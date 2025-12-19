
import React, { useState, useEffect, useCallback, useRef } from 'react';
import MoodSelector from './components/MoodSelector';
import PlaylistView from './components/PlaylistView';
import PlayerControls from './components/PlayerControls';
import SettingsOverlay from './components/SettingsOverlay';
import { CogIcon } from './components/Icons'; 
import type { Playlist, Song, PlayerState, SpotifyUserProfile, UserTasteProfile, VibeGenerationStats, ContextualSignals, PlaylistIntelligence, PlaylistData } from './types';
import { generatePlaylistFromMood, analyzeUserTopTracks, analyzePlaylistIntelligence } from './services/geminiService';
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
  fetchUserTasteProfile,
  fetchUserPlaylists,
  fetchPlaylistTracks
} from './services/spotifyService';
import { generateRandomString, generateCodeChallenge } from './services/pkceService';
import { saveVibe, markVibeAsExported, saveUserProfile } from './services/historyService';

// Enums must be imported as values
import { PlayerState as PlayerStateEnum } from './types';

const App: React.FC = () => {
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Curating vibes...');
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [playerState, setPlayerState] = useState<PlayerState>(PlayerStateEnum.STOPPED);
  const [spotifyToken, setSpotifyToken] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<SpotifyUserProfile | null>(null);
  const [userTaste, setUserTaste] = useState<UserTasteProfile | null>(null);
  const [exporting, setExporting] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const authProcessed = useRef(false);
  const generationSessionId = useRef(0);

  const spotifyClientId = localStorage.getItem('spotify_client_id') || "b292c19608a44142990530a7e9595b8a";
  const DEFAULT_REDIRECT_URI = typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
    ? `${window.location.origin}/` 
    : "https://example.com/";

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
      refreshProfileAndTaste(token, profile);
    } catch (e) {
      console.error("Failed to fetch profile", e);
      localStorage.removeItem('spotify_token');
      setSpotifyToken(null);
    }
  };

  const refreshProfileAndTaste = async (token: string, profile: SpotifyUserProfile) => {
      try {
          const taste = await fetchUserTasteProfile(token);
          if (taste) {
              addLog("--- TOP 50 ARTISTS ---");
              addLog(JSON.stringify(taste.topArtists.slice(0, 10), null, 2) + ` ...and ${Math.max(0, taste.topArtists.length - 10)} more`);

              if (taste.topTracks.length > 0) {
                  addLog("Sending Top Tracks to Gemini for Feature Analysis...");
                  analyzeUserTopTracks(taste.topTracks)
                      .then((analysis) => {
                          if ('error' in analysis) {
                              addLog(`Gemini Analysis Error: ${analysis.error}`);
                              setUserTaste(taste);
                              return;
                          }
                          addLog("--- GEMINI AUDIO ANALYSIS & GENRE (RAW) ---");
                          const sessionProfile = aggregateSessionData(analysis);
                          addLog(JSON.stringify(sessionProfile, null, 2));
                          
                          const enhancedTaste: UserTasteProfile = {
                              ...taste,
                              session_analysis: sessionProfile
                          };
                          setUserTaste(enhancedTaste);
                          saveUserProfile(profile, enhancedTaste);
                      });
              }

              addLog("Fetching User Playlists for Intelligence Analysis...");
              const playlists = await fetchUserPlaylists(token, 10);
              if (playlists.length > 0) {
                  const playlistData: PlaylistData[] = await Promise.all(playlists.map(async (p: any) => ({
                      name: p.name,
                      tracks: await fetchPlaylistTracks(token, p.id, 20)
                  })));

                  addLog("Sending Playlists to Gemini for Archetype Discovery...");
                  analyzePlaylistIntelligence(playlistData)
                    .then((intelligence) => {
                        addLog("--- SPOTIFY PLAYLIST INTELLIGENCE ---");
                        intelligence.forEach(intel => {
                            addLog(`\n1) PLAYLIST NAME: ${intel.name}`);
                            addLog(`2) TRACKS NAME + ARTIST NAME: ${intel.tracks.join(', ')}`);
                            addLog(`3) LIST OF GENRE (TOP 3 GENRES): ${intel.top_genres.join(', ')}`);
                            addLog(`4) AVERAGE (THE AVERAGE RATE OF THE AUDIO FEATURE): Energy: ${intel.audio_averages.energy}, Tempo: ${intel.audio_averages.tempo}, Texture: ${intel.audio_averages.texture}`);
                            addLog(`5) GEMINI INTERPRETATIONS OF THE "Organizational Archetypes": ${intel.archetype}`);
                        });

                        setUserTaste(prev => prev ? {
                            ...prev,
                            playlist_intelligence: intelligence
                        } : null);
                    });
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
    handleReset();
  };

  const handleMoodSelect = async (mood: string, modality: 'text' | 'voice' = 'text', isRemix: boolean = false) => {
    const currentSessionId = ++generationSessionId.current;
    
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
    setPlayerState(PlayerStateEnum.STOPPED);
    
    addLog(`Generating vibe for: "${mood}" (${modality})...`);

    const t_context_start = performance.now();
    const contextSignals: ContextualSignals = {
        local_time: localTime,
        day_of_week: dayOfWeek,
        device_type: deviceType,
        input_modality: modality,
        browser_language: browserLanguage,
        country: userProfile?.country
    };
    const t_context_end = performance.now();
    capturedContextTime = Math.round(t_context_end - t_context_start);

    try {
        const generatedData = await generatePlaylistFromMood(mood, contextSignals, userTaste || undefined, excludeSongs);
        capturedPromptText = generatedData.promptText;
        t1_gemini_end = performance.now(); 

        addLog("--- CONTEXTUAL PROMPT PAYLOAD ---");
        addLog(generatedData.promptText);

        if (currentSessionId !== generationSessionId.current) return;

        addLog("AI generation complete. Fetching metadata...");
        t2_itunes_start = performance.now();

        const validSongs: Song[] = [];
        const BATCH_SIZE = 5; 
        const allSongsRaw = generatedData.songs;

        for (let i = 0; i < allSongsRaw.length; i += BATCH_SIZE) {
             if (currentSessionId !== generationSessionId.current) return;
             const batch = allSongsRaw.slice(i, i + BATCH_SIZE);
             const batchPromises = batch.map(raw => fetchSongMetadata(raw));
             const results = await Promise.all(batchPromises);
             results.forEach((s, index) => {
                 if (s !== null) validSongs.push(s);
                 else {
                     const rawSong = batch[index];
                     failureDetails.push({ title: rawSong.title, artist: rawSong.artist, reason: "Metadata not found" });
                 }
             });
             await new Promise(r => setTimeout(r, 100));
        }

        t3_itunes_end = performance.now();

        if (currentSessionId !== generationSessionId.current) return;

        const finalPlaylist: Playlist = {
            title: generatedData.playlist_title,
            mood: generatedData.mood,
            description: generatedData.description,
            songs: validSongs
        };
        
        setPlaylist(finalPlaylist);
        setIsLoading(false);
        addLog(`Complete. Found ${validSongs.length}/${allSongsRaw.length} songs with previews.`);

        const t4_total_end = performance.now();
        const ipAddress = await ipPromise; 
        
        const stats: VibeGenerationStats = {
            geminiTimeMs: Math.round(t1_gemini_end - t0_start), 
            itunesTimeMs: Math.round(t3_itunes_end - t2_itunes_start), 
            totalDurationMs: Math.round(t4_total_end - t0_start),
            contextTimeMs: capturedContextTime, 
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

        const { data: savedVibe } = await saveVibe(mood, finalPlaylist, userProfile?.id || null, stats);
        if (savedVibe) {
            setPlaylist(prev => prev ? { ...prev, id: savedVibe.id } : null);
        }

    } catch (error: any) {
        console.error("Generation failed", error);
        setIsLoading(false);
    }
  };

  const handleReset = () => {
    setPlaylist(null);
    setCurrentSong(null);
    setPlayerState(PlayerStateEnum.STOPPED);
  };

  const handleRemix = () => {
      if (playlist) handleMoodSelect(playlist.mood, 'text', true);
  };

  const handleShare = () => {
      if (!playlist) return;
      const url = `${window.location.origin}/?mood=${encodeURIComponent(playlist.mood)}`;
      navigator.clipboard.writeText(url).then(() => alert(`Vibe link copied!`));
  };

  const handlePlaySong = (song: Song) => {
    if (currentSong?.id === song.id) {
      setPlayerState(prev => prev === PlayerStateEnum.PLAYING ? PlayerStateEnum.PAUSED : PlayerStateEnum.PLAYING);
    } else {
      setCurrentSong(song);
      setPlayerState(PlayerStateEnum.PLAYING);
    }
  };

  const handlePause = () => setPlayerState(PlayerStateEnum.PAUSED);

  const handleNext = () => {
    if (!playlist || !currentSong) return;
    const idx = playlist.songs.findIndex(s => s.id === currentSong.id);
    if (idx < playlist.songs.length - 1) handlePlaySong(playlist.songs[idx + 1]);
    else setPlayerState(PlayerStateEnum.STOPPED);
  };

  const handlePrev = () => {
    if (!playlist || !currentSong) return;
    const idx = playlist.songs.findIndex(s => s.id === currentSong.id);
    if (idx > 0) handlePlaySong(playlist.songs[idx - 1]);
  };

  const handleExportToSpotify = async () => {
    if (!playlist || !spotifyToken || !userProfile) {
      handleLogin();
      return;
    }
    setExporting(true);
    try {
      const url = await createSpotifyPlaylist(spotifyToken, playlist, userProfile.id);
      if (playlist.id) await markVibeAsExported(playlist.id);
      window.open(url, '_blank');
    } catch (e: any) {
      alert(`Failed to export: ${e.message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleClosePlayer = () => {
      setPlayerState(PlayerStateEnum.STOPPED);
      setCurrentSong(null); 
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-white flex flex-col relative font-inter">
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-20 -left-20 w-96 h-96 bg-purple-900 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob"></div>
        <div className="absolute top-40 right-10 w-96 h-96 bg-cyan-900 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>
        <div className="absolute -bottom-20 left-1/2 w-96 h-96 bg-pink-900 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-4000"></div>
      </div>

      <header className="relative z-20 w-full p-4 md:p-6 px-6 flex justify-between items-center glass-panel border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-2 cursor-pointer" onClick={handleReset}>
           <div className="w-8 h-8 bg-gradient-to-tr from-purple-500 to-cyan-400 rounded-lg flex items-center justify-center">
             <span className="font-bold text-white">V+</span>
           </div>
           <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400 hidden md:block">
             VibeList+
           </h1>
        </div>
        
        <div className="flex items-center gap-4">
           <button onClick={handleSettings} className="text-slate-400 hover:text-white transition-colors" title="Settings">
               <CogIcon className="w-6 h-6" />
           </button>
           <button onClick={() => setShowDebug(!showDebug)} className="text-xs text-slate-700 hover:text-slate-500 font-mono px-3">π</button>

           {!spotifyToken ? (
             <button onClick={handleLogin} className="text-sm font-medium bg-[#1DB954] text-black px-5 py-2 rounded-full hover:bg-[#1ed760] transition-all">Login with Spotify</button>
           ) : (
             <div className="flex items-center gap-3 bg-white/5 px-4 py-1.5 rounded-full border border-white/10">
               {userProfile?.images?.[0] && <img src={userProfile.images[0].url} alt="Profile" className="w-6 h-6 rounded-full" />}
               <span className="text-sm font-medium text-slate-200 hidden md:block">{userProfile?.display_name}</span>
             </div>
           )}
        </div>
      </header>

      {showDebug && (
          <div className="fixed bottom-24 right-4 w-80 h-96 bg-black/95 text-green-400 font-mono text-xs p-4 overflow-y-auto z-[60] border border-green-800 rounded-lg shadow-2xl">
              <div className="flex justify-between border-b border-green-900 pb-1 mb-2">
                  <span>DEBUG LOGS</span>
                  <button onClick={() => setDebugLogs([])}>Clear</button>
              </div>
              {debugLogs.map((log, i) => (
                  <div key={i} className="mb-1 break-words whitespace-pre-wrap">{log}</div>
              ))}
          </div>
      )}

      <main className="relative z-10 flex-grow w-full">
        {isLoading ? (
          <div className="min-h-[60vh] flex flex-col items-center justify-center text-center animate-fade-in p-4">
            <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-cyan-400 animate-pulse">{loadingMessage}</h2>
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

      <PlayerControls 
        currentSong={currentSong}
        playerState={playerState}
        onTogglePlay={() => playerState === PlayerStateEnum.PLAYING ? handlePause() : currentSong && handlePlaySong(currentSong)}
        onNext={handleNext}
        onPrev={handlePrev}
        onClose={handleClosePlayer} 
        playlistTitle={playlist?.title}
      />
      
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
