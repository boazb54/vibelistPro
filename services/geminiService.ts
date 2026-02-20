import {
  GeneratedPlaylistRaw, AnalyzedTopTrack, ContextualSignals, UserTasteProfile, GeneratedTeaserRaw, VibeValidationResponse, UnifiedVibeResponse, GeminiResponseMetrics,
  UnifiedTasteAnalysis,
  UnifiedTasteGeminiResponse,
  TranscriptionResult,
  TranscriptionStatus,
  TranscriptionRequestMeta,
  AggregatedPlaylist, // NEW: Import AggregatedPlaylist
  AnalyzedPlaylistContextItem, // NEW: Import AnalyzedPlaylistContextItem
  UnifiedTasteGeminiError, // NEW: Import UnifiedTasteGeminiError
} from "../types";
// REMOVED: GoogleGenAI, Type, HarmCategory, HarmBlockThreshold are no longer imported here as Gemini calls are proxied.
// import { GoogleGenAI, Type, GenerateContentResponse, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { GEMINI_MODEL } from "../constants"; // Use the global model constant

declare const addLog: (message: string) => void;

const API_REQUEST_TIMEOUT_MS = 60 * 1000;
const BILLING_DOCS_URL = "ai.google.dev/gemini-api/docs/billing";
const ACOUSTIC_DURATION_THRESHOLD_MS = 800; // Minimum duration for valid speech signal

// NEW: Constant for transcription prompt text, consistent with server.
const TRANSCRIPTION_PROMPT_TEXT = "Transcribe the following audio exactly as spoken. Do not translate it. Return only the transcription text, no preamble.";


/**
 * Classifies raw Gemini transcription output into 'ok', 'no_speech', or 'error'.
 * This function enforces the transcription contract on the client-side for preview environment.
 * It now includes a two-factor gate: acoustic signals (duration, speech detected) and text quality.
 * @param {string} rawText - The raw text received from the Gemini API.
 * @param {string} promptTextSentToModel - The exact prompt text that was sent to the Gemini API for transcription.
 * @param {TranscriptionRequestMeta} acousticMetadata - Acoustic signals from the client.
 * @returns {TranscriptionResult} - Structured transcription result.
 */
function classifyTranscription(rawText: string, promptTextSentToModel: string, acousticMetadata: TranscriptionRequestMeta): TranscriptionResult {
  const trimmedText = rawText.trim();
  const lowerCaseTrimmedText = trimmedText.toLowerCase();

  // v2.2.4 - FACTOR A: ACOUSTIC SIGNAL CHECK
  const acousticFactorA_pass = acousticMetadata.speechDetected && acousticMetadata.durationMs >= ACOUSTIC_DURATION_THRESHOLD_MS;

  if (!acousticFactorA_pass) {
    addLog(`[Client-classify] Acoustic Factor A failed. Speech detected: ${acousticMetadata.speechDetected}, Duration: ${acousticMetadata.durationMs}ms (Threshold: ${ACOUSTIC_DURATION_THRESHOLD_MS}ms). Returning 'no_speech'.`);
    return { status: 'no_speech', reason: "No sufficient speech signal detected in the audio." };
  }

  // If Acoustic Factor A passes, proceed to FACTOR B (Text Quality Checks)
  // Condition 1: Empty or whitespace
  if (trimmedText === "") {
    addLog("[Client-classify] Text Factor B failed: Empty or whitespace output. Returning 'no_speech'.");
    return { status: 'no_speech', reason: "No discernible speech detected in the audio." };
  }

  // Condition 2: Prompt-echoing or explicit 'no speech' phrases from Gemini
  const lowerCasePrompt = promptTextSentToModel.toLowerCase().trim();

  if (lowerCaseTrimmedText === lowerCasePrompt || // Exact echo of the prompt
      lowerCaseTrimmedText.includes("i cannot transcribe") ||
      lowerCaseTrimmedText.includes("no discernible speech") ||
      lowerCaseTrimmedText.includes("there was no speech detected") ||
      lowerCaseTrimmedText.includes("no speech was detected") ||
      lowerCaseTrimmedText.includes("the audio was silent") ||
      lowerCaseTrimmedText.includes("i could not understand the audio") ||
      lowerCaseTrimmedText.includes("no audio input received")
  ) {
    addLog(`[Client-classify] Text Factor B failed: Model output includes instruction-like or 'no speech' patterns. Raw output: "${rawText.substring(0, 100)}...". Returning 'no_speech'.`);
    return { status: 'no_speech', reason: "No clear speech detected in the audio." };
  }

  // NEW Condition 3 (v2.2.3): Non-speech event filtering
  const eventTokenRegex = /\[.*?\]/g;
  const hasEventTokens = eventTokenRegex.test(trimmedText);
  const textWithoutEventTokens = trimmedText.replace(eventTokenRegex, '').trim();

  // Check 3.1: Output consists ONLY of event markers
  if (trimmedText.length > 0 && textWithoutEventTokens.length === 0 && hasEventTokens) {
      addLog("[Client-classify] Text Factor B failed: Output consists only of event markers. Returning 'no_speech'.");
      return { status: 'no_speech', reason: "No speech detected. Only environmental sounds or non-linguistic events." };
  }

  // Check 3.2: Output is dominated by bracketed tokens (more than 50% of non-whitespace characters)
  const allNonWhitespaceLength = trimmedText.replace(/\s/g, '').length;
  const eventTokenStrippedLength = textWithoutEventTokens.replace(/\s/g, '').length;
  const lengthOfEventTokens = allNonWhitespaceLength - eventTokenStrippedLength;

  if (allNonWhitespaceLength > 0 && (lengthOfEventTokens / allNonWhitespaceLength) > 0.5) {
      addLog("[Client-classify] Text Factor B failed: Output dominated by bracketed event tokens. Returning 'no_speech'.");
      return { status: 'no_speech', reason: "No clear speech detected. Input appears to be mostly environmental sounds or non-linguistic events." };
  }

  // Check 3.3: Repetitive non-lexical markers (e.g., "uh uh uh", "mmm mmm")
  const repetitiveNonLexicalRegex = /(uh|um|mm|ah|oh)\s*(\1\s*){1,}/i; // Detects "uh uh uh", "um um um", etc.
  if (repetitiveNonLexicalRegex.test(lowerCaseTrimmedText)) {
      addLog("[Client-classify] Text Factor B failed: Repetitive non-lexical markers detected. Returning 'no_speech'.");
      return { status: 'no_speech', reason: "No clear speech detected. Input contains repetitive non-linguistic sounds." };
  }

  // Check 3.4: Very short, non-linguistic input (e.g., just "uh", "mm", or single sounds)
  // This covers "Output length is below a meaningful speech threshold" and "No linguistic sentence structure" if combined with other checks
  const words = textWithoutEventTokens.split(/\s+/).filter(Boolean);
  if (trimmedText.length < 5 && words.length < 2) {
    const commonFillers = ['uh', 'um', 'mm', 'oh', 'ah', 'er', 'hm'];
    if (words.every(word => commonFillers.includes(word.toLowerCase())) || textWithoutEventTokens.length < 3) {
        addLog("[Client-classify] Text Factor B failed: Very short non-linguistic input detected. Returning 'no_speech'.");
        return { status: 'no_speech', reason: "No discernible speech detected in the audio." };
    }
  }

  // Final Condition: Otherwise, it's valid speech (both Factor A and Factor B passed)
  addLog("[Client-classify] Transcription classified as 'ok'.");
  return { status: 'ok', text: rawText };
}

export const generatePlaylistFromMood = async (
  mood: string,
  contextSignals: ContextualSignals,
  isAuthenticated: boolean,
  tasteProfile?: UserTasteProfile,
  excludeSongs?: string[]
): Promise<UnifiedVibeResponse> => {
  const t_prompt_start = performance.now();

  // --- STAGE 1: Client-side prompt construction for Gemini ---
  // The system instruction for the /api/vibe.mjs endpoint (server-side) will handle
  // the validation and teaser generation internally based on isAuthenticated flag.
  // Here, we just build the raw JSON payload for Gemini to process.

   // REMOVED: `session_semantic_profile`, `overall_mood_category` logic
   // REPLACED: `top_genres` with `genre_profile_distribution`
   // Mapped other `taste_bias` fields to `user_taste_profile_v1`
   const promptText = JSON.stringify({
      user_target: { query: mood, modality: contextSignals.input_modality },
      environmental_context: {
          local_time: contextSignals.local_time,
          day_of_week: contextSignals.day_of_week,
          device_type: contextSignals.device_type,
          browser_language: contextSignals.browser_language,
          country: contextSignals.country || 'Unknown'
      },
      taste_bias: tasteProfile?.unified_analysis?.user_taste_profile_v1 ? { // Use the new V1 profile
          type: tasteProfile.unified_analysis.user_taste_profile_v1.overall_profile_confidence === 'high' ? 'focused' : 'diverse', // Derive from overall confidence
          top_artists: tasteProfile.topArtists.slice(0, 20), // Still use Spotify top artists
          top_genres: tasteProfile.unified_analysis.user_taste_profile_v1.genre_profile.primary_genres, // Use primary_genres from V1 profile
          primary_genre_distribution: tasteProfile.unified_analysis.user_taste_profile_v1.genre_profile.primary_genre_profile_distribution, // NEW
          secondary_genre_distribution: tasteProfile.unified_analysis.user_taste_profile_v1.genre_profile.secondary_genre_profile_distribution, // NEW
          energy_bias: tasteProfile.unified_analysis.user_taste_profile_v1.audio_physics_profile.energy_bias, // From V1 profile
          tempo_bias: tasteProfile.unified_analysis.user_taste_profile_v1.audio_physics_profile.tempo_bias, // From V1 profile
          vocals_bias: tasteProfile.unified_analysis.user_taste_profile_v1.audio_physics_profile.vocals_bias, // From V1 profile
          texture_bias: tasteProfile.unified_analysis.user_taste_profile_v1.audio_physics_profile.texture_bias, // From V1 profile
          language_distribution: tasteProfile.unified_analysis.user_taste_profile_v1.language_profile.language_profile_distribution, // From V1 profile
          vibe_fingerprint: { // Re-map vibe_fingerprint
            energy: tasteProfile.unified_analysis.user_taste_profile_v1.audio_physics_profile.energy_bias,
            favored_genres: tasteProfile.unified_analysis.user_taste_profile_v1.genre_profile.primary_genres,
            primary_mood: tasteProfile.unified_analysis.user_taste_profile_v1.emotional_mood_profile.primary,
          },
          user_playlist_mood: { // Re-map user_playlist_mood if needed, or remove if no direct equivalent
            playlist_mood_category: tasteProfile.unified_analysis.user_taste_profile_v1.emotional_mood_profile.primary, // Using primary emotional mood
            confidence_score: tasteProfile.unified_analysis.user_taste_profile_v1.emotional_mood_profile.emotional_mood_profile_confidence // Using emotional mood confidence
          },
          top_50_tracks_anchors: tasteProfile.topTracks.slice(0, 50)
      } : null,
      exclusions: excludeSongs || []
  }, null, 2);
  const promptBuildTimeMs = Math.round(performance.now() - t_prompt_start);

    // --- PRODUCTION MODE: SECURE PROXY CALL ---
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

// MODIFIED: analyzeFullTasteProfile now calls the server-side /api/analyze.mjs endpoint
// It no longer takes 'playlists' as an argument.
export const analyzeFullTasteProfile = async (
  topTracks: string[] // Removed 'playlists: AggregatedPlaylist[]'
): Promise<UnifiedTasteGeminiResponse | UnifiedTasteGeminiError> => {
  if (!topTracks || topTracks.length === 0) { // Simplified check
    addLog("Skipping full taste profile analysis: No top track data provided.");
    return { error: "No top track data to analyze" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
  addLog(`Calling /api/analyze.mjs for unified taste analysis...`);

  try {
    const response = await fetch('/api/analyze.mjs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'unified_taste', topTracks }), // Removed 'playlists' from body
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

    const data: UnifiedTasteGeminiResponse = await response.json();
    addLog("[Client-side] Unified Taste Analysis response received from server proxy.");
    return data;

  } catch (error: any) {
    clearTimeout(timeoutId);
    console.error("Unified Taste Analysis failed through proxy:", error);
    addLog(`Unified Taste Analysis failed through proxy: ${error.message}`);
    return { error: error.message || 'Internal Server Error', serverErrorName: error.name || 'UnknownServerError' };
  }
};
