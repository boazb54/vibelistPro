import {
  GeneratedPlaylistRaw, AnalyzedTopTrack, ContextualSignals, UserTasteProfile, GeneratedTeaserRaw, VibeValidationResponse, UnifiedVibeResponse, GeminiResponseMetrics,
  UnifiedTasteAnalysis,
  // UnifiedTasteGeminiResponse, // Removed, as we now return a partial structure
  TranscriptionResult,
  TranscriptionStatus,
  TranscriptionRequestMeta,
  AggregatedPlaylist,
  // AnalyzedPlaylistContextItem, // Removed, as this is part of Task B
  UnifiedTasteGeminiError,
} from "../types";
import { GEMINI_MODEL } from "../constants";

declare const addLog: (message: string) => void;

const API_REQUEST_TIMEOUT_MS = 60 * 1000;
const BILLING_DOCS_URL = "ai.google.dev/gemini-api/docs/billing";
const ACOUSTIC_DURATION_THRESHOLD_MS = 800;

const TRANSCRIPTION_PROMPT_TEXT = "Transcribe the following audio exactly as spoken. Do not translate it. Return only the transcription text, no preamble.";


function classifyTranscription(rawText: string, promptTextSentToModel: string, acousticMetadata: TranscriptionRequestMeta): TranscriptionResult {
  const trimmedText = rawText.trim();
  const lowerCaseTrimmedText = trimmedText.toLowerCase();

  const acousticFactorA_pass = acousticMetadata.speechDetected && acousticMetadata.durationMs >= ACOUSTIC_DURATION_THRESHOLD_MS;

  if (!acousticFactorA_pass) {
    addLog(`[Client-classify] Acoustic Factor A failed. Speech detected: ${acousticMetadata.speechDetected}, Duration: ${acousticMetadata.durationMs}ms (Threshold: ${ACOUSTIC_DURATION_THRESHOLD_MS}ms). Returning 'no_speech'.`);
    return { status: 'no_speech', reason: "No sufficient speech signal detected in the audio." };
  }

  if (trimmedText === "") {
    addLog("[Client-classify] Text Factor B failed: Empty or whitespace output. Returning 'no_speech'.");
    return { status: 'no_speech', reason: "No discernible speech detected in the audio." };
  }

  const lowerCasePrompt = promptTextSentToModel.toLowerCase().trim();

  if (lowerCaseTrimmedText === lowerCasePrompt ||
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

  const eventTokenRegex = /\[.*?\]/g;
  const hasEventTokens = eventTokenRegex.test(trimmedText);
  const textWithoutEventTokens = trimmedText.replace(eventTokenRegex, '').trim();

  if (trimmedText.length > 0 && textWithoutEventTokens.length === 0 && hasEventTokens) {
      addLog("[Client-classify] Text Factor B failed: Output consists only of event markers. Returning 'no_speech'.");
      return { status: 'no_speech', reason: "No speech detected. Only environmental sounds or non-linguistic events." };
  }

  const allNonWhitespaceLength = trimmedText.replace(/\s/g, '').length;
  const eventTokenStrippedLength = textWithoutEventTokens.replace(/\s/g, '').length;
  const lengthOfEventTokens = allNonWhitespaceLength - eventTokenStrippedLength;

  if (allNonWhitespaceLength > 0 && (lengthOfEventTokens / allNonWhitespaceLength) > 0.5) {
      addLog("[Client-classify] Text Factor B failed: Output dominated by bracketed event tokens. Returning 'no_speech'.");
      return { status: 'no_speech', reason: "No clear speech detected. Input appears to be mostly environmental sounds or non-linguistic events." };
  }

  const repetitiveNonLexicalRegex = /(uh|um|mm|ah|oh)\s*(\1\s*){1,}/i;
  if (repetitiveNonLexicalRegex.test(lowerCaseTrimmedText)) {
      addLog("[Client-classify] Text Factor B failed: Repetitive non-lexical markers detected. Returning 'no_speech'.");
      return { status: 'no_speech', reason: "No clear speech detected. Input contains repetitive non-linguistic sounds." };
  }

  const words = textWithoutEventTokens.split(/\s+/).filter(Boolean);
  if (trimmedText.length < 5 && words.length < 2) {
    const commonFillers = ['uh', 'um', 'mm', 'oh', 'ah', 'er', 'hm'];
    if (words.every(word => commonFillers.includes(word.toLowerCase())) || textWithoutEventTokens.length < 3) {
        addLog("[Client-classify] Text Factor B failed: Very short non-linguistic input detected. Returning 'no_speech'.");
        return { status: 'no_speech', reason: "No discernible speech detected in the audio." };
    }
  }

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

// MODIFIED: analyzeFullTasteProfile now calls the server-side /api/analyze.mjs endpoint
// and expects ONLY AnalyzedTopTrack[] in the response for v2.4.1
export const analyzeFullTasteProfile = async (
  playlists: AggregatedPlaylist[], // Still accepting this, but won't be sent for Task A only
  topTracks: string[]
): Promise<{ analyzed_50_top_tracks: AnalyzedTopTrack[] } | UnifiedTasteGeminiError> => { // UPDATED RETURN TYPE
  if (!topTracks || topTracks.length === 0) { // Only checking topTracks as playlists are ignored for this API call
    addLog("Skipping full taste profile analysis: No top tracks provided.");
    return { error: "No top tracks to analyze" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
  addLog(`Calling /api/analyze.mjs for Task A taste analysis...`);

  try {
    const response = await fetch('/api/analyze.mjs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'unified_taste', topTracks }), // Only send topTracks to the server proxy
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

    const data: { analyzed_50_top_tracks: AnalyzedTopTrack[] } = await response.json(); // UPDATED EXPECTED DATA STRUCTURE
    addLog("[Client-side] Task A Taste Analysis response received from server proxy.");
    return data;

  } catch (error: any) {
    clearTimeout(timeoutId);
    console.error("Task A Taste Analysis failed through proxy:", error);
    addLog(`Task A Taste Analysis failed through proxy: ${error.message}`);
    return { error: error.message || 'Internal Server Error', serverErrorName: error.name || 'UnknownServerError' };
  }
};
