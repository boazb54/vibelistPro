

export interface AiVibeEstimate {
  energy: string;      // e.g. "High", "Chill", "Medium"
  mood: string;        // e.g. "Uplifting", "Melancholic"
  genre_hint: string;  // e.g. "Synth-pop"
}

// NEW: Improved Schema Interfaces
export interface SemanticTags {
  primary_genre: string;
  secondary_genres: string[];
  energy: string; // "low" | "medium" | "high" | "explosive"
  mood: string[]; 
  tempo: string; // "slow" | "mid" | "fast"
  vocals: string; // "instrumental" | "lead_vocal" | "choral"
  texture: string; // "organic" | "electric" | "synthetic"
}

export interface AnalyzedTrack {
  song_name: string;
  artist_name: string;
  semantic_tags: SemanticTags;
  confidence: string; // "low" | "medium" | "high"
}

// NEW: Aggregated Session Profile (Deterministically calculated)
export interface SessionSemanticProfile {
  taste_profile_type: 'diverse' | 'focused'; // NEW: Logic flag for prompt engineering
  dominant_genres: string[];
  energy_bias: string;
  energy_distribution: Record<string, number>; // e.g. { low: 0.2, medium: 0.8 }
  dominant_moods: string[];
  tempo_bias: string;
  vocals_bias: string;
  texture_bias: string;
  artist_examples: string[]; // Top 5 weighted artists
}

// NEW: Context Object for Intent Parsing
export interface ContextualSignals {
  local_time: string;
  day_of_week: string;
  device_type: string;
  input_modality: 'text' | 'voice';
  browser_language: string;
  country?: string;
}

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
  estimatedVibe?: AiVibeEstimate; // NEW: AI Qualitative Data
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
  estimated_vibe?: AiVibeEstimate; // NEW: Requested from Gemini
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
  images?: SpotifyImage[];
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: { name: string }[];
}

// NEW: User Playlist Mood Analysis
export interface UserPlaylistMoodAnalysis {
  playlist_mood_category: string;
  confidence_score: number; // 0.0 to 1.0
}

export interface UserTasteProfile {
  topArtists: string[];
  topGenres: string[];
  topTracks: string[]; // RESTORED: For Gemini Analysis
  session_analysis?: SessionSemanticProfile; // NEW: Processed "Vibe Fingerprint"
  playlistMoodAnalysis?: UserPlaylistMoodAnalysis; // NEW: Added for overall playlist mood
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
  
  localTime?: string;
  dayOfWeek?: string;
  browserLanguage?: string;
  inputModality?: 'text' | 'voice';
  deviceType?: string;
  ipAddress?: string;
}