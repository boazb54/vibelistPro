

export interface AiVibeEstimate {
  energy: string;      // e.g. "High", "Chill", "Medium"
  mood: string;        // e.g. "Uplifting", "Melancholic"
  genre_hint: string;  // e.g. "Synth-pop"
}

// NEW: Interface for per-attribute confidence (low|medium|high)
export type ConfidenceLevel = "low" | "medium" | "high";

// NEW: Audio Physics attributes with per-attribute confidence
export interface AudioPhysics {
  energy_level: "low" | "low_medium" | "medium" | "medium_high" | "high";
  energy_confidence: ConfidenceLevel;
  tempo_feel: "slow" | "mid" | "fast";
  tempo_confidence: ConfidenceLevel;
  vocals_type: "instrumental" | "sparse" | "lead_vocal" | "harmonies" | "choral" | "background_vocal"; // Expanded enum
  vocals_confidence: ConfidenceLevel;
  texture_type: "organic" | "acoustic" | "electric" | "synthetic" | "hybrid" | "ambient"; // Expanded enum
  texture_confidence: ConfidenceLevel;
  danceability_hint: "low" | "medium" | "high"; // New dimension
  danceability_confidence: ConfidenceLevel;
}

// NEW: Raw Audio Physics (string for flexible input from Gemini)
export interface RawAudioPhysics {
  energy_level: string; // Was enum, now raw string
  energy_confidence: ConfidenceLevel;
  tempo_feel: string;   // Was enum, now raw string
  tempo_confidence: ConfidenceLevel;
  vocals_type: string;  // Was enum, now raw string
  vocals_confidence: ConfidenceLevel;
  texture_type: string; // Was enum, now raw string
  texture_confidence: ConfidenceLevel;
  danceability_hint: string; // Was enum, now raw string
  danceability_confidence: ConfidenceLevel;
}

// NEW: Semantic Tags structure (refined and flattened)
export interface SemanticTags {
  primary_genre: string;
  primary_genre_confidence: ConfidenceLevel;
  secondary_genres: string[];
  secondary_genres_confidence: ConfidenceLevel;
  // Flattened mood analysis properties
  emotional_tags: string[];
  emotional_confidence: ConfidenceLevel;
  cognitive_tags: string[];
  cognitive_confidence: ConfidenceLevel;
  somatic_tags: string[];
  somatic_confidence: ConfidenceLevel;
  language_iso_639_1: string;
  language_confidence: ConfidenceLevel;
}

// NEW: Raw Semantic Tags (strings for flexible input from Gemini)
export interface RawSemanticTags {
  primary_genre: string;
  primary_genre_confidence: ConfidenceLevel;
  secondary_genres: string[];
  secondary_genres_confidence: ConfidenceLevel;
  emotional_tags: string[];
  emotional_confidence: ConfidenceLevel;
  cognitive_tags: string[];
  cognitive_confidence: ConfidenceLevel;
  somatic_tags: string[];
  somatic_confidence: ConfidenceLevel;
  language_iso_639_1: string;
  language_confidence: ConfidenceLevel;
}

export interface AnalyzedTopTrack { 
  origin: "TOP_50_TRACKS_LIST"; 
  song_name: string;
  artist_name: string;
  audio_physics: AudioPhysics; // NEW: Split out audio physics
  semantic_tags: SemanticTags; // NEW: Updated semantic tags structure (flattened mood)
  // REMOVED: Top-level overall track confidence
}

// NEW: Raw Analyzed Top Track (uses RawAudioPhysics and RawSemanticTags)
export interface RawAnalyzedTopTrack {
  origin: "TOP_50_TRACKS_LIST";
  song_name: string;
  artist_name: string;
  audio_physics: RawAudioPhysics; // Uses raw string types
  semantic_tags: RawSemanticTags; // Uses raw string types
}

// NEW: Analyzed playlist context item for TASK B
export interface AnalyzedPlaylistContextItem {
  origin: "PLAYLISTS";
  playlist_name: string;
  playlist_creator: string;
  playlist_track_count: number;
  playlist_primary_function: "focus" | "workout" | "relax" | "sleep" | "commute" | "study" | "party" | "background" | "other";
  playlist_emotional_direction: "calming" | "energizing" | "uplifting" | "melancholic" | "romantic" | "dark" | "nostalgic" | "neutral" | "other";
  playlist_language_distribution: Array<{ language: string; percentage: number; }>; 
  confidence: "low" | "medium" | "high";
}

// NEW: Combination item for intents (for UserTasteProfileV1)
export interface IntentCombinationItem {
  mood: string;
  weight: number;
  track_examples: Array<{ title: string; artist: string }>;
}

// NEW: Intent Profile Signals Structure (for UserTasteProfileV1)
export interface IntentProfileSignals {
  intent: string;
  confidence: ConfidenceLevel;
  emotional_mood_combinations: IntentCombinationItem[];
  cognitive_mood_combinations: IntentCombinationItem[];
  somatic_mood_combinations: IntentCombinationItem[];
  genre_hints: string[];
  physics_constraints: {
    energy: AudioPhysics['energy_level'];
    danceability: AudioPhysics['danceability_hint'];
    vocals: AudioPhysics['vocals_type'];
    texture: AudioPhysics['texture_type'];
    tempo: AudioPhysics['tempo_feel'];
  };
  track_examples: Array<{ title: string; artist: string }>;
}

// NEW: User Taste Profile v1 (Aggregated JSON)
export interface UserTasteProfileV1 {
  origin: "TOP_50_TRACKS_ANALYZE";
  overall_profile_confidence: ConfidenceLevel;
  language_profile: {
    language_profile_distribution: Record<string, number>; // e.g. { "en": 0.0 }
    language_profile_confidence: ConfidenceLevel;
  };
  audio_physics_profile: {
    energy_bias: AudioPhysics['energy_level'];
    tempo_bias: AudioPhysics['tempo_feel'];
    danceability_bias: AudioPhysics['danceability_hint'];
    vocals_bias: AudioPhysics['vocals_type'];
    texture_bias: AudioPhysics['texture_type'];
    audio_physics_profile_confidence: ConfidenceLevel;
  };
  genre_profile: {
    primary_genres: string[];
    secondary_genres: string[];
    genre_profile_confidence: ConfidenceLevel;
  };
  emotional_mood_profile: {
    primary: string;
    secondary: string[];
    distribution: Record<string, number>; // e.g. { "<mood>": 0.0 }
    emotional_mood_profile_confidence: ConfidenceLevel;
  };
  cognitive_mood_profile: {
    primary: string;
    secondary: string[];
    distribution: Record<string, number>;
    cognitive_mood_profile_confidence: ConfidenceLevel;
  };
  somatic_mood_profile: {
    primary: string;
    secondary: string[];
    distribution: Record<string, number>;
    somatic_mood_profile_confidence: ConfidenceLevel;
  };
  intent_profile_signals: {
    intents_ranked: IntentProfileSignals[];
  };
}


// Existing types follow...
export interface SessionSemanticProfile {
  taste_profile_type: 'diverse' | 'focused'; 
  dominant_genres: string[];
  energy_bias: string;
  energy_distribution: Record<string, number>; 
  dominant_moods: string[];
  tempo_bias: string;
  vocals_bias: string;
  texture_bias: string;
  artist_examples: string[]; 
  language_distribution: Record<string, number>; 
}

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
  estimatedVibe?: AiVibeEstimate; 
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
  estimated_vibe?: AiVibeEstimate; 
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

export interface GeminiResponseMetrics { 
  promptBuildTimeMs: number;
  geminiApiTimeMs: number;
}

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

// NEW: Unified Taste Analysis (combines SessionSemanticProfile and AnalyzedPlaylistContextItem[])
export interface UnifiedTasteAnalysis {
  overall_mood_category: string;
  overall_mood_confidence: number;
  session_semantic_profile: SessionSemanticProfile;
  playlist_contexts: AnalyzedPlaylistContextItem[]; // NEW
  // REMOVED: analyzed_top_tracks?: RawAnalyzedTopTrack[]; // MODIFIED: For itemized raw top track analysis
  user_taste_profile_v1?: UserTasteProfileV1; // NEW: The aggregated taste profile v1
}

// NEW: Gemini's raw unified response for taste analysis (for two parallel calls)
export interface UnifiedTasteGeminiResponse {
  analyzed_top_50_tracks: RawAnalyzedTopTrack[]; // MODIFIED: Type now reflects new RawAnalyzedTopTrack
  analyzed_playlist_context: AnalyzedPlaylistContextItem[];
}

// NEW: Error interface for UnifiedTasteGeminiResponse (to include serverErrorName)
export interface UnifiedTasteGeminiError {
  error: string;
  serverErrorName?: string;
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
