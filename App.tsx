import React, { useState, useEffect, useCallback, useRef } from 'react';
import MoodSelector from './components/MoodSelector';
import PlaylistView from './components/PlaylistView';
import PlayerControls from './components/PlayerControls';
import { Playlist, Song, PlayerState, SpotifyUserProfile, UserTasteProfile } from './types';
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
import { saveVibe, markVibeAsExported } from './services/historyService';
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
  // FIX: Track generation sessions to prevent race conditions during Instant Render
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
       // Clean URL so we don't loop or clutter
       window.history.replaceState({}, '', window.location.pathname);
       // Trigger generation if not already doing so
       // We need a small delay to ensure auth is processed if present
       setTimeout(() => {
         if (!playlist) handleMoodSelect(sharedMood);
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
      
      // NEW: Fetch Taste Profile for Discovery
      refreshProfileAndTaste(token);
    } catch (e) {
      console.error("Failed to fetch profile", e);
      // If unauthorized, clear token
      localStorage.removeItem('spotify_token');
      setSpotifyToken(null);
    }
  };

  const refreshProfileAndTaste = async (token: string) => {
      try {
          // 1. Taste
          const taste = await fetchUserTopArtists(token);
          if (taste) {
              setUserTaste(taste);
              addLog(`Taste profile loaded: ${taste.topGenres.slice(0, 3).join(', ')}`);
          }
      } catch (e) {
          console.warn("Could not load taste profile", e);
      }
  };

  const handleLogin = async () => {
    // Generate PKCE
    const verifier = generateRandomString(128);
    const challenge = await generateCodeChallenge(verifier);
    
    localStorage.setItem('code_verifier', verifier);
    const url = getPkceLoginUrl(spotifyClientId, DEFAULT_REDIRECT_URI, challenge);
    window.location.href = url;
  };

  const refreshSessionIfNeeded = async (): Promise<string | null> => {
    if (!spotifyToken) return null;
    // Simple check: if we get 401 later, we handle it. 
    // Ideally check expiration time. For now, rely on existing token.
    return spotifyToken;
  };

  // --- REFACTORED CORE LOGIC: INSTANT RENDER & PARALLEL BURST ---
  const handleMoodSelect = async (mood: string, isRemix: boolean = false) => {
    // Increment session ID to invalidate any previous running generations
    // This handles the case where user clicks "Remix" quickly multiple times
    const currentSessionId = ++generationSessionId.current;

    setIsLoading(true);
    setLoadingMessage(isRemix ? 'Remixing...' : 'Curating vibes...');
    
    // If remixing, we grab current songs to exclude them (Anti-Repetition)
    const excludeSongs = isRemix && playlist ? playlist.songs.map(s => s.title) : undefined;
    
    // Clear previous state (optional, but good for "Loading" feedback)
    setPlaylist(null);
    setCurrentSong(null);
    setPlayerState(PlayerState.STOPPED);
    setDebugLogs([]); // Start fresh logs

    addLog(`Generating vibe for: "${mood}"...`);

    // Prepare Context
    let userContext = {};
    if (userProfile) {
        userContext = {
            country: userProfile.country,
            explicit_filter_enabled: userProfile.explicit_content?.filter_enabled
        };
    }

    try {
        // 1. CALL GEMINI (The Brain)
        // ~3-4 seconds
        const generatedData = await generatePlaylistFromMood(
            mood, 
            userContext, 
            userTaste || undefined, 
            excludeSongs
        );

        // RACE CONDITION CHECK
        if (currentSessionId !== generationSessionId.current) return;

        // 2. INSTANT RENDER (The Sketch)
        // We immediately show the song titles while fetching audio in background.
        // This makes the app feel INSTANT (4s) instead of slow (40s).
        const skeletonSongs: Song[] = generatedData.songs.map((s, idx) => ({
            id: `temp-${idx}`, // Temporary ID
            title: s.title,
            artist: s.artist,
            album: s.album,
            previewUrl: null, // No audio yet
            artworkUrl: null, // No art yet
            searchQuery: s.search_query
        }));

        const skeletonPlaylist: Playlist = {
            title: generatedData.playlist_title,
            mood: generatedData.mood,
            description: generatedData.description,
            songs: skeletonSongs
        };

        setPlaylist(skeletonPlaylist); // SHOW UI NOW
        setIsLoading(false); // HIDE LOADING SPINNER
        addLog("Instant render complete. Hydrating metadata...");

        // 3. BURST FETCHING (The Painting)
        // Fetch metadata in parallel chunks (Burst Mode)
        const allSongsRaw = generatedData.songs;
        const validSongs: Song[] = [];
        const CHUNK_SIZE = 12; // Process 12 songs at a time (Fast)

        const token = await refreshSessionIfNeeded();

        for (let i = 0; i < allSongsRaw.length; i += CHUNK_SIZE) {
             // Check if user cancelled/remixed while we were fetching
             if (currentSessionId !== generationSessionId.current) return;

             const batch = allSongsRaw.slice(i, i + CHUNK_SIZE);
             addLog(`Hydrating batch ${Math.floor(i / CHUNK_SIZE) + 1}...`);

             // Fire all requests in parallel
             const results = await Promise.all(batch.map(async (raw) => {
                 try {
                     // Primary: iTunes for Previews
                     // Future: We can use fetchSpotifyMetadata(token, raw) if we prefer
                     return await fetchSongMetadata(raw);
                 } catch (e) {
                     console.warn(`Failed metadata for ${raw.title}`);
                     return null;
                 }
             }));

             validSongs.push(...results.filter((s): s is Song => s !== null));
        }

        if (currentSessionId !== generationSessionId.current) return;

        // 4. FINAL UPDATE (Rich Data)
        // Update the UI with the fully loaded songs (Images/Audio pop in)
        const finalPlaylist: Playlist = {
            ...skeletonPlaylist,
            songs: validSongs
        };
        setPlaylist(finalPlaylist);
        addLog("Hydration complete. UI Updated.");

        // 5. MEMORY & LEARNING (Save to Supabase)
        try {
            const { data: savedVibe, error: saveError } = await saveVibe(mood, finalPlaylist, userProfile?.id || null);
            
            if (saveError) {
                addLog(`Database Error: ${saveError.message}`);
                // Auto-open debug if DB fails so we can see why
                setShowDebug(true); 
            } else if (savedVibe) {
                // Attach the DB ID to the playlist in state so we can track exports later
                setPlaylist(prev => prev ? { ...prev, id: savedVibe.id } : null);
                addLog(`Vibe saved to memory (ID: ${savedVibe.id})`);
            }
        } catch (dbErr) {
            console.error(dbErr);
        }

    } catch (error: any) {
        console.error("Generation failed", error);
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
          handleMoodSelect(playlist.mood, true);
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
      
      // TRACK SUCCESS
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
           {/* Debug Toggle (Hidden unless clicked) */}
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
        onClose={() => setPlayerState(PlayerState.STOPPED)}
        playlistTitle={playlist?.title}
      />
    </div>
  );
};

export default App;