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
  language?: string[]; // NEW: ISO 639-1 language codes (e.g., ['en', 'he'])
}

export interface AnalyzedTopTrack { // Renamed from AnalyzedTrack
  origin: "TOP_50_TRACKS_LIST"; // NEW
  song_name: string;
  artist_name: string;
  semantic_tags: SemanticTags;
  confidence: string; // "low" | "medium" | "high"
}

// NEW: Analyzed playlist context item for TASK B
export interface AnalyzedPlaylistContextItem {
  origin: "PLAYLISTS";
  playlist_name: string;
  playlist_creator: string;
  playlist_track_count: number;
  playlist_primary_function: "focus" | "workout" | "relax" | "sleep" | "commute" | "study" | "party" | "background" | "other";
  playlist_emotional_direction: "calming" | "energizing" | "uplifting" | "melancholic" | "romantic" | "dark" | "nostalgic" | "other";
  playlist_language_distribution: Array<{ language: string; percentage: number; }>; // MODIFIED: Changed to array of objects
  confidence: "low" | "medium" | "high";
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
  language_distribution: Record<string, number>; // NEW: e.g., { "en": 0.7, "he": 0.3 }
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

// Defines the client-side representation of a full playlist
export interface Playlist {
  id?: string; // Optional, might be assigned after saving to DB
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

// REMOVED: User Playlist Mood Analysis
// export interface UserPlaylistMoodAnalysis {
//   playlist_mood_category: string;
//   confidence_score: number; // 0.0 to 1.0
// }

// NEW: Unified Taste Analysis (combines SessionSemanticProfile and AnalyzedPlaylistContextItem[])
export interface UnifiedTasteAnalysis {
  overall_mood_category: string;
  overall_mood_confidence: number;
  session_semantic_profile: SessionSemanticProfile;
  playlist_contexts: AnalyzedPlaylistContextItem[]; // NEW
  analyzed_top_tracks?: AnalyzedTopTrack[]; // NEW: Added for itemized top track analysis
}

// NEW: Gemini's raw unified response for taste analysis (for two parallel calls)
export interface UnifiedTasteGeminiResponse {
  analyzed_50_top_tracks: AnalyzedTopTrack[];
  analyzed_playlist_context: AnalyzedPlaylistContextItem[];
}

export interface UserTasteProfile {
  topArtists: string[];
  topGenres: string[];
  topTracks: string[]; // RESTORED: For Gemini Analysis
  unified_analysis?: UnifiedTasteAnalysis; // NEW: Replaces session_analysis and playlistMoodAnalysis
  last_analyzed_at?: string; // NEW: Timestamp of when unified_analysis was last performed
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
  playlistCreator: string; // NEW
  playlistTrackCount: number; // NEW
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

// NEW: Interface for the validation response object
export interface VibeValidationResponse {
  validation_status: VibeValidationStatus;
  reason: string;
}

export interface UnifiedVibeResponse {
  validation_status: VibeValidationStatus;
  reason: string;
  playlist_title?: string;
  description?: string;
  mood?: string;
  songs?: GeneratedSongRaw[];
  promptText?: string;
  metrics?: GeminiResponseMetrics;
}

// NEW: Transcription Contract Hard Stop (v2.2.2)
export type TranscriptionStatus = 'ok' | 'no_speech' | 'error';

export interface TranscriptionResult {
  status: TranscriptionStatus;
  text?: string;
  reason?: string;
}

// NEW (v2.2.4): Metadata for transcription request with acoustic signals
export interface TranscriptionRequestMeta {
  durationMs: number;
  speechDetected: boolean;
  speechConfidence?: number; // 0-1, optional (not used in v2.2.4, but for future extensibility)
}
