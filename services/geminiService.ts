


import {
  GeneratedPlaylistRaw, AnalyzedTopTrack, ContextualSignals, UserTasteProfile, GeneratedTeaserRaw, VibeValidationResponse, UnifiedVibeResponse, GeminiResponseMetrics,
  UnifiedTasteAnalysis,
  TranscriptionResult,
  TranscriptionStatus,
  TranscriptionRequestMeta,
  AggregatedPlaylist,
  AnalyzedPlaylistContextItem,
  UnifiedTasteGeminiError,
  UserTasteProfileV1
} from "../types";
import { GEMINI_MODEL } from "../constants";

declare const addLog: (message: string) => void;

const API_REQUEST_TIMEOUT_MS = 60 * 1000;
const BILLING_DOCS_URL = "ai.google.dev/gemini-api/docs/billing";
const ACOUSTIC_DURATION_THRESHOLD_MS = 800; // Minimum duration for valid speech signal

const TRANSCRIPTION_PROMPT_TEXT = "Transcribe the following audio exactly as spoken. Do not translate it. Return only the transcription text, no preamble.";


// Removed classifyTranscription from client-side (now only server-side in api/transcribe.mjs)


export const generatePlaylistFromMood = async (
  mood: string,
  contextSignals: ContextualSignals,
  isAuthenticated: boolean,
  tasteProfile?: UserTasteProfile,
  excludeSongs?: string[]
): Promise<UnifiedVibeResponse> => {
  const t_prompt_start = performance.now();

   const promptText = JSON.stringify({
      user_target: { query: mood, modality: contextSignals.input_modality },
      environmental_context: {
          local_time: contextSignals.local_time,
          day_of_week: contextSignals.day_of_week,
          device_type: contextSignals.device_type,
          browser_language: contextSignals.browser_language,
          country: contextSignals.country || 'Unknown'
      },
      taste_bias: tasteProfile ? {
          type: tasteProfile.unified_analysis?.session_semantic_profile?.taste_profile_type || 'unknown',
          top_artists: tasteProfile.topArtists.slice(0, 20),
          top_genres: tasteProfile.topGenres.slice(0, 10),
          vibe_fingerprint: tasteProfile.unified_analysis?.session_semantic_profile ? { energy: tasteProfile.unified_analysis.session_semantic_profile.energy_bias, favored_genres: tasteProfile.unified_analysis.session_semantic_profile.dominant_genres } : null,
          user_playlist_mood: tasteProfile.unified_analysis?.overall_mood_category ? { playlist_mood_category: tasteProfile.unified_analysis.overall_mood_category, confidence_score: tasteProfile.unified_analysis.overall_mood_confidence } : null,
          top_50_tracks_anchors: tasteProfile.topTracks.slice(0, 50)
      } : null,
      unified_taste_profile: tasteProfile?.unified_analysis?.user_taste_profile_v1 || null, 
      exclusions: excludeSongs || []
  }, null, 2);
  const promptBuildTimeMs = Math.round(performance.now() - t_prompt_start);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
    addLog(`Calling /api/vibe.mjs with mood "${mood}" (Authenticated: ${isAuthenticated})...`);
    try {
        const response = await fetch('/api/vibe.mjs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mood, contextSignals, isAuthenticated, tasteProfile, excludeSongs, promptText }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
            const errorBody = await response.text();
            let errorData: any = {};
            try {
                errorData = JSON.parse(errorBody);
            } catch (e) {
                addLog(`Server response was not JSON for status ${response.status}, falling back to raw text. Raw body: "${errorBody.substring(0, 200)}..."`);
                errorData.error = `Non-JSON response from server: ${errorBody.substring(0, 500)}`;
            }
            throw new Error(`Server error (${response.status}): ${errorData.error || response.statusText || 'Unknown server response'}`);
        }
        const rawData: UnifiedVibeResponse = await response.json();
        return {
            ...rawData,
            promptText: promptText,
            metrics: {
                promptBuildTimeMs: promptBuildTimeMs,
                geminiApiTimeMs: rawData.metrics?.geminiApiTimeMs || 0
            }
        };
    } catch (error) {
        clearTimeout(timeoutId);
        console.error("Vibe generation failed through proxy:", error);
        throw error;
    }
};

export const transcribeAudio = async (base64Audio: string, mimeType: string, acousticMetadata?: TranscriptionRequestMeta): Promise<TranscriptionResult> => {
    if (!base64Audio) {
      addLog("No audio data provided for transcription.");
      return { status: 'no_speech', reason: "No audio data provided." };
    }
    const effectiveAcousticMetadata: TranscriptionRequestMeta = acousticMetadata || { durationMs: 0, speechDetected: false };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
    addLog(`Calling /api/transcribe.mjs...`);
    try {
        const response = await fetch('/api/transcribe.mjs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64Audio, mimeType, acousticMetadata: effectiveAcousticMetadata }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
            const errorBody = await response.text();
            let errorData: any = {};
            try {
                errorData = JSON.parse(errorBody);
            } catch (e) {
                addLog(`Server response was not JSON for status ${response.status}, falling back to raw text. Raw body: "${errorBody.substring(0, 200)}..."`);
                errorData.reason = `Non-JSON response from server: ${errorBody.substring(0, 500)}`;
                errorData.status = 'error';
            }

            if (errorData.status && (errorData.status === 'error' || errorData.status === 'no_speech')) {
              addLog(`Transcription proxy returned classified status '${errorData.status}': ${errorData.reason || errorData.error}`);
              return { status: errorData.status, reason: errorData.reason || errorData.error };
            } else {
              addLog(`Transcription proxy returned generic error (${response.status}): ${errorData.reason || response.statusText}`);
              return { status: 'error', reason: `Server error: ${errorData.reason || response.statusText}` };
            }
        }
        const data: TranscriptionResult = await response.json();
        addLog(`Transcription proxy returned status '${data.status}'. Text: "${data.text?.substring(0, 50)}...". Reason: ${data.reason}`);
        return data;
    } catch (error: any) {
        clearTimeout(timeoutId);
        console.error("Audio transcription failed through proxy:", error);
        addLog(`Audio transcription failed through proxy: ${error.message}`);
        return { status: 'error', reason: `Voice processing failed: ${error.message}` };
    }
};

// MODIFIED: analyzeFullTasteProfile now expects UnifiedTasteAnalysis from the server
export const analyzeFullTasteProfile = async (
  playlists: AggregatedPlaylist[],
  topTracks: string[]
): Promise<UnifiedTasteAnalysis | UnifiedTasteGeminiError> => { // NEW: Return type is UnifiedTasteAnalysis
  if ((!playlists || playlists.length === 0) && (!topTracks || topTracks.length === 0)) {
    addLog("Skipping full taste profile analysis: No tracks or playlist data provided.");
    return { error: "No tracks or playlist data to analyze" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
  addLog(`Calling /api/analyze.mjs for unified taste analysis...`);

  try {
    const response = await fetch('/api/analyze.mjs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'unified_taste', topTracks, playlists }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text();
      let errorData: any = {};
      try {
        errorData = JSON.parse(errorBody);
      } catch (e) {
        addLog(`Server response was not JSON for status ${response.status}, falling back to raw text. Raw body: "${errorBody.substring(0, 200)}..."`);
        errorData.error = `Non-JSON response from server: ${errorBody.substring(0, 500)}`;
      }
      throw new Error(`Server error (${response.status}): ${errorData.error || response.statusText || 'Unknown server response'}`);
    }

    const data: UnifiedTasteAnalysis = await response.json(); // NEW: Expect UnifiedTasteAnalysis directly
    addLog("[Client-side] Unified Taste Analysis response received from server proxy.");
    return data;

  } catch (error: any) {
    clearTimeout(timeoutId);
    console.error("Unified Taste Analysis failed through proxy:", error);
    addLog(`Unified Taste Analysis failed through proxy: ${error.message}`);
    return { error: error.message || 'Internal Server Error', serverErrorName: error.name || 'UnknownServerError' };
  }
};
