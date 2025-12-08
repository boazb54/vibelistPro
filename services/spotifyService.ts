import { SPOTIFY_AUTH_ENDPOINT, SPOTIFY_SCOPES } from "../constants";
import { Playlist, Song, GeneratedSongRaw } from "../types";
import { fetchSongMetadata } from "./itunesService";

export const getDefaultRedirectUri = (): string => {
  return window.location.href.split('#')[0];
};

export const getLoginUrl = (clientId: string, redirectUri: string, showDialog: boolean = false): string => {
  const scopes = SPOTIFY_SCOPES.join("%20");
  const cleanId = clientId.replace(/[^a-zA-Z0-9]/g, '');
  const cleanUri = redirectUri.trim();
  return `${SPOTIFY_AUTH_ENDPOINT}?client_id=${cleanId}&redirect_uri=${encodeURIComponent(cleanUri)}&scope=${scopes}&response_type=token${showDialog ? '&show_dialog=true' : ''}`;
};

// --- PKCE ADDITIONS ---

export const getPkceLoginUrl = (clientId: string, redirectUri: string, codeChallenge: string, showDialog: boolean = false): string => {
  const scopes = SPOTIFY_SCOPES.join("%20");
  const cleanId = clientId.replace(/[^a-zA-Z0-9]/g, '');
  const cleanUri = redirectUri.trim();
  
  // Note: response_type is 'code' for PKCE
  return `${SPOTIFY_AUTH_ENDPOINT}?client_id=${cleanId}&redirect_uri=${encodeURIComponent(cleanUri)}&scope=${scopes}&response_type=code&code_challenge_method=S256&code_challenge=${codeChallenge}${showDialog ? '&show_dialog=true' : ''}`;
};

export const exchangeCodeForToken = async (clientId: string, redirectUri: string, code: string, codeVerifier: string) => {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  });

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${errorText}`);
  }

  return response.json();
};

export const refreshSpotifyToken = async (clientId: string, refreshToken: string) => {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error('Failed to refresh token');
  }

  return response.json();
};

// ---------------------

export const getTokenFromHash = (): string | null => {
  if (typeof window === 'undefined') return null;
  // Look for access_token in hash OR query params (handle both implicit and edge cases)
  const hashMatch = window.location.href.match(/[#?&]access_token=([^&]*)/);
  if (hashMatch) return hashMatch[1];
  
  return null;
};

// NEW: Search Spotify for Metadata (Hybrid Fallback)
export const fetchSpotifyMetadata = async (token: string, generatedSong: GeneratedSongRaw): Promise<Song> => {
    try {
        const q = encodeURIComponent(`track:${generatedSong.title} artist:${generatedSong.artist}`);
        const res = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (res.ok) {
            const data = await res.json();
            if (data.tracks && data.tracks.items.length > 0) {
                const track = data.tracks.items[0];
                let previewUrl = track.preview_url;

                // HYBRID FALLBACK: If Spotify preview is null, try iTunes
                if (!previewUrl) {
                    try {
                        const itunesSong = await fetchSongMetadata(generatedSong);
                        if (itunesSong.previewUrl) {
                            previewUrl = itunesSong.previewUrl;
                        }
                    } catch (fallbackErr) {
                        console.warn("iTunes fallback for preview failed", fallbackErr);
                    }
                }

                return {
                    id: track.id, // Spotify ID
                    title: track.name,
                    artist: track.artists.map((a: any) => a.name).join(', '),
                    album: track.album.name,
                    previewUrl: previewUrl, 
                    artworkUrl: track.album.images[0]?.url || null,
                    spotifyUri: track.uri,
                    durationMs: track.duration_ms,
                    searchQuery: generatedSong.search_query
                };
            }
        }
    } catch (e) {
        console.warn("Spotify search failed, falling back to basic data", e);
    }

    // Fallback: If Spotify search found nothing or failed (e.g. 429), try iTunes entirely
    // This ensures we always show the song if possible, even if Spotify API flaked out.
    return fetchSongMetadata(generatedSong);
};

export const createSpotifyPlaylist = async (token: string, playlist: Playlist, userId: string) => {
  if (!userId) {
      throw new Error("User ID is required to create a playlist");
  }

  // 1. Create Playlist
  const createRes = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `VibeList+: ${playlist.title}`,
      description: `Generated by VibeList+ for mood: ${playlist.mood}. ${playlist.description}`,
      public: false,
    }),
  });

  if (!createRes.ok) {
     const errorText = await createRes.text();
     try {
         const jsonErr = JSON.parse(errorText);
         throw new Error(`Failed to create playlist: ${jsonErr.error?.message || createRes.statusText}`);
     } catch(e) {
         throw new Error(`Failed to create playlist: ${errorText}`);
     }
  }
  
  const playlistData = await createRes.json();
  const playlistId = playlistData.id;

  // 2. Search for tracks on Spotify to get URIs
  // Note: If we already fetched metadata via Spotify, we might have URIs in the song objects.
  const trackUris: string[] = [];
  
  for (const song of playlist.songs) {
    if (song.spotifyUri) {
        trackUris.push(song.spotifyUri);
    } else {
        // Fallback search if we didn't have URI (e.g. came from iTunes or failure)
        const q = encodeURIComponent(`track:${song.title} artist:${song.artist}`);
        const searchRes = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          if (searchData.tracks.items.length > 0) {
            trackUris.push(searchData.tracks.items[0].uri);
          }
        }
    }
  }

  // 3. Add tracks to playlist
  if (trackUris.length > 0) {
    await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        uris: trackUris,
      }),
    });
  }
  
  return playlistData.external_urls.spotify;
};

export const getUserProfile = async (token: string) => {
  if (!token) throw new Error("No token provided");
  const res = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let errorMessage = `Failed to fetch profile: ${res.status} ${res.statusText}`;
    try {
        const errorBody = await res.json();
        if (errorBody.error && errorBody.error.message) {
            errorMessage = errorBody.error.message;
        }
    } catch (e) {
        // failed to parse json
    }
    throw new Error(errorMessage);
  }
  return res.json();
};