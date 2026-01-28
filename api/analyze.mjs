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
  console.log(`[API/ANALYZE] Incoming request body size (chars): ${JSON.stringify(req.body).length}`);

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
      const systemInstruction_taskA = `You are a Music Attribute Inference Engine.
Your job is to infer musical attributes such as semantic tags, by analyzing song name and artist name.

## TASK A — analyzed_50_top_tracks
For each individual song from the "top 50 tracks" list, generate detailed semantic tags, along with a confidence score.

## OUTPUT FORMAT:
Return ONLY raw JSON matching schema:
{ 
 "analyzed_50_top_tracks": [
    {
      "origin": "TOP_50_TRACKS_LIST",
      "song_name": "...",
      "artist_name": "...",
      "semantic_tags": {
        "primary_genre": "...",
        "secondary_genres": ["..."],
        "energy": "low" | "medium" | "high" | "explosive",
        "mood": ["..."],
        "tempo": "slow" | "mid" | "fast",
        "vocals": "instrumental" | "lead_vocal" | "choral",
        "texture": "organic" | "electric" | "synthetic",
        "language": "..."
     },  
     "confidence": "low" | "medium" | "high"
    }
 ]
}
`;
      // --- SYSTEM INSTRUCTION TASK B ---
      const systemInstruction_taskB = `You are an AI system analyzing user-created playlists to extract high-level contextual signals that will later help generate better mood-based playlists.

You are NOT a music recommender in this task.
You are NOT selecting songs.
You are NOT optimizing for popularity.
Your role is to understand what each playlist represents from the user’s point of view.
A playlist is a deliberate user action:
- The user chose a name
- The user grouped tracks intentionally
- The playlist reflects a recurring use, emotional direction, or personal context
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
- focus
- workout
- relax
- sleep
- commute
- study
- party
- background
- other

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

Allowed values:
- calming
- energizing
- uplifting
- melancholic
- romantic
- dark
- nostalgic
- neutral
- other

Rules:
- Describe the overall emotional tone, not individual tracks.
- Use neutral when the playlist is functional or unobtrusive.
- Use other only if no category reasonably fits.

────────────────────────────────
3) playlist_language_distribution

Estimate the language balance of the playlist.

Rules:
- Use ISO-639-1 language codes (e.g. en, he, es).
- Values should approximately sum to 1.0.
- If one language dominates, use 1.0.

Examples:
{"en": 1.0}
{"he": 0.8, "en": 0.2}
────────────────────────────────
4) confidence

Indicate overall confidence in your classification.

Allowed values:
- high
- medium
- low

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

GOAL:
This output will later be used as contextual input for mood-based playlist generation.
Quality is measured by:
- Consistency
- Reduced bias toward “safe” labels
- Correct handling of ambiguity
- Honest confidence scoring

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
      "playlist_language_distribution": {
        "<iso_639_1>": <number>
      },
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
                      language: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                    required: ["primary_genre", "energy", "mood", "tempo", "vocals", "texture", "language"],
                  },
                  confidence: { type: Type.STRING },
                },
                required: ["origin", "song_name", "artist_name", "semantic_tags", "confidence"],
              },
            },
          },
          required: ["analyzed_50_top_tracks"],
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
                    type: Type.OBJECT,
                    properties: { _schema_placeholder: { type: Type.NUMBER } },
                    additionalProperties: { type: Type.NUMBER },
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
        console.log(`[API/ANALYZE] Gemini prompt A payload size (chars): ${prompt_taskA.length}`);

        console.log("[API/ANALYZE] Unified Taste Analysis Prompt B (first 500 chars):", prompt_taskB.substring(0, 500));
        // Removed redundant debug log for prompt contents
        console.log(`[API/ANALYZE] Gemini prompt B payload size (chars): ${prompt_taskB.length}`);


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
        console.log(`[API/ANALYZE] Raw Gemini response A size (chars): ${geminiResponseTextA?.length || 0}`);
        
        console.log("[API/ANALYZE] Raw Gemini Response Text (Unified Taste B - first 500 chars):", geminiResponseTextB ? geminiResponseTextB.substring(0, 500) : "No text received.");
        // Removed redundant debug log for raw Gemini response
        console.log(`[API/ANALYZE] Raw Gemini response B size (chars): ${geminiResponseTextB?.length || 0}`);


        let t_before_json_parse;
        let t_after_json_parse;
        let jsonParseDuration = 0;
        try {
          t_before_json_parse = Date.now();
          const parsedDataA = JSON.parse(geminiResponseTextA.replace(/```json|```/g, '').trim());
          const parsedDataB = JSON.parse(geminiResponseTextB.replace(/```json|```/g, '').trim());

          const unifiedResponse = {
            analyzed_50_top_tracks: parsedDataA.analyzed_50_top_tracks,
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
