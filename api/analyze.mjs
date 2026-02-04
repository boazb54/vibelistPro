

import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";

const GEMINI_MODEL = 'gemini-2.5-flash';

export default async function handler(req, res) {
  const t_handler_start = Date.now();
  console.log(`[API/ANALYZE] Handler started at ${new Date().toISOString()}. Region: ${process.env.VERCEL_REGION || 'unknown'}`);

  if (req.method !== 'POST') {
    console.warn(`[API/ANALYZE] Method not allowed: ${req.method}`);
    const t_handler_end_method_not_allowed = Date.now();
    console.log(`[API/ANALYZE] Handler finished (method not allowed) in ${t_handler_end_method_not_allowed - t_handler_start}ms.`);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Removed redundant debug log for incoming request body
  // console.log(`[API/ANALYZE] Incoming request body size (chars): ${JSON.stringify(req.body).length}`);

  const API_KEY = process.env.API_KEY;
  if (!API_KEY) {
    console.error("[API/ANALYZE] API_KEY environment variable is not set or is empty.");
    const t_handler_end_api_key_missing = Date.now();
    console.log(`[API/ANALYZE] Handler finished (API key missing) in ${t_handler_end_api_key_missing - t_handler_start}ms.`);
    return res.status(401).json({ error: 'API_KEY environment variable is missing from serverless function. Please ensure it is correctly configured in your deployment environment (e.g., Vercel environment variables or AI Studio settings).' });
  }

  const { type, topTracks, playlists } = req.body;

  console.log(`[API/ANALYZE] Incoming request type: "${type}"`);
  console.log(`[API/ANALYZE] Using GEMINI_MODEL: ${GEMINI_MODEL}`);

  let promptBuildTimeMsA = 0;
  let promptBuildTimeMsB = 0;
  let geminiApiDurationA = 0;
  let geminiApiDurationB = 0;

  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    console.log("[API/ANALYZE] DEBUG: GoogleGenAI client initialized.");

    if (type === 'unified_taste') {
      console.log(`[API/ANALYZE] Performing unified taste analysis for ${playlists?.length || 0} playlists and ${topTracks?.length || 0} top tracks.`);

      // --- SYSTEM INSTRUCTION TASK A ---
      // MODIFIED: Instruct Gemini to provide raw string outputs without strict enum enforcement.
      const systemInstruction_taskA = `You are a Music Attribute RAW Signal Extractor for VibeList Pro. Your primary function is to quickly analyze song and artist names to extract musical attributes. Your goal is SPEED and RAW EXTRACTION, not strict validation or interpretation.

──────────────────────────────
## CRITICAL POSITION RULES NO 1 ##
───────────────────────────────
- TOP 50 TRACKS always outweigh playlist-derived insights.
- No other source may override Top 50 conclusions.
- Other sources may only refine, never contradict.

─────────────────────────────
## CRITICAL POSITION RULES NO 2 ##:
───────────────────────────────
TOP 50 TRACKS represent the user’s strongest and most reliable taste signal.
They reflect:
- Actual listening behavior
- Repetition over time
- Real preference expressed through action, not intention

─────────────────────────────
## USAGE RULE ##:
───────────────────────
- Use Top 50 tracks to understand *how the user listens*.
- Do NOT treat them as a search query or a recommendation list.

─────────────────────────────
## YOUR TASK — Analyzed Top 50 Tracks (RAW, FAST, NON-STRICT) ##:
───────────────────────────────
For each individual song from the "top 50 tracks" list, rapidly generate detailed musical attributes along with a specific confidence score for *each individual attribute*.

**KEY RULES (REPEAT TO DEVS):**
- **Strings Only:** For attributes like \`energy_level\`, \`tempo_feel\`, \`vocals_type\`, \`texture_type\`, \`danceability_hint\`, \`primary_genre\`, \`secondary_genres\`, \`emotional_tags\`, \`cognitive_tags\`, \`somatic_tags\`, and \`language_iso_639_1\`, return them as **RAW STRING VALUES**. Do NOT enforce strict enum values.
- **No Aggregation:** Do NOT combine or summarize attributes across tracks.
- **No Normalization:** Return attribute values as inferred, without attempting to standardize them (e.g., "medium low energy" is acceptable for \`energy_level\` if you infer it).
- **No Intent Logic:** Do NOT perform any interpretation or derive user intents.
- **One Pass Per Track:** Focus on extracting attributes for each track independently in a single, fast pass.

You must provide per-attribute confidence for:
- All audio physics parameters.
- All genre parameters.
- All mood analysis parameters.
- Language.

These inferences form the PRIMARY reference for:
1) Audio physics baselines (energy, tempo, vocals, texture, danceability).
2) Structured mood distribution across emotional, cognitive, and somatic axes.
3) Language distribution.
4) Genre and texture bias.

---------------------------
// CORE PRINCIPLES (NON-NEGOTIABLE)
// ---------------------------
// A) Evidence-first, anti-bias:
// - Do NOT infer mood/genre purely from track title, playlist name, or trending/popularity.
// - Do NOT default to “safe” mainstream labels or artists. If uncertain, lower confidence.
// - Prefer stable musical knowledge (arrangement, tempo feel, instrumentation, production style, cultural consensus) over guessy storytelling.

// B) Multilingual + multicultural by default:
// - Tracks may be in any language. Do NOT privilege English.
// - Detect language from known lyrics/language of performance when possible;
// - When inferring language or musical attributes:
//    - Do not assume English dominance due to higher familiarity or data availability.
//    - Some non-English tracks may have less public metadata or coverage.
//    - In such cases:
//    - Prefer artist origin, known discography.

──────────────────────────────
## Attribute Extraction Guidelines ##
───────────────────────────────
1.  **Audio Physics (Objective-ish, arrangement/production driven):**
    *   Infer \`energy_level\`, \`tempo_feel\`, \`vocals_type\`, \`texture_type\`, \`danceability_hint\`.
    *   Return these as **raw strings**.
    *   Each must have its own confidence: \`energy_confidence\`, \`tempo_confidence\`, \`vocals_confidence\`, \`texture_confidence\`, \`danceability_confidence\`.

2.  **Genres (Best-guess taxonomy, avoid overly broad defaults):**
    *   Infer \`primary_genre\` (specific, lowercase) and \`secondary_genres\` (up to 3 strings, lowercase).
    *   Return these as **raw strings**.
    *   Each must have its own confidence: \`primary_genre_confidence\`, \`secondary_genres_confidence\`.
    *   **Rule:** If unsure, choose fewer genres and lower confidence. Avoid broad/Western defaults.

3.  **Language (ISO-639-1):**
    *   Infer a single \`language_iso_639_1\` for the track.
    *   Return as a **raw string**.
    *   Must have its own confidence: \`language_confidence\`.
    *   **Rule:** Do NOT privilege English. Detect language from known lyrics/performance. If public metadata is scarce, prefer artist origin/discography.

4.  **Mood Profile (3 axes: Emotional, Cognitive, Somatic):**
    *   Replaces a simple mood array with a structured \`semantic_tags\` object containing three distinct tag lists: \`emotional_tags\`, \`cognitive_tags\`, \`somatic_tags\`.
    *   Return these as **raw string arrays**.
    *   Each must have its own confidence: \`emotional_confidence\`, \`cognitive_confidence\`, \`somatic_confidence\`.
    *   **Definitions:**
        *   **EMOTIONAL MOODS:** What the listener FEELS emotionally (e.g., melancholic, joyful, dark, romantic, angry, calm).
        *   **COGNITIVE MOODS:** What mental or reflective state the music induces (e.g., reflective, introspective, focused, meditative, thoughtful).
        *   **SOMATIC MOODS:** How the music affects the body or physical state (e.g., relaxing, energizing, tense, grounding).
    *   **Rules:**
        *   Provide 1-3 short strings per tag list.
        *   Tags are open-vocabulary but must align with common industry-standard categories.
        *   Avoid poetic/metaphorical labels. Keep tags simple, culturally stable, reusable.
        *   A track may express multiple mood types simultaneously.
        *   Do NOT invent new labels that cannot be expressed with confidence.

──────────────────────────────
## Confidence Rules (Per Attribute, Unique Keys) ##
───────────────────────────────
RULE (NON-NEGOTIABLE): YOU MUST PROVIDE A UNIQUE CONFIDENCE FOR EVERY ATTRIBUTE YOU RETURN.
ALWAYS CONSIDER How strongly the track matches the tags you assigned.
It is NOT about whether the song is “good” or “popular”.
It is NOT about the user’s preference.
It is about certainty in your classification.
Use: low | medium | high
- **high:** widely recognized characteristics; strong consensus; clear arrangement cues.
- **medium:** reasonable inference; some ambiguity (remix/version uncertainty, mixed sections).
- **low:** weak evidence, uncommon track, or you’re guessing.

──────────────────────────────
## OUTPUT FORMAT RULES ##
───────────────────────────────
Return ONLY raw JSON matching this schema exactly. Do NOT add extra keys or explanations.
Use lowercase for genres and tags. If unknown, use minimal empty lists or default "und" with low confidence.

{
  "analyzed_top_50_tracks": [
    {
      "origin": "TOP_50_TRACKS_LIST",
      "song_name": "<string>",
      "artist_name": "<string>",

      "audio_physics": {
        "energy_level": "<string>",
        "energy_confidence": "low|medium|high",

        "tempo_feel": "<string>",
        "tempo_confidence": "low|medium|high",

        "vocals_type": "<string>",
        "vocals_confidence": "low|medium|high",

        "texture_type": "<string>",
        "texture_confidence": "low|medium|high",

        "danceability_hint": "<string>",
        "danceability_confidence": "low|medium|high"
      },

      "semantic_tags": {
        "primary_genre": "<string>",
        "primary_genre_confidence": "low|medium|high",

        "secondary_genres": ["<string>"],
        "secondary_genres_confidence": "low|medium|high",

        "emotional_tags": ["<string>"],
        "emotional_confidence": "low|medium|high",

        "cognitive_tags": ["<string>"],
        "cognitive_confidence": "low|medium|high",

        "somatic_tags": ["<string>"],
        "somatic_confidence": "low|medium|high",

        "language_iso_639_1": "<string>",
        "language_confidence": "low|medium|high"
      }
    }
  ]
}
`;
      // --- SYSTEM INSTRUCTION TASK B ---
      const systemInstruction_taskB = `You are an AI system analyzing user-created playlists to extract contextual signals.
Your role is to understand what each playlist represents from the user’s point of view.
Your job is to infer:
1. The primary function of the playlist
2. The dominant emotional direction
3. The language distribution
4. How confident you are in these inferences
───────────────────────────────
OUTPUT RULES (STRICT)
- Return ONLY raw JSON matching the response schema.
- Do NOT add fields that are not defined.
- Do NOT include explanations or commentary outside the JSON.
- Do NOT guess when signals are weak.
────────────────────────────────
FIELD DEFINITIONS & RULES
1) playlist_primary_function
Choose the main use-case of the playlist.
Allowed values:
- focus, workout, relax, sleep, commute, study, party, background, other

Rules:
- Base this on playlist name AND track patterns together.
- Genre-only names (e.g. “Alternative”, “Rock”) do NOT imply function.
- If no clear functional intent exists, prefer:
  - background
  - or other (only if none apply)
Never force a function if signals are unclear.
────────────────────────────────
2) playlist_emotional_direction
Choose the dominant emotional direction of the playlist.
Allowed values:, calming, energizing, uplifting, melancholic, romantic, dark, nostalgic, neutral, other

Rules:
- Describe the overall emotional tone, not individual tracks.
- Use neutral when the playlist is functional or unobtrusive.
- Use other only if no category reasonably fits.

────────────────────────────────
### PLAYLIST NAME BIAS CONTROL (CRITICAL)
The playlist_name is NOT the emotional label. It is only a weak hint.
RULES:
1) Track-derived signals MUST override playlist_name keywords.
2) Do NOT classify "playlist_emotional_direction" from name words like: love, sad, happy, chill, party, focus, workout.
3) If playlist_name suggests an emotion/function but the tracks disagree, choose the track-based emotion/function and LOWER confidence by one level.
4) Only use playlist_name as a tiebreaker when track signals are genuinely ambiguous.
────────────────────────────────
PLAYLIST NAME INTERPRETATION RULE:
If a playlist_name expresses personal attachment (e.g. "Loved once", "My favorites", "All time classics"),
treat it as an indicator of playlist importance, NOT emotional direction.
Do NOT infer romantic, nostalgic, or calming emotions unless supported by track-level signals
────────────────────────────────
3) playlist_language_distribution
Estimate the language balance of the playlist.
Rules:
- Output as an ARRAY of objects.
- Each object MUST have "language" (ISO-639-1 code, e.g., "en", "he", "es") and "percentage" (number, 0.0 to 1.0).
- Percentages in the array should approximately sum to 1.0.
- If one language dominates, use 1.0 for it.
Examples:
[{"language": "en", "percentage": 1.0}]
[{"language": "he", "percentage": 0.8}, {"language": "en", "percentage": 0.2}]
────────────────────────────────
4) confidence
Indicate overall confidence in your classification.
Allowed values:, high, medium, low
Rules:
- high → playlist name and track composition clearly align
- medium → partial signals or mild ambiguity
- low → weak, mixed, or unclear signals

NEVER output high confidence if:
- The playlist name is generic
- Signals conflict
- The inference relies mainly on assumptions
────────────────────────────────
GENERAL GUIDELINES
- Do NOT overfit to popular artists or genres.
- Do NOT assume intent where none is clear.
- Accuracy is more important than coverage.
- Honest uncertainty is preferred over confident misclassification.
When unsure:
- Prefer background over a strong function
- Prefer neutral over forcing emotion
- Prefer medium or low confidence over false certainty
────────────────────────────────
## OUTPUT FORMAT:
Return ONLY raw JSON matching schema:
{
  "analyzed_playlist_context": [
    {
      "origin": "PLAYLISTS",
      "playlist_name": "<string>",
      "playlist_creator": "<string>",
      "playlist_track_count": <number>,
      "playlist_primary_function": "focus | workout | relax | sleep | commute | study | party | background | other",
      "playlist_emotional_direction": "calming | energizing | uplifting | melancholic | romantic | dark | nostalgic | neutral | other",
      "playlist_language_distribution": [{"language": "<iso_639_1>", "percentage": 0.0}],
      "confidence": "low | medium | high"
    }
  ]
}
`;
        const t_prompt_A_start = Date.now();
        const prompt_taskA = JSON.stringify({ TOP_50_TRACKS: topTracks }, null, 2);
        const t_prompt_A_end = Date.now();
        promptBuildTimeMsA = t_prompt_A_end - t_prompt_A_start;

        const t_prompt_B_start = Date.now();
        const prompt_taskB = JSON.stringify({ PLAYLISTS: playlists }, null, 2);
        const t_prompt_B_end = Date.now();
        promptBuildTimeMsB = t_prompt_B_end - t_prompt_B_start;

        // Response schema for TASK A
        // MODIFIED: All musical attribute fields are now Type.STRING for raw output.
        const responseSchema_taskA = {
          type: Type.OBJECT,
          properties: {
            analyzed_top_50_tracks: { // Renamed from analyzed_50_top_tracks
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  origin: { type: Type.STRING },
                  song_name: { type: Type.STRING },
                  artist_name: { type: Type.STRING },
                  // REMOVED: Top-level track confidence
                  audio_physics: {
                    type: Type.OBJECT,
                    properties: {
                      energy_level: { type: Type.STRING }, // Raw string
                      energy_confidence: { type: Type.STRING },
                      tempo_feel: { type: Type.STRING },   // Raw string
                      tempo_confidence: { type: Type.STRING },
                      vocals_type: { type: Type.STRING },  // Raw string
                      vocals_confidence: { type: Type.STRING },
                      texture_type: { type: Type.STRING }, // Raw string
                      texture_confidence: { type: Type.STRING },
                      danceability_hint: { type: Type.STRING }, // Raw string
                      danceability_confidence: { type: Type.STRING },
                    },
                    required: [
                      "energy_level", "energy_confidence",
                      "tempo_feel", "tempo_confidence",
                      "vocals_type", "vocals_confidence",
                      "texture_type", "texture_confidence",
                      "danceability_hint", "danceability_confidence"
                    ],
                  },
                  semantic_tags: {
                    type: Type.OBJECT,
                    properties: {
                      primary_genre: { type: Type.STRING }, // Raw string
                      primary_genre_confidence: { type: Type.STRING },
                      secondary_genres: { type: Type.ARRAY, items: { type: Type.STRING } }, // Raw string array
                      secondary_genres_confidence: { type: Type.STRING },
                      emotional_tags: { type: Type.ARRAY, items: { type: Type.STRING } }, // Raw string array
                      emotional_confidence: { type: Type.STRING },
                      cognitive_tags: { type: Type.ARRAY, items: { type: Type.STRING } }, // Raw string array
                      cognitive_confidence: { type: Type.STRING },
                      somatic_tags: { type: Type.ARRAY, items: { type: Type.STRING } }, // Raw string array
                      somatic_confidence: { type: Type.STRING },
                      language_iso_639_1: { type: Type.STRING }, // Raw string
                      language_confidence: { type: Type.STRING },
                    },
                    required: [
                      "primary_genre", "primary_genre_confidence",
                      "secondary_genres", "secondary_genres_confidence",
                      "emotional_tags", "emotional_confidence",
                      "cognitive_tags", "cognitive_confidence",
                      "somatic_tags", "somatic_confidence",
                      "language_iso_639_1", "language_confidence"
                    ],
                  },
                },
                required: ["origin", "song_name", "artist_name", "audio_physics", "semantic_tags"], // Removed "confidence"
              },
            },
          },
          required: ["analyzed_top_50_tracks"], // Renamed from analyzed_50_top_tracks
        };

        // Response schema for TASK B
        const responseSchema_taskB = {
          type: Type.OBJECT,
          properties: {
            analyzed_playlist_context: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  origin: { type: Type.STRING },
                  playlist_name: { type: Type.STRING },
                  playlist_creator: { type: Type.STRING },
                  playlist_track_count: { type: Type.NUMBER },
                  playlist_primary_function: { type: Type.STRING },
                  playlist_emotional_direction: { type: Type.STRING },
                  playlist_language_distribution: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        language: { type: Type.STRING },
                        percentage: { type: Type.NUMBER },
                      },
                      required: ["language", "percentage"],
                    },
                  },
                  confidence: { type: Type.STRING },
                },
                required: [
                  "origin",
                  "playlist_name",
                  "playlist_creator",
                  "playlist_track_count",
                  "playlist_primary_function",
                  "playlist_emotional_direction",
                  "playlist_language_distribution",
                  "confidence",
                ],
              },
            },
          },
          required: ["analyzed_playlist_context"],
        };


        console.log("[API/ANALYZE] Unified Taste Analysis Prompt A (first 500 chars):", prompt_taskA.substring(0, 500));
        // Removed redundant debug log for prompt contents
        // console.log(`[API/ANALYZE] Gemini prompt A payload size (chars): ${prompt_taskA.length}`);

        console.log("[API/ANALYZE] Unified Taste Analysis Prompt B (first 500 chars):", prompt_taskB.substring(0, 500));
        // Removed redundant debug log for prompt contents
        // console.log(`[API/ANALYZE] Gemini prompt B payload size (chars): ${prompt_taskB.length}`);


        let geminiResponseTextA = "";
        let geminiResponseTextB = "";

        let t_gemini_api_start_A;
        let t_gemini_api_end_A;
        let t_gemini_api_start_B;
        let t_gemini_api_end_B;

        try {
          const taskA_promise = (async () => {
            t_gemini_api_start_A = Date.now();
            const response = await ai.models.generateContent({
              model: GEMINI_MODEL,
              contents: prompt_taskA,
              config: {
                systemInstruction: systemInstruction_taskA,
                responseMimeType: "application/json",
                responseSchema: responseSchema_taskA,
                thinkingConfig: { thinkingBudget: 0 },
                safetySettings: [
                  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                ],
              }
            });
            t_gemini_api_end_A = Date.now();
            geminiApiDurationA = t_gemini_api_end_A - t_gemini_api_start_A;
            return response;
          })();

          const taskB_promise = (async () => {
            t_gemini_api_start_B = Date.now();
            const response = await ai.models.generateContent({
              model: GEMINI_MODEL,
              contents: prompt_taskB,
              config: {
                systemInstruction: systemInstruction_taskB,
                responseMimeType: "application/json",
                responseSchema: responseSchema_taskB,
                thinkingConfig: { thinkingBudget: 0 },
                safetySettings: [
                  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                ],
              }
            });
            t_gemini_api_end_B = Date.now();
            geminiApiDurationB = t_gemini_api_end_B - t_gemini_api_start_B;
            return response;
          })();

          const [responseA, responseB] = await Promise.all([
            taskA_promise,
            taskB_promise
          ]);

          geminiResponseTextA = responseA.text;
          geminiResponseTextB = responseB.text;

        } catch (geminiError) {
          console.error("[API/ANALYZE] Error calling Gemini API for unified taste analysis (parallel):", geminiError);
          console.error(`[API/ANALYZE] Gemini Error Details (unified_taste): Name=${geminiError.name}, Message=${geminiError.message}`);
          if (geminiError.stack) {
            console.error("[API/ANALYZE] Gemini Error Stack (unified_taste):", geminiError.stack);
          }
          const t_handler_end_gemini_error = Date.now();
          const totalDuration = t_handler_end_gemini_error - t_handler_start;
          console.log(`[API/ANALYZE] Handler finished (Gemini API error) in ${totalDuration}ms. Prompt Build A=${promptBuildTimeMsA}ms, Prompt Build B=${promptBuildTimeMsB}ms. Gemini API A=${geminiApiDurationA}ms, Gemini API B=${geminiApiDurationB}ms.`);
          return res.status(500).json({ error: `Gemini API Error (unified_taste): ${geminiError.message || 'Unknown Gemini error'}`, serverErrorName: geminiError.name || 'UnknownGeminiError' });
        }

        console.log("[API/ANALYZE] Raw Gemini Response Text (Unified Taste A - first 500 chars):", geminiResponseTextA ? geminiResponseTextA.substring(0, 500) : "No text received.");
        // Removed redundant debug log for raw Gemini response
        // console.log(`[API/ANALYZE] Raw Gemini response A size (chars): ${geminiResponseTextA?.length || 0}`);

        console.log("[API/ANALYZE] Raw Gemini Response Text (Unified Taste B - first 500 chars):", geminiResponseTextB ? geminiResponseTextB.substring(0, 500) : "No text received.");
        // Removed redundant debug log for raw Gemini response
        // console.log(`[API/ANALYZE] Raw Gemini response B size (chars): ${geminiResponseTextB?.length || 0}`);


        let t_before_json_parse;
        let t_after_json_parse;
        let jsonParseDuration = 0;
        try {
          t_before_json_parse = Date.now();
          const parsedDataA = JSON.parse(geminiResponseTextA.replace(/```json|```/g, '').trim());
          const parsedDataB = JSON.parse(geminiResponseTextB.replace(/```json|```/g, '').trim());

          const unifiedResponse = {
            analyzed_top_50_tracks: parsedDataA.analyzed_top_50_tracks, // Renamed
            analyzed_playlist_context: parsedDataB.analyzed_playlist_context,
          };

          t_after_json_parse = Date.now();
          jsonParseDuration = t_after_json_parse - t_before_json_parse;
          // Removed redundant debug log for parsed Gemini data
          console.log("[API/ANALYZE] Successfully parsed unified taste response.");
          // NEW LOGGING FOR QA PURPOSES
          console.log("[API/ANALYZE] Final Aggregated Unified Taste Response:", JSON.stringify(unifiedResponse, null, 2));

          const t_handler_end = Date.now();
          const totalHandlerDuration = t_handler_end - t_handler_start;

          console.log(`[API/ANALYZE] Handler finished successfully.`);
          console.log(`[API/ANALYZE] Durations: Total=${totalHandlerDuration}ms, Prompt Build A=${promptBuildTimeMsA}ms, Prompt Build B=${promptBuildTimeMsB}ms, Gemini API A=${geminiApiDurationA}ms, Gemini API B=${geminiApiDurationB}ms, JSON Parse=${jsonParseDuration}ms.`);
          return res.status(200).json(unifiedResponse);
        } catch (parseError) {
          console.error("[API/ANALYZE] Error parsing unified taste JSON (parallel):", parseError);
          console.error(`[API/ANALYZE] Parsing Error Details (unified_taste): Name=${parseError.name}, Message=${parseError.message}`);
          console.error("[API/ANALYZE] Malformed response text (unified taste A):", geminiResponseTextA.substring(0, 500) + (geminiResponseTextA.length > 500 ? '...' : ''));
          console.error("[API/ANALYZE] Malformed response text (unified taste B):", geminiResponseTextB.substring(0, 500) + (geminiResponseTextB.length > 500 ? '...' : ''));
          if (parseError.stack) {
            console.error("[API/ANALYZE] Parsing Error Stack (unified_taste):", parseError.stack);
          }

          const t_handler_end_parse_error = Date.now();
          const totalDuration = t_handler_end_parse_error - t_handler_start;
          // Fix: Ensure jsonParseDuration is always a number. If t_after_json_parse is not defined, it means parsing failed before calculation.
          jsonParseDuration = (t_after_json_parse && t_before_json_parse) ? (t_after_json_parse - t_before_json_parse) : 0;
          console.log(`[API/ANALYZE] Handler finished (parsing error) in ${totalDuration}ms. Prompt Build A=${promptBuildTimeMsA}ms, Prompt Build B=${promptBuildTimeMsB}ms, Gemini API A=${geminiApiDurationA}ms, Gemini API B=${geminiApiDurationB}ms, JSON Parse=${jsonParseDuration}ms.`);
          return res.status(500).json({ error: `Failed to parse AI response for unified taste: ${parseError.message}`, serverErrorName: parseError.name || 'UnknownParseError' });
        }
      }

      console.error(`[API/ANALYZE] Invalid analysis type received: "${type}"`);
      const t_handler_end_invalid_type = Date.now();
      console.log(`[API/ANALYZE] Handler finished (invalid type error) in ${t_handler_end_invalid_type - t_handler_start}ms.`);
      return res.status(400).json({ error: 'Invalid analysis type' });
    } catch (error) {
    console.error("[API/ANALYZE] Analyze API Handler - Uncaught Error:", error);
    console.error(`[API/ANALYZE] Uncaught Error Details: Name=${error.name}, Message=${error.message}`);
    if (error.stack) {
      console.error("[API/ANALYZE] Uncaught Error Stack:", error.stack);
    }

    const t_handler_end_uncaught_error = Date.now();
    console.log(`[API/ANALYZE] Handler finished (uncaught error) in ${t_handler_end_uncaught_error - t_handler_start}ms.`);
    return res.status(500).json({ error: error.message || 'Internal Server Error', serverErrorName: error.name || 'UnknownServerError' });
  }
}
