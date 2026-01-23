

import { 
  GeneratedPlaylistRaw, AnalyzedTrack, ContextualSignals, UserTasteProfile, UserPlaylistMoodAnalysis, GeneratedTeaserRaw, VibeValidationResponse, UnifiedVibeResponse, GeminiResponseMetrics,
  UnifiedTasteAnalysis,
  UnifiedTasteGeminiResponse,
  TranscriptionResult, // NEW: Import TranscriptionResult
  TranscriptionStatus // NEW: Import TranscriptionStatus
} from "../types";
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { GEMINI_MODEL } from "../constants"; // Use the global model constant

declare const addLog: (message: string) => void;

const API_REQUEST_TIMEOUT_MS = 60 * 1000;
const BILLING_DOCS_URL = "ai.google.dev/gemini-api/docs/billing";

// NEW: Constant for transcription prompt text, consistent with server.
const TRANSCRIPTION_PROMPT_TEXT = "Transcribe the following audio exactly as spoken. Do not translate it. Return only the transcription text, no preamble.";

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

/**
 * Classifies raw Gemini transcription output into 'ok', 'no_speech', or 'error'.
 * This function enforces the transcription contract on the client-side for preview environment.
 * @param {string} rawText - The raw text received from the Gemini API.
 * @param {string} promptTextSentToModel - The exact prompt text that was sent to the Gemini API for transcription.
 * @returns {TranscriptionResult} - Structured transcription result.
 */
function classifyTranscription(rawText: string, promptTextSentToModel: string): TranscriptionResult {
  const trimmedText = rawText.trim();
  const lowerCaseTrimmedText = trimmedText.toLowerCase();

  // Condition 1: Empty or whitespace
  if (trimmedText === "") {
    addLog("Transcription classified as 'no_speech': Empty or whitespace output.");
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
    addLog(`Transcription classified as 'no_speech': Model output includes instruction-like or 'no speech' patterns. Raw output: "${rawText.substring(0, 100)}..."`);
    return { status: 'no_speech', reason: "No clear speech detected in the audio." };
  }

  // NEW Condition 3 (v2.2.3): Non-speech event filtering
  const eventTokenRegex = /\[.*?\]/g;
  const hasEventTokens = eventTokenRegex.test(trimmedText);
  const textWithoutEventTokens = trimmedText.replace(eventTokenRegex, '').trim();

  // Check 3.1: Output consists ONLY of event markers
  if (trimmedText.length > 0 && textWithoutEventTokens.length === 0 && hasEventTokens) {
      addLog("Transcription classified as 'no_speech': Output consists only of event markers.");
      return { status: 'no_speech', reason: "No speech detected. Only environmental sounds or non-linguistic events." };
  }

  // Check 3.2: Output is dominated by bracketed tokens (more than 50% of non-whitespace characters)
  const allNonWhitespaceLength = trimmedText.replace(/\s/g, '').length;
  const eventTokenStrippedLength = textWithoutEventTokens.replace(/\s/g, '').length;
  const lengthOfEventTokens = allNonWhitespaceLength - eventTokenStrippedLength;

  if (allNonWhitespaceLength > 0 && (lengthOfEventTokens / allNonWhitespaceLength) > 0.5) {
      addLog("Transcription classified as 'no_speech': Output dominated by bracketed event tokens.");
      return { status: 'no_speech', reason: "No clear speech detected. Input appears to be mostly environmental sounds or non-linguistic events." };
  }

  // Check 3.3: Repetitive non-lexical markers (e.g., "uh uh uh", "mmm mmm")
  const repetitiveNonLexicalRegex = /(uh|um|mm|ah|oh)\s*(\1\s*){1,}/i; // Detects "uh uh uh", "um um um", etc.
  if (repetitiveNonLexicalRegex.test(lowerCaseTrimmedText)) {
      addLog("Transcription classified as 'no_speech': Repetitive non-lexical markers detected.");
      return { status: 'no_speech', reason: "No clear speech detected. Input contains repetitive non-linguistic sounds." };
  }

  // Check 3.4: Very short, non-linguistic input (e.g., just "uh", "mm", or single sounds)
  // This covers "Output length is below a meaningful speech threshold" and "No linguistic sentence structure" if combined with other checks
  const words = textWithoutEventTokens.split(/\s+/).filter(Boolean); // Get actual words after removing events
  if (trimmedText.length < 5 && words.length < 2) { // Short raw text, very few actual words
    const commonFillers = ['uh', 'um', 'mm', 'oh', 'ah', 'er', 'hm'];
    // If all detected 'words' are common fillers, or the text without event tokens is extremely short
    if (words.every(word => commonFillers.includes(word.toLowerCase())) || textWithoutEventTokens.length < 3) {
        addLog("Transcription classified as 'no_speech': Very short non-linguistic input detected.");
        return { status: 'no_speech', reason: "No discernible speech detected in the audio." };
    }
  }

  // Final Condition: Otherwise, it's valid speech
  addLog("Transcription classified as 'ok'.");
  return { status: 'ok', text: rawText };
}

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
          type: tasteProfile.unified_analysis?.session_semantic_profile?.taste_profile_type || 'unknown', // Updated
          top_artists: tasteProfile.topArtists.slice(0, 20),
          top_genres: tasteProfile.topGenres.slice(0, 10),
          vibe_fingerprint: tasteProfile.unified_analysis?.session_semantic_profile ? { energy: tasteProfile.unified_analysis.session_semantic_profile.energy_bias, favored_genres: tasteProfile.unified_analysis.session_semantic_profile.dominant_genres } : null, // Updated
          user_playlist_mood: tasteProfile.unified_analysis?.overall_mood_category ? { playlist_mood_category: tasteProfile.unified_analysis.overall_mood_category, confidence_score: tasteProfile.unified_analysis.overall_mood_confidence } : null // Updated
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
                const errorBody = await response.text(); // Always try to get raw text
                let errorData: any = {};
                try {
                    errorData = JSON.parse(errorBody);
                } catch (e) {
                    addLog(`Server response was not JSON for status ${response.status}, falling back to raw text. Raw body: "${errorBody.substring(0, 200)}..."`);
                    errorData.error = `Non-JSON response from server: ${errorBody.substring(0, 500)}`; // Provide truncated raw body
                }
                await handleApiKeyMissingError(response.status, errorData);
                throw new Error(`Server error (${response.status}): ${errorData.error || response.statusText || 'Unknown server response'}`);
            }
            const rawData: UnifiedVibeResponse = await response.json();
            return {
                ...rawData,
                promptText: promptText,
                // Fix: Include promptBuildTimeMs as required by GeminiResponseMetrics
                metrics: {
                    promptBuildTimeMs: promptBuildTimeMs,
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

export const transcribeAudio = async (base64Audio: string, mimeType: string): Promise<TranscriptionResult> => { // NEW: Return TranscriptionResult
    if (!base64Audio) {
      addLog("No audio data provided for transcription.");
      return { status: 'no_speech', reason: "No audio data provided." }; // Handle early for empty input
    }

    if (isPreviewEnvironment()) {
        addLog(`[PREVIEW MODE] Transcribing audio directly (type: ${mimeType})...`);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            // Use the defined constant prompt text
            const response = await ai.models.generateContent({
                model: GEMINI_MODEL,
                contents: [
                    { inlineData: { mimeType: mimeType, data: base64Audio } },
                    { text: TRANSCRIPTION_PROMPT_TEXT }
                ]
            });
            const rawTranscript = response.text || "";
            addLog(`[PREVIEW MODE] Transcription raw output: "${rawTranscript.substring(0, 50)}..."`);
            
            // Classify the transcription result client-side for preview
            const result = classifyTranscription(rawTranscript, TRANSCRIPTION_PROMPT_TEXT);
            if (result.status === 'ok') {
              addLog(`[PREVIEW MODE] Transcription successful. Text: "${result.text?.substring(0, 50)}..."`);
            } else {
              addLog(`[PREVIEW MODE] Transcription classified as '${result.status}'. Reason: ${result.reason}`);
            }
            return result;

        } catch (error: any) {
            console.error("[PREVIEW MODE] Direct Gemini call failed (transcribe):", error);
            addLog(`[PREVIEW MODE] Transcription failed: ${error.message}`);
            // Map errors to structured error response
            return { status: 'error', reason: `Voice processing failed: ${error.message}` };
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
                const errorBody = await response.text();
                let errorData: any = {};
                try {
                    errorData = JSON.parse(errorBody);
                } catch (e) {
                    addLog(`Server response was not JSON for status ${response.status}, falling back to raw text. Raw body: "${errorBody.substring(0, 200)}..."`);
                    errorData.reason = `Non-JSON response from server: ${errorBody.substring(0, 500)}`;
                    errorData.status = 'error'; // Assume error if not JSON
                }

                await handleApiKeyMissingError(response.status, errorData);
                
                // If the server returns a structured error, use it. Otherwise, create a generic one.
                if (errorData.status && (errorData.status === 'error' || errorData.status === 'no_speech')) {
                  addLog(`Transcription proxy returned classified status '${errorData.status}': ${errorData.reason || errorData.error}`);
                  return { status: errorData.status, reason: errorData.reason || errorData.error };
                } else {
                  addLog(`Transcription proxy returned generic error (${response.status}): ${errorData.reason || response.statusText}`);
                  return { status: 'error', reason: `Server error: ${errorData.reason || response.statusText}` };
                }
            }
            const data: TranscriptionResult = await response.json(); // NEW: Expect TranscriptionResult
            addLog(`Transcription proxy returned status '${data.status}'. Text: "${data.text?.substring(0, 50)}...". Reason: ${data.reason}`);
            return data;
        } catch (error: any) {
            clearTimeout(timeoutId);
            console.error("Audio transcription failed through proxy:", error);
            addLog(`Audio transcription failed through proxy: ${error.message}`);
            // Map network/fetch errors to structured error response
            return { status: 'error', reason: `Voice processing failed: ${error.message}` };
        }
    }
};

// NEW: analyzeFullTasteProfile
export const analyzeFullTasteProfile = async (
  playlistTracks: string[], 
  topTracks: string[]
): Promise<UnifiedTasteGeminiResponse | { error: string }> => {
  if ((!playlistTracks || playlistTracks.length === 0) && (!topTracks || topTracks.length === 0)) {
    addLog("Skipping full taste profile analysis: No tracks or playlist tracks provided.");
    return { error: "No tracks or playlist tracks to analyze" };
  }

  const systemInstruction = `You are an expert music psychologist and an advanced music analysis engine.
Your task is to perform a "Semantic Synthesis" of a user's musical taste by analyzing two distinct sets of data:
1.  A list of song titles and artists from the user's personal playlists.
2.  A list of the user's top 50 individual tracks.

Based on this combined input, you must:
A. Infer the overarching, most dominant "playlist mood category" that the user's playlists collectively represent, along with a confidence score.
B. For each individual song from the "top 50 tracks" list, generate detailed semantic tags.

RULES FOR OUTPUT:
1.  Return ONLY raw, valid JSON matching the specified schema.
2.  For 'playlist_mood_category', provide a concise, descriptive phrase (e.g., "High-Energy Workout Mix", "Relaxed Indie Vibes").
3.  For 'overall_mood_confidence', provide a floating-point number between 0.0 (very uncertain) and 1.0 (very certain).
4.  For language use SO-639-1 language codes only. If the song is instrumental or language is not clearly detectable, you may omit this field or provide an empty array.
5.  For individual song analysis ('analyzed_tracks'), use this exact schema for each item:
    {
      "song_name": "Song Name",
      "artist_name": "Artist Name",
      "semantic_tags": {
        "primary_genre": "specific genre (lowercase)",
        "secondary_genres": ["genre1", "genre2"],
        "energy": "low" | "medium" | "high" | "explosive",
        "mood": ["mood1", "mood2"],
        "tempo": "slow" | "mid" | "fast",
        "vocals": "instrumental" | "lead_vocal" | "choral",
        "texture": "organic" | "electric" | "synthetic" ,
        "language": ["language1" , "language2"] 
      },
      "confidence": "low" | "medium" | "high"
    }
    a. Split the input string (e.g. "Song by Artist") into "song_name" and "artist_name".
    b. Normalize values: Use lowercase, controlled vocabulary only.
    c. Use arrays for attributes that can be multiple (mood, secondary_genres, language).
    d. Interpret attributes as soft signals, not absolute facts.

OUTPUT FORMAT:
{
  "playlist_mood_analysis": {
    "playlist_mood_category": "string",
    "confidence_score": "number"
  },
  "analyzed_tracks": [ // Array of AnalyzedTrack objects
    // ...
  ]
}
`;

  const promptInput = JSON.stringify({
    playlist_tracks: playlistTracks,
    top_tracks: topTracks
  }, null, 2);

  if (isPreviewEnvironment()) {
    addLog(`[PREVIEW MODE] Analyzing full taste profile directly...`);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: promptInput,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              playlist_mood_analysis: {
                type: Type.OBJECT,
                properties: {
                  playlist_mood_category: { type: Type.STRING },
                  confidence_score: { type: Type.NUMBER }
                },
                required: ["playlist_mood_category", "confidence_score"],
              },
              analyzed_tracks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    song_name: { type: Type.STRING },
                    artist_name: { type: Type.STRING },
                    semantic_tags: {
                      type: Type.OBJECT,
                      properties: {
                        primary_genre: { type: Type.STRING },
                        secondary_genres: { type: Type.ARRAY, items: { type: Type.STRING } },
                        energy: { type: Type.STRING },
                        mood: { type: Type.ARRAY, items: { type: Type.STRING } },
                        tempo: { type: Type.STRING },
                        vocals: { type: Type.STRING },
                        texture: { type: Type.STRING },
                        language: { type: Type.ARRAY, items: { type: Type.STRING } }, // NEW: Added language for client-side schema
                      },
                      required: ["primary_genre", "energy", "mood", "tempo", "vocals", "texture"],
                    },
                    confidence: { type: Type.STRING },
                  },
                  required: ["song_name", "artist_name", "semantic_tags", "confidence"],
                },
              },
            },
            required: ["playlist_mood_analysis", "analyzed_tracks"],
          },
          thinkingConfig: { thinkingBudget: 0 }
        }
      });

      const parsedData: UnifiedTasteGeminiResponse = JSON.parse(response.text);
      addLog(`[PREVIEW MODE] Successfully analyzed full taste profile.`);
      return parsedData;

    } catch (error) {
      console.error("[PREVIEW MODE] Direct Gemini call failed (unified taste analysis):", error);
      throw error;
    }
  } else {
    // PRODUCTION MODE: SECURE PROXY CALL
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);

    addLog(`Calling /api/analyze.mjs (unified taste) with ${playlistTracks.length} playlist tracks and ${topTracks.length} top tracks...`);
    try {
      const response = await fetch('/api/analyze.mjs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'unified_taste', playlistTracks, topTracks }),
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
      console.error("Error analyzing unified user taste via proxy:", error);
      throw error;
    }
  }
};
