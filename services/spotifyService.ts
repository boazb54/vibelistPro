import { SPOTIFY_AUTH_ENDPOINT, SPOTIFY_SCOPES } from "../constants";
import { Playlist, Song, GeneratedSongRaw, SpotifyArtist, SpotifyTrack, UserTasteProfile, AggregatedPlaylist } from "../types";
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

export const exchangeCodeForToken = async (clientId: string, redirectUri: string, code: string, codeVerifier: string, signal?: AbortSignal) => {
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
    signal,
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
  const hashMatch = window.location.href.match(/[#?&]access_token=([^&]*)/);
  if (hashMatch) return hashMatch[1];
  
  return null;
};

// Search Spotify for Metadata (Hybrid Fallback)
export const fetchSpotifyMetadata = async (token: string, generatedSong: GeneratedSongRaw, country?: string): Promise<Song> => {
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
                        if (itunesSong && itunesSong.previewUrl) {
                            previewUrl = itunesSong.previewUrl;
                        }
                    } catch (fallbackErr) {
                        console.warn("iTunes fallback for preview failed", fallbackErr);
                    }
                }

                return {
                    id: track.id, 
                    title: track.name,
                    artist: track.artists.map((a: any) => a.name).join(', '),
                    album: track.album.name,
                    previewUrl: previewUrl, 
                    artworkUrl: track.album.images[0]?.url || null,
                    spotifyUri: track.uri,
                    durationMs: track.duration_ms,
                    searchQuery: `${generatedSong.title} ${generatedSong.artist}`,
                    estimatedVibe: generatedSong.estimated_vibe // Pass through Gemini's qualitative data
                };
            }
        }
    } catch (e) {
        console.warn("Spotify search failed, falling back to basic data", e);
    }

    const itunesResult = await fetchSongMetadata(generatedSong);
    if (!itunesResult) {
        throw new Error("Song not found in any provider");
    }
    return itunesResult;
};

export const createSpotifyPlaylist = async (token: string, playlist: Playlist, userId: string) => {
  if (!userId) {
      throw new Error("User ID is required to create a playlist");
  }

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
     throw new Error(`Failed to create playlist: ${errorText}`);
  }
  
  const playlistData = await createRes.json();
  const playlistId = playlistData.id;

  const trackUris: string[] = [];
  
  for (const song of playlist.songs) {
    if (song.spotifyUri) {
        trackUris.push(song.spotifyUri);
    } else {
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
    throw new Error("Failed to fetch profile");
  }
  return res.json();
};

/**
 * Fetches user taste profile (Top 50 Artists & Top 50 Tracks)
 */
export const fetchUserTasteProfile = async (token: string): Promise<UserTasteProfile | null> => {
  try {
    // 1. Fetch Top 50 Artists (Long Term)
    const artistsPromise = fetch('https://api.spotify.com/v1/me/top/artists?limit=50&time_range=long_term', {
      headers: { Authorization: `Bearer ${token}` },
    }).then(res => res.ok ? res.json() : { items: [] });

    // 2. Fetch Top 50 Tracks (Long Term - for Gemini Analysis)
    const tracksPromise = fetch('https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=long_term', {
        headers: { Authorization: `Bearer ${token}` },
    }).then(res => res.ok ? res.json() : { items: [] });
    
    const [artistsData, tracksData] = await Promise.all([artistsPromise, tracksPromise]);

    const topArtists = (artistsData.items || []).map((a: SpotifyArtist) => a.name);
    
    // Extract genres from artists
    const allGenres = (artistsData.items || []).flatMap((a: SpotifyArtist) => a.genres);
    const topGenres = [...new Set(allGenres)].slice(0, 20) as string[];

    // Map Tracks for Gemini
    const topTracks = (tracksData.items || []).map((t: any) => 
        `${t.name} by ${t.artists.map((a:any) => a.name).join(', ')}`
    );

    return { topArtists, topGenres, topTracks };
  } catch (e) {
    console.error("Error fetching taste profile", e);
    return null;
  }
};

// NEW: Fetches user's playlists and their tracks, aggregating them into a single list of "Song by Artist" strings.
export const fetchUserPlaylistsAndTracks = async (token: string): Promise<AggregatedPlaylist[]> => {
  const aggregatedPlaylists: AggregatedPlaylist[] = [];
  try {
    // 1. Fetch user playlists (limit 50)
    const playlistsRes = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!playlistsRes.ok) {
      const errorText = await playlistsRes.text();
      throw new Error(`Failed to fetch user playlists: ${errorText}`);
    }
    const playlistsData = await playlistsRes.json();
    const userPlaylists = playlistsData.items || [];

    let playlistsProcessed = 0;
    for (const playlist of userPlaylists) {
      if (playlistsProcessed >= 5) break; // Limit to first 5 non-empty playlists

      // Check if playlist is not empty before fetching tracks
      if (playlist.tracks.total > 0) {
        const playlistTracks: string[] = []; // Tracks for current playlist
        // 2. Fetch tracks for each playlist (limit 20 per playlist as per scope)
        const tracksRes = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks?limit=20`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!tracksRes.ok) {
          const errorText = await tracksRes.text();
          console.warn(`Failed to fetch tracks for playlist ${playlist.name} (ID: ${playlist.id}): ${errorText}`);
          continue; // Skip to next playlist if this one fails
        }
        const tracksData = await tracksRes.json();
        const items = tracksData.items || [];

        items.forEach((item: any) => {
          if (item.track && item.track.name && item.track.artists && item.track.artists.length > 0) {
            playlistTracks.push(`${item.track.name} by ${item.track.artists.map((a: any) => a.name).join(', ')}`);
          }
        });
        if (playlistTracks.length > 0) {
            aggregatedPlaylists.push({ playlistName: playlist.name, tracks: playlistTracks });
        }
        playlistsProcessed++;
      }
    }
  } catch (e: any) {
    console.error("Critical error during Spotify playlist/track fetching:", e.message);
    throw e; // Re-throw to be handled by App.tsx
  }
  return aggregatedPlaylists;
};

// Backward compatibility export if needed
export const fetchUserTopArtists = fetchUserTasteProfile;