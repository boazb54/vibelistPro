
export interface Song {
  id: string; 
  title: string;
  artist: string;
  album: string;
  previewUrl: string | null;
  artworkUrl: string | null;
  spotifyUri?: string; 
  durationMs?: number;
  itunesUrl?: string;
  searchQuery: string; 
}

export interface Playlist {
  id?: string; 
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

export interface SpotifyArtist {
  id: string;
  name: string;
  genres: string[];
  popularity: number;
  images?: SpotifyImage[]; // Enhanced to include images
}

export interface UserTasteProfile {
  topArtists: string[];
  topGenres: string[];
}

export interface VibeGenerationStats {
  geminiTimeMs: number; 
  contextTimeMs: number; 
  promptBuildTimeMs: number; 
  geminiApiTimeMs: number; 
  itunesTimeMs: number; 
  totalDurationMs: number;
  successCount: number;
  failCount: number;
  failureDetails: { title: string; artist: string; reason: string }[];
  promptText?: string;
  
  // NEW: Contextual Analytics
  localTime?: string;
  dayOfWeek?: string;
  browserLanguage?: string;
  inputModality?: 'text' | 'voice';
  deviceType?: string;
  ipAddress?: string;
}

// --- VERSION ONE: NEW DATA TYPES ---

export type SpotifyTimeRange = 'short_term' | 'medium_term' | 'long_term';

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: { name: string; id: string }[];
  album: { name: string; images: SpotifyImage[]; release_date: string };
  popularity: number;
  uri: string;
  preview_url: string | null;
}

export interface SpotifyPlayHistory {
  track: SpotifyTrack;
  played_at: string;
  context: any;
}

export interface ExtendedUserProfile {
  profile: SpotifyUserProfile;
  top_artists: {
    short_term: SpotifyArtist[];
    medium_term: SpotifyArtist[];
    long_term: SpotifyArtist[];
  };
  top_tracks: {
    short_term: SpotifyTrack[];
    medium_term: SpotifyTrack[];
    long_term: SpotifyTrack[];
  };
  recently_played: SpotifyPlayHistory[];
  followed_artists: SpotifyArtist[];
}
