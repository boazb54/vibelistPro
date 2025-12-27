
import { GeneratedPlaylistRaw, AnalyzedTrack, ContextualSignals, UserTasteProfile, UserPlaylistMoodAnalysis, UnifiedTasteAnalysis, GeneratedTeaserRaw, VibeValidationResponse, UnifiedVibeResponse, GeminiResponseMetrics } from "../types";
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { GEMINI_MODEL } from "../constants"; // Use the global model constant

declare const addLog: (message: string) => void;

const API_REQUEST_TIMEOUT_MS = 60 * 1000;
const BILLING_DOCS_URL = "ai.google.dev/gemini-api/docs/billing";

// --- START: PREVIEW MODE IMPLEMENTATION (v1.1.1 FIX) ---

/**
 * Detects if the app is running inside the Google AI Studio Preview environment.
 * @returns {boolean} True if in preview mode, otherwise false.
 */
export const isPreviewEnvironment = (): boolean => {
  try {
    return typeof window !== 'undefined' && !!(window as any).aistudio;
  } catch (e) {
    return false; // Fallback for non-browser environments
  }
};

/**
 * Handles API key missing errors by prompting the user to select a key.
 */
async function handleApiKeyMissingError(responseStatus: number, errorData: any) {
  if (responseStatus === 401 && errorData?.error?.includes('API_KEY environment variable is missing')) {
    addLog("API Key Missing (401). Attempting to prompt user for key selection.");
    if (typeof window !== 'undefined' && (window as any).aistudio && (window as any).aistudio.openSelectKey) {
      await (window as any).aistudio.openSelectKey();
      const userError = new Error(`Authentication Error: Gemini API key is missing or invalid. Please retry after selecting a valid API key from a paid GCP project. See billing info at ${BILLING_DOCS_URL}`);
      userError.name = 'ApiKeyRequiredError';
      throw userError;
    } else {
      const userError = new Error(`Authentication Error: Gemini API key is missing or invalid. Please ensure it's configured in your environment variables. See billing info at ${BILLING_DOCS_URL}`);
      userError.name = 'ApiKeyRequiredError';
      throw userError;
    }
  }
}

/**
 * [Release v1.2.2 - Quantum Taste]
 * Unifies Top Track analysis and Playlist Mood inference into a single logical AI pass.
 */
export const analyzeFullTasteProfile = async (topTracks: string[], playlistTracks: string[]): Promise<UnifiedTasteAnalysis | null> => {
    if ((!topTracks || topTracks.length === 0) && (!playlistTracks || playlistTracks.length === 0)) {
        addLog("Skipping taste profile analysis: No track data provided.");
        return null;
    }

    if (isPreviewEnvironment()) {
        addLog(`[PREVIEW MODE] Performing unified taste analysis for ${topTracks.length} top tracks and ${playlistTracks.length} playlist tracks...`);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const systemInstruction = `You are an elite music psychologist and audio metadata expert.
Analyze two datasets provided by the user: 1. Top Tracks (most frequent listens) and 2. Playlist Tracks (personal collection context).

TASK:
1. INFRASTRUCTURE: Provide semantic audio tags for each song in the 'Top Tracks' list.
2. SYNTHESIS: Infer the overarching mood category of the 'Playlist Tracks' collection.

RESPONSE SCHEMA:
{
  "playlist_mood": {
    "playlist_mood_category": "Short descriptive phrase",
    "confidence_score": 0.0-1.0
  },
  "analyzed_tracks": [
    {
      "song_name": "string",
      "artist_name": "string",
      "semantic_tags": {
        "primary_genre": "string",
        "secondary_genres": ["string"],
        "energy": "low"|"medium"|"high"|"explosive",
        "mood": ["string"],
        "tempo": "slow"|"mid"|"fast",
        "vocals": "instrumental"|"lead_vocal"|"choral",
        "texture": "organic"|"electric"|"synthetic"
      },
      "confidence": "low"|"medium"|"high"
    }
  ]
}

RULES:
- Return ONLY valid JSON.
- For semantic tags, judge the AUDIO physics, not the metadata titles.`;

            const prompt = JSON.stringify({
                top_tracks: topTracks,
                playlist_collection: playlistTracks
            });

            const response = await ai.models.generateContent({
                model: GEMINI_MODEL,
                contents: prompt,
                config: {
                    systemInstruction,
                    responseMimeType: "application/json",
                    thinkingConfig: { thinkingBudget: 0 }
                }
            });

            const parsedData = JSON.parse(response.text);
            addLog(`[PREVIEW MODE] Unified Analysis complete. Mood inferred: ${parsedData.playlist_mood.playlist_mood_category}`);
            return parsedData;
        } catch (error) {
            console.error("[PREVIEW MODE] Unified analysis failed:", error);
            throw error;
        }
    } else {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch('/api/analyze.mjs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'unified_taste', topTracks, playlistTracks }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                await handleApiKeyMissingError(response.status, errorData);
                throw new Error(`Server error: ${errorData.error || response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }
};

// Deprecated in favor of analyzeFullTasteProfile
export const analyzeUserPlaylistsForMood = async (playlistTracks: string[]): Promise<UserPlaylistMoodAnalysis | null> => {
    addLog("Warning: analyzeUserPlaylistsForMood is deprecated. Redirecting to unified pass...");
    const result = await analyzeFullTasteProfile([], playlistTracks);
    return result?.playlist_mood || null;
};

// Deprecated in favor of analyzeFullTasteProfile
export const analyzeUserTopTracks = async (tracks: string[]): Promise<AnalyzedTrack[] | { error: string }> => {
    addLog("Warning: analyzeUserTopTracks is deprecated. Redirecting to unified pass...");
    const result = await analyzeFullTasteProfile(tracks, []);
    return result?.analyzed_tracks || { error: "Analysis failed" };
};

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
          type: tasteProfile.session_analysis?.taste_profile_type || 'unknown',
          top_artists: tasteProfile.topArtists.slice(0, 20),
          top_genres: tasteProfile.topGenres.slice(0, 10),
          vibe_fingerprint: tasteProfile.session_analysis ? { energy: tasteProfile.session_analysis.energy_bias, favored_genres: tasteProfile.session_analysis.dominant_genres } : null,
          user_playlist_mood: tasteProfile.playlistMoodAnalysis
      } : null,
      exclusions: excludeSongs || []
  }, null, 2);
  const promptBuildTimeMs = Math.round(performance.now() - t_prompt_start);

    if (isPreviewEnvironment()) {
        addLog(`[PREVIEW MODE] Generating vibe for "${mood}" directly... (Authenticated: ${isAuthenticated})`);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            const systemInstruction_validation = `You are an AI gatekeeper for a music playlist generator. Your task is to validate a user's input based on whether it's a plausible request for a music vibe.

You must classify the input into one of three categories:
1.  'VIBE_VALID': The input describes a mood, activity, memory, or scenario suitable for music.
2.  'VIBE_INVALID_GIBBERISH': The input is nonsensical, random characters.
3.  'VIBE_INVALID_OFF_TOPIC': The input is a coherent question but NOT about a mood or music.

RULES:
1.  Provide a concise 'reason'.
2.  **LANGUAGE MIRRORING (CRITICAL):** The 'reason' MUST be in the same language as the user's input.
3.  Return ONLY raw JSON.`;
            
            const systemInstruction_teaser = `You are a creative music curator. Your goal is to generate a creative, evocative playlist title and a short, compelling description.

RULES:
1. The description MUST be under 20 words.
2. Mirror the language of the user's mood.
3. Return ONLY raw JSON with 'playlist_title' and 'description'.`;

            const systemInstruction_fullPlaylist = `You are a professional music curator with deep knowledge of audio engineering. Your goal is to create a playlist matching the PHYSICAL audio requirements of the user's intent. 

RULES:
1. Judge the AUDIO PHYSICS (Energy, Tempo, Texture), not the metadata labels.
2. Language Mirroring: Playlist title and description must match the user's input language.
3. Return raw JSON only. Pick 15 real songs.`;

            const validation_t_api_start = performance.now();
            const validationResponse = await ai.models.generateContent({
                model: GEMINI_MODEL,
                contents: `Validate the following user input: "${mood}"`,
                config: {
                    systemInstruction: systemInstruction_validation,
                    responseMimeType: "application/json",
                    thinkingConfig: { thinkingBudget: 0 }
                }
            });
            const validationData: VibeValidationResponse = JSON.parse(validationResponse.text);
            const validation_t_api_end = performance.now();

            if (validationData.validation_status !== 'VIBE_VALID') {
              return {
                validation_status: validationData.validation_status,
                reason: validationData.reason,
                promptText: promptText,
                metrics: {
                  promptBuildTimeMs,
                  geminiApiTimeMs: Math.round(validation_t_api_end - validation_t_api_start)
                }
              };
            }

            const t_api_start = performance.now();
            let geminiModelResponse: GenerateContentResponse;
            if (!isAuthenticated) {
                geminiModelResponse = await ai.models.generateContent({
                    model: GEMINI_MODEL,
                    contents: `Generate a playlist title and description for the mood: "${mood}"`,
                    config: {
                        systemInstruction: systemInstruction_teaser,
                        responseMimeType: "application/json",
                        thinkingConfig: { thinkingBudget: 0 }
                    }
                });
            } else {
                geminiModelResponse = await ai.models.generateContent({
                    model: GEMINI_MODEL,
                    contents: promptText,
                    config: { systemInstruction: systemInstruction_fullPlaylist, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } }
                });
            }
            const t_api_end = performance.now();
            
            const rawData = JSON.parse(geminiModelResponse.text);
            return {
                ...rawData,
                validation_status: 'VIBE_VALID',
                reason: 'Vibe is valid',
                promptText: promptText,
                metrics: {
                    promptBuildTimeMs,
                    geminiApiTimeMs: Math.round(t_api_end - t_api_start) + Math.round(validation_t_api_end - validation_t_api_start)
                }
            };
        } catch (error) {
            console.error("[PREVIEW MODE] Unified generation failed:", error);
            throw error;
        }
    } else {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch('/api/vibe.mjs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mood, contextSignals, isAuthenticated, tasteProfile, excludeSongs, promptText }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                await handleApiKeyMissingError(response.status, errorData);
                throw new Error(`Server error: ${errorData.error || response.statusText}`);
            }
            const rawData: UnifiedVibeResponse = await response.json();
            return {
                ...rawData,
                promptText: promptText,
                metrics: {
                    promptBuildTimeMs,
                    geminiApiTimeMs: rawData.metrics?.geminiApiTimeMs || 0
                }
            };
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }
};

export const transcribeAudio = async (base64Audio: string, mimeType: string): Promise<string> => {
    if (!base64Audio) return "";

    if (isPreviewEnvironment()) {
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const promptText = "Transcribe the following audio exactly as spoken.";
            const response = await ai.models.generateContent({
                model: GEMINI_MODEL,
                contents: [
                    { inlineData: { mimeType: mimeType, data: base64Audio } },
                    { text: promptText }
                ]
            });
            return response.text || "";
        } catch (error) {
            console.error("[PREVIEW MODE] Transcription failed:", error);
            throw error;
        }
    } else {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch('/api/transcribe.mjs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ base64Audio, mimeType }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                await handleApiKeyMissingError(response.status, errorData);
                throw new Error(`Server error: ${errorData.error || response.statusText}`);
            }
            const data = await response.json();
            return data.text || "";
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }
};
