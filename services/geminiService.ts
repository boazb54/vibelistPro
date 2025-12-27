import { GeneratedPlaylistRaw, AnalyzedTrack, ContextualSignals, UserTasteProfile, UserPlaylistMoodAnalysis, GeneratedTeaserRaw, VibeValidationResponse, UnifiedVibeResponse, GeminiResponseMetrics } from "../types";
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
    // Correctly detect the environment by checking for the host-injected 'aistudio' API object.
    // The previous hostname check was incorrect due to iframe sandboxing.
    return typeof window !== 'undefined' && !!(window as any).aistudio;
  } catch (e) {
    return false; // Fallback for non-browser environments
  }
};

/**
 * Handles API key missing errors by prompting the user to select a key.
 * This is primarily for the preview environment where direct calls are made.
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

// --- END: PREVIEW MODE IMPLEMENTATION ---

export const analyzeUserPlaylistsForMood = async (playlistTracks: string[]): Promise<UserPlaylistMoodAnalysis | null> => {
    if (!playlistTracks || playlistTracks.length === 0) {
        addLog("Skipping playlist mood analysis: No tracks provided.");
        return null;
    }

    if (isPreviewEnvironment()) {
        addLog(`[PREVIEW MODE] Analyzing ${playlistTracks.length} playlist tracks directly...`);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const systemInstruction = `You are an expert music psychologist and mood categorizer.
      Your task is to analyze a list of song titles and artists, representing a user's collection of personal playlists.
      Based on this combined list, infer the overarching, most dominant "mood category" that these playlists collectively represent.
      Also, provide a confidence score for your categorization.

      RULES:
      1. The 'playlist_mood_category' should be a concise, descriptive phrase (e.g., "High-Energy Workout Mix", "Relaxed Indie Vibes", "Chill Study Focus").
      2. The 'confidence_score' must be a floating-point number between 0.0 (very uncertain) and 1.0 (very certain).
      3. Return only raw, valid JSON matching the specified schema.`;
            
            const prompt = `Analyze the collective mood represented by these songs from a user's playlists:\n${playlistTracks.join('\n')}`;
            
            const response = await ai.models.generateContent({
              model: GEMINI_MODEL,
              contents: prompt,
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
                thinkingConfig: { thinkingBudget: 0 }
              }
            });

            const parsedData = JSON.parse(response.text);
            addLog(`[PREVIEW MODE] Successfully analyzed playlist mood. Category: ${parsedData.playlist_mood_category}`);
            return parsedData;

        } catch (error) {
            console.error("[PREVIEW MODE] Direct Gemini call failed (playlists):", error);
            throw error;
        }
    } else {
        // --- PRODUCTION MODE: SECURE PROXY CALL (Existing Logic) ---
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);

        addLog(`Calling /api/analyze.mjs (playlists) with ${playlistTracks.length} tracks...`);
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
            console.error("Error analyzing user playlist mood via proxy:", error);
            throw error;
        }
    }
};

export const generatePlaylistFromMood = async (
  mood: string, 
  contextSignals: ContextualSignals,
  isAuthenticated: boolean, // NEW: isAuthenticated flag
  tasteProfile?: UserTasteProfile,
  excludeSongs?: string[]
): Promise<UnifiedVibeResponse> => { // NEW: Return UnifiedVibeResponse
  const t_prompt_start = performance.now();

  // --- STAGE 1: Client-side prompt construction for Gemini ---
  // The system instruction for the /api/vibe.mjs endpoint (server-side) will handle
  // the validation and teaser generation internally based on isAuthenticated flag.
  // Here, we just build the raw JSON payload for Gemini to process.
  
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
            
            // --- Unified System Instruction for Preview Environment ---
            const systemInstruction_validation = `You are an AI gatekeeper for a music playlist generator. Your task is to validate a user's input based on whether it's a plausible request for a music vibe.

You must classify the input into one of three categories:
1.  'VIBE_VALID': The input describes a mood, activity, memory, or scenario suitable for music (e.g., "rainy day", "post-breakup", "coding at 2am", "שמח"). This is the most common case.
2.  'VIBE_INVALID_GIBBERISH': The input is nonsensical, random characters, or keyboard mashing (e.g., "asdfasdf", "jhgjhgj").
3.  'VIBE_INVALID_OFF_TOPIC': The input is a coherent question or statement but is NOT about a mood or music (e.g., "what's the weather", "tell me a joke", "מתכון לעוגה").

RULES:
1.  Provide a concise, user-friendly 'reason' for your decision.
2.  **LANGUAGE MIRRORING (CRITICAL):** The 'reason' MUST be in the same language as the user's input.
3.  Return ONLY a raw JSON object matching the schema: { "validation_status": "string", "reason": "string" }.`;
            
            const systemInstruction_teaser = `You are a creative music curator. Your goal is to generate a creative, evocative playlist title and a short, compelling description.

RULES:
1. The description MUST be under 20 words.
2. Mirror the language of the user's mood (e.g., Hebrew input gets a Hebrew title).
3. Return ONLY a raw JSON object with 'playlist_title' and 'description'.`;

            const systemInstruction_fullPlaylist = `You are a professional music curator/Mood-driven playlists with deep knowledge of audio engineering and music theory. Your goal is to create a playlist that matches the **physical audio requirements** of the user's intent, prioritizing physics over genre labels. ### 1. THE "AUDIO PHYSICS" HIERARCHY (ABSOLUTE RULES) When selecting songs, you must evaluate them in this order: 1. **INTENT (PHYSICAL CONSTRAINTS):** Does the song's audio texture match the requested activity? - *Workout:* Requires High Energy, Steady Beat. - *Focus:* Requires Steady Pulse, Minimal Lyrics. - *Sleep/Relax:* See Polarity Logic below. 2. **CONTEXT:** Time of day and location tuning. 3. **TASTE (STYLISTIC COMPASS):** Only use the user's favorite artists/genres if they fit the **Physical Constraints** of Step 1. - **CRITICAL:** If the user loves "Techno" but asks for "Sleep", **DO NOT** play "Chill Techno" (it still has kicks). Play an "Ambient" or "Beatless" track by a Techno artist, or ignore the genre entirely. - **NEW: DEEPER TASTE UNDERSTANDING:** If provided, leverage the 'user_playlist_mood' as a strong signal for the user's overall, inherent musical taste. This is *beyond* just top artists/genres and represents a more holistic "vibe fingerprint" for the user. Use it to fine-tune song selection, especially when there are multiple songs that fit the physical constraints. ### 2. TEMPORAL + LINGUISTIC POLARITY & INTENT DECODING (CRITICAL LOGIC) Determine whether the user describes a **PROBLEM** (needs fixing) or a **GOAL** (needs matching). **SCENARIO: User expresses fatigue ("tired", "low energy", "חסר אנרגיות")** *   **IF user explicitly requests sleep/relaxation:** *   → GOAL: Matching (Sleep/Calm) *   → Ignore time. *   **ELSE IF local_time is Morning/Afternoon (06:00–17:00):** *   → GOAL: Gentle Energy Lift (Compensation). *   → AUDIO PHYSICS: - Energy: Low → Medium. - Tempo: Slow → Mid. - Rhythm: Present but soft. - No ambient drones. No heavy drops. *   **ELSE IF local_time is Evening/Night (20:00–05:00):** *   → GOAL: Relaxation / Sleep. *   → AUDIO PHYSICS: - Constant low energy. - Slow tempo. - Ambient / minimal. - No drums. **RULE: "Waking up" ≠ "Sleep"** *   Waking up requires dynamic rising energy. *   Sleep requires static low energy. ### 3. "TITLE BIAS" WARNING **NEVER** infer a song's vibe from its title. - A song named "Pure Bliss" might be a high-energy Trance track (Bad for sleep). - A song named "Violent" might be a slow ballad (Good for sleep). - **Judge the Audio, Not the Metadata.** ### 4. LANGUAGE & FORMATTING RULES (NEW & CRITICAL) 1. **Language Mirroring:** If the user types in Hebrew/Spanish/etc., write the 'playlist_title' and 'description' in that **SAME LANGUAGE**. 2. **Metadata Exception:** Keep 'songs' metadata (Song Titles and Artist Names) in their original language (English/International). Do not translate them. 3. **Conciseness:** The 'description' must be **under 20 words**. Short, punchy, and evocative. ### 5. NEGATIVE EXAMPLES (LEARN FROM THESE ERRORS) *   **User Intent:** Sleep / Waking Up *   **User Taste:** Pop, EDM (e.g., Alan Walker, Calvin Harris) *   🔴 **BAD SELECTION:** "Alone" by Alan Walker. *   *Why:* Lyrically sad, but physically high energy (EDM drops, synth leads). *   🟢 **GOOD SELECTION:** "Faded (Restrung)" by Alan Walker or "Ambient Mix" by similar artists. *   *Why:* Matches taste but strips away the drums/energy to fit the physics of sleep. ### OUTPUT FORMAT Return the result as raw, valid JSON only. Do not use Markdown formatting. Use this exact JSON structure for your output: { "playlist_title": "Creative Title (Localized)", "mood": "The mood requested", "description": "Short description (<20 words, Localized)", "songs": [ { "title": "Song Title (Original Language)", "artist": "Artist Name (Original Language)", "estimated_vibe": { "energy": "Low" | "Medium" | "High" | "Explosive", "mood": "Adjective (e.g. Uplifting, Melancholic)", "genre_hint": "Specific Sub-genre" } } ] } CRITICAL RULES: 1. Pick 15 songs. 2. The songs must be real and findable on Spotify/iTunes. 3. If "Exclusion List" is provided: Do NOT include any of the songs listed. 4. "estimated_vibe": Use your knowledge of the song to estimate its qualitative feel.`;

            // --- STAGE 1.1: Validation (Preview) ---
            const validation_t_api_start = performance.now();
            const validationResponse = await ai.models.generateContent({
                model: GEMINI_MODEL,
                contents: `Validate the following user input: "${mood}"`,
                config: {
                    systemInstruction: systemInstruction_validation,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: { validation_status: { type: Type.STRING }, reason: { type: Type.STRING } },
                        required: ["validation_status", "reason"]
                    },
                    thinkingConfig: { thinkingBudget: 0 }
                }
            });
            const validationData: VibeValidationResponse = JSON.parse(validationResponse.text);
            const validation_t_api_end = performance.now();

            if (validationData.validation_status !== 'VIBE_VALID') {
              addLog(`[PREVIEW MODE] Vibe validation failed for "${mood}": ${validationData.reason}`);
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

            // --- STAGE 1.2: Teaser or Full Playlist (Preview) ---
            const t_api_start = performance.now();
            let geminiModelResponse: GenerateContentResponse;
            if (!isAuthenticated) {
                // Teaser generation
                addLog(`[PREVIEW MODE] Generating teaser for "${mood}"...`);
                geminiModelResponse = await ai.models.generateContent({
                    model: GEMINI_MODEL,
                    contents: `Generate a playlist title and description for the mood: "${mood}"`,
                    config: {
                        systemInstruction: systemInstruction_teaser,
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: { playlist_title: { type: Type.STRING }, description: { type: Type.STRING } },
                            required: ["playlist_title", "description"]
                        },
                        thinkingConfig: { thinkingBudget: 0 }
                    }
                });
            } else {
                // Full playlist generation
                addLog(`[PREVIEW MODE] Generating full playlist for "${mood}"...`);
                geminiModelResponse = await ai.models.generateContent({
                    model: GEMINI_MODEL,
                    contents: promptText,
                    config: { systemInstruction: systemInstruction_fullPlaylist, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } }
                });
            }
            const t_api_end = performance.now();
            
            const rawData = JSON.parse(geminiModelResponse.text);
            addLog(`[PREVIEW MODE] Generation successful for mood "${mood}".`);
            return {
                ...rawData,
                validation_status: 'VIBE_VALID', // Mark as valid as it passed validation
                reason: 'Vibe is valid',
                promptText: promptText,
                metrics: {
                    promptBuildTimeMs,
                    geminiApiTimeMs: Math.round(t_api_end - t_api_start) + Math.round(validation_t_api_end - validation_t_api_start) // Sum of all Gemini calls
                }
            };
        } catch (error) {
            console.error("[PREVIEW MODE] Direct Gemini call failed (unified):", error);
            throw error;
        }
    } else {
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
                    geminiApiTimeMs: rawData.metrics?.geminiApiTimeMs || 0 // Ensure metrics exists
                }
            };
        } catch (error) {
            clearTimeout(timeoutId);
            console.error("Vibe generation failed through proxy:", error);
            throw error;
        }
    }
};

export const transcribeAudio = async (base64Audio: string, mimeType: string): Promise<string> => {
    if (!base64Audio) return "";

    if (isPreviewEnvironment()) {
        addLog(`[PREVIEW MODE] Transcribing audio directly (type: ${mimeType})...`);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const promptText = "Transcribe the following audio exactly as spoken. Do not translate it. Return only the transcription text, no preamble.";
            const response = await ai.models.generateContent({
                model: GEMINI_MODEL,
                contents: [
                    { inlineData: { mimeType: mimeType, data: base64Audio } },
                    { text: promptText }
                ]
            });
            const transcript = response.text || "";
            addLog(`[PREVIEW MODE] Transcription successful. Text: "${transcript.substring(0, 50)}..."`);
            return transcript;
        } catch (error) {
            console.error("[PREVIEW MODE] Direct Gemini call failed (transcribe):", error);
            throw error;
        }
    } else {
        // --- PRODUCTION MODE: SECURE PROXY CALL (Existing Logic) ---
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
        addLog(`Calling /api/transcribe.mjs...`);
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
            console.error("Audio transcription failed through proxy:", error);
            throw error;
        }
    }
};

export const analyzeUserTopTracks = async (tracks: string[]): Promise<AnalyzedTrack[] | { error: string }> => {
    if (!tracks || tracks.length === 0) return { error: "No tracks to analyze" };

    if (isPreviewEnvironment()) {
        addLog(`[PREVIEW MODE] Analyzing ${tracks.length} top tracks directly...`);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const systemInstruction = `You are a music analysis engine. Analyze the provided list of songs. For each song, return a JSON object using this exact schema: {"song_name": "Song Name", "artist_name": "Artist Name", "semantic_tags": {"primary_genre": "specific genre (lowercase)", "secondary_genres": ["genre1", "genre2"], "energy": "low" | "medium" | "high" | "explosive", "mood": ["mood1", "mood2"], "tempo": "slow" | "mid" | "fast", "vocals": "instrumental" | "lead_vocal" | "choral", "texture": "organic" | "electric" | "synthetic"}, "confidence": "low" | "medium" | "high"} RULES: 1. Split the input string (e.g. "Song by Artist") into "song_name" and "artist_name". 2. Normalize values: Use lowercase, controlled vocabulary only. 3. Use arrays for attributes that can be multiple (mood, secondary_genres). 4. Interpret attributes as soft signals, not absolute facts. Return the result as a raw JSON array.`;
            const prompt = tracks.join('\n');
            const response = await ai.models.generateContent({
                model: GEMINI_MODEL,
                contents: prompt,
                config: { systemInstruction, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } }
            });
            const parsedData = JSON.parse(response.text);
            addLog(`[PREVIEW MODE] Successfully analyzed ${parsedData.length} top tracks.`);
            return parsedData;
        } catch (error) {
            console.error("[PREVIEW MODE] Direct Gemini call failed (tracks):", error);
            throw error;
        }
    } else {
        // --- PRODUCTION MODE: SECURE PROXY CALL (Existing Logic) ---
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
        addLog(`Calling /api/analyze.mjs (tracks) with ${tracks.length} tracks...`);
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
            console.error("Error analyzing user top tracks via proxy:", error);
            throw error;
        }
    }
};
