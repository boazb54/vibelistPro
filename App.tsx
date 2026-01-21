import React, { useState, useEffect, useCallback, useRef } from 'react';
import MoodSelector from './components/MoodSelector';
import PlaylistView from './components/PlaylistView';
import TeaserPlaylistView from './components/TeaserPlaylistView';
import PlayerControls from './components/PlayerControls';
import SettingsOverlay from './components/SettingsOverlay';
import { BurgerIcon } from './components/Icons'; 
import AdminDataInspector from './components/AdminDataInspector';
import { 
  Playlist, Song, PlayerState, SpotifyUserProfile, UserTasteProfile, VibeGenerationStats, ContextualSignals, AggregatedPlaylist, UnifiedVibeResponse,
  UnifiedTasteAnalysis // NEW import
} from './types';
import { 
  generatePlaylistFromMood, 
  analyzeFullTasteProfile, // NEW import
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
import { saveVibe, markVibeAsExported, saveUserProfile, logGenerationFailure, fetchVibeById } from './services/historyService';
import { DEFAULT_SPOTIFY_CLIENT_ID, DEFAULT_REDIRECT_URI } from './constants';
// import { openExternalLink } from './utils/linkUtils'; // Removed NEW import

interface TeaserPlaylist {
  id: string;
  title: string;
  description: string;
  mood: string;
}

// Module-level guard to survive React remounts
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
  const [userAggregatedPlaylists, setUserAggregatedPlaylists] = useState<AggregatedPlaylist[]>([]
  );
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
          authProcessedGlobal = false; // Reset on failure so retry is possible
          addLog(`PKCE Exchange failed: ${e instanceof Error ? e.message : String(e)}`);
          console.error("PKCE Exchange failed", e);
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

    const params = new URLSearchParams(window.location.search);
    const sharedMood = params.get('mood');
    if (sharedMood) {
       window.history.replaceState({}, '', window.location.pathname);
       setTimeout(() => {
         if (!playlist) handleMoodSelect(sharedMood, 'text');
       }, 500);
    }

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addLog, handleSpotifyAuth]);

  const handleSuccessFullAuth = async (accessToken: string, refreshToken?: string) => {
    setSpotifyToken(accessToken);
    localStorage.setItem('spotify_token', accessToken);
    if (refreshToken) {
      localStorage.setItem('spotify_refresh_token', refreshToken);
    }
    fetchProfile(accessToken);

    const pendingVibeId = localStorage.getItem('vibelist_pending_vibe_id');
    if (pendingVibeId) {
      try {
        addLog(`Found pending vibe ID: ${pendingVibeId}. Fetching from DB...`);
        const { data: pendingVibe, error } = await fetchVibeById(pendingVibeId);
        if (error) throw error;
        
        if (pendingVibe && pendingVibe.playlist_json) {
          const teaserData = pendingVibe.playlist_json as { title: string, description: string };
          setTeaserPlaylist({
            id: pendingVibe.id,
            title: teaserData.title,
            description: teaserData.description,
            mood: pendingVibe.mood_prompt,
          });
          setIsConfirmationStep(true);
          addLog(`Successfully retrieved pending vibe "${teaserData.title}" from DB.`);
        } else {
           addLog(`Pending vibe ID ${pendingVibeId} not found in DB or has no data. Clearing.`);
           localStorage.removeItem('vibelist_pending_vibe_id');
        }
      } catch(e: any) {
        console.error("Failed to retrieve pending vibe from database", e);
        addLog(`DB Error retrieving vibe: ${e.message}`);
        localStorage.removeItem('vibelist_pending_vibe_id');
      }
    }
  };

  const fetchProfile = async (token: string) => {
    try {
      const profile = await getUserProfile(token);
      setUserProfile(profile);
      refreshProfileAndTaste(token, profile);
    } catch (e) {
      addLog(`Failed to fetch Spotify profile: ${e instanceof Error ? e.message : String(e)}`);
      console.error("Failed to fetch profile", e);
      localStorage.removeItem('spotify_token');
      setSpotifyToken(null);
    }
  };

  /**
   * [Release v1.3.0 - Quantum Taste Unification]
   * Refactored into a single-wave analysis pipeline.
   */
  const refreshProfileAndTaste = async (token: string, profile: SpotifyUserProfile) => {
      try {
          addLog("[Wave 1: Spotify Data Acquisition] Initiating concurrent data acquisition...");
          
          const [tasteResult, playlistsResult] = await Promise.allSettled([
            fetchUserTasteProfile(token),
            fetchUserPlaylistsAndTracks(token)
          ]);

          let taste: UserTasteProfile | null = null;
          let aggregatedPlaylists: AggregatedPlaylist[] = [];

          if (tasteResult.status === 'fulfilled' && tasteResult.value) {
            taste = tasteResult.value;
            addLog("[Wave 1: Spotify] Taste Profile (Artists/Tracks) acquired successfully.");
          } else {
            addLog(`[Wave 1: Spotify] Taste Profile acquisition failed or returned null.`);
          }

          if (playlistsResult.status === 'fulfilled') {
            aggregatedPlaylists = playlistsResult.value;
            setUserAggregatedPlaylists(aggregatedPlaylists);
            addLog(`[Wave 1: Spotify] Playlists acquired successfully. Hydrated ${aggregatedPlaylists.length} playlists.`);
          } else {
            addLog(`[Wave 1: Spotify] Playlists acquisition failed.`);
          }

          // If no taste data at all, save profile without any AI analysis.
          if (!taste || (taste.topTracks.length === 0 && aggregatedPlaylists.length === 0)) {
             addLog("[Wave 1: Spotify] No meaningful taste data available for AI analysis. Saving profile without analysis.");
             saveUserProfile(profile, null);
             setUserTaste(null); // Ensure taste is null if no data
             return;
          }

          // --- WAVE 2: UNIFIED AI ANALYSIS ---
          addLog("[Wave 2: Gemini] Initiating unified AI taste analysis...");

          const rawAggregatedPlaylistTracks = aggregatedPlaylists.flatMap(p => p.tracks);

          if (taste.topTracks.length > 0 || rawAggregatedPlaylistTracks.length > 0) {
            try {
              const unifiedGeminiResponse = await analyzeFullTasteProfile(rawAggregatedPlaylistTracks, taste.topTracks);
              
              if ('error' in unifiedGeminiResponse) {
                throw new Error(unifiedGeminiResponse.error);
              }

              addLog(`[Wave 2: Gemini] Unified Taste Analysis successful. Processing session fingerprint...`);
              const unifiedAnalysis: UnifiedTasteAnalysis = aggregateSessionData(unifiedGeminiResponse);
              
              const enhancedTaste: UserTasteProfile = {
                  ...taste,
                  unified_analysis: unifiedAnalysis // Assign unified_analysis
              };

              addLog(">>> UNIFIED SESSION SEMANTIC PROFILE GENERATED <<<");
              setUserTaste(enhancedTaste);
              saveUserProfile(profile, enhancedTaste); // Save profile with enhanced taste
            } catch (geminiError: any) {
              addLog(`[Wave 2: Gemini] Unified Taste Analysis failed: ${geminiError.message || 'Unknown error'}`);
              console.warn("Unified Gemini analysis failed", geminiError);
              
              // On failure, save profile with existing taste (without unified_analysis)
              setUserTaste(taste);
              saveUserProfile(profile, taste);
            }
          } else {
            addLog("[Wave 2: Gemini] Skipping unified analysis: No track or playlist data available.");
            setUserTaste(taste); // Set taste even if no analysis
            saveUserProfile(profile, taste);
          }

          addLog(">>> ALL PROFILE DATA REFRESH COMPLETE <<<");

      } catch (e: any) {
          console.warn("Could not perform parallel profile/taste refresh", e);
          addLog(`Critical Error during Profile Refresh: ${e.message || e}`);
          saveUserProfile(profile, null); // On critical failure, save profile without taste
          setUserTaste(null);
      }
  };

  const handleLogin = async () => {
    if (isPreviewEnvironment()) {
      addLog("Preview environment detected. Using top-level redirect for Spotify login.");
      const currentUrl = window.location.href.split('#')[0];
      const url = getLoginUrl(spotifyClientId, currentUrl);
      window.open(url, '_top'); // Use _top target to ensure full page redirect
    } else {
      addLog("Production environment detected. Using PKCE flow for Spotify login.");
      const verifier = generateRandomString(128);
      const challenge = await generateCodeChallenge(verifier);
      localStorage.setItem('code_verifier', verifier);
      const url = getPkceLoginUrl(spotifyClientId, DEFAULT_REDIRECT_URI, challenge);
      window.open(url, '_blank'); // Use default _blank target
    }
  };

  const handleSignOut = () => {
    setSpotifyToken(null);
    setUserProfile(null);
    setUserTaste(null);
    localStorage.removeItem('spotify_token');
    localStorage.removeItem('spotify_refresh_token');
    setShowSettings(false);
    addLog("User signed out.");
  };

  // --- START: Unified handleMoodSelect (v1.2.0) ---
  const handleMoodSelect = async (mood: string, modality: 'text' | 'voice' = 'text', isRemix: boolean = false) => {
    setValidationError(null);

    // --- STAGE 1: CLIENT-SIDE PRE-FLIGHT CHECK ---
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
    setIsConfirmationStep(false);

    const currentSessionId = ++generationSessionId.current;
    const ipPromise = fetch('https://api.ipify.org?format=json').then(res => res.json()).then(data => data.ip).catch(() => 'unknown');

    const t0_start = performance.now();
    let t1_gemini_end = 0;
    let t2_itunes_start = 0;
    let t3_itunes_end = 0;
    let capturedPromptText = "";
    let capturedContextTime = 0;

    const failureDetails: { title: string, artist: string, reason: string }[] = [];
    const excludeSongs = isRemix && playlist ? playlist.songs.map(s => s.title) : undefined;
    
    addLog(`Generating vibe for: "${mood}" (${modality})...`);

    const localTime = new Date().toLocaleTimeString();
    const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const browserLanguage = navigator.language;
    const deviceType = /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop';

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
        const unifiedResponse: UnifiedVibeResponse = await generatePlaylistFromMood(
            mood, 
            contextSignals, 
            !!spotifyToken, // isAuthenticated flag
            userTaste || undefined, 
            excludeSongs
        );

        capturedPromptText = unifiedResponse.promptText;
        t1_gemini_end = performance.now(); 

        addLog("--- CONTEXTUAL PROMPT PAYLOAD ---");
        addLog(unifiedResponse.promptText);
        addLog(`Unified response status: ${unifiedResponse.validation_status || 'N/A'}`);

        if (currentSessionId !== generationSessionId.current) return;

        // --- Handle Validation Errors ---
        if (unifiedResponse.validation_status && unifiedResponse.validation_status !== 'VIBE_VALID') {
            setValidationError({ message: unifiedResponse.reason!, key: Date.now() });
            setIsLoading(false);
            
            const t_fail = performance.now();
            const ipAddress = await ipPromise;
            logGenerationFailure(
                mood,
                unifiedResponse.reason || "Validation failed",
                userProfile?.id || null,
                {
                    totalDurationMs: Math.round(t_fail - t0_start),
                    localTime, dayOfWeek, browserLanguage, deviceType, ipAddress,
                    inputModality: modality,
                },
                'validation_failure' // New phase for explicit validation failures
            );
            return;
        }

        // --- Handle Teaser Generation ---
        if (!spotifyToken && !unifiedResponse.songs) { // No songs means it's a teaser
            const teaserPayload = { 
                title: unifiedResponse.playlist_title!,
                description: unifiedResponse.description!,
            };

            const ipAddress = await ipPromise;
            const stats: Partial<VibeGenerationStats> = {
                totalDurationMs: Math.round(t1_gemini_end - t0_start),
                geminiApiTimeMs: unifiedResponse.metrics?.geminiApiTimeMs || 0,
                localTime, dayOfWeek, browserLanguage, deviceType, ipAddress,
                inputModality: modality,
            };

            const { data: savedVibe, error: saveError } = await saveVibe(mood, teaserPayload, null, stats, 'pre_auth_teaser');

            if (saveError || !savedVibe) {
                throw new Error(saveError?.message || "Failed to save initial vibe to DB.");
            }
            
            localStorage.setItem('vibelist_pending_vibe_id', savedVibe.id);
            setTeaserPlaylist({ ...teaserPayload, mood: mood, id: savedVibe.id });
            addLog(`Teaser generated and saved for mood: "${mood}" (ID: ${savedVibe.id})`);
            setIsLoading(false);
            return;
        }

        // --- Handle Full Playlist Generation ---
        if (unifiedResponse.songs) {
            addLog("AI generation complete. Fetching metadata (Safe Mode)...");
            t2_itunes_start = performance.now();

            const validSongs: Song[] = [];
            const BATCH_SIZE = 5; 
            const allSongsRaw = unifiedResponse.songs;

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

            const pendingVibeId = localStorage.getItem('vibelist_pending_vibe_id');
            localStorage.removeItem('vibelist_pending_vibe_id');

            const finalPlaylist: Playlist = {
                id: pendingVibeId || undefined,
                title: unifiedResponse.playlist_title!,
                mood: mood,
                description: unifiedResponse.description!,
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
                promptBuildTimeMs: unifiedResponse.metrics.promptBuildTimeMs, 
                geminiApiTimeMs: unifiedResponse.metrics.geminiApiTimeMs, 
                promptText: unifiedResponse.promptText,

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
                const { error: saveError } = await saveVibe(mood, finalPlaylist, userProfile?.id || null, stats, 'post_auth_generation', pendingVibeId || undefined);
                
                if (saveError) {
                    addLog(`Database Error: ${saveError.message}`);
                    setShowDebug(true); 
                } else {
                    addLog(`Vibe updated in memory (ID: ${pendingVibeId || 'new'})`);
                }
            } catch (dbErr) {
                console.error(dbErr);
                addLog(`Failed to save vibe to database: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`);
            }
        }

    } catch (error: any) {
        console.error("Playlist generation failed:", error);
        addLog(`Playlist generation failed. Error Name: ${error.name || 'UnknownError'}, Message: ${error.message || 'No message provided.'}`);
        
        if (error.name === 'ApiKeyRequiredError') {
            setValidationError({ message: error.message, key: Date.now() }); // Use new modal for API Key errors
        } else {
            setLoadingMessage("Error generating playlist. Please check debug logs for details.");
            setValidationError({ message: `Error generating playlist. Details: ${error.message || 'Unknown error.'}`, key: Date.now() });
        }

        if ((error as any).details) {
            addLog(`Server Details: ${JSON.stringify((error as any).details, null, 2)}`);
        }
        if (error.stack) {
            addLog(`Stack: ${error.stack}`);
        }
        
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
            },
            'post_auth_generation'
        );

        setShowDebug(true);
        setTimeout(() => setIsLoading(false), 3000);
    }
  };
  // --- END: Unified handleMoodSelect (v1.2.0) ---

  const handleReset = () => {
    localStorage.removeItem('vibelist_pending_vibe_id');
    setPlaylist(null);
    setTeaserPlaylist(null);
    setCurrentSong(null);
    setPlayerState(PlayerState.STOPPED);
    setIsConfirmationStep(false);
    setValidationError(null);
    addLog("App state reset.");
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
          addLog(`Shared vibe link copied: ${url}`);
      });
  };

  const handlePlaySong = (song: Song) => {
    if (currentSong?.id === song.id) {
      if (playerState === PlayerState.PLAYING) {
        setPlayerState(PlayerState.PAUSED);
        addLog(`Paused song: ${song.title}`);
      } else {
        setPlayerState(PlayerState.PLAYING);
        addLog(`Resumed song: ${song.title}`);
      }
    } else {
      setCurrentSong(song);
      setPlayerState(PlayerState.PLAYING);
      addLog(`Playing new song: ${song.title} by ${song.artist}`);
    }
  };

  const handlePause = () => {
    setPlayerState(PlayerState.PAUSED);
    addLog(`Playback paused.`);
  };

  const handleNext = () => {
    if (!playlist || !currentSong) return;
    const idx = playlist.songs.findIndex(s => s.id === currentSong.id);
    if (idx < playlist.songs.length - 1) {
      handlePlaySong(playlist.songs[idx + 1]);
      addLog(`Skipped to next song.`);
    } else {
      setPlayerState(PlayerState.STOPPED);
      addLog(`Playlist ended.`);
    }
  };

  const handlePrev = () => {
    if (!playlist || !currentSong) return;
    const idx = playlist.songs.findIndex(s => s.id === currentSong.id);
    if (idx > 0) {
      handlePlaySong(playlist.songs[idx - 1]);
      addLog(`Skipped to previous song.`);
    }
  };

  const handleExportToSpotify = async () => {
    if (!playlist || !spotifyToken || !userProfile) {
      handleLogin();
      return;
    }
    setExporting(true);
    addLog(`Attempting to export playlist "${playlist.title}" to Spotify...`);
    try {
      const url = await createSpotifyPlaylist(spotifyToken, playlist, userProfile.id);
      if (playlist.id) {
          await markVibeAsExported(playlist.id);
      }
      window.open(url, '_blank'); // Original line
      addLog(`Playlist "${playlist.title}" successfully exported to Spotify: ${url}`);
    } catch (e: any) {
      alert(`Failed to export: ${e.message}`);
      addLog(`Failed to export playlist to Spotify: ${e.message || e}`);
    } finally {
      setExporting(false);
    }
  };

  const handleClosePlayer = () => {
      setPlayerState(PlayerState.STOPPED);
      setCurrentSong(null); 
      addLog("Player closed.");
  };

  const renderContent = () => {
    if (isLoading && !teaserPlaylist) {
      return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center text-center animate-fade-in p-4">
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
      );
    }

    if (playlist) {
      return (
        <PlaylistView 
          playlist={playlist}
          currentSong={currentSong}
          playerState={playerState}
          onPlaySong={handlePlaySong}
          onPause={handlePause}
          onExport={handleExportToSpotify}
          onShare={handleShare}
          exporting={exporting}
        />
      );
    }

    return <MoodSelector onSelectMood={handleMoodSelect} isLoading={isLoading} validationError={validationError} />;
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-white flex flex-col relative font-inter">
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-20 -left-20 w-96 h-96 bg-purple-900 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob"></div>
        <div className="absolute top-40 right-10 w-96 h-96 bg-cyan-900 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>
        <div className="absolute -bottom-20 left-1/2 w-96 h-96 bg-pink-900 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-4000"></div>
      </div>

      <header className="sticky top-0 z-20 w-full p-4 md:p-6 px-6 flex justify-between items-center glass-panel border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-2 cursor-pointer" onClick={handleReset}>
           <img
  src="/vibelist-header-icon-final-64-v3.png"
  alt="VibeList Pro"
  className="w-9 h-9"
 />
           <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400 hidden md:block">
             VibeList Pro
           </h1>
        </div>
        
        <div className="flex items-center gap-4">
           <button 
             onClick={(e) => {
               addLog(`'π' button clicked. Ctrl key pressed: ${e.ctrlKey}. Current Admin Inspector state: ${showAdminDataInspector}.`);
               if (e.ctrlKey) {
                 addLog(`Ctrl+Click detected for 'π'. Toggling AdminDataInspector to ${!showAdminDataInspector}.`);
                 setShowAdminDataInspector(prev => !prev);
               } else {
                 addLog(`Regular click detected for 'π'. Toggling debug logs to ${!showDebug}.`);
                 setShowDebug(prev => !prev);
               }
             }} 
             className="text-xs text-slate-700 hover:text-slate-500 font-mono px-3"
             title="Debug"
           >
               π
           </button>

           {!spotifyToken ? (
            // Pre-login: Burger menu icon
             <>
               <button 
                 onClick={handleLogin}
                 className="text-sm font-medium bg-[#1DB954] text-black px-5 py-2 rounded-full hover:bg-[#1ed760] transition-all shadow-lg hover:shadow-[#1DB954]/20"
               >
                 Login with Spotify
               </button>
               <button onClick={() => setShowSettings(true)} className="text-slate-400 hover:text-white transition-colors" title="Settings">
                  <BurgerIcon className="w-6 h-6" />
               </button>
             </>
           ) : (
            // Post-login: Spotify profile avatar
             <div 
               className="flex items-center gap-3 bg-white/5 px-4 py-1.5 rounded-full border border-white/10 cursor-pointer hover:bg-white/10 transition-colors"
               onClick={() => setShowSettings(true)} // Clicking profile now opens settings
             >
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

      {showAdminDataInspector && (
          <AdminDataInspector
              isOpen={showAdminDataInspector}
              onClose={() => setShowAdminDataInspector(false)}
              userTaste={userTaste}
              aggregatedPlaylists={userAggregatedPlaylists}
              debugLogs={debugLogs}
          />
      )}

      <main className="relative z-10 flex-grow w-full">
        {renderContent()}
      </main>
      
      {teaserPlaylist && (
        <TeaserPlaylistView
          playlist={teaserPlaylist}
          isConfirmationStep={isConfirmationStep}
          onConfirm={() => handleMoodSelect(teaserPlaylist.mood, 'text')}
          onUnlock={handleLogin}
          onTryAnother={handleReset}
        />
      )}

      <PlayerControls 
        currentSong={currentSong}
        playerState={playerState}
        onTogglePlay={() => playerState === PlayerState.PLAYING ? handlePause() : currentSong && handlePlaySong(currentSong)}
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
        isAuthenticated={!!spotifyToken}
      />
    </div>
  );
};

export default App;
