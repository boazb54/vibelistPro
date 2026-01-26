

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

  // [DEBUG LOG][api/analyze.mjs] Point 1: Log Incoming Request Body
  console.log("[DEBUG LOG][api/analyze.mjs] Incoming request body:", JSON.stringify(req.body, null, 2));
  console.log(`[API/ANALYZE] Incoming request body size (chars): ${JSON.stringify(req.body).length}`);

  const API_KEY = process.env.API_KEY;
  if (!API_KEY) {
    console.error("[API/ANALYZE] API_KEY environment variable is not set or is empty.");
    const t_handler_end_api_key_missing = Date.now();
    console.log(`[API/ANALYZE] Handler finished (API key missing) in ${t_handler_end_api_key_missing - t_handler_start}ms.`);
    return res.status(401).json({ error: 'API_KEY environment variable is missing from serverless function. Please ensure it is correctly configured in your deployment environment (e.g., Vercel environment variables or AI Studio settings).' });
  }

  const { type, topTracks, playlists } = req.body; // MODIFIED: changed playlistTracks to playlists
  
  console.log(`[API/ANALYZE] Incoming request type: "${type}"`);
  console.log(`[API/ANALYZE] Using GEMINI_MODEL: ${GEMINI_MODEL}`);

  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    console.log("[API/ANALYZE] DEBUG: GoogleGenAI client initialized.");

    // --- NEW: Unified Taste Analysis ---
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
 "analyized_50_top_tracks": [
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
      const systemInstruction_taskB = `You are a Music Attribute Inference Engine.
Your job is to infer musical attributes such as context signals, by analyzing playlist objects.

## TASK B — analyzed_playlist_context
For each playlist, generate playlist-level context signals that describe how the user *uses* music, not what they like in general.

Two fields are provided:
1) playlist_primary_function  
This represents the **main purpose** the user created or uses this playlist for (e.g. focus, workout, relax, sleep, commute).  
Treat this as a **behavioral intent signal**, derived from naming, structure, and audio characteristics of the playlist.  
Use it to understand *what the user is trying to achieve* when they listen.

2) playlist_emotional_direction  
This represents the **overall emotional effect** the playlist creates over time (e.g. calming, energizing, uplifting, melancholic).  
Treat this as an **emotional trajectory**, not a genre or mood label.

In short:
playlist_primary_function = what the user uses music *for*  
playlist_emotional_direction = how the music makes the user *feel over time*

## IMPORTANT USAGE RULES (TASK B):

Derive playlist_primary_function and playlist_emotional_direction using:
- playlist_name (strong hint)
- playlist structure (energy/tempo spread across tracks, repetition, consistency)
- dominant audio characteristics inferred from track titles/artists (best-effort)
If playlist_name is generic/unclear (e.g., "My Playlist", "Playlist #1"):
prioritize the inferred audio/structure signals over the name.

## IMPORTANT USAGE RULES (TASK B)
- These values are contextual signals, not strict commands.
- Do NOT copy playlist_name words into playlist_primary_function unless it truly matches.
- Do NOT output explanations, only the required fields.
- If confidence is uncertain, still choose the best label, but mark confidence as "medium" or "low".

## OUTPUT FORMAT:
Return ONLY raw JSON matching schema:
{
  "analyzed_playlist_context": [
    {
      "origin": "PLAYLISTS",
      "playlist_name": "...",
      "playlist_creator": "...",
      "playlist_track_count": 0,
      "playlist_primary_function": "focus" | "workout" | "relax" | "sleep" | "commute" | "study" | "party" | "background" | "other",
      "playlist_emotional_direction": "calming" | "energizing" | "uplifting" | "melancholic" | "romantic" | "dark" | "nostalgic" | "other",
      "playlist_language_distribution": { "<iso_639_1>": 0.0 },
      "confidence": "low" | "medium" | "high"
    }
  ]
}
`;
        const prompt_taskA = JSON.stringify({ TOP_50_TRACKS: topTracks }, null, 2);
        const prompt_taskB = JSON.stringify({ PLAYLISTS: playlists }, null, 2); // MODIFIED: pass full playlist objects
      
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
        // [DEBUG LOG][api/analyze.mjs] Point 2: Log Gemini `contents` Payload (Unified Taste TASK A)
        console.log("[DEBUG LOG][api/analyze.mjs] Gemini 'contents' for unified taste TASK A:", prompt_taskA);
        console.log(`[API/ANALYZE] Gemini prompt A payload size (chars): ${prompt_taskA.length}`);

        console.log("[API/ANALYZE] Unified Taste Analysis Prompt B (first 500 chars):", prompt_taskB.substring(0, 500));
        // [DEBUG LOG][api/analyze.mjs] Point 2: Log Gemini `contents` Payload (Unified Taste TASK B)
        console.log("[DEBUG LOG][api/analyze.mjs] Gemini 'contents' for unified taste TASK B:", prompt_taskB);
        console.log(`[API/ANALYZE] Gemini prompt B payload size (chars): ${prompt_taskB.length}`);


        let geminiResponseTextA = "";
        let geminiResponseTextB = "";
        let t_gemini_api_start;
        let t_gemini_api_end;

        try {
          t_gemini_api_start = Date.now();
          const [responseA, responseB] = await Promise.all([
            ai.models.generateContent({
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
            }),
            ai.models.generateContent({
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
            })
          ]);
          t_gemini_api_end = Date.now();
          geminiResponseTextA = responseA.text;
          geminiResponseTextB = responseB.text;
        } catch (geminiError) {
          t_gemini_api_end = Date.now(); // Ensure end time is captured even on error
          console.error("[API/ANALYZE] Error calling Gemini API for unified taste analysis (parallel):", geminiError);
          console.error(`[API/ANALYZE] Gemini Error Details (unified_taste): Name=${geminiError.name}, Message=${geminiError.message}`);
          if (geminiError.stack) {
            console.error("[API/ANALYZE] Gemini Error Stack (unified_taste):", geminiError.stack);
          }
          const t_handler_end_gemini_error = Date.now();
          const totalDuration = t_handler_end_gemini_error - t_handler_start;
          const geminiApiDuration = t_gemini_api_end - (t_gemini_api_start || t_handler_start); // Fallback if start wasn't captured
          console.log(`[API/ANALYZE] Handler finished (Gemini API error) in ${totalDuration}ms. Gemini API took ${geminiApiDuration}ms.`);
          return res.status(500).json({ error: `Gemini API Error (unified_taste): ${geminiError.message || 'Unknown Gemini error'}`, serverErrorName: geminiError.name || 'UnknownGeminiError' });
        }

        console.log("[API/ANALYZE] Raw Gemini Response Text (Unified Taste A - first 500 chars):", geminiResponseTextA ? geminiResponseTextA.substring(0, 500) : "No text received.");
        // [DEBUG LOG][api/analyze.mjs] Point 3: Log Raw Gemini Response Text (Unified Taste A)
        console.log("[DEBUG LOG][api/analyze.mjs] Raw Gemini response text (unified taste A):", geminiResponseTextA);
        console.log(`[API/ANALYZE] Raw Gemini response A size (chars): ${geminiResponseTextA?.length || 0}`);
        
        console.log("[API/ANALYZE] Raw Gemini Response Text (Unified Taste B - first 500 chars):", geminiResponseTextB ? geminiResponseTextB.substring(0, 500) : "No text received.");
        // [DEBUG LOG][api/analyze.mjs] Point 3: Log Raw Gemini Response Text (Unified Taste B)
        console.log("[DEBUG LOG][api/analyze.mjs] Raw Gemini response text (unified taste B):", geminiResponseTextB);
        console.log(`[API/ANALYZE] Raw Gemini response B size (chars): ${geminiResponseTextB?.length || 0}`);


        let t_before_json_parse;
        let t_after_json_parse;
        try {
          t_before_json_parse = Date.now();
          const parsedDataA = JSON.parse(geminiResponseTextA.replace(/```json|```/g, '').trim());
          const parsedDataB = JSON.parse(geminiResponseTextB.replace(/```json|```/g, '').trim());

          const unifiedResponse = {
            analyzed_50_top_tracks: parsedDataA.analyzed_50_top_tracks,
            analyzed_playlist_context: parsedDataB.analyzed_playlist_context,
          };

          t_after_json_parse = Date.now();
          // [DEBUG LOG][api/analyze.mjs] Point 4: Log Parsed Gemini Data (Unified Taste)
          console.log("[DEBUG LOG][api/analyze.mjs] Parsed Gemini data (unified taste):", JSON.stringify(unifiedResponse, null, 2));
          console.log("[API/ANALYZE] Successfully parsed unified taste response.");

          const t_handler_end = Date.now();
          const geminiApiDuration = t_gemini_api_end - t_gemini_api_start;
          const jsonParseDuration = t_after_json_parse - t_before_json_parse;
          const totalHandlerDuration = t_handler_end - t_handler_start;

          console.log(`[API/ANALYZE] Handler finished successfully.`);
          console.log(`[API/ANALYZE] Durations: Total=${totalHandlerDuration}ms, Gemini API=${geminiApiDuration}ms, JSON Parse=${jsonParseDuration}ms.`);
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
          const geminiApiDuration = t_gemini_api_end - (t_gemini_api_start || t_handler_start);
          const jsonParseDuration = t_after_json_parse ? (t_after_json_parse - t_before_json_parse) : 'N/A';
          console.log(`[API/ANALYZE] Handler finished (parsing error) in ${totalDuration}ms. Gemini API took ${geminiApiDuration}ms, JSON Parse ${jsonParseDuration}ms.`);
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
