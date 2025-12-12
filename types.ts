
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
