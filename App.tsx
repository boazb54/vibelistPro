import React, { useState, useEffect, useCallback, useRef } from 'react';
import MoodSelector from './components/MoodSelector';
import PlaylistView from './components/PlaylistView';
import PlayerControls from './components/PlayerControls';
import SettingsOverlay from './components/SettingsOverlay';
import { CogIcon } from './components/Icons'; 
import { Playlist, Song, PlayerState, SpotifyUserProfile, UserTasteProfile, VibeGenerationStats, ContextualSignals } from './types';
import { generatePlaylistFromMood, analyzeUserTopTracks } from './services/geminiService';
import { aggregateSessionData } from './services/dataAggregator';
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
  fetchUserTasteProfile
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
  const [showSettings, setShowSettings] = useState(false);

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
          // 1. FETCH TASTE
          const taste = await fetchUserTasteProfile(token);
          if (taste) {
              // 1.5 LOG TOP ARTISTS
              addLog("--- TOP 50 ARTISTS ---");
              addLog(JSON.stringify(taste.topArtists.slice(0, 10), null, 2) + ` ...and ${Math.max(0, taste.topArtists.length - 10)} more`);

              // 2. TRIGGER GEMINI ANALYSIS
              if (taste.topTracks.length > 0) {
                  addLog("Sending Top Tracks to Gemini for Feature Analysis (Energy, Mood, Genre)...");
                  
                  // Run in background so we don't block the UI, but update taste state when done
                  analyzeUserTopTracks(taste.topTracks)
                      .then((analysis) => {
                          if ('error' in analysis) {
                              addLog(`Gemini Analysis Error: ${analysis.error}`);
                              setUserTaste(taste); // Set basics even if AI fails
                              return;
                          }

                          addLog("--- GEMINI AUDIO ANALYSIS & GENRE (RAW) ---");
                          addLog(`Analyzed ${analysis.length} tracks.`);
                          // addLog(JSON.stringify(analysis[0], null, 2)); // Log first one as example

                          // 3. AGGREGATE SESSION DATA (DETERMINISTIC MATH)
                          addLog("--- AGGREGATING SESSION PROFILE (TYPESCRIPT) ---");
                          const sessionProfile = aggregateSessionData(analysis);
                          
                          addLog(JSON.stringify(sessionProfile, null, 2));
                          
                          // Update taste with the AI enhanced profile
                          const enhancedTaste: UserTasteProfile = {
                              ...taste,
                              session_analysis: sessionProfile
                          };
                          
                          setUserTaste(enhancedTaste);
                          saveUserProfile(profile, enhancedTaste);
                      })
                      .catch(err => {
                          addLog(`Gemini Analysis Failed: ${err.message}`);
                          setUserTaste(taste);
                      });
              } else {
                  setUserTaste(taste);
                  saveUserProfile(profile, taste);
              }
          } else {
              saveUserProfile(profile, null);
          }
      } catch (e) {
          console.warn("Could not load taste profile", e);
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
        setShowSettings(true);
    } else {
        alert("Please login first to manage your settings.");
        handleLogin();
    }
  };

  const handleSignOut = () => {
    setSpotifyToken(null);
    setUserProfile(null);
    setUserTaste(null);
    localStorage.removeItem('spotify_token');
    localStorage.removeItem('spotify_refresh_token');
    setShowSettings(false);
    handleReset(); // Reset the UI/Player state
  };

  // --- SAFE MODE LOGIC: SEQUENTIAL & STRICT ---
  const handleMoodSelect = async (mood: string, modality: 'text' | 'voice' = 'text', isRemix: boolean = false) => {
    const currentSessionId = ++generationSessionId.current;
    
    // --- 1. CAPTURE CONTEXTUAL DATA ---
    const localTime = new Date().toLocaleTimeString();
    const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const browserLanguage = navigator.language;
    const deviceType = /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
    
    const ipPromise = fetch('https://api.ipify.org?format=json')
        .then(res => res.json())
        .then(data => data.ip)
        .catch(() => 'unknown');

    const t0_start = performance.now();
    let t1_gemini_end = 0;
    let t2_itunes_start = 0;
    let t3_itunes_end = 0;
    let capturedPromptText = "";
    let capturedContextTime = 0;

    const failureDetails: { title: string, artist: string, reason: string }[] = [];

    setIsLoading(true);
    setLoadingMessage(isRemix ? 'Remixing...' : 'Curating vibes...');
    
    const excludeSongs = isRemix && playlist ? playlist.songs.map(s => s.title) : undefined;
    
    setPlaylist(null);
    setCurrentSong(null);
    setPlayerState(PlayerState.STOPPED);
    
    // NOTE: Removed setDebugLogs([]) to preserve the Taste Profile logs in the debugger

    addLog(`Generating vibe for: "${mood}" (${modality})...`);

    const t_context_start = performance.now();

    // NEW: Pack contextual signals strictly
    const contextSignals: ContextualSignals = {
        local_time: localTime,
        day_of_week: dayOfWeek,
        device_type: deviceType,
        input_modality: modality,
        browser_language: browserLanguage,
        country: userProfile?.country
    };

    const t_context_end = performance.now();
    const contextTimeMs = Math.round(t_context_end - t_context_start);
    capturedContextTime = contextTimeMs;

    try {
        // 1. CALL GEMINI (STEPS C & D)
        // Pass contextSignals directly instead of loose parameters
        const generatedData = await generatePlaylistFromMood(
            mood, 
            contextSignals, 
            userTaste || undefined, 
            excludeSongs
        );

        capturedPromptText = generatedData.promptText;
        t1_gemini_end = performance.now(); 

        // --- ADDED FOR QA: Log full prompt context ---
        addLog("--- CONTEXTUAL PROMPT PAYLOAD ---");
        addLog(generatedData.promptText);
        // ---------------------------------------------

        if (currentSessionId !== generationSessionId.current) return;

        addLog("AI generation complete. Fetching metadata (Safe Mode)...");
        t2_itunes_start = performance.now();

        // 2. BATCH FETCH (Sequential Chunks)
        const validSongs: Song[] = [];
        const BATCH_SIZE = 5; 
        const allSongsRaw = generatedData.songs;

        for (let i = 0; i < allSongsRaw.length; i += BATCH_SIZE) {
             if (currentSessionId !== generationSessionId.current) return;
             
             const batch = allSongsRaw.slice(i, i + BATCH_SIZE);
             const batchPromises = batch.map(raw => fetchSongMetadata(raw));
             
             const results = await Promise.all(batchPromises);
             
             results.forEach((s, index) => {
                 if (s !== null) {
                     validSongs.push(s);
                 } else {
                     const rawSong = batch[index];
                     failureDetails.push({
                         title: rawSong.title,
                         artist: rawSong.artist,
                         reason: "Metadata or Preview not found in iTunes"
                     });
                 }
             });
             
             await new Promise(r => setTimeout(r, 100));
        }

        t3_itunes_end = performance.now();

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

        // 4. SAVE (With Granular Metrics + Context)
        const t4_total_end = performance.now();
        const ipAddress = await ipPromise; 
        
        const stats: VibeGenerationStats = {
            geminiTimeMs: Math.round(t1_gemini_end - t0_start), 
            itunesTimeMs: Math.round(t3_itunes_end - t2_itunes_start), 
            totalDurationMs: Math.round(t4_total_end - t0_start),
            
            contextTimeMs: contextTimeMs, 
            promptBuildTimeMs: generatedData.metrics.promptBuildTimeMs, 
            geminiApiTimeMs: generatedData.metrics.geminiApiTimeMs, 
            promptText: generatedData.promptText,

            successCount: validSongs.length,
            failCount: failureDetails.length,
            failureDetails: failureDetails,

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
        
        const t_fail = performance.now();
        const failDuration = Math.round(t_fail - t0_start);
        const ipAddress = await ipPromise; 

        await logGenerationFailure(
            mood,
            error?.message || "Unknown error",
            userProfile?.id || null,
            {
                totalDurationMs: failDuration,
                contextTimeMs: capturedContextTime,
                promptText: capturedPromptText,
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

           <button 
             onClick={() => setShowDebug(!showDebug)} 
             className="text-xs text-slate-700 hover:text-slate-500 font-mono"
             title="Debug"
           >
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
          <div className="fixed bottom-20 right-4 w-80 h-96 bg-black/95 text-green-400 font-mono text-xs p-4 overflow-y-auto z-[60] border border-green-800 rounded-lg shadow-2xl">
              <div className="flex justify-between border-b border-green-900 pb-1 mb-2">
                  <span>DEBUG LOGS</span>
                  <button onClick={() => setDebugLogs([])}>Clear</button>
              </div>
              {debugLogs.map((log, i) => (
                  <div key={i} className="mb-1 break-words whitespace-pre-wrap">{log}</div>
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
      
      {/* SETTINGS OVERLAY (Renamed back to SettingsOverlay) */}
      <SettingsOverlay 
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        userProfile={userProfile}
        onSignOut={handleSignOut}
      />
    </div>
  );
};

export default App;