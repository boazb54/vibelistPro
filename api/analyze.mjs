import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";

const GEMINI_MODEL = 'gemini-2.5-flash';

export default async function handler(req, res) {
  const t_handler_start = Date.now();
  console.log(`[API/ANALYZE] Handler started at ${new Date().toISOString()}. Region: ${process.env.VERCEL_REGION || 'unknown'}`);

  if (req.method !== 'POST') {
    console.warn(`[API/ANALYZE] Method not allowed: ${req.method}`);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const API_KEY = process.env.API_KEY;
  if (!API_KEY) {
    console.error("[API/ANALYZE] API_KEY environment variable is not set or is empty.");
    return res.status(401).json({ error: 'API_KEY environment variable is missing from serverless function. Please ensure it is correctly configured in your deployment environment (e.g., Vercel environment variables or AI Studio settings).' });
  }

  const { type, tracks, playlistTracks } = req.body;
  
  console.log(`[API/ANALYZE] Incoming request type: "${type}"`);
  console.log(`[API/ANALYZE] Using GEMINI_MODEL: ${GEMINI_MODEL}`);

  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    console.log("[API/ANALYZE] DEBUG: GoogleGenAI client initialized.");

    // --- NEW: Unified Taste Analysis ---
    if (type === 'unified_taste') {
      console.log(`[API/ANALYZE] Performing unified taste analysis for ${playlistTracks?.length || 0} playlist tracks and ${tracks?.length || 0} top tracks.`);

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
      const prompt = JSON.stringify({
        playlist_tracks: playlistTracks,
        top_tracks: tracks // 'tracks' variable from req.body now holds top tracks for unified analysis
      }, null, 2);
      
      console.log("[API/ANALYZE] Unified Taste Analysis Prompt (first 500 chars):", prompt.substring(0, 500));

      let geminiResponseText = "";
      try {
        const response = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt,
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
                          language: { type: Type.ARRAY, items: { type: Type.STRING } }, // Explicitly included language
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
            thinkingConfig: { thinkingBudget: 0 },
            safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
            ],
          }
        });
        geminiResponseText = response.text;
      } catch (geminiError) {
        console.error("[API/ANALYZE] Error calling Gemini API for unified taste analysis:", geminiError);
        console.error(`[API/ANALYZE] Gemini Error Details (unified_taste): Name=${(geminiError).name}, Message=${(geminiError).message}`);
        console.error("[API/ANALYZE] Gemini Error Object (unified_taste):", JSON.stringify(geminiError, null, 2));
        if ((geminiError).stack) {
          console.error("[API/ANALYZE] Gemini Error Stack (unified_taste):", (geminiError).stack);
        }
        throw new Error(`Gemini API Error (unified_taste): ${(geminiError).message || 'Unknown Gemini error'}`);
      }

      console.log("[API/ANALYZE] Raw Gemini Response Text (Unified Taste - first 500 chars):", geminiResponseText ? geminiResponseText.substring(0, 500) : "No text received.");
      const cleanText = geminiResponseText.replace(/```json|```/g, '').trim();
      try {
        const parsedData = JSON.parse(cleanText);
        console.log("[API/ANALYZE] Successfully parsed unified taste response.");

        const t_handler_end = Date.now();
        console.log(`[API/ANALYZE] Handler finished successfully in ${t_handler_end - t_handler_start}ms.`);
        return res.status(200).json(parsedData);
      } catch (parseError) {
        console.error("[API/ANALYZE] Error parsing unified taste JSON:", parseError);
        console.error(`[API/ANALYZE] Parsing Error Details (unified_taste): Name=${(parseError).name}, Message=${(parseError).message}`);
        console.error("[API/ANALYZE] Malformed response text (unified taste):", cleanText);

        const t_handler_end = Date.now();
        console.log(`[API/ANALYZE] Handler finished with parsing error in ${t_handler_end - t_handler_start}ms.`);
        return res.status(500).json({ error: `Failed to parse AI response for unified taste: ${(parseError).message}` });
      }
    }

    console.error(`[API/ANALYZE] Invalid analysis type received: "${type}"`);
    const t_handler_end = Date.now();
    console.log(`[API/ANALYZE] Handler finished with invalid type error in ${t_handler_end - t_handler_start}ms.`);
    return res.status(400).json({ error: 'Invalid analysis type' });
  } catch (error) {
    console.error("[API/ANALYZE] Analyze API Handler - Uncaught Error:", error);
    console.error(`[API/ANALYZE] Uncaught Error Details: Name=${(error).name}, Message=${(error).message}`);
    console.error("[API/ANALYZE] Uncaught Error Object:", JSON.stringify(error, null, 2));
    if ((error).stack) {
      console.error("[API/ANALYZE] Uncaught Error Stack:", (error).stack);
    }

    const t_handler_end = Date.now();
    console.log(`[API/ANALYZE] Handler finished with uncaught error in ${t_handler_end - t_handler_start}ms.`);
    return res.status(500).json({ error: (error).message || 'Internal Server Error', serverErrorName: (error).name || 'UnknownServerError' });
  }
}
