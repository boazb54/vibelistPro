

export interface Song {
  id: string; // Unique ID (often from iTunes or generated)
  title: string;
  artist: string;
  album: string;
  previewUrl: string | null;
  artworkUrl: string | null;
  spotifyUri?: string; // If we could fetch it, for now mostly placeholder or user-matched
  durationMs?: number;
  itunesUrl?: string;
  searchQuery: string; // The query used to find this
}

export interface Playlist {
  id?: string; // Supabase UUID for history tracking
  title: string;
  mood: string;
  description: string;
  songs: Song[];
}

export interface GeneratedSongRaw {
  title: string;
  artist: string;
}

export interface GeneratedPlaylistRaw {
  playlist_title: string;
  mood: string;
  description: string;
  songs: GeneratedSongRaw[];
}

// NEW: Wrapper to return metrics along with the playlist data
export interface GeminiResponseWithMetrics extends GeneratedPlaylistRaw {
  promptText: string;
  metrics: {
    promptBuildTimeMs: number;
    geminiApiTimeMs: number;
  };
}

export enum PlayerState {
  STOPPED,
  PLAYING,
  PAUSED,
  LOADING
}

export interface SpotifyConfig {
  clientId: string;
  redirectUri: string;
}

export interface SpotifyImage {
  url: string;
  height: number | null;
  width: number | null;
}

export interface SpotifyExplicitContent {
  filter_enabled: boolean;
  filter_locked: boolean;
}

export interface SpotifyUserProfile {
  id: string;
  display_name: string;
  email: string;
  country: string;
  explicit_content: SpotifyExplicitContent;
  images: SpotifyImage[];
  product: string;
  uri: string;
}

// NEW: For Discovery Bridge
export interface SpotifyArtist {
  id: string;
  name: string;
  genres: string[];
  popularity: number;
}

export interface UserTasteProfile {
  topArtists: string[];
  topGenres: string[];
}

// NEW: Performance Logging Stats
export interface VibeGenerationStats {
  geminiTimeMs: number; // Total Gemini time (Step B+C+D)
  contextTimeMs: number; // Step B: Context Assembly
  promptBuildTimeMs: number; // Step C: Prompt Construction
  geminiApiTimeMs: number; // Step D: Google API Wait
  itunesTimeMs: number; // Step E: Filtering
  totalDurationMs: number;
  successCount: number;
  failCount: number;
  failureDetails: { title: string; artist: string; reason: string }[];
  promptText?: string;
}