
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

export interface GeneratedTeaserRaw {
  playlist_title: string;
  description: string;
}

export interface GeminiResponseMetrics { // Extracted metrics interface for reuse
  promptBuildTimeMs: number;
  geminiApiTimeMs: number;
}

// Previously GeminiResponseWithMetrics, now part of UnifiedVibeResponse
export interface GeminiPlaylistResponse extends GeneratedPlaylistRaw {
  promptText: string;
  metrics: GeminiResponseMetrics;
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

// V1.2.2: Unified Taste Analysis Result
export interface UnifiedTasteAnalysis {
  playlist_mood: UserPlaylistMoodAnalysis;
  analyzed_tracks: AnalyzedTrack[];
}

export interface UserTasteProfile {
  topArtists: string[];
  topGenres: string[];
  topTracks: string[]; // RESTORED: For Gemini Analysis
  session_analysis?: SessionSemanticProfile; // NEW: Processed "Vibe Fingerprint"
  playlistMoodAnalysis?: UserPlaylistMoodAnalysis; // NEW: Added for overall playlist mood
  unified_analysis?: UnifiedTasteAnalysis; // V1.2.2: The result of consolidated AI pass
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

// NEW: Interface for structured aggregated playlist data
export interface AggregatedPlaylist {
  playlistName: string;
  tracks: string[]; // Array of "Song by Artist" strings
}

// NEW: Props for AdminDataInspector component
export interface AdminDataInspectorProps {
  isOpen: boolean;
  onClose: () => void;
  userTaste: UserTasteProfile | null;
  aggregatedPlaylists: AggregatedPlaylist[];
  debugLogs: string[];
}

// V1.2.0: Vibe Validation Gate Types
export type VibeValidationStatus = 'VIBE_VALID' | 'VIBE_INVALID_GIBBERISH' | 'VIBE_INVALID_OFF_TOPIC';

export interface VibeValidationResponse {
  validation_status: VibeValidationStatus;
  reason: string;
}

// V1.2.0: Unified response for the /api/vibe.mjs endpoint
// This type combines possible outcomes: validation, teaser, or full playlist
export interface UnifiedVibeResponse {
  validation_status?: VibeValidationStatus; // Present for all responses, optional as server might omit if always valid
  reason?: string; // Reason for validation status

  playlist_title?: string; // Present for teasers and full playlists
  mood?: string; // Present for full playlists
  description?: string; // Present for teasers and full playlists
  songs?: GeneratedSongRaw[]; // Present only for full playlists

  promptText?: string; // Only returned from client-side `generatePlaylistFromMood` in preview env
  metrics?: GeminiResponseMetrics; // Optional, server might provide
}
