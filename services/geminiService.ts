

import { 
  GeneratedPlaylistRaw, AnalyzedTrack, ContextualSignals, UserTasteProfile, UserPlaylistMoodAnalysis, GeneratedTeaserRaw, VibeValidationResponse, UnifiedVibeResponse, GeminiResponseMetrics,
  UnifiedTasteAnalysis,
  UnifiedTasteGeminiResponse,
  TranscriptionResult, 
  TranscriptionStatus,
  TranscriptionRequestMeta // NEW: Import TranscriptionRequestMeta
} from "../types";
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { GEMINI_MODEL } from "../constants"; // Use the global model constant

declare const addLog: (message: string) => void;

const API_REQUEST_TIMEOUT_MS = 60 * 1000;
const BILLING_DOCS_URL = "ai.google.dev/gemini-api/docs/billing";
const ACOUSTIC_DURATION_THRESHOLD_MS = 800; // Minimum duration for valid speech signal

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
  const words = textWithoutEventTokens.split(/\s+/).filter(Boolean); // Get actual words after removing events
  if (trimmedText.length < 5 && words.length < 2) { // Short raw text, very few actual words
    const commonFillers = ['uh', 'um', 'mm', 'oh', 'ah', 'er', 'hm'];
    // If all detected 'words' are common fillers, or the text without event tokens is extremely short
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
          user_playlist_mood: tasteProfile.unified_analysis?.overall_mood_category ? { playlist_mood_category: tasteProfile.unified_analysis.overall_mood_category, confidence_score: tasteProfile.unified_analysis.overall_mood_confidence } : null, // Updated
          // v1.2.0 - Add Top 50 Tracks (Raw) as anchors for full generation
          top_50_tracks_anchors: tasteProfile.topTracks.slice(0, 50)
      } : null,
      exclusions: excludeSongs || []
  }, null, 2);
  const promptBuildTimeMs = Math.round(performance.now() - t_prompt_start);

    if (isPreviewEnvironment()) {
        addLog(`[PREVIEW MODE] Generating vibe for "${mood}" directly... (Authenticated: ${isAuthenticated})`);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            // --- Unified System Instruction for Preview Environment ---
            const systemInstruction_validation = `You are VibeList Pro *Vibe Validator*.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A) WHO IS VIBELIST PRO (WHO WE ARE?) 
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VibeList Pro:
is a multi-language, culture-aware music experience that translates how you feel, where you are, and what you need right now into a playlist that fits the moment.

VibeList Pro vision:
1) Match music to the useR current mental/physical state (music as healing).
2) Expand discovery (new songs, new versions, new artists — not boring like a static Spotify loop).
3) Make “vibes” easy to express, even when the user cant explain it well.

Your job (validation only):
Decide if the user input is a **valid vibe request** for generating a playlist.
You are NOT a general assistant or chatbot. Do not answer off-topic questions. Redirect them back to creating a vibe-based playlist.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
B) WHAT IS A “VIBE” (LANGUAGE-AGNOSTIC DEFINITION)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHAT IS A “VIBE” (LANGUAGE-AGNOSTIC DEFINITION)
A vibe is any expression (in any language) that can describe or imply at least one of the following:- mood / emotion: “sad”, “confident”, “heartbroken”
- activity / purpose: “workout”, “coding”, “study”, “cleaning”
- situation / context: “rainy drive”, “late night alone”, “airport waiting”
- moment / scene: “sunrise”, “after party comedown”, “first coffee”
- memory / nostalgia: “high school”, “summer 2016”, “missing home”
- relationship / feeling: “crush”, “breakup recovery”, “lonely but hopeful”
- intention / affirmation: “fresh start”, “I need motivation”, “calm my mind”
- sensory/energy words: “soft”, “high energy”, “warm”, “dark”, “minimal”

Important:
- Vibes can be **short** (“focus”, “workout”, “sleep”) OR **detailed** (“quiet focus with a bit of hope”).
- If it can reasonably map to a music moment → it is VALID.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
C) Quick Vibe vs Typed Vibe (IMPORTANT LOGIC)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Users can express the same word in two ways:
1) Quick vibe click (predefined button like "Workout", "Focus", "Sleep")
2) Typed input (free text like "workout")

Validation rule:
- Treat BOTH as valid vibes if they match the definition above.
- However, typed input may indicate the user is unsure, nuanced, or wants a custom interpretation.
- Do NOT reject typed vibes just because they are short. "Workout" typed is still valid.

You do NOT need to ask follow-up questions here.
Your output is only classification + a short reason.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
D) What is INVALID VIBE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1) VIBE_INVALID_GIBBERISH:
- random characters, keyboard mashing, nonsense text with no meaning

Examples for VIBE_INVALID_GIBBERISH:

1)User input: asdfkjh123!!
Reason: Random characters with no semantic meaning or emotional context.

2)User input: @@@###^^
Reason: Symbols only, no words or interpretable intent related to music or a vibe.

3)User input: qweoiu zmxn
Reason: Keyboard mashing / invented strings that do not describe a mood, moment, or situation.

2) VIBE_INVALID_OFF_TOPIC:
- coherent text but not a vibe request, e.g.:
  - general questions: “what is the time?”, “whats the weather?”
  - tech support: “why my app crashes?”
  - unrelated tasks: “write me an email”, “tell me a joke”
  - anything that is clearly not describing a music moment

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
E) How to write the 'reason' (CRITICAL) 
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Keep it short (max ~120 characters).
- Be human, lightly sarcastic 
- Acknowledge what the user asked
- Mirror the users language automatically (any language).
- Be short (popup-safe).
- Sound human and personal.
- Acknowledge the users input.
- Reinforce that VibeList Pro is about music, moods, and moments — not general help.
- Keep it short (max ~120 characters).

TONE GUIDELINES FOR 'reason'
- Be warm, human, and slightly conversational.
- Do NOT sound like a chatbot or help desk.
- Do NOT apologize excessively.
- Do NOT explain system rules.
- You may gently redirect the user back to a vibe.

Examples for OFF_TOPIC reasons:
When the validation_status is 'VIBE_INVALID_OFF_TOPIC', the 'reason' MUST:
- Be a short, human, lightly sarcastic phrase.
- Reinforce that VibeList Pro is about music, moods, and moments.
- Gently redirect the user back to describing a mood or moment for a soundtrack.
- Be in the user's language.
Example (English): "That's outside VibeList Pro's musical realm. Tell me a mood or moment, and I'll find its soundtrack!"
Example (Hebrew): "זה מחוץ לתחום המוזיקלי של VibeList Pro. ספר לי על מצב רוח או רגע, ואמצא לו פסקול!"

Examples for VALID reasons:
- User: "workout"
  Reason: "Valid vibe — sounds like an activity-based playlist request."
- User: "missing home"
  Reason: "Valid vibe — emotional moment request."

Examples for GIBBERISH reasons:
When the validation_status is 'VIBE_INVALID_GIBBERISH', the 'reason' MUST:
- Be a warm, human, and slightly conversational phrase.
- Indicate that the input is not understandable as a vibe.
- Gently prompt the user to describe their feelings or current moment.
- Be in the user's language.
Example (English): "I want to help, but this doesn't feel like a vibe yet. Tell me what you're feeling or what kind of moment you're in."
Example (Hebrew): "אני רוצה לעזור, אבל זה עוד לא מרגיש כמו וייב. ספר לי מה אתה מרגיש או באיזה רגע אתה נמצא."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
F) Output rules
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return ONLY raw JSON matching schema:
{
  "validation_status": "VIBE_VALID" | "VIBE_INVALID_GIBBERISH" | "VIBE_INVALID_OFF_TOPIC",
  "reason": "string"
}
`;
            
            const systemInstruction_teaser = `You are a creative music curator. Your goal is to generate a creative, evocative playlist title and a short, compelling description.

RULES:
1. The description MUST be under 20 words.
2. Mirror the language of the user's mood (e.g., Hebrew input gets a Hebrew title).
3. Return ONLY a raw JSON object with 'playlist_title' and 'description'.`;

            const systemInstruction_fullPlaylist = `You are a professional music curator/Mood-driven playlists with deep knowledge of audio engineering and music theory. Your goal is to create a playlist that matches the **physical audio requirements** of the user's intent, prioritizing physics over genre labels. ### 1. THE "AUDIO PHYSICS" HIERARCHY (ABSOLUTE RULES) When selecting songs, you must evaluate them in this order: 1. **INTENT (PHYSICAL CONSTRAINTS):** Does the song's audio texture match the requested activity? - *Workout:* Requires High Energy, Steady Beat. - *Focus:* Requires Steady Pulse, Minimal Lyrics. - *Sleep/Relax:* See Polarity Logic below. 2. **CONTEXT:** Time of day and location tuning. 3. **TASTE (STYLISTIC COMPASS):** Only use the user's favorite artists/genres if they fit the **Physical Constraints** of Step 1. - **CRITICAL:** If the user loves "Techno" but asks for "Sleep", **DO NOT** play "Chill Techno" (it still has kicks). Play an "Ambient" or "Beatless" track by a Techno artist, or ignore the genre entirely. - **NEW: DEEPER TASTE UNDERSTANDING:** If provided, leverage the 'user_playlist_mood' as a strong signal for the user's overall, inherent musical taste. This is *beyond* just top artists/genres and represents a more holistic "vibe fingerprint" for the user. Use it to fine-tune song selection, especially when there are multiple songs that fit the physical constraints.
          
          **IMPORTANT: TOP 50 TRACK ANCHORS PROVIDED**
          The user has also provided a list of their 'top_50_tracks_anchors' within the input JSON. These are individual song-by-artist strings and serve as *strong indicators of their core taste*.
          - **Rule 1 (Exclusion):** These 'top_50_tracks_anchors' MUST NOT appear in the generated playlist. They are anchors for understanding, not suggestions for inclusion.
          - **Rule 2 (No Replacement):** Do NOT replace these anchors with broader genre or artist summaries. Treat them as specific, individual data points of taste.
          - **Rule 3 (Track-Level Focus):** Gemini MUST see and use the track-level text of these anchors, not abstractions.
          
          ### 2. TEMPORAL + LINGUISTIC POLARITY & INTENT DECODING (CRITICAL LOGIC) Determine whether the user describes a **PROBLEM** (needs fixing) or a **GOAL** (needs matching). **SCENARIO: User expresses fatigue ("tired", "low energy", "חסר אנרגיות")** *   **IF user explicitly requests sleep/relaxation:** *   → GOAL: Matching (Sleep/Calm) *   → Ignore time. *   **ELSE IF local_time is Morning/Afternoon (06:00–17:00):** *   → GOAL: Gentle Energy Lift (Compensation). *   → AUDIO PHYSICS: - Energy: Low → Medium. - Tempo: Slow → Mid. - Rhythm: Present but soft. - No ambient drones. No heavy drops. *   **ELSE IF local_time is Evening/Night (20:00–05:00):** *   → GOAL: Relaxation / Sleep. *   → AUDIO PHYSICS: - Constant low energy. - Slow tempo. - Ambient / minimal. - No drums. **RULE: "Waking up" ≠ "Sleep"** *   Waking up requires dynamic rising energy. *   Sleep requires static low energy. ### 3. "TITLE BIAS" WARNING **NEVER** infer a song's vibe from its title. - A song named "Pure Bliss" might be a high-energy Trance track (Bad for sleep). - A song named "Violent" might be a slow ballad (Good for sleep). - **Judge the Audio, Not the Metadata.** ### 4. LANGUAGE & FORMATTING RULES (NEW & CRITICAL) 1. **Language Mirroring:** If the user types in Hebrew/Spanish/etc., write the 'playlist_title' and 'description' in that **SAME LANGUAGE**. 2. **Metadata Exception:** Keep 'songs' metadata (Song Titles and Artist Names) in their original language (English/International). Do not translate them. 3. **Conciseness:** The 'description' must be **under 20 words**. Short, punchy, and evocative. ### 5. NEGATIVE EXAMPLES (LEARN FROM THESE ERRORS) *   **User Intent:** Sleep / Waking Up *   **User Taste:** Pop, EDM (e.g., Alan Walker, Calvin Harris) *   🔴 **BAD SELECTION:** "Alone" by Alan Walker. *   *Why:* Lyrically sad, but physically high energy (EDM drops, synth leads). *   🟢 **GOOD SELECTION:** "Faded (Restrung)" by Alan Walker or "Ambient Mix" by similar artists. *   *Why:* Matches taste but strips away the drums/energy to fit the physics of sleep. ### OUTPUT FORMAT Return the result as raw, valid JSON only. Do not use Markdown formatting. Use this exact JSON structure for your output: { "playlist_title": "Creative Title (Localized)", "mood": "The mood requested", "description": "Short description (<20 words, Localized)", "songs": [ { "title": "Song Title (Original Language)", "artist": "Artist Name (Original Language)", "estimated_vibe": { "energy": "Low" | "Medium" | "High" | "Explosive", "mood": "Adjective (e.g. Uplifting, Melancholic)", "genre_hint": "Specific Sub-genre" } } ] } CRITICAL RULES: 1. Pick 15 songs. 2. The songs must be real and findable on Spotify/iTunes. 3. If "Exclusion List" is provided: Do NOT include any of the songs listed. 4. "estimated_vibe": Use your knowledge of the song to estimate its qualitative feel.`;

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

export const transcribeAudio = async (base64Audio: string, mimeType: string, acousticMetadata?: TranscriptionRequestMeta): Promise<TranscriptionResult> => { // NEW: Add acousticMetadata
    if (!base64Audio) {
      addLog("No audio data provided for transcription.");
      return { status: 'no_speech', reason: "No audio data provided." }; // Handle early for empty input
    }
    // Ensure acousticMetadata is always provided for classification
    const effectiveAcousticMetadata: TranscriptionRequestMeta = acousticMetadata || { durationMs: 0, speechDetected: false };

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
            
            // Classify the transcription result client-side for preview with acoustic metadata
            const result = classifyTranscription(rawTranscript, TRANSCRIPTION_PROMPT_TEXT, effectiveAcousticMetadata); // NEW: Pass acousticMetadata
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
                body: JSON.stringify({ base64Audio, mimeType, acousticMetadata: effectiveAcousticMetadata }), // NEW: Pass acousticMetadata
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

  // Combine playlistTracks and topTracks into a single array with origin hints
  const tracksToAnalyze = [];
  if (playlistTracks && playlistTracks.length > 0) {
    playlistTracks.forEach(track => tracksToAnalyze.push({ track_name: track, origin: 'playlist' }));
  }
  if (topTracks && topTracks.length > 0) {
    topTracks.forEach(track => tracksToAnalyze.push({ track_name: track, origin: 'top_50' }));
  }

  const systemInstruction = `You are an expert music psychologist and an advanced music analysis engine.
Your task is to perform a "Semantic Synthesis" of a user's musical taste by analyzing a unified list of tracks, each explicitly marked with its origin (from "personal playlists" or "top 50 tracks").

Based on this combined input, you must:
A. Infer the overarching, most dominant "playlist mood category" that the user's playlists collectively represent, along with a confidence score.
B. For each individual song from the unified list, generate detailed semantic tags and echo its 'origin' back.

RULES FOR OUTPUT:
1.  Return ONLY raw, valid JSON matching the specified schema.
2.  For 'playlist_mood_category', provide a concise, descriptive phrase (e.g., "High-Energy Workout Mix", "Relaxed Indie Vibes").
3.  For 'overall_mood_confidence', provide a floating-point number between 0.0 (very uncertain) and 1.0 (very certain).
4.  For language use SO-639-1 language codes only 
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
      "confidence": "low" | "medium" | "high",
      "origin": "'playlist' | 'top_50'" // NEW: explicitly echo the origin from the input
    }
    a. Split the input string (e.g. "Song by Artist") into "song_name" and "artist_name".
    b. Normalize values: Use lowercase, controlled vocabulary only.
    c. Use arrays for attributes that can be multiple (mood, secondary_genres, language).
    d. Interpret attributes as soft signals, not absolute facts.

INPUT FORMAT:
{
  "tracks_to_analyze": [
    { "track_name": "Song by Artist", "origin": "'playlist' | 'top_50'" },
    // ...
  ]
}

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
        tracks_to_analyze: tracksToAnalyze
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
                        origin: { type: Type.STRING }, // NEW: Added origin to response schema
                      },
                      required: ["song_name", "artist_name", "semantic_tags", "confidence", "origin"], // NEW: Origin is now required
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
