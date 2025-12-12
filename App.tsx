
import React, { useState, useEffect, useCallback, useRef } from 'react';
import MoodSelector from './components/MoodSelector';
import PlaylistView from './components/PlaylistView';
import PlayerControls from './components/PlayerControls';
import { CogIcon } from './components/Icons'; 
import { Playlist, Song, PlayerState, SpotifyUserProfile, UserTasteProfile, VibeGenerationStats } from './types';
import { generatePlaylistFromMood } from './services/geminiService';
import { fetchSongMetadata } from './services/itunesService';
import { 
  getLoginUrl, 
  getPkceLoginUrl,
  exchangeCodeForToken,
  refreshSpotifyToken,
  getTokenFromHash, 
  createSpotifyPlaylist, 
  getUserProfile, 
  fetchSpotifyMetadata,
  fetchUserTopArtists
} from './services/spotifyService';
import { generateRandomString, generateCodeChallenge } from './services/pkceService';
import { saveVibe, markVibeAsExported, saveUserProfile, logGenerationFailure } from './services/historyService';
import { supabase } from './services/supabaseClient';
import { DEFAULT_SPOTIFY_CLIENT_ID, DEFAULT_REDIRECT_URI } from './constants';

const App: React.FC = () => {
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Curating vibes...');
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [playerState, setPlayerState] = useState<PlayerState>(PlayerState.STOPPED);
  const [spotifyToken, setSpotifyToken] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<SpotifyUserProfile | null>(null);
  const [userTaste, setUserTaste] = useState<UserTasteProfile | null>(null);
  const [exporting, setExporting] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  // FIX: Race condition lock for strict mode / fast mobile browsers
  const authProcessed = useRef(false);
  // FIX: Track generation sessions
  const generationSessionId = useRef(0);

  const spotifyClientId = localStorage.getItem('spotify_client_id') || DEFAULT_SPOTIFY_CLIENT_ID;

  const addLog = (msg: string) => {
    setDebugLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  useEffect(() => {
    const storedToken = localStorage.getItem('spotify_token');
    if (storedToken) {
      setSpotifyToken(storedToken);
      fetchProfile(storedToken);
    }
    
    handleSpotifyAuth();

    // Check for shared vibe in URL
    const params = new URLSearchParams(window.location.search);
    const sharedMood = params.get('mood');
    if (sharedMood) {
       window.history.replaceState({}, '', window.location.pathname);
       setTimeout(() => {
         if (!playlist) handleMoodSelect(sharedMood, 'text');
       }, 500);
    }
  }, []);

  const handleSpotifyAuth = async () => {
    if (authProcessed.current) return;

    const code = new URLSearchParams(window.location.search).get('code');
    const token = getTokenFromHash();

    if (code) {
      authProcessed.current = true;
      window.location.hash = ""; 
      const verifier = localStorage.getItem('code_verifier');
      if (verifier) {
        try {
          const data = await exchangeCodeForToken(spotifyClientId, DEFAULT_REDIRECT_URI, code, verifier);
          handleSuccessFullAuth(data.access_token, data.refresh_token);
        } catch (e) {
          console.error("PKCE Exchange failed", e);
        }
      }
    } else if (token) {
      authProcessed.current = true;
      window.location.hash = "";
      handleSuccessFullAuth(token);
    }
  };

  const handleSuccessFullAuth = (accessToken: string, refreshToken?: string) => {
    setSpotifyToken(accessToken);
    localStorage.setItem('spotify_token', accessToken);
    if (refreshToken) {
      localStorage.setItem('spotify_refresh_token', refreshToken);
    }
    fetchProfile(accessToken);
  };

  const fetchProfile = async (token: string) => {
    try {
      const profile = await getUserProfile(token);
      setUserProfile(profile);
      // Pass profile down so we can save it immediately
      refreshProfileAndTaste(token, profile);
    } catch (e) {
      console.error("Failed to fetch profile", e);
      localStorage.removeItem('spotify_token');
      setSpotifyToken(null);
    }
  };

  const refreshProfileAndTaste = async (token: string, profile: SpotifyUserProfile) => {
      try {
          const taste = await fetchUserTopArtists(token);
          if (taste) {
              setUserTaste(taste);
              addLog(`Taste profile loaded: ${taste.topGenres.slice(0, 3).join(', ')}`);
              
              // NEW: Save entire profile + taste to Supabase 'users' table
              saveUserProfile(profile, taste);
          } else {
              // Even if taste fails, save basic profile
              saveUserProfile(profile, null);
          }
      } catch (e) {
          console.warn("Could not load taste profile", e);
          // Still try to save basic profile
          saveUserProfile(profile, null);
      }
  };

  const handleLogin = async () => {
    const verifier = generateRandomString(128);
    const challenge = await generateCodeChallenge(verifier);
    localStorage.setItem('code_verifier', verifier);
    const url = getPkceLoginUrl(spotifyClientId, DEFAULT_REDIRECT_URI, challenge);
    window.location.href = url;
  };

  const handleSettings = () => {
    if (spotifyToken) {
        if (confirm("Logout of Spotify?")) {
            setSpotifyToken(null);
            setUserProfile(null);
            localStorage.removeItem('spotify_token');
            localStorage.removeItem('spotify_refresh_token');
        }
    } else {
        alert("Settings: Please login first to manage your account.");
    }
  };

  const refreshSessionIfNeeded = async (): Promise<string | null> => {
    if (!spotifyToken) return null;
    return spotifyToken;
  };

  // --- SAFE MODE LOGIC: SEQUENTIAL & STRICT ---
  const handleMoodSelect = async (mood: string, modality: 'text' | 'voice' = 'text', isRemix: boolean = false) => {
    const currentSessionId = ++generationSessionId.current;
    
    // --- 1. CAPTURE CONTEXTUAL DATA ---
    // We capture this *before* generation so we reflect the state at click time.
    const localTime = new Date().toLocaleTimeString();
    const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const browserLanguage = navigator.language;
    const deviceType = /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
    
    // Start IP fetch in background (don't await it yet)
    const ipPromise = fetch('https://api.ipify.org?format=json')
        .then(res => res.json())
        .then(data => data.ip)
        .catch(() => 'unknown');

    // PERFORMANCE TRACKING START
    const t0_start = performance.now();
    let t1_gemini_end = 0;
    let t2_itunes_start = 0;
    let t3_itunes_end = 0;
    // Capture these for error logging if needed
    let capturedPromptText = "";
    let capturedContextTime = 0;

    const failureDetails: { title: string, artist: string, reason: string }[] = [];

    setIsLoading(true);
    setLoadingMessage(isRemix ? 'Remixing...' : 'Curating vibes...');
    
    const excludeSongs = isRemix && playlist ? playlist.songs.map(s => s.title) : undefined;
    
    setPlaylist(null);
    setCurrentSong(null);
    setPlayerState(PlayerState.STOPPED);
    setDebugLogs([]);

    addLog(`Generating vibe for: "${mood}" (${modality})...`);

    // MEASURE STEP B: Context Assembly
    const t_context_start = performance.now();
    let userContext = {};
    if (userProfile) {
        userContext = {
            country: userProfile.country,
            explicit_filter_enabled: userProfile.explicit_content?.filter_enabled
        };
    }
    const t_context_end = performance.now();
    const contextTimeMs = Math.round(t_context_end - t_context_start);
    capturedContextTime = contextTimeMs;

    try {
        // 1. CALL GEMINI (STEPS C & D)
        const generatedData = await generatePlaylistFromMood(
            mood, 
            userContext, 
            userTaste || undefined, 
            excludeSongs
        );

        // Capture data for potential error logging
        capturedPromptText = generatedData.promptText;
        t1_gemini_end = performance.now(); // Gemini Phase Done

        if (currentSessionId !== generationSessionId.current) return;

        addLog("AI generation complete. Fetching metadata (Safe Mode)...");
        t2_itunes_start = performance.now(); // iTunes Start (Step E)

        // 2. BATCH FETCH (Sequential Chunks) - STEP E
        // We use smaller chunks and wait for them to ensure high success rate
        const validSongs: Song[] = [];
        const BATCH_SIZE = 5; 
        const allSongsRaw = generatedData.songs;

        for (let i = 0; i < allSongsRaw.length; i += BATCH_SIZE) {
             if (currentSessionId !== generationSessionId.current) return;
             
             const batch = allSongsRaw.slice(i, i + BATCH_SIZE);
             const batchPromises = batch.map(raw => fetchSongMetadata(raw));
             
             const results = await Promise.all(batchPromises);
             
             // STRICT FILTER & LOGGING
             results.forEach((s, index) => {
                 if (s !== null) {
                     validSongs.push(s);
                 } else {
                     // Log missing songs
                     const rawSong = batch[index];
                     failureDetails.push({
                         title: rawSong.title,
                         artist: rawSong.artist,
                         reason: "Metadata or Preview not found in iTunes"
                     });
                 }
             });
             
             // Optional: Add a tiny delay to be polite to the API
             await new Promise(r => setTimeout(r, 100));
        }

        t3_itunes_end = performance.now(); // iTunes End

        if (currentSessionId !== generationSessionId.current) return;

        // 3. FINAL UPDATE
        const finalPlaylist: Playlist = {
            title: generatedData.playlist_title,
            mood: generatedData.mood,
            description: generatedData.description,
            songs: validSongs
        };
        
        setPlaylist(finalPlaylist);
        setIsLoading(false);
        addLog(`Complete. Found ${validSongs.length}/${allSongsRaw.length} songs with previews.`);

        // 4. SAVE (Step F) (With Granular Metrics + Context)
        const t4_total_end = performance.now();
        const ipAddress = await ipPromise; // Resolve IP now
        
        const stats: VibeGenerationStats = {
            // High Level
            geminiTimeMs: Math.round(t1_gemini_end - t0_start), // B+C+D
            itunesTimeMs: Math.round(t3_itunes_end - t2_itunes_start), // E
            totalDurationMs: Math.round(t4_total_end - t0_start),
            
            // Granular
            contextTimeMs: contextTimeMs, // B
            promptBuildTimeMs: generatedData.metrics.promptBuildTimeMs, // C
            geminiApiTimeMs: generatedData.metrics.geminiApiTimeMs, // D
            promptText: generatedData.promptText,

            successCount: validSongs.length,
            failCount: failureDetails.length,
            failureDetails: failureDetails,

            // Contextual Analytics
            localTime,
            dayOfWeek,
            browserLanguage,
            inputModality: modality,
            deviceType,
            ipAddress
        };

        try {
            const { data: savedVibe, error: saveError } = await saveVibe(mood, finalPlaylist, userProfile?.id || null, stats);
            
            if (saveError) {
                addLog(`Database Error: ${saveError.message}`);
                setShowDebug(true); 
            } else if (savedVibe) {
                setPlaylist(prev => prev ? { ...prev, id: savedVibe.id } : null);
                addLog(`Vibe saved to memory (ID: ${savedVibe.id})`);
            }
        } catch (dbErr) {
            console.error(dbErr);
        }

    } catch (error: any) {
        console.error("Generation failed", error);
        
        // --- FAILURE LOGGING SYSTEM ---
        const t_fail = performance.now();
        const failDuration = Math.round(t_fail - t0_start);
        const ipAddress = await ipPromise; // Resolve IP even for errors

        // Log the failure to Supabase so we know what caused it
        // and what the user was trying to do.
        await logGenerationFailure(
            mood,
            error?.message || "Unknown error",
            userProfile?.id || null,
            {
                totalDurationMs: failDuration,
                contextTimeMs: capturedContextTime,
                promptText: capturedPromptText,
                // Add context to failures too
                localTime,
                dayOfWeek,
                browserLanguage,
                inputModality: modality,
                deviceType,
                ipAddress
            }
        );

        setLoadingMessage("Error generating playlist. Please try again.");
        setTimeout(() => setIsLoading(false), 2000);
    }
  };

  // --- ACTIONS ---

  const handleReset = () => {
    setPlaylist(null);
    setCurrentSong(null);
    setPlayerState(PlayerState.STOPPED);
  };

  const handleRemix = () => {
      if (playlist) {
          // Pass 'text' as default modality for remix, or we could track it? 
          // For now, remix is considered a button click -> 'text'.
          handleMoodSelect(playlist.mood, 'text', true);
      }
  };

  const handleShare = () => {
      if (!playlist) return;
      const url = `${window.location.origin}/?mood=${encodeURIComponent(playlist.mood)}`;
      navigator.clipboard.writeText(url).then(() => {
          alert(`Vibe link copied to clipboard!\n${url}`);
      });
  };

  const handlePlaySong = (song: Song) => {
    if (currentSong?.id === song.id) {
      if (playerState === PlayerState.PLAYING) {
        setPlayerState(PlayerState.PAUSED);
      } else {
        setPlayerState(PlayerState.PLAYING);
      }
    } else {
      setCurrentSong(song);
      setPlayerState(PlayerState.PLAYING);
    }
  };

  const handlePause = () => {
    setPlayerState(PlayerState.PAUSED);
  };

  const handleNext = () => {
    if (!playlist || !currentSong) return;
    const idx = playlist.songs.findIndex(s => s.id === currentSong.id);
    if (idx < playlist.songs.length - 1) {
      handlePlaySong(playlist.songs[idx + 1]);
    } else {
      setPlayerState(PlayerState.STOPPED);
    }
  };

  const handlePrev = () => {
    if (!playlist || !currentSong) return;
    const idx = playlist.songs.findIndex(s => s.id === currentSong.id);
    if (idx > 0) {
      handlePlaySong(playlist.songs[idx - 1]);
    }
  };

  const handleExportToSpotify = async () => {
    if (!playlist || !spotifyToken || !userProfile) {
      handleLogin();
      return;
    }
    setExporting(true);
    try {
      const url = await createSpotifyPlaylist(spotifyToken, playlist, userProfile.id);
      if (playlist.id) {
          await markVibeAsExported(playlist.id);
      }
      window.open(url, '_blank');
    } catch (e: any) {
      alert(`Failed to export: ${e.message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleClosePlayer = () => {
      setPlayerState(PlayerState.STOPPED);
      setCurrentSong(null); 
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-white flex flex-col relative overflow-hidden">
      {/* BACKGROUND ELEMENTS */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-20 -left-20 w-96 h-96 bg-purple-900 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob"></div>
        <div className="absolute top-40 right-10 w-96 h-96 bg-cyan-900 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>
        <div className="absolute -bottom-20 left-1/2 w-96 h-96 bg-pink-900 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-4000"></div>
      </div>

      {/* HEADER */}
      <header className="relative z-10 w-full p-6 flex justify-between items-center glass-panel border-b border-white/5">
        <div className="flex items-center gap-2 cursor-pointer" onClick={handleReset}>
           <div className="w-8 h-8 bg-gradient-to-tr from-purple-500 to-cyan-400 rounded-lg flex items-center justify-center">
             <span className="font-bold text-white">V+</span>
           </div>
           <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400 hidden md:block">
             VibeList+
           </h1>
        </div>
        
        <div className="flex items-center gap-4">
           {/* Settings Button */}
           <button onClick={handleSettings} className="text-slate-400 hover:text-white transition-colors" title="Settings">
               <CogIcon className="w-6 h-6" />
           </button>

           <button onClick={() => setShowDebug(!showDebug)} className="text-xs text-slate-700 hover:text-slate-500">
               π
           </button>

           {!spotifyToken ? (
             <button 
               onClick={handleLogin}
               className="text-sm font-medium bg-[#1DB954] text-black px-5 py-2 rounded-full hover:bg-[#1ed760] transition-all shadow-lg hover:shadow-[#1DB954]/20"
             >
               Login with Spotify
             </button>
           ) : (
             <div className="flex items-center gap-3 bg-white/5 px-4 py-1.5 rounded-full border border-white/10">
               {userProfile?.images?.[0] ? (
                 <img src={userProfile.images[0].url} alt="Profile" className="w-6 h-6 rounded-full border border-white/20" />
               ) : (
                 <div className="w-6 h-6 rounded-full bg-purple-500 flex items-center justify-center text-xs font-bold">
                    {userProfile?.display_name?.[0] || 'U'}
                 </div>
               )}
               <span className="text-sm font-medium text-slate-200 hidden md:block">
                 {userProfile?.display_name}
               </span>
             </div>
           )}
        </div>
      </header>

      {/* DEBUG CONSOLE */}
      {showDebug && (
          <div className="fixed bottom-20 right-4 w-80 h-64 bg-black/90 text-green-400 font-mono text-xs p-4 overflow-y-auto z-[60] border border-green-800 rounded-lg shadow-2xl">
              <div className="flex justify-between border-b border-green-900 pb-1 mb-2">
                  <span>DEBUG LOGS</span>
                  <button onClick={() => setDebugLogs([])}>Clear</button>
              </div>
              {debugLogs.map((log, i) => (
                  <div key={i} className="mb-1">{log}</div>
              ))}
          </div>
      )}

      {/* MAIN CONTENT */}
      <main className="relative z-10 flex-grow flex flex-col items-center justify-center p-4">
        {isLoading ? (
          <div className="text-center animate-fade-in">
            <div className="relative w-24 h-24 mx-auto mb-8">
               <div className="absolute inset-0 border-4 border-slate-700 rounded-full"></div>
               <div className="absolute inset-0 border-4 border-purple-500 rounded-full border-t-transparent animate-spin"></div>
               <div className="absolute inset-0 flex items-center justify-center">
                 <span className="text-2xl">✨</span>
               </div>
            </div>
            <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-cyan-400 animate-pulse">
              {loadingMessage}
            </h2>
            <p className="text-slate-500 mt-2">Consulting the oracles...</p>
          </div>
        ) : !playlist ? (
          <MoodSelector onSelectMood={handleMoodSelect} isLoading={isLoading} />
        ) : (
          <PlaylistView 
            playlist={playlist}
            currentSong={currentSong}
            playerState={playerState}
            onPlaySong={handlePlaySong}
            onPause={handlePause}
            onReset={handleReset}
            onExport={handleExportToSpotify}
            onDownloadCsv={() => {}}
            onYouTubeExport={() => {}}
            onRemix={handleRemix}
            onShare={handleShare}
            exporting={exporting}
          />
        )}
      </main>

      {/* PLAYER */}
      <PlayerControls 
        currentSong={currentSong}
        playerState={playerState}
        onTogglePlay={() => playerState === PlayerState.PLAYING ? handlePause() : currentSong && handlePlaySong(currentSong)}
        onNext={handleNext}
        onPrev={handlePrev}
        onClose={handleClosePlayer} 
        playlistTitle={playlist?.title}
      />
    </div>
  );
};

export default App;
