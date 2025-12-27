
import React, { useState, useEffect, useCallback, useRef } from 'react';
import MoodSelector from './components/MoodSelector';
import PlaylistView from './components/PlaylistView';
import TeaserPlaylistView from './components/TeaserPlaylistView';
import PlayerControls from './components/PlayerControls';
import SettingsOverlay from './components/SettingsOverlay';
import { CogIcon } from './components/Icons'; 
import AdminDataInspector from './components/AdminDataInspector';
import { Playlist, Song, PlayerState, SpotifyUserProfile, UserTasteProfile, VibeGenerationStats, ContextualSignals, AggregatedPlaylist, UnifiedVibeResponse } from './types';
import { generatePlaylistFromMood, analyzeFullTasteProfile, isPreviewEnvironment } from './services/geminiService';
import { aggregateSessionData } from './services/dataAggregator';
import { fetchSongMetadata } from './services/itunesService';
import { 
  getLoginUrl, 
  getPkceLoginUrl,
  exchangeCodeForToken, 
  getTokenFromHash, 
  createSpotifyPlaylist, 
  getUserProfile, 
  fetchUserTasteProfile,
  fetchUserPlaylistsAndTracks
} from './services/spotifyService';
import { generateRandomString, generateCodeChallenge } from './services/pkceService';
import { saveVibe, markVibeAsExported, saveUserProfile, logGenerationFailure, fetchVibeById } from './services/historyService';
import { DEFAULT_SPOTIFY_CLIENT_ID, DEFAULT_REDIRECT_URI } from './constants';

interface TeaserPlaylist {
  id: string;
  title: string;
  description: string;
  mood: string;
}

let authProcessedGlobal = false;

const App: React.FC = () => {
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [teaserPlaylist, setTeaserPlaylist] = useState<TeaserPlaylist | null>(null);
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
  const [showAdminDataInspector, setShowAdminDataInspector] = useState(false);
  const [userAggregatedPlaylists, setUserAggregatedPlaylists] = useState<AggregatedPlaylist[]>([]);
  const [isConfirmationStep, setIsConfirmationStep] = useState(false);
  const [validationError, setValidationError] = useState<{ message: string; key: number } | null>(null);

  const generationSessionId = useRef(0);
  const spotifyClientId = localStorage.getItem('spotify_client_id') || DEFAULT_SPOTIFY_CLIENT_ID;

  const addLog = useCallback((msg: string) => {
    setDebugLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`]);
  }, []);

  const handleSpotifyAuth = useCallback(async (signal: AbortSignal) => {
    if (authProcessedGlobal) return;

    const code = new URLSearchParams(window.location.search).get('code');
    const token = getTokenFromHash();

    if (code) {
      authProcessedGlobal = true;
      window.history.replaceState({}, '', window.location.pathname);
      const verifier = localStorage.getItem('code_verifier');
      if (verifier) {
        try {
          const data = await exchangeCodeForToken(spotifyClientId, DEFAULT_REDIRECT_URI, code, verifier, signal);
          if (!signal.aborted) {
            handleSuccessFullAuth(data.access_token, data.refresh_token);
          }
        } catch (e) {
          if (e instanceof Error && e.name === 'AbortError') return;
          authProcessedGlobal = false;
          addLog(`PKCE Exchange failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } else if (token) {
      authProcessedGlobal = true;
      window.location.hash = "";
      handleSuccessFullAuth(token);
    }
  }, [spotifyClientId, addLog]);

  useEffect(() => {
    (window as any).addLog = addLog;
    const storedToken = localStorage.getItem('spotify_token');
    if (storedToken) {
      setSpotifyToken(storedToken);
      fetchProfile(storedToken);
    }
    const controller = new AbortController();
    handleSpotifyAuth(controller.signal);
    return () => controller.abort();
  }, [addLog, handleSpotifyAuth]);

  const handleSuccessFullAuth = async (accessToken: string, refreshToken?: string) => {
    setSpotifyToken(accessToken);
    localStorage.setItem('spotify_token', accessToken);
    if (refreshToken) localStorage.setItem('spotify_refresh_token', refreshToken);
    fetchProfile(accessToken);
  };

  const fetchProfile = async (token: string) => {
    try {
      const profile = await getUserProfile(token);
      setUserProfile(profile);
      refreshProfileAndTaste(token, profile);
    } catch (e) {
      localStorage.removeItem('spotify_token');
      setSpotifyToken(null);
    }
  };

  /**
   * [Release v1.2.2 - Quantum Taste]
   * Consolidates Spotify data analysis into a single Gemini API pass.
   */
  const refreshProfileAndTaste = async (token: string, profile: SpotifyUserProfile) => {
      try {
          addLog("[Wave 1: Spotify] Fetching tracks and playlists...");
          const [tasteResult, playlistsResult] = await Promise.allSettled([
            fetchUserTasteProfile(token),
            fetchUserPlaylistsAndTracks(token)
          ]);

          let taste: UserTasteProfile | null = null;
          let aggregatedPlaylists: AggregatedPlaylist[] = [];

          if (tasteResult.status === 'fulfilled' && tasteResult.value) {
            taste = tasteResult.value;
          }
          if (playlistsResult.status === 'fulfilled') {
            aggregatedPlaylists = playlistsResult.value;
            setUserAggregatedPlaylists(aggregatedPlaylists);
          }

          if (!taste) {
             saveUserProfile(profile, null);
             return;
          }

          const rawPlaylistTracks = aggregatedPlaylists.flatMap(p => p.tracks);

          // --- WAVE 2: UNIFIED SEMANTIC SYNTHESIS ---
          addLog("[Wave 2: Gemini] Initiating Quantum Taste Unification...");
          const unifiedResult = await analyzeFullTasteProfile(taste.topTracks, rawPlaylistTracks);

          if (unifiedResult) {
            addLog(`[Wave 2: Gemini] Unified synthesis complete. Category: "${unifiedResult.playlist_mood.playlist_mood_category}"`);
            
            const sessionProfile = aggregateSessionData(unifiedResult.analyzed_tracks);
            
            const finalTaste: UserTasteProfile = {
              ...taste,
              playlistMoodAnalysis: unifiedResult.playlist_mood,
              session_analysis: sessionProfile,
              unified_analysis: unifiedResult
            };

            setUserTaste(finalTaste);
            saveUserProfile(profile, finalTaste);
            addLog(">>> UNIFIED VIBE FINGERPRINT GENERATED <<<");
          } else {
            addLog("[Wave 2: Gemini] Synthesis returned null. Using raw profile.");
            saveUserProfile(profile, taste);
          }

      } catch (e: any) {
          addLog(`Critical Error during Refresh: ${e.message || e}`);
          saveUserProfile(profile, null);
      }
  };

  const handleLogin = async () => {
    if (isPreviewEnvironment()) {
      const currentUrl = window.location.href.split('#')[0];
      window.top.location.href = getLoginUrl(spotifyClientId, currentUrl);
    } else {
      const verifier = generateRandomString(128);
      const challenge = await generateCodeChallenge(verifier);
      localStorage.setItem('code_verifier', verifier);
      window.location.href = getPkceLoginUrl(spotifyClientId, DEFAULT_REDIRECT_URI, challenge);
    }
  };

  const handleSignOut = () => {
    setSpotifyToken(null);
    setUserProfile(null);
    setUserTaste(null);
    localStorage.removeItem('spotify_token');
    localStorage.removeItem('spotify_refresh_token');
    setShowSettings(false);
    authProcessedGlobal = false;
    handleReset();
  };

  const handleMoodSelect = async (mood: string, modality: 'text' | 'voice' = 'text', isRemix: boolean = false) => {
    setValidationError(null);
    if (mood.trim().length < 3) {
      setValidationError({ message: "Please describe the vibe in a bit more detail.", key: Date.now() });
      return;
    }

    setIsLoading(true);
    setLoadingMessage(isRemix ? 'Remixing...' : 'Curating vibes...');
    setPlaylist(null);
    setTeaserPlaylist(null);
    setCurrentSong(null);
    setPlayerState(PlayerState.STOPPED);

    const currentSessionId = ++generationSessionId.current;
    const ipPromise = fetch('https://api.ipify.org?format=json').then(res => res.json()).then(data => data.ip).catch(() => 'unknown');
    const t0_start = performance.now();

    try {
        const contextSignals: ContextualSignals = {
            local_time: new Date().toLocaleTimeString(),
            day_of_week: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
            device_type: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
            input_modality: modality,
            browser_language: navigator.language,
            country: userProfile?.country
        };

        const unifiedResponse: UnifiedVibeResponse = await generatePlaylistFromMood(
            mood, 
            contextSignals, 
            !!spotifyToken,
            userTaste || undefined, 
            isRemix && playlist ? playlist.songs.map(s => s.title) : undefined
        );

        if (currentSessionId !== generationSessionId.current) return;

        if (unifiedResponse.validation_status !== 'VIBE_VALID') {
            setValidationError({ message: unifiedResponse.reason!, key: Date.now() });
            setIsLoading(false);
            return;
        }

        if (!spotifyToken && !unifiedResponse.songs) {
            const teaserPayload = { title: unifiedResponse.playlist_title!, description: unifiedResponse.description! };
            const { data: savedVibe } = await saveVibe(mood, teaserPayload, null, {}, 'pre_auth_teaser');
            if (savedVibe) {
                localStorage.setItem('vibelist_pending_vibe_id', savedVibe.id);
                setTeaserPlaylist({ ...teaserPayload, mood: mood, id: savedVibe.id });
            }
            setIsLoading(false);
            return;
        }

        if (unifiedResponse.songs) {
            const validSongs: Song[] = [];
            const BATCH_SIZE = 5;
            for (let i = 0; i < unifiedResponse.songs.length; i += BATCH_SIZE) {
                if (currentSessionId !== generationSessionId.current) return;
                const batch = unifiedResponse.songs.slice(i, i + BATCH_SIZE);
                const results = await Promise.all(batch.map(raw => fetchSongMetadata(raw)));
                results.forEach(s => s && validSongs.push(s));
            }

            const finalPlaylist: Playlist = {
                title: unifiedResponse.playlist_title!,
                mood: mood,
                description: unifiedResponse.description!,
                songs: validSongs
            };
            setPlaylist(finalPlaylist);
            setIsLoading(false);
        }
    } catch (error: any) {
        setIsLoading(false);
        setShowDebug(true);
    }
  };

  const handleReset = () => {
    localStorage.removeItem('vibelist_pending_vibe_id');
    setPlaylist(null);
    setTeaserPlaylist(null);
    setCurrentSong(null);
    setPlayerState(PlayerState.STOPPED);
    setIsConfirmationStep(false);
    setValidationError(null);
  };

  const handlePlaySong = (song: Song) => {
    if (currentSong?.id === song.id) {
      setPlayerState(playerState === PlayerState.PLAYING ? PlayerState.PAUSED : PlayerState.PLAYING);
    } else {
      setCurrentSong(song);
      setPlayerState(PlayerState.PLAYING);
    }
  };

  const renderContent = () => {
    if (isLoading && !teaserPlaylist) {
      return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center text-center animate-fade-in p-4">
          <div className="relative w-24 h-24 mx-auto mb-8 animate-spin rounded-full border-4 border-purple-500 border-t-transparent"></div>
          <h2 className="text-2xl font-bold text-white animate-pulse">{loadingMessage}</h2>
        </div>
      );
    }
    if (playlist) {
      return (
        <PlaylistView 
          playlist={playlist}
          currentSong={currentSong}
          playerState={playerState}
          onPlaySong={handlePlaySong}
          onPause={() => setPlayerState(PlayerState.PAUSED)}
          onReset={handleReset}
          onExport={() => {}}
          onDownloadCsv={() => {}}
          onYouTubeExport={() => {}}
          onRemix={() => handleMoodSelect(playlist.mood, 'text', true)}
          onShare={() => {}}
          exporting={exporting}
        />
      );
    }
    return <MoodSelector onSelectMood={handleMoodSelect} isLoading={isLoading} validationError={validationError} />;
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-white flex flex-col relative font-inter">
      <header className="relative z-20 w-full p-6 flex justify-between items-center glass-panel border-b border-white/5">
        <div className="flex items-center gap-2 cursor-pointer" onClick={handleReset}>
           <div className="w-8 h-8 bg-gradient-to-tr from-purple-500 to-cyan-400 rounded-lg flex items-center justify-center font-bold">V+</div>
           <h1 className="text-xl font-bold">VibeList+</h1>
        </div>
        <div className="flex items-center gap-4">
           <button onClick={(e) => e.ctrlKey ? setShowAdminDataInspector(true) : setShowDebug(!showDebug)} className="text-xs text-slate-700 font-mono px-3">π</button>
           {!spotifyToken ? (
             <button onClick={handleLogin} className="bg-[#1DB954] text-black px-5 py-2 rounded-full font-medium">Login with Spotify</button>
           ) : (
             <div className="flex items-center gap-3 bg-white/5 px-4 py-1.5 rounded-full border border-white/10 cursor-pointer" onClick={() => setShowSettings(true)}>
               {userProfile?.display_name}
             </div>
           )}
        </div>
      </header>
      <main className="relative z-10 flex-grow w-full">{renderContent()}</main>
      {showAdminDataInspector && (
          <AdminDataInspector
              isOpen={showAdminDataInspector}
              onClose={() => setShowAdminDataInspector(false)}
              userTaste={userTaste}
              aggregatedPlaylists={userAggregatedPlaylists}
              debugLogs={debugLogs}
          />
      )}
      <PlayerControls 
        currentSong={currentSong} playerState={playerState}
        onTogglePlay={() => setPlayerState(playerState === PlayerState.PLAYING ? PlayerState.PAUSED : PlayerState.PLAYING)}
        onNext={() => {}} onPrev={() => {}} onClose={() => { setCurrentSong(null); setPlayerState(PlayerState.STOPPED); }}
      />
      <SettingsOverlay isOpen={showSettings} onClose={() => setShowSettings(false)} userProfile={userProfile} onSignOut={handleSignOut} />
    </div>
  );
};

export default App;
