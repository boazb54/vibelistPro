import React, { useState, useEffect, useCallback } from 'react';
import MoodSelector from './components/MoodSelector';
import PlaylistView from './components/PlaylistView';
import PlayerControls from './components/PlayerControls';
import { CogIcon, SpotifyIcon } from './components/Icons';
import { generatePlaylistFromMood } from './services/geminiService';
import { fetchSongMetadata } from './services/itunesService';
import { getLoginUrl, getPkceLoginUrl, exchangeCodeForToken, refreshSpotifyToken, getTokenFromHash, createSpotifyPlaylist, getUserProfile, fetchSpotifyMetadata } from './services/spotifyService';
import { generateRandomString, generateCodeChallenge } from './services/pkceService';
import { supabase } from './services/supabaseClient';
import { Playlist, Song, PlayerState, SpotifyUserProfile } from './types';
import { DEFAULT_SPOTIFY_CLIENT_ID, DEFAULT_REDIRECT_URI } from './constants';

const App: React.FC = () => {
  // ----------------------------------------------------------------
  // STRICT POPUP DETECTION
  // ----------------------------------------------------------------
  const [isPopupMode, setIsPopupMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      !!window.opener || 
      window.name === 'SpotifyLogin' || 
      window.location.href.includes('access_token') || 
      window.location.href.includes('code=') ||
      window.location.href.includes('error')
    );
  });

  const [debugUrl, setDebugUrl] = useState<string>('');

  // ----------------------------------------------------------------
  // STATE
  // ----------------------------------------------------------------
  const [playlist, setPlaylist] = useState<Playlist | null>(() => {
    try {
      const saved = localStorage.getItem('vibelist_playlist');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      console.error("Failed to parse playlist from storage", e);
      return null;
    }
  });

  const [currentSong, setCurrentSong] = useState<Song | null>(() => {
    try {
      const saved = localStorage.getItem('vibelist_currentSong');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      console.error("Failed to parse current song from storage", e);
      return null;
    }
  });

  const [playerState, setPlayerState] = useState<PlayerState>(() => {
    return localStorage.getItem('vibelist_currentSong') ? PlayerState.PAUSED : PlayerState.STOPPED;
  });

  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  
  // Spotify State
  const [spotifyToken, setSpotifyToken] = useState<string | null>(null);
  
  // Initialize with Defaults or LocalStorage
  const [spotifyClientId, setSpotifyClientId] = useState<string>(() => {
      return localStorage.getItem('spotify_client_id') || DEFAULT_SPOTIFY_CLIENT_ID;
  });
  const [spotifyRedirectUri, setSpotifyRedirectUri] = useState<string>(() => {
      return localStorage.getItem('spotify_redirect_uri') || DEFAULT_REDIRECT_URI;
  });

  const [usePkce, setUsePkce] = useState<boolean>(true); // Default to True now
  const [showSettings, setShowSettings] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [manualUrlInput, setManualUrlInput] = useState('');
  const [exporting, setExporting] = useState(false);
  const [userProfile, setUserProfile] = useState<SpotifyUserProfile | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Popup Specific State
  const [callbackStatus, setCallbackStatus] = useState<'detecting' | 'exchanging' | 'success' | 'creating' | 'done' | 'error'>('detecting');
  const [createdPlaylistUrl, setCreatedPlaylistUrl] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');

  // ----------------------------------------------------------------
  // EFFECTS
  // ----------------------------------------------------------------
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDebugUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    if (playlist) {
      localStorage.setItem('vibelist_playlist', JSON.stringify(playlist));
    } else {
      localStorage.removeItem('vibelist_playlist');
    }
  }, [playlist]);

  useEffect(() => {
    if (currentSong) {
      localStorage.setItem('vibelist_currentSong', JSON.stringify(currentSong));
    } else {
      localStorage.removeItem('vibelist_currentSong');
    }
  }, [currentSong]);

  useEffect(() => {
    // If local storage is empty, ensure defaults are set in state
    if (!localStorage.getItem('spotify_client_id')) {
        localStorage.setItem('spotify_client_id', DEFAULT_SPOTIFY_CLIENT_ID);
    }
    if (!localStorage.getItem('spotify_redirect_uri')) {
        localStorage.setItem('spotify_redirect_uri', DEFAULT_REDIRECT_URI);
    }

    // Initial Token Check
    refreshSessionIfNeeded();

  }, []);

  // TOKEN / CODE HANDLING
  useEffect(() => {
    const handleAuth = async () => {
      // 1. Check for Access Token (Legacy)
      const tokenFromHash = getTokenFromHash();
      if (tokenFromHash) {
        handleSuccess(tokenFromHash);
        return;
      }

      // 2. Check for Auth Code (PKCE)
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      
      if (code) {
        setCallbackStatus('exchanging');
        setStatusMessage('Securing connection (swapping code for token)...');
        
        // We need the code_verifier we saved before redirect
        const verifier = localStorage.getItem('spotify_code_verifier');
        // Use defaults if LS is missing, though verifier MUST be in LS
        const storedClientId = localStorage.getItem('spotify_client_id') || DEFAULT_SPOTIFY_CLIENT_ID;
        const storedRedirectUri = localStorage.getItem('spotify_redirect_uri') || DEFAULT_REDIRECT_URI;

        if (verifier) {
           try {
             const data = await exchangeCodeForToken(storedClientId, storedRedirectUri, code, verifier);
             if (data.access_token) {
               // Clear verifier to be clean
               localStorage.removeItem('spotify_code_verifier');
               // Handle success with full data object to save refresh token
               handleSuccessFull(data);
             } else {
               throw new Error("No access token in response");
             }
           } catch (e: any) {
             console.error("PKCE Exchange Failed", e);
             setCallbackStatus('error');
             setStatusMessage(`PKCE Error: ${e.message}`);
           }
        } else {
           setCallbackStatus('error');
           setStatusMessage('Missing PKCE verifier. Did you switch browsers or clear cache?');
        }
        return;
      }
      
      // 3. Error state
      if (isPopupMode && callbackStatus === 'detecting') {
          if (!window.location.href.includes('error=')) {
              // Might be waiting for redirect, don't error immediately
          } else {
             setCallbackStatus('error');
             setStatusMessage('Spotify returned an error in the URL.');
          }
      }
    };

    handleAuth();

    // Listeners for cross-window communication
    const messageHandler = (event: MessageEvent) => {
      if (event.data?.type === 'SPOTIFY_TOKEN' && event.data?.token) {
        handleNewToken(event.data.token);
      }
    };
    window.addEventListener('message', messageHandler);

    const storageHandler = (event: StorageEvent) => {
      if (event.key === 'spotify_access_token' && event.newValue) {
        handleNewToken(event.newValue);
      }
    };
    window.addEventListener('storage', storageHandler);

    return () => {
      window.removeEventListener('message', messageHandler);
      window.removeEventListener('storage', storageHandler);
    };
  }, [isPopupMode]);

  // ----------------------------------------------------------------
  // AUTH HELPERS
  // ----------------------------------------------------------------

  // Returns the current valid token, refreshing it if necessary
  const refreshSessionIfNeeded = async (): Promise<string | null> => {
      const storedToken = localStorage.getItem('spotify_access_token');
      const storedRefreshToken = localStorage.getItem('spotify_refresh_token');
      const storedExpiry = localStorage.getItem('spotify_token_expiry');
      const clientId = localStorage.getItem('spotify_client_id') || DEFAULT_SPOTIFY_CLIENT_ID;

      const now = Date.now();
      const isExpired = !storedExpiry || now > parseInt(storedExpiry, 10);

      // If we have a refresh token and need a new access token
      if (storedRefreshToken && isExpired) {
          setIsRefreshing(true);
          try {
              const data = await refreshSpotifyToken(clientId, storedRefreshToken);
              
              const newToken = data.access_token;
              localStorage.setItem('spotify_access_token', newToken);
              setSpotifyToken(newToken);
              
              const expiresInMs = (data.expires_in || 3600) * 1000;
              localStorage.setItem('spotify_token_expiry', (now + expiresInMs).toString());
              
              if (data.refresh_token) {
                  localStorage.setItem('spotify_refresh_token', data.refresh_token);
              }

              // Refresh profile while we're at it
              getUserProfile(newToken).then(profile => {
                  setUserProfile(profile);
                  saveUserToSupabase(profile);
              });
              
              setIsRefreshing(false);
              return newToken;
          } catch (e) {
              console.error("Auto-refresh failed", e);
              setSpotifyToken(null);
              setUserProfile(null);
              localStorage.removeItem('spotify_access_token');
              localStorage.removeItem('spotify_refresh_token');
              localStorage.removeItem('spotify_token_expiry');
              setIsRefreshing(false);
              return null;
          }
      }

      // If valid, just return what we have
      if (storedToken && !isExpired) {
          if (!spotifyToken) {
              setSpotifyToken(storedToken);
              getUserProfile(storedToken).then(profile => {
                  setUserProfile(profile);
                  saveUserToSupabase(profile);
              }).catch(() => {});
          }
          return storedToken;
      }

      return null;
  };

  const handleSuccessFull = (data: any) => {
      const token = data.access_token;
      
      setSpotifyToken(token);
      setCallbackStatus('success');
      setStatusMessage('');
      
      // Save all tokens
      localStorage.setItem('spotify_access_token', token);
      if (data.refresh_token) {
          localStorage.setItem('spotify_refresh_token', data.refresh_token);
      }
      if (data.expires_in) {
          const now = Date.now();
          const expiresInMs = data.expires_in * 1000;
          localStorage.setItem('spotify_token_expiry', (now + expiresInMs).toString());
      }
      
      if (window.opener && window.opener !== window) {
        try {
          window.opener.postMessage({ type: 'SPOTIFY_TOKEN', token: token }, '*');
        } catch (e) { console.warn("Could not post to opener", e); }
      }
      
      getUserProfile(token).then(profile => {
          setUserProfile(profile);
          saveUserToSupabase(profile);
      }).catch(console.error);
  };

  const handleSuccess = (token: string) => {
     handleNewToken(token);
  }

  const handleNewToken = (token: string) => {
    setSpotifyToken(token);
    localStorage.setItem('spotify_access_token', token);
    
    getUserProfile(token)
        .then((profile) => {
            setUserProfile(profile);
            saveUserToSupabase(profile);
        })
        .catch(e => {
            console.error(e);
            alert(`Connected, but failed to load profile. \n\nIMPORTANT: You must add your email to the "User Management" list in your Spotify Developer Dashboard to fix this.\n\nError: ${e.message}`);
        });
  };
  
  const saveUserToSupabase = async (profile: SpotifyUserProfile) => {
      try {
          const { error } = await supabase
              .from('users')
              .upsert({
                  id: profile.id,
                  email: profile.email,
                  display_name: profile.display_name,
                  country: profile.country,
                  product: profile.product,
                  explicit_filter: profile.explicit_content?.filter_enabled,
                  last_login: new Date().toISOString()
              });
          
          if (error) {
              console.warn("Supabase save error (table might not exist yet):", error.message);
          } else {
              console.log("User segmentation saved to cloud.");
          }
      } catch (e) {
          console.warn("Supabase connection issue:", e);
      }
  };

  // ----------------------------------------------------------------
  // HANDLERS
  // ----------------------------------------------------------------

  const handleMoodSelect = async (mood: string) => {
    setIsLoading(true);
    setLoadingMessage('Consulting the musical oracles...');
    setPlaylist(null);
    setCurrentSong(null);
    setPlayerState(PlayerState.STOPPED);

    try {
      const userContext = userProfile ? {
          country: userProfile.country,
          explicit_filter_enabled: userProfile.explicit_content?.filter_enabled
      } : undefined;

      // We now request 10 songs to create a buffer
      const generatedData = await generatePlaylistFromMood(mood, userContext);
      setLoadingMessage('Finding preview tapes...');
      
      // Ensure we have a valid token if possible
      const activeToken = await refreshSessionIfNeeded();

      const realSongs: Song[] = await Promise.all(
        generatedData.songs.map(s => {
            // Prioritize Spotify Metadata if logged in
            if (activeToken) {
                return fetchSpotifyMetadata(activeToken, s);
            } else {
                // Fallback to iTunes if not logged in
                return fetchSongMetadata(s);
            }
        })
      );
      
      // STRICT FILTER: Remove any song that still has no previewUrl (despite fallback attempts)
      const validSongs = realSongs.filter(s => s.previewUrl !== null);

      if (validSongs.length === 0) {
          alert("We found some great songs, but couldn't load audio previews for any of them. Please try again with a slightly different mood.");
          setPlaylist(null);
          return;
      }

      // Limit to 8 songs maximum for the final display
      const displaySongs = validSongs.slice(0, 8);

      const finalPlaylist: Playlist = {
        title: generatedData.playlist_title,
        mood: generatedData.mood,
        description: generatedData.description,
        songs: displaySongs
      };
      setPlaylist(finalPlaylist);
    } catch (error) {
      console.error(error);
      alert("Failed to generate playlist. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlaySong = (song: Song) => {
    if (currentSong?.id === song.id && playerState === PlayerState.PLAYING) {
      setPlayerState(PlayerState.PAUSED);
    } else {
      setCurrentSong(song);
      setPlayerState(PlayerState.PLAYING);
    }
  };

  const handleNext = useCallback(() => {
    if (!playlist || !currentSong) return;
    const idx = playlist.songs.findIndex(s => s.id === currentSong.id);
    if (idx < playlist.songs.length - 1) {
      handlePlaySong(playlist.songs[idx + 1]);
    } else {
      setPlayerState(PlayerState.STOPPED);
    }
  }, [playlist, currentSong]);

  const handlePrev = useCallback(() => {
    if (!playlist || !currentSong) return;
    const idx = playlist.songs.findIndex(s => s.id === currentSong.id);
    if (idx > 0) {
      handlePlaySong(playlist.songs[idx - 1]);
    }
  }, [playlist, currentSong]);

  const handleSpotifyAuth = async () => {
    const currentClientId = spotifyClientId || DEFAULT_SPOTIFY_CLIENT_ID;
    
    if (!currentClientId) {
      alert("Configuration Error: Missing Client ID.");
      setShowSettings(true);
      return;
    }

    const cleanClientId = currentClientId.replace(/[^a-zA-Z0-9]/g, '');
    const cleanRedirectUri = (spotifyRedirectUri || DEFAULT_REDIRECT_URI).trim();

    localStorage.setItem('spotify_client_id', cleanClientId);
    localStorage.setItem('spotify_redirect_uri', cleanRedirectUri);
    
    setSpotifyClientId(cleanClientId);
    setSpotifyRedirectUri(cleanRedirectUri);

    let url = "";
    if (usePkce) {
        const verifier = generateRandomString(128);
        const challenge = await generateCodeChallenge(verifier);
        localStorage.setItem('spotify_code_verifier', verifier);
        url = getPkceLoginUrl(cleanClientId, cleanRedirectUri, challenge);
    } else {
        url = getLoginUrl(cleanClientId, cleanRedirectUri);
    }

    const width = 450;
    const height = 730;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;
    window.open(url, 'SpotifyLogin', `menubar=no,location=no,resizable=no,scrollbars=no,status=no,width=${width},height=${height},top=${top},left=${left}`);
  };

  const handleManualUrlSubmit = async () => {
    try {
      let input = manualUrlInput.trim();
      if (!input) { alert("Please paste the URL first."); return; }
      try { input = decodeURIComponent(input); } catch (e) {}

      if (input.includes('error=')) {
          const match = input.match(/error=([^&]*)/);
          alert(`Spotify Error: ${match ? match[1] : 'Unknown'}`);
          return;
      }

      const tokenMatch = input.match(/[#?&]access_token=([^&]*)/);
      if (tokenMatch && tokenMatch[1]) {
        handleNewToken(tokenMatch[1]);
        setManualUrlInput('');
        return;
      }

      const codeMatch = input.match(/[?&]code=([^&]*)/);
      if (codeMatch && codeMatch[1]) {
         const code = codeMatch[1];
         const verifier = localStorage.getItem('spotify_code_verifier');
         if (!verifier) {
             alert("PKCE Error: No code_verifier found. You must initiate the login from this browser.");
             return;
         }
         try {
             const data = await exchangeCodeForToken(spotifyClientId, spotifyRedirectUri, code, verifier);
             if (data.access_token) {
                 handleSuccessFull(data);
                 localStorage.removeItem('spotify_code_verifier');
                 setManualUrlInput('');
                 alert("Connected Successfully! (Auto-refresh enabled)");
             } else {
                 alert("Failed to exchange code for token.");
             }
         } catch(e: any) {
             alert(`Exchange Failed: ${e.message}`);
         }
         return;
      }
      alert("Could not find 'access_token' or 'code' in the pasted URL.");
    } catch (e) {
      alert("Error parsing input.");
    }
  };
  
  const handleSpotifyExport = async (isPopupAction = false) => {
    if (!isPopupAction && !spotifyToken) {
      handleSpotifyAuth();
      return;
    }
    
    // Ensure token is fresh before we try to use it
    const activeToken = await refreshSessionIfNeeded();
    
    if (!activeToken) {
        if (!isPopupAction) {
            handleSpotifyAuth();
            return;
        } else {
            alert("Session expired and could not refresh. Please log in again.");
            setCallbackStatus('error');
            return;
        }
    }

    if (!playlist) return;
    if (isPopupAction) setCallbackStatus('creating');
    else setExporting(true);

    try {
      let userId = userProfile?.id;
      if (!userId) {
          try {
             const profile = await getUserProfile(activeToken);
             userId = profile.id;
             setUserProfile(profile);
             saveUserToSupabase(profile);
          } catch(e) {
              throw new Error("Could not determine Spotify User ID. Please make sure your email is added to the Spotify Dashboard User Management.");
          }
      }
      const url = await createSpotifyPlaylist(activeToken, playlist, userId);
      if (isPopupAction) {
        setCreatedPlaylistUrl(url);
        setCallbackStatus('done');
      } else {
        window.open(url, "_blank");
      }
    } catch (error: any) {
      console.error(error);
      alert(`Export Failed: ${error.message}`);
      if (isPopupAction) setCallbackStatus('success');
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadCsv = () => {
    if (!playlist) return;
    const headers = ['Title', 'Artist', 'Album', 'Search Query'];
    const rows = playlist.songs.map(s => [s.title, s.artist, s.album, s.searchQuery]);
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${playlist.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_playlist.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleYouTubeExport = () => {
    if (!playlist) return;
    const query = encodeURIComponent(`${playlist.title} playlist`);
    window.open(`https://www.youtube.com/results?search_query=${query}`, '_blank');
  };

  const handleSystemDataExport = () => {
      const dump = {
          app_name: "VibeList+",
          timestamp: new Date().toISOString(),
          user_profile: userProfile,
          auth_state: {
              has_token: !!spotifyToken,
              token_expiry: localStorage.getItem('spotify_token_expiry'),
              has_refresh_token: !!localStorage.getItem('spotify_refresh_token')
          },
          configuration: {
              client_id: spotifyClientId,
              redirect_uri: spotifyRedirectUri,
              mode: 'pkce'
          },
          current_session: {
              active_playlist: playlist,
              current_song: currentSong
          }
      };

      const jsonStr = JSON.stringify(dump, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `vibelist_system_data_${Date.now()}.json`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const saveSettings = () => {
    const cleanClientId = spotifyClientId.replace(/[^a-zA-Z0-9]/g, '');
    const cleanRedirectUri = spotifyRedirectUri.trim();

    localStorage.setItem('spotify_client_id', cleanClientId);
    localStorage.setItem('spotify_redirect_uri', cleanRedirectUri);
    
    setSpotifyClientId(cleanClientId);
    setSpotifyRedirectUri(cleanRedirectUri);
    setShowSettings(false);
  };

  // ----------------------------------------------------------------
  // RENDER: STRICT POPUP MODE
  // ----------------------------------------------------------------
  if (isPopupMode) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6">
        <div className="glass-panel w-full max-w-md p-8 rounded-2xl text-center border-t-4 border-[#1DB954]">
          <SpotifyIcon className="w-16 h-16 text-[#1DB954] mx-auto mb-6" />
          <h1 className="text-2xl font-bold mb-2">Spotify Connection</h1>
          
          {callbackStatus === 'detecting' && <p className="text-slate-400 animate-pulse">Verifying connection...</p>}
          {callbackStatus === 'exchanging' && <p className="text-blue-400 animate-pulse">{statusMessage || 'Securing token...'}</p>}

          {callbackStatus === 'error' && (
            <div className="text-left bg-slate-800 p-4 rounded-lg mt-4 mb-4">
              <p className="text-red-400 font-bold mb-2">⚠ Connection Error</p>
              <p className="text-xs text-slate-400 mb-2">{statusMessage || 'Token not found.'}</p>
              <div className="bg-blue-900/30 border border-blue-700 p-2 rounded mb-3">
                 <p className="text-blue-200 text-xs font-bold">Use the Example.com Trick:</p>
                 <p className="text-blue-200 text-[10px]">Ensure Redirect URI is <code>https://example.com/</code> in Settings. When this popup redirects there, copy the URL and paste it in the main window.</p>
              </div>
              
              <div className="mb-4">
                <p className="text-[10px] uppercase text-slate-500 font-bold">Current URL:</p>
                <div className="relative group">
                    <code className="block bg-black p-2 rounded text-[10px] text-green-400 break-all border border-slate-700 cursor-text" onClick={(e) => (e.target as HTMLElement).classList.add('select-all')}>
                        {debugUrl || "Loading..."}
                    </code>
                </div>
              </div>
              <button onClick={handleSpotifyAuth} className="w-full bg-[#1DB954] text-black font-bold py-2 rounded hover:bg-[#1ed760] transition mb-2">Retry Login</button>
              <button onClick={() => window.close()} className="w-full text-slate-400 text-xs py-2 hover:text-white">Close Window</button>
            </div>
          )}

          {callbackStatus === 'success' && (
            <div className="space-y-4">
              <p className="text-green-400 font-medium">Authorization Successful!</p>
              {spotifyToken && (
                <div className="bg-slate-800 p-3 rounded-lg border border-slate-700 text-left">
                    <p className="text-[10px] uppercase text-slate-500 font-bold mb-1">Access Token</p>
                    <div className="flex gap-2">
                        <input type="text" readOnly value={spotifyToken} className="flex-grow bg-black text-green-400 text-xs p-2 rounded border border-slate-600 focus:outline-none" />
                        <button onClick={() => { navigator.clipboard.writeText(spotifyToken); alert("Token copied!"); }} className="bg-slate-600 hover:bg-slate-500 text-white text-xs px-2 rounded">Copy</button>
                    </div>
                </div>
              )}
              {playlist ? (
                <button onClick={() => handleSpotifyExport(true)} className="w-full bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold py-3 rounded-xl transition-all shadow-lg shadow-green-900/20">Create "{playlist.title}" Now</button>
              ) : (
                <div className="bg-yellow-900/30 border border-yellow-700/50 p-3 rounded-lg">
                   <p className="text-yellow-200 text-xs">Playlist data not found here. Close this and use the main window.</p>
                </div>
              )}
              <button onClick={() => window.close()} className="text-slate-500 hover:text-white text-xs underline">Close Window</button>
            </div>
          )}

          {callbackStatus === 'creating' && (
             <div className="py-8"><div className="w-10 h-10 border-4 border-[#1DB954] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div><p className="text-slate-300">Saving to your library...</p></div>
          )}
          {callbackStatus === 'done' && (
            <div className="space-y-4 animate-fade-in-up">
               <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-2"><svg className="w-8 h-8 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg></div>
               <h2 className="text-xl font-bold text-white">Playlist Created!</h2>
               <a href={createdPlaylistUrl!} target="_blank" rel="noreferrer" className="block w-full bg-white text-black font-bold py-3 rounded-xl transition-all hover:bg-gray-200">Open on Spotify</a>
               <button onClick={() => window.close()} className="text-slate-500 hover:text-white text-xs">Close Window</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------------
  // RENDER: MAIN APP
  // ----------------------------------------------------------------
  return (
    <div className="min-h-screen relative overflow-hidden text-white">
      <div className="fixed inset-0 bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 animate-gradient z-0"></div>
      
      <div className="absolute top-4 right-4 z-40 flex items-center gap-3">
        <button 
            disabled={isRefreshing}
            onClick={spotifyToken ? () => setShowSettings(true) : handleSpotifyAuth}
            className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all shadow-lg ${
                isRefreshing ? 'opacity-50 cursor-wait bg-gray-600 text-gray-300' :
                spotifyToken 
                ? 'bg-black/40 text-[#1DB954] border border-[#1DB954]/50 hover:bg-black/60' 
                : 'bg-[#1DB954] text-black font-bold hover:bg-[#1ed760] hover:scale-105'
            }`}
        >
            <SpotifyIcon className="w-5 h-5" />
            <span className="text-sm font-bold hidden md:inline">
                {isRefreshing ? 'Refreshing...' : (spotifyToken ? (userProfile?.display_name || 'Connected') : 'Connect Spotify')}
            </span>
        </button>

        <button onClick={() => setShowSettings(true)} className="p-2.5 rounded-full bg-slate-800/50 hover:bg-slate-700 text-slate-300 transition-colors backdrop-blur-sm border border-slate-700">
            <CogIcon className="w-6 h-6" />
        </button>
      </div>

      <div className="relative z-10 container mx-auto px-4 pt-12 pb-20">
        <header className="flex flex-col items-center mb-12">
            <h1 className="text-4xl md:text-6xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 mb-2">VibeList+</h1>
            <p className="text-slate-400 text-sm font-medium tracking-widest uppercase">AI Mood Curator</p>
            {isRefreshing && <p className="text-xs text-green-400 mt-2 animate-pulse">Refreshing Spotify Session...</p>}
        </header>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center min-h-[400px]">
             <div className="relative w-24 h-24 mb-6"><div className="absolute inset-0 border-t-4 border-cyan-400 rounded-full animate-spin"></div><div className="absolute inset-2 border-t-4 border-purple-500 rounded-full animate-spin" style={{animationDirection: 'reverse', animationDuration: '1.5s'}}></div></div>
             <p className="text-xl text-slate-300 animate-pulse">{loadingMessage}</p>
          </div>
        ) : !playlist ? (
          <MoodSelector onSelectMood={handleMoodSelect} isLoading={isLoading} />
        ) : (
          <PlaylistView 
            playlist={playlist}
            currentSong={currentSong}
            playerState={playerState}
            onPlaySong={handlePlaySong}
            onPause={() => setPlayerState(PlayerState.PAUSED)}
            onReset={() => { setPlaylist(null); setPlayerState(PlayerState.STOPPED); setCurrentSong(null); }}
            onExport={() => handleSpotifyExport(false)}
            onDownloadCsv={handleDownloadCsv}
            onYouTubeExport={handleYouTubeExport}
            exporting={exporting}
          />
        )}
      </div>

      <PlayerControls 
        currentSong={currentSong}
        playerState={playerState}
        onTogglePlay={() => { if (playerState === PlayerState.PLAYING) setPlayerState(PlayerState.PAUSED); else setPlayerState(PlayerState.PLAYING); }}
        onNext={handleNext}
        onPrev={handlePrev}
        onClose={() => {
            setPlayerState(PlayerState.STOPPED);
            setCurrentSong(null);
        }}
        playlistTitle={playlist?.title}
      />

      {showSettings && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="glass-panel w-full max-w-md rounded-2xl p-6 relative max-h-[90vh] overflow-y-auto">
                <button onClick={() => setShowSettings(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">✕</button>
                <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><SpotifyIcon className="w-6 h-6 text-[#1DB954]" />Settings</h3>
                
                {/* ACCOUNT SECTION */}
                <div className="mb-6">
                    <h4 className="text-xs font-bold text-slate-400 uppercase mb-3">Account</h4>
                    {!spotifyToken ? (
                        <div className="p-4 bg-gradient-to-r from-[#1DB954] to-[#198c43] rounded-xl flex items-center justify-between shadow-lg">
                            <div>
                               <p className="font-bold text-white">Connect your account</p>
                               <p className="text-xs text-green-100">Log in with your Spotify email & password</p>
                            </div>
                            <button onClick={handleSpotifyAuth} className="bg-white text-[#1DB954] font-bold px-4 py-2 rounded-lg text-sm hover:scale-105 transition-transform shadow-sm">
                               Log In
                            </button>
                        </div>
                    ) : (
                        userProfile && (
                            <div>
                                <div className="bg-gradient-to-r from-[#1DB954]/20 to-[#1DB954]/5 border border-[#1DB954]/30 p-4 rounded-xl flex items-center gap-4 shadow-lg shadow-green-900/10 mb-2">
                                     {userProfile.images && userProfile.images[0] ? (
                                        <img src={userProfile.images[0].url} alt="Profile" className="w-12 h-12 rounded-full border-2 border-[#1DB954]" />
                                     ) : (
                                        <div className="w-12 h-12 rounded-full bg-[#1DB954] flex items-center justify-center text-black font-bold text-lg shadow-lg">
                                            {userProfile.display_name?.charAt(0) || 'U'}
                                        </div>
                                     )}
                                     <div>
                                         <p className="text-[10px] text-[#1DB954] font-black uppercase tracking-widest mb-0.5">Connected As</p>
                                         <p className="text-white font-bold text-base">{userProfile.display_name}</p>
                                         <p className="text-xs text-slate-300">{userProfile.email}</p>
                                         
                                         {/* SEGMENTATION DEBUG DATA */}
                                         <div className="mt-2 text-[10px] text-slate-500 font-mono">
                                            <span className="mr-2">CTRY: {userProfile.country || 'N/A'}</span>
                                            <span className="mr-2">SUB: {userProfile.product || 'N/A'}</span>
                                            <span>EXPL: {userProfile.explicit_content?.filter_enabled ? 'OFF' : 'ON'}</span>
                                         </div>
                                     </div>
                                </div>
                                <button onClick={() => { setSpotifyToken(null); setUserProfile(null); localStorage.removeItem('spotify_access_token'); localStorage.removeItem('spotify_user_id'); localStorage.removeItem('spotify_refresh_token'); localStorage.removeItem('spotify_token_expiry'); }} className="text-xs text-slate-500 hover:text-red-400 w-full text-right">Log Out</button>
                            </div>
                        )
                    )}
                </div>

                <div className="bg-yellow-900/30 border border-yellow-700/50 p-3 rounded-lg mb-6">
                   <p className="text-yellow-200 text-xs font-bold mb-1">⚠️ Development Mode</p>
                   <p className="text-yellow-200 text-xs leading-relaxed">Ensure your email is added to "User Management" in the Spotify Developer Dashboard, otherwise login will fail.</p>
                </div>

                <div className="mb-4 border-t border-white/10 pt-4">
                     <button onClick={() => setShowAdvancedSettings(!showAdvancedSettings)} className="text-xs text-slate-500 underline hover:text-white flex items-center gap-1">
                        {showAdvancedSettings ? 'Hide Advanced Debugging' : 'Show Advanced Debugging'}
                     </button>
                     
                     {showAdvancedSettings && (
                         <div className="mt-3">
                             <div className="mb-6 pt-4">
                                <h4 className="text-xs font-bold text-slate-400 uppercase mb-3">Developer Configuration</h4>
                                <div className="mb-4">
                                    <label className="block text-xs uppercase text-slate-500 mb-1 font-bold">Client ID</label>
                                    <input type="text" value={spotifyClientId} onChange={(e) => setSpotifyClientId(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))} placeholder="32-char hex ID" className={`w-full bg-slate-800 border rounded-lg p-3 text-white focus:ring-2 focus:ring-[#1DB954] focus:outline-none ${spotifyClientId.length > 0 && spotifyClientId.length !== 32 ? 'border-red-500' : 'border-slate-700'}`} />
                                    {spotifyClientId.length > 0 && spotifyClientId.length !== 32 && <p className="text-red-400 text-xs mt-1">ID should be 32 chars.</p>}
                                </div>

                                <div className="mb-4">
                                    <label className="block text-xs uppercase text-slate-500 mb-1 font-bold">Redirect URI</label>
                                    <div className="bg-blue-900/30 border border-blue-700 p-2 rounded mb-2">
                                         <p className="text-blue-200 text-[10px] font-bold mb-1">Recommended: Example.com</p>
                                         <p className="text-blue-200 text-[10px] leading-tight mb-2">Redirect to a simple page and copy the URL back here.</p>
                                         <button onClick={() => setSpotifyRedirectUri("https://example.com/")} className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold px-2 py-1 rounded">Set to https://example.com/</button>
                                    </div>
                                    <input type="text" value={spotifyRedirectUri} onChange={(e) => setSpotifyRedirectUri(e.target.value.trim())} className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white" />
                                </div>
                                <div className="mt-4 border-t border-slate-700 pt-4">
                                     <button onClick={handleSystemDataExport} className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold py-2 rounded-lg text-xs transition-colors">
                                         <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                           <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                                         </svg>
                                         Export System Data (JSON)
                                     </button>
                                     <p className="text-[10px] text-slate-500 mt-2 text-center">Dumps all local storage keys and state to a JSON file.</p>
                                </div>
                            </div>
                         
                             <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                                <h4 className="text-xs font-bold text-white mb-2">Manual Connection</h4>
                                <p className="text-[10px] text-slate-400 mb-2">Copy the full URL from the popup (Example.com) and paste it here.</p>
                                <div className="flex gap-2">
                                    <input type="text" value={manualUrlInput} onChange={(e) => setManualUrlInput(e.target.value)} placeholder="Paste URL..." className="flex-grow bg-slate-900 border border-slate-600 rounded-lg p-2 text-xs text-white" />
                                    <button onClick={handleManualUrlSubmit} className="bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold px-3 rounded-lg">Connect</button>
                                </div>
                             </div>
                         </div>
                     )}
                </div>

                <button onClick={saveSettings} className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold py-3 rounded-xl transition-all">Save & Close</button>
            </div>
        </div>
      )}
    </div>
  );
};

export default App;