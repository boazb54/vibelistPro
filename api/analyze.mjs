
import { GoogleGenAI, Type } from "@google/genai";

const GEMINI_MODEL = 'gemini-2.5-flash';

export default async function handler(req, res) {
  const t_handler_start = Date.now();
  console.log(`[API/ANALYZE] Handler started at ${new Date().toISOString()}. Region: ${process.env.VERCEL_REGION || 'unknown'}`);

  if (req.method !== 'POST') {
    console.warn(`[API/ANALYZE] Method not allowed: ${req.method}`);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- API KEY VALIDATION ---
  const API_KEY = process.env.API_KEY; // Capture it here
  if (!API_KEY) { // Use the captured value
    console.error("[API/ANALYZE] API_KEY environment variable is not set or is empty.");
    return res.status(401).json({ error: 'API_KEY environment variable is missing from serverless function. Please ensure it is correctly configured in your deployment environment (e.g., Vercel environment variables or AI Studio settings).' });
  }
  // --- END API KEY VALIDATION ---

  const { type, tracks, playlistTracks } = req.body;
  
  console.log(`[API/ANALYZE] Incoming request type: "${type}"`);
  console.log(`[API/ANALYZE] Using GEMINI_MODEL: ${GEMINI_MODEL}`);

  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY }); // Use the validated API_KEY
    console.log("[API/ANALYZE] DEBUG: GoogleGenAI client initialized.");

    if (type === 'playlists') {
      console.log(`[API/ANALYZE] Analyzing ${playlistTracks.length} playlist tracks.`);
      const systemInstruction = `You are an expert music psychologist and mood categorizer.
      Your task is to analyze a list of song titles and artists, representing a user's collection of personal playlists.
      Based on this combined list, infer the overarching, most dominant "mood category" that these playlists collectively represent.
      Also, provide a confidence score for your categorization.

      RULES:
      1. The 'playlist_mood_category' should be a concise, descriptive phrase (e.g., "High-Energy Workout Mix", "Relaxed Indie Vibes", "Chill Study Focus").
      2. The 'confidence_score' must be a floating-point number between 0.0 (very uncertain) and 1.0 (very certain).
      3. Return only raw, valid JSON matching the specified schema.

      OUTPUT FORMAT:
      {
        "playlist_mood_category": "string",
        "confidence_score": "number"
      }
      `;

      const prompt = `Analyze the collective mood represented by these songs from a user's playlists:\n${playlistTracks.join('\n')}`;
      console.log("[API/ANALYZE] Playlist Mood Analysis Prompt (first 500 chars):", prompt.substring(0, 500));
      
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
                playlist_mood_category: { type: Type.STRING },
                confidence_score: { type: Type.NUMBER }
              },
              required: ["playlist_mood_category", "confidence_score"],
            },
            thinkingConfig: { thinkingBudget: 0 }
          }
        });
        geminiResponseText = response.text;
      } catch (geminiError) {
        console.error("[API/ANALYZE] Error calling Gemini API for playlists:", geminiError);
        console.error(`[API/ANALYZE] Gemini Error Details (playlists): Name=${(geminiError).name}, Message=${(geminiError).message}`);
        console.error("[API/ANALYZE] Gemini Error Object (playlists):", JSON.stringify(geminiError, null, 2));
        if ((geminiError).stack) {
          console.error("[API/ANALYZE] Gemini Error Stack (playlists):", (geminiError).stack);
        }
        throw new Error(`Gemini API Error (playlists): ${(geminiError).message || 'Unknown Gemini error'}`);
      }

      console.log("[API/ANALYZE] Raw Gemini Response Text (Playlist Mood - first 500 chars):", geminiResponseText ? geminiResponseText.substring(0, 500) : "No text received.");
      const cleanText = geminiResponseText.replace(/```json|```/g, '').trim();
      try {
        const parsedData = JSON.parse(cleanText);
        console.log("[API/ANALYZE] Successfully parsed playlist mood response.");

        const t_handler_end = Date.now();
        console.log(`[API/ANALYZE] Handler finished successfully in ${t_handler_end - t_handler_start}ms.`);
        return res.status(200).json(parsedData);
      } catch (parseError) {
        console.error("[API/ANALYZE] Error parsing playlist mood JSON:", parseError);
        console.error(`[API/ANALYZE] Parsing Error Details (playlists): Name=${(parseError).name}, Message=${(parseError).message}`);
        console.error("[API/ANALYZE] Malformed response text (playlist mood):", cleanText);

        const t_handler_end = Date.now();
        console.log(`[API/ANALYZE] Handler finished with parsing error in ${t_handler_end - t_handler_start}ms.`);
        return res.status(500).json({ error: `Failed to parse AI response for playlist mood: ${(parseError).message}` });
      }
      
    } 
    
    if (type === 'tracks') {
      console.log(`[API/ANALYZE] Analyzing ${tracks.length} individual tracks.`);
      const systemInstruction = `You are a music analysis engine. 
    Analyze the provided list of songs.
    
    For each song, return a JSON object using this exact schema:
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
        "texture": "organic" | "electric" | "synthetic"
      },
      "confidence": "low" | "medium" | "high"
    }

    RULES:
    1. Split the input string (e.g. "Song by Artist") into "song_name" and "artist_name".
    2. Normalize values: Use lowercase, controlled vocabulary only.
    3. Use arrays for attributes that can be multiple (mood, secondary_genres).
    4. Interpret attributes as soft signals, not absolute facts.
    
    Return the result as a raw JSON array.`;
      
      const prompt = tracks.join('\n');
      console.log("[API/ANALYZE] Track Analysis Prompt (first 500 chars):", prompt.substring(0, 500));

      let geminiResponseText = "";
      try {
        const response = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt,
          config: { 
            systemInstruction, 
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 0 }
          }
        });
        geminiResponseText = response.text;
      } catch (geminiError) {
        console.error("[API/ANALYZE] Error calling Gemini API for tracks:", geminiError);
        console.error(`[API/ANALYZE] Gemini Error Details (tracks): Name=${(geminiError).name}, Message=${(geminiError).message}`);
        console.error("[API/ANALYZE] Gemini Error Object (tracks):", JSON.stringify(geminiError, null, 2));
        if ((geminiError).stack) {
          console.error("[API/ANALYZE] Gemini Error Stack (tracks):", (geminiError).stack);
        }
        throw new Error(`Gemini API Error (tracks): ${(geminiError).message || 'Unknown Gemini error'}`);
      }

      console.log("[API/ANALYZE] Raw Gemini Response Text (Track Analysis - first 500 chars):", geminiResponseText ? geminiResponseText.substring(0, 500) : "No text received.");
      const cleanText = geminiResponseText.replace(/```json|```/g, '').trim();
      try {
        const parsedData = JSON.parse(cleanText);
        console.log("[API/ANALYZE] Successfully parsed track analysis response.");

        const t_handler_end = Date.now();
        console.log(`[API/ANALYZE] Handler finished successfully in ${t_handler_end - t_handler_start}ms.`);
        return res.status(200).json(parsedData);
      } catch (parseError) {
        console.error("[API/ANALYZE] Error parsing track analysis JSON:", parseError);
        console.error(`[API/ANALYZE] Parsing Error Details (tracks): Name=${(parseError).name}, Message=${(parseError).message}`);
        console.error("[API/ANALYZE] Malformed response text (track analysis):", cleanText);

        const t_handler_end = Date.now();
        console.log(`[API/ANALYZE] Handler finished with parsing error in ${t_handler_end - t_handler_start}ms.`);
        return res.status(500).json({ error: `Failed to parse AI response for track analysis: ${(parseError).message}` });
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