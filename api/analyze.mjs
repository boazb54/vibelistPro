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

  const API_KEY = process.env.API_KEY;
  if (!API_KEY) {
    console.error("[API/ANALYZE] API_KEY environment variable is not set or is empty.");
    const t_handler_end_api_key_missing = Date.now();
    console.log(`[API/ANALYZE] Handler finished (API key missing) in ${t_handler_end_api_key_missing - t_handler_start}ms.`);
    return res.status(401).json({ error: 'API_KEY environment variable is missing from serverless function. Please ensure it is correctly configured in your deployment environment (e.g., Vercel environment variables or AI Studio settings).' });
  }

  const { type, topTracks } = req.body; // Removed 'playlists' from destructuring

  console.log(`[API/ANALYZE] Incoming request type: "${type}"`);
  console.log(`[API/ANALYZE] Using GEMINI_MODEL: ${GEMINI_MODEL}`);

  let promptBuildTimeMs = 0; // Combined prompt build time
  let geminiApiDuration = 0; // Combined Gemini API duration

  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    console.log("[API/ANALYZE] DEBUG: GoogleGenAI client initialized.");

    if (type === 'unified_taste') { // Renamed for Task A only, but keeping original 'unified_taste' to prevent client-side breakage
      console.log(`[API/ANALYZE] Performing taste analysis for ${topTracks?.length || 0} top tracks (Task A only).`);

      // --- SYSTEM INSTRUCTION TASK A ---
      const systemInstruction_taskA = `You are a Music Attribute Inference Engine for VibeList Pro. Your primary function is to analyze song and artist names to infer detailed musical attributes, including audio physics, semantic tags, and structured mood profiles, with granular confidence scores.

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
## YOUR TASK — Analyzed Top 50 Tracks ##:
───────────────────────────────
For each individual song from the "top 50 tracks" list, generate detailed musical attributes along with a specific confidence score for *each individual attribute*.

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
## Attribute Inference Guidelines ##
───────────────────────────────
1.  **Audio Physics (Objective-ish, arrangement/production driven):**
    *   Infer \`energy_level\`, \`tempo_feel\`, \`vocals_type\`, \`texture_type\`, \`danceability_hint\`.
    *   Use expanded enum values:
        *   \`vocals_type\`: instrumental | sparse | lead_vocal | harmonies | choral | background_vocal
        *   \`texture_type\`: organic | acoustic | electric | synthetic | hybrid | ambient
        *   \`danceability_hint\`: low | medium | high
    *   Each must have its own confidence: \`energy_confidence\`, \`tempo_confidence\`, \`vocals_confidence\`, \`texture_confidence\`, \`danceability_confidence\`.

2.  **Genres (Best-guess taxonomy, avoid overly broad defaults):**
    *   Infer \`primary_genre\` (specific, lowercase) and \`secondary_genres\` (up to 3 strings, lowercase).
    *   Each must have its own confidence: \`primary_genre_confidence\`, \`secondary_genres_confidence\`.
    *   **Rule:** If unsure, choose fewer genres and lower confidence. Avoid broad/Western defaults.

3.  **Language (ISO-639-1):**
    *   Infer a single \`language_iso_639_1\` for the track.
    *   Must have its own confidence: \`language_confidence\`.
    *   **Rule:** Do NOT privilege English. Detect language from known lyrics/performance. If public metadata is scarce, prefer artist origin/discography.

4.  **Mood Profile (3 axes: Emotional, Cognitive, Somatic):**
    *   Replaces a simple mood array with a structured \`semantic_tags\` object containing three distinct tag lists: \`emotional_tags\`, \`cognitive_tags\`, \`somatic_tags\`.
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
## Overall Track Confidence ##
───────────────────────────────
In addition to per-attribute confidences, also provide a single \`confidence\` score for the entire track's overall analysis (low | medium | high). This reflects your general certainty about the composite assessment of the track.

──────────────────────────────
## OUTPUT FORMAT RULES ##
───────────────────────────────
Return ONLY raw JSON matching this schema exactly. Do NOT add extra keys or explanations.
Use lowercase for genres and tags. If unknown, use minimal empty lists or default "und" with low confidence.

{
  "analyzed_50_top_tracks": [
    {
      "origin": "TOP_50_TRACKS_LIST",
      "song_name": "<string>",
      "artist_name": "<string>",
      "confidence": "low|medium|high",

      "audio_physics": {
        "energy_level": "low|low_medium|medium|medium_high|high",
        "energy_confidence": "low|medium|high",

        "tempo_feel": "slow|mid|fast",
        "tempo_confidence": "low|medium|high",

        "vocals_type": "instrumental|sparse|lead_vocal|harmonies|choral|background_vocal",
        "vocals_confidence": "low|medium|high",

        "texture_type": "organic|acoustic|electric|synthetic|hybrid|ambient",
        "texture_confidence": "low|medium|high",

        "danceability_hint": "low|medium|high",
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
      // --- REMOVED: SYSTEM INSTRUCTION TASK B ---

        const t_prompt_A_start = Date.now();
        const prompt_taskA = JSON.stringify({ TOP_50_TRACKS: topTracks }, null, 2);
        const t_prompt_A_end = Date.now();
        promptBuildTimeMs = t_prompt_A_end - t_prompt_A_start; // Only Task A contributes to prompt build time

        // --- REMOVED: Prompt build for Task B ---

        // Response schema for TASK A
        const responseSchema_taskA = {
          type: Type.OBJECT,
          properties: {
            analyzed_50_top_tracks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  origin: { type: Type.STRING },
                  song_name: { type: Type.STRING },
                  artist_name: { type: Type.STRING },
                  confidence: { type: Type.STRING }, // Top-level track confidence
                  audio_physics: {
                    type: Type.OBJECT,
                    properties: {
                      energy_level: { type: Type.STRING },
                      energy_confidence: { type: Type.STRING },
                      tempo_feel: { type: Type.STRING },
                      tempo_confidence: { type: Type.STRING },
                      vocals_type: { type: Type.STRING },
                      vocals_confidence: { type: Type.STRING },
                      texture_type: { type: Type.STRING },
                      texture_confidence: { type: Type.STRING },
                      danceability_hint: { type: Type.STRING },
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
                      primary_genre: { type: Type.STRING },
                      primary_genre_confidence: { type: Type.STRING },
                      secondary_genres: { type: Type.ARRAY, items: { type: Type.STRING } },
                      secondary_genres_confidence: { type: Type.STRING },
                      emotional_tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                      emotional_confidence: { type: Type.STRING },
                      cognitive_tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                      cognitive_confidence: { type: Type.STRING },
                      somatic_tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                      somatic_confidence: { type: Type.STRING },
                      language_iso_639_1: { type: Type.STRING },
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
                required: ["origin", "song_name", "artist_name", "confidence", "audio_physics", "semantic_tags"],
              },
            },
          },
          required: ["analyzed_50_top_tracks"],
        };

        // --- REMOVED: Response schema for TASK B ---


        console.log("[API/ANALYZE] Unified Taste Analysis Prompt A (first 500 chars):", prompt_taskA.substring(0, 500));

        let geminiResponseTextA = "";

        let t_gemini_api_start;
        let t_gemini_api_end;

        try {
          // Only Task A promise
          t_gemini_api_start = Date.now();
          const responseA = await ai.models.generateContent({
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
          t_gemini_api_end = Date.now();
          geminiApiDuration = t_gemini_api_end - t_gemini_api_start; // Only Task A duration

          geminiResponseTextA = responseA.text;

        } catch (geminiError) {
          console.error("[API/ANALYZE] Error calling Gemini API for taste analysis (Task A):", geminiError);
          console.error(`[API/ANALYZE] Gemini Error Details (Task A): Name=${geminiError.name}, Message=${geminiError.message}`);
          if (geminiError.stack) {
            console.error("[API/ANALYZE] Gemini Error Stack (Task A):", geminiError.stack);
          }
          const t_handler_end_gemini_error = Date.now();
          const totalDuration = t_handler_end_gemini_error - t_handler_start;
          console.log(`[API/ANALYZE] Handler finished (Gemini API error) in ${totalDuration}ms. Prompt Build=${promptBuildTimeMs}ms. Gemini API=${geminiApiDuration}ms.`);
          return res.status(500).json({ error: `Gemini API Error (Task A): ${geminiError.message || 'Unknown Gemini error'}`, serverErrorName: geminiError.name || 'UnknownGeminiError' });
        }

        console.log("[API/ANALYZE] Raw Gemini Response Text (Task A - first 500 chars):", geminiResponseTextA ? geminiResponseTextA.substring(0, 500) : "No text received.");

        let t_before_json_parse;
        let t_after_json_parse;
        let jsonParseDuration = 0;
        try {
          t_before_json_parse = Date.now();
          const parsedDataA = JSON.parse(geminiResponseTextA.replace(/```json|```/g, '').trim());

          t_after_json_parse = Date.now();
          jsonParseDuration = t_after_json_parse - t_before_json_parse;
          console.log("[API/ANALYZE] Successfully parsed Task A response.");
          console.log("[API/ANALYZE] Final Aggregated Unified Taste Response (Task A Only):", JSON.stringify({analyzed_50_top_tracks: parsedDataA.analyzed_50_top_tracks}, null, 2));

          const t_handler_end = Date.now();
          const totalHandlerDuration = t_handler_end - t_handler_start;

          console.log(`[API/ANALYZE] Handler finished successfully.`);
          console.log(`[API/ANALYZE] Durations: Total=${totalHandlerDuration}ms, Prompt Build=${promptBuildTimeMs}ms, Gemini API=${geminiApiDuration}ms, JSON Parse=${jsonParseDuration}ms.`);
          
          // Return ONLY analyzed_50_top_tracks
          return res.status(200).json({
            analyzed_50_top_tracks: parsedDataA.analyzed_50_top_tracks,
          });
        } catch (parseError) {
          console.error("[API/ANALYZE] Error parsing Task A JSON:", parseError);
          console.error(`[API/ANALYZE] Parsing Error Details (Task A): Name=${parseError.name}, Message=${parseError.message}`);
          console.error("[API/ANALYZE] Malformed response text (Task A):", geminiResponseTextA.substring(0, 500) + (geminiResponseTextA.length > 500 ? '...' : ''));
          if (parseError.stack) {
            console.error("[API/ANALYZE] Parsing Error Stack (Task A):", parseError.stack);
          }

          const t_handler_end_parse_error = Date.now();
          const totalDuration = t_handler_end_parse_error - t_handler_start;
          jsonParseDuration = (t_after_json_parse && t_before_json_parse) ? (t_after_json_parse - t_before_json_parse) : 0;
          console.log(`[API/ANALYZE] Handler finished (parsing error) in ${totalDuration}ms. Prompt Build=${promptBuildTimeMs}ms, Gemini API=${geminiApiDuration}ms, JSON Parse=${jsonParseDuration}ms.`);
          return res.status(500).json({ error: `Failed to parse AI response for Task A: ${parseError.message}`, serverErrorName: parseError.name || 'UnknownParseError' });
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
