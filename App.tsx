
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import MoodSelector from './components/MoodSelector';
import PlaylistView from './components/PlaylistView';
import TeaserPlaylistView from './components/TeaserPlaylistView';
import PlayerControls from './components/PlayerControls';
import SettingsOverlay from './components/SettingsOverlay';
import PostSavePopup from './components/PostSavePopup';
import { BurgerIcon } from './components/Icons'; 
import AdminDataInspector from './components/AdminDataInspector';
import { 
  Playlist, Song, PlayerState, SpotifyUserProfile, UserTasteProfile, VibeGenerationStats, ContextualSignals, AggregatedPlaylist, UnifiedVibeResponse,
  UnifiedTasteAnalysis 
} from './types';
import { 
  generatePlaylistFromMood, 
  analyzeFullTasteProfile, 
  isPreviewEnvironment 
} from './services/geminiService';
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
import { storageService } from './services/storageService';
import { saveVibe, markVibeAsExported, saveUserProfile, logGenerationFailure, fetchVibeById } from './services/historyService';
import { DEFAULT_SPOTIFY_CLIENT_ID, DEFAULT_REDIRECT_URI } from './constants';
import { isNative, getRedirectUri } from './utils/platformUtils';

interface TeaserPlaylist {
  id: string;
  title: string;
  description: string;
  mood: string;
}

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
  const [showPostSavePopup, setShowPostSavePopup] = useState(false);
  const [lastExportUrl, setLastExportUrl] = useState<string | null>(null);
  const [shouldAutoFocus, setShouldAutoFocus] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdminDataInspector, setShowAdminDataInspector] = useState(false);
  const [userAggregatedPlaylists, setUserAggregatedPlaylists] = useState<AggregatedPlaylist[]>([]);
  const [isConfirmationStep, setIsConfirmationStep] = useState(false);
  const [validationError, setValidationError] = useState<{ message: string; key: number } | null>(null);

  const isProcessingAuth = useRef(false);
  const generationSessionId = useRef(0);
  const spotifyClientId = localStorage.getItem('spotify_client_id') || DEFAULT_SPOTIFY_CLIENT_ID;

  const addLog = useCallback((msg: string) => {
    setDebugLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`]);
  }, []);

  const processAuthCode = useCallback(async (code: string, incomingState: string | null, signal?: AbortSignal) => {
    if (isProcessingAuth.current) return;
    isProcessingAuth.current = true;

    try {
      addLog(`Initiating auth code exchange. Native: ${isNative()}`);
      const storedState = await storageService.getItem('auth_state');
      if (incomingState && storedState && incomingState !== storedState) {
        throw new Error("CSRF State Mismatch. Authentication aborted.");
      }
      const verifier = await storageService.getItem('code_verifier');
      const usedRedirectUri = await storageService.getItem('used_redirect_uri') || DEFAULT_REDIRECT_URI;
      if (!verifier) throw new Error("PKCE Verifier lost.");
      const data = await exchangeCodeForToken(spotifyClientId, usedRedirectUri, code, verifier, signal);
      if (!signal?.aborted) {
        await handleSuccessFullAuth(data.access_token, data.refresh_token);
        await storageService.removeItem('auth_state');
        await storageService.removeItem('code_verifier');
      }
    } catch (e: any) {
      if (e instanceof Error && e.name === 'AbortError') return;
      addLog(`Auth failed: ${e.message}`);
    } finally {
      isProcessingAuth.current = false;
    }
  }, [spotifyClientId, addLog]);

  useEffect(() => {
    (window as any).addLog = addLog;
    const initApp = async () => {
      const storedToken = await storageService.getItem('spotify_token');
      if (storedToken) {
        setSpotifyToken(storedToken);
        fetchProfile(storedToken);
      }
      if (!isNative()) {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const state = urlParams.get('state');
        const hashToken = getTokenFromHash();
        if (code) {
          window.history.replaceState({}, '', window.location.pathname);
          processAuthCode(code, state);
        } else if (hashToken) {
          window.location.hash = "";
          handleSuccessFullAuth(hashToken);
        }
      }
      if (isNative()) {
        CapacitorApp.addListener('appUrlOpen', async (data) => {
          const url = new URL(data.url);
          const code = url.searchParams.get('code');
          if (code) {
            await Browser.close();
            processAuthCode(code, url.searchParams.get('state'));
          }
        });
      }
    };
    initApp();
    return () => { if (isNative()) CapacitorApp.removeAllListeners(); };
  }, [addLog, processAuthCode]);

  const handleSuccessFullAuth = async (accessToken: string, refreshToken?: string) => {
    setSpotifyToken(accessToken);
    await storageService.setItem('spotify_token', accessToken);
    if (refreshToken) await storageService.setItem('spotify_refresh_token', refreshToken);
    fetchProfile(accessToken);
  };

  const fetchProfile = async (token: string) => {
    try {
      const profile = await getUserProfile(token);
      setUserProfile(profile);
      refreshProfileAndTaste(token, profile);
    } catch (e) {
      await storageService.removeItem('spotify_token');
      setSpotifyToken(null);
    }
  };

  const refreshProfileAndTaste = async (token: string, profile: SpotifyUserProfile) => {
      try {
          const [tasteResult, playlistsResult] = await Promise.allSettled([
            fetchUserTasteProfile(token),
            fetchUserPlaylistsAndTracks(token)
          ]);
          let taste: UserTasteProfile | null = null;
          if (tasteResult.status === 'fulfilled' && tasteResult.value) taste = tasteResult.value;
          if (playlistsResult.status === 'fulfilled') setUserAggregatedPlaylists(playlistsResult.value);
          if (!taste) return;
          const rawTracks = (playlistsResult.status === 'fulfilled' ? playlistsResult.value : []).flatMap(p => p.tracks);
          const geminiResponse = await analyzeFullTasteProfile(rawTracks, taste.topTracks);
          if ('playlist_mood_analysis' in geminiResponse) {
            const unifiedAnalysis = aggregateSessionData(geminiResponse);
            setUserTaste({ ...taste, unified_analysis: unifiedAnalysis });
          }
      } catch (e) { console.warn("Taste refresh error", e); }
  };

  const handleLogin = async () => {
    const verifier = generateRandomString(128);
    const state = generateRandomString(16);
    const challenge = await generateCodeChallenge(verifier);
    const redirectUri = getRedirectUri();
    await storageService.setItem('code_verifier', verifier);
    await storageService.setItem('auth_state', state);
    await storageService.setItem('used_redirect_uri', redirectUri);
    const url = getPkceLoginUrl(spotifyClientId, redirectUri, challenge, state);
    if (isNative()) await Browser.open({ url }); else window.location.href = url;
  };

  const handleSignOut = async () => {
    setSpotifyToken(null);
    setUserProfile(null);
    setUserTaste(null);
    await storageService.removeItem('spotify_token');
    await storageService.removeItem('spotify_refresh_token');
    setShowSettings(false);
    handleReset();
  };

  const handleMoodSelect = async (mood: string, modality: 'text' | 'voice' = 'text', isRemix: boolean = false) => {
    setValidationError(null);
    if (mood.trim().length < 3) {
      setValidationError({ message: "Vibe details needed.", key: Date.now() });
      return;
    }
    setIsLoading(true);
    setPlaylist(null);
    setTeaserPlaylist(null);
    setShouldAutoFocus(false);
    const currentSessionId = ++generationSessionId.current;
    try {
      const contextSignals: ContextualSignals = {
        local_time: new Date().toLocaleTimeString(),
        day_of_week: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
        device_type: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
        input_modality: modality,
        browser_language: navigator.language,
        country: userProfile?.country
      };
      const response = await generatePlaylistFromMood(mood, contextSignals, !!spotifyToken, userTaste || undefined);
      if (currentSessionId !== generationSessionId.current) return;
      if (response.validation_status && response.validation_status !== 'VIBE_VALID') {
          setValidationError({ message: response.reason || "Vibe invalid.", key: Date.now() });
          setIsLoading(false);
          return;
      }
      if (!spotifyToken && !response.songs) {
          setTeaserPlaylist({ id: 'teaser', title: response.playlist_title!, description: response.description!, mood });
      } else if (response.songs) {
          const validSongs: Song[] = [];
          for (const s of response.songs.slice(0, 15)) {
              const meta = await fetchSongMetadata(s);
              if (meta) validSongs.push(meta);
          }
          setPlaylist({ title: response.playlist_title!, mood, description: response.description!, songs: validSongs });
      }
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

  const handleReset = (autoFocus: boolean = false) => {
    setPlaylist(null);
    setTeaserPlaylist(null);
    setCurrentSong(null);
    setPlayerState(PlayerState.STOPPED);
    setShowPostSavePopup(false);
    setLastExportUrl(null);
    setShouldAutoFocus(autoFocus);
  };

  const handleExportToSpotify = async () => {
    if (!playlist || !spotifyToken || !userProfile) { handleLogin(); return; }
    setExporting(true);
    try {
      const url = await createSpotifyPlaylist(spotifyToken, playlist, userProfile.id);
      setLastExportUrl(url);
      setShowPostSavePopup(true); // Open the Decision Gate
    } catch (e: any) { alert(`Export failed: ${e.message}`); }
    finally { setExporting(false); }
  };

  const handlePostSavePlay = async () => {
    if (lastExportUrl) {
      if (isNative()) await Browser.open({ url: lastExportUrl }); else window.open(lastExportUrl, '_blank');
    }
    handleReset(false); // Play Intent ends session but no auto-focus needed
  };

  const handlePostSaveNewVibe = () => {
    handleReset(true); // New Vibe Intent ends session and triggers auto-focus + glow
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-white flex flex-col relative font-inter">
      <header className="sticky top-0 z-20 w-full p-4 md:p-6 px-6 flex justify-between items-center glass-panel border-b border-white/5">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => handleReset()}>
           <img src="/vibelist-header-icon-final-64-v3.png" alt="VibeList Pro" className="w-9 h-9" />
           <h1 className="text-xl font-bold hidden md:block">VibeList Pro</h1>
        </div>
        <div className="flex items-center gap-4">
           {!spotifyToken ? (
             <button onClick={handleLogin} className="text-sm font-medium bg-[#1DB954] text-black px-5 py-2 rounded-full">Login</button>
           ) : (
             <div className="cursor-pointer" onClick={() => setShowSettings(true)}>
               {userProfile?.display_name}
             </div>
           )}
           <button onClick={() => setShowSettings(true)} className="text-slate-400"><BurgerIcon className="w-6 h-6" /></button>
        </div>
      </header>

      <main className="relative z-10 flex-grow w-full">
        {playlist ? (
          <PlaylistView 
            playlist={playlist}
            currentSong={currentSong}
            playerState={playerState}
            onPlaySong={(s) => { setCurrentSong(s); setPlayerState(PlayerState.PLAYING); }}
            onPause={() => setPlayerState(PlayerState.PAUSED)}
            onReset={() => handlePostSaveNewVibe()} // Use Case 1C
            onExport={handleExportToSpotify}
            exporting={exporting}
            onDownloadCsv={() => {}} onYouTubeExport={() => {}} onRemix={() => {}} onShare={() => {}}
          />
        ) : (
          <MoodSelector onSelectMood={handleMoodSelect} isLoading={isLoading} validationError={validationError} autoFocus={shouldAutoFocus} />
        )}
      </main>

      {showPostSavePopup && (
        <PostSavePopup 
          onPlayNow={handlePostSavePlay}
          onCreateNew={handlePostSaveNewVibe}
          onDismiss={handlePostSaveNewVibe} // Implicitly create new vibe
        />
      )}

      {teaserPlaylist && (
        <TeaserPlaylistView 
          playlist={teaserPlaylist} isConfirmationStep={false} 
          onUnlock={handleLogin} onConfirm={() => {}} onTryAnother={() => handleReset()} 
        />
      )}

      <PlayerControls 
        currentSong={currentSong} playerState={playerState}
        onTogglePlay={() => setPlayerState(prev => prev === PlayerState.PLAYING ? PlayerState.PAUSED : PlayerState.PLAYING)}
        onNext={() => {}} onPrev={() => {}} onClose={() => { setCurrentSong(null); setPlayerState(PlayerState.STOPPED); }} 
      />
      
      <SettingsOverlay isOpen={showSettings} onClose={() => setShowSettings(false)} userProfile={userProfile} onSignOut={handleSignOut} isAuthenticated={!!spotifyToken} />
    </div>
  );
};

export default App;
