
import { GeminiResponseWithMetrics, GeneratedPlaylistRaw, AnalyzedTrack, ContextualSignals, UserTasteProfile, UserPlaylistMoodAnalysis, GeneratedTeaserRaw, VibeValidationResponse } from "../types";
import { GoogleGenAI, Type } from "@google/genai";

declare const addLog: (message: string) => void;

const API_REQUEST_TIMEOUT_MS = 60 * 1000;
const BILLING_DOCS_URL = "ai.google.dev/gemini-api/docs/billing";

interface GeneratedTeaserRawWithMetrics extends GeneratedTeaserRaw {
  metrics: {
    geminiApiTimeMs: number;
  }
}

export const isPreviewEnvironment = (): boolean => {
  try {
    return typeof window !== 'undefined' && !!(window as any).aistudio;
  } catch (e) {
    return false; 
  }
};

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
 * [Release v1.4.2] - Native Audio Transcription Service
 * Uses Gemini to transcribe raw audio chunks.
 */
export const transcribeAudio = async (base64Data: string, mimeType: string): Promise<string> => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: {
                parts: [
                    { inlineData: { data: base64Data, mimeType: mimeType } },
                    { text: "Transcribe the audio exactly. Return ONLY the transcription text. If the language is Hebrew, return Hebrew characters. If English, return English. Do not add any conversational filler." }
                ]
            }
        });
        return response.text || "";
    } catch (error: any) {
        console.error("Transcription service failed:", error);
        throw error;
    }
};

export const validateVibe = async (mood: string): Promise<VibeValidationResponse> => {
    const systemInstruction = `You are an AI gatekeeper for a music playlist generator. Your task is to validate a user's input based on whether it's a plausible request for a music vibe.

You must classify the input into one of three categories:
1.  'VIBE_VALID': The input describes a mood, activity, memory, or scenario suitable for music.
2.  'VIBE_INVALID_GIBBERISH': The input is nonsensical or keyboard mashing.
3.  'VIBE_INVALID_OFF_TOPIC': The input is coherent but not about a mood or music.

RULES:
1.  Provide a concise, user-friendly 'reason' for your decision.
2.  **LANGUAGE MIRRORING (CRITICAL):** The 'reason' MUST be in the same language as the user's input.
3.  Return ONLY a raw JSON object matching the schema.`;

    if (isPreviewEnvironment()) {
        addLog(`[PREVIEW MODE] Validating vibe for "${mood}" directly...`);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: `Validate the following user input: "${mood}"`,
                config: {
                    systemInstruction,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            validation_status: { type: Type.STRING },
                            reason: { type: Type.STRING }
                        },
                        required: ["validation_status", "reason"]
                    }
                }
            });
            return JSON.parse(response.text);
        } catch (error) {
            console.error("[PREVIEW MODE] Direct Gemini call failed (validate):", error);
            throw error;
        }
    } else {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch('/api/validate.mjs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mood }),
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

export const generatePlaylistTeaser = async (mood: string): Promise<GeneratedTeaserRawWithMetrics> => {
    if (isPreviewEnvironment()) {
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const systemInstruction = `You are a creative music curator. Generate a title and a short description (<20 words). Mirror input language. JSON only.`;
            const t_api_start = performance.now();
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: `Generate a playlist title and description for the mood: "${mood}"`,
                config: {
                    systemInstruction,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            playlist_title: { type: Type.STRING },
                            description: { type: Type.STRING }
                        },
                        required: ["playlist_title", "description"]
                    }
                }
            });
            const t_api_end = performance.now();
            return {
              ...JSON.parse(response.text),
              metrics: { geminiApiTimeMs: Math.round(t_api_end - t_api_start) }
            };
        } catch (error) {
            throw error;
        }
    } else {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch('/api/teaser.mjs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mood }),
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

export const analyzeUserPlaylistsForMood = async (playlistTracks: string[]): Promise<UserPlaylistMoodAnalysis | null> => {
    if (!playlistTracks || playlistTracks.length === 0) return null;

    if (isPreviewEnvironment()) {
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const systemInstruction = `Analyze song titles to infer an overarching mood category and confidence score. JSON only.`;
            const response = await ai.models.generateContent({
              model: 'gemini-3-flash-preview',
              contents: `Analyze: ${playlistTracks.join('\n')}`,
              config: {
                systemInstruction,
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    playlist_mood_category: { type: Type.STRING },
                    confidence_score: { type: Type.NUMBER }
                  },
                  required: ["playlist_mood_category", "confidence_score"],
                },
              }
            });
            return JSON.parse(response.text);
        } catch (error) {
            throw error;
        }
    } else {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch('/api/analyze.mjs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'playlists', playlistTracks }),
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

export const generatePlaylistFromMood = async (
  mood: string, 
  contextSignals: ContextualSignals,
  tasteProfile?: UserTasteProfile,
  excludeSongs?: string[]
): Promise<GeminiResponseWithMetrics> => {
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
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const systemInstruction = `You are a professional music curator. Create a playlist (15 songs) matching the audio physics of the user's intent. JSON only.`;
            const t_api_start = performance.now();
            const response = await ai.models.generateContent({
              model: 'gemini-3-flash-preview',
              contents: promptText,
              config: { systemInstruction, responseMimeType: "application/json" }
            });
            const t_api_end = performance.now();
            return {
                ...JSON.parse(response.text),
                promptText: promptText,
                metrics: {
                    promptBuildTimeMs,
                    geminiApiTimeMs: Math.round(t_api_end - t_api_start)
                }
            };
        } catch (error) {
            throw error;
        }
    } else {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch('/api/vibe.mjs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mood, contextSignals, tasteProfile, excludeSongs, promptText }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                await handleApiKeyMissingError(response.status, errorData);
                throw new Error(`Server error: ${errorData.error || response.statusText}`);
            }
            const rawData = await response.json();
            return {
                ...rawData,
                promptText: promptText,
                metrics: {
                    promptBuildTimeMs,
                    geminiApiTimeMs: rawData.metrics.geminiApiTimeMs
                }
            };
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }
};

export const analyzeUserTopTracks = async (tracks: string[]): Promise<AnalyzedTrack[] | { error: string }> => {
    if (!tracks || tracks.length === 0) return { error: "No tracks to analyze" };

    if (isPreviewEnvironment()) {
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const systemInstruction = `Analyze song lists into structured semantic tags. JSON only.`;
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: tracks.join('\n'),
                config: { systemInstruction, responseMimeType: "application/json" }
            });
            return JSON.parse(response.text);
        } catch (error) {
            throw error;
        }
    } else {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch('/api/analyze.mjs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'tracks', tracks }),
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
