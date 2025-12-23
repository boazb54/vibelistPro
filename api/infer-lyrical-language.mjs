import { GoogleGenAI, Type } from "@google/genai";

const GEMINI_MODEL = 'gemini-2.5-flash';

export default async function handler(req, res) {
  const t_handler_start = Date.now();
  console.log(`[API/INFER-LYRICAL-LANGUAGE] Handler started at ${new Date().toISOString()}. Region: ${process.env.VERCEL_REGION || 'unknown'}`);

  if (req.method !== 'POST') {
    console.warn(`[API/INFER-LYRICAL-LANGUAGE] Method not allowed: ${req.method}`);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- API KEY VALIDATION ---
  const API_KEY = process.env.API_KEY;
  if (!API_KEY) {
    console.error("[API/INFER-LYRICAL-LANGUAGE] API_KEY environment variable is not set or is empty.");
    return res.status(401).json({ error: 'API_KEY environment variable is missing from serverless function. Please ensure it is correctly configured in your deployment environment (e.g., Vercel environment variables or AI Studio settings).' });
  }
  // --- END API KEY VALIDATION ---

  const { tracks } = req.body;

  console.log(`[API/INFER-LYRICAL-LANGUAGE] Incoming request to infer lyrical language for ${tracks.length} tracks.`);
  console.log(`[API/INFER-LYRICAL-LANGUAGE] Using GEMINI_MODEL: ${GEMINI_MODEL}`);

  if (!Array.isArray(tracks) || tracks.length === 0) {
    console.error("[API/INFER-LYRICAL-LANGUAGE] Missing or empty 'tracks' array.");
    return res.status(400).json({ error: 'Missing or empty tracks array' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    console.log("[API/INFER-LYRICAL-LANGUAGE] DEBUG: GoogleGenAI client initialized.");

    const systemInstruction = `You are an expert music analyst with deep knowledge of song lyrics, artists, and their cultural and linguistic origins.
Your task is to infer the dominant lyrical language for each provided song, based solely on its title and artist name, by drawing upon your vast knowledge of music. If a song is primarily instrumental, state "instrumental".

RULES:
1. Infer the *most probable dominant lyrical language*. Use common language names (e.g., "english", "spanish", "korean", "hebrew", "arabic", "french", "german", "japanese", "portuguese", "hindi", "instrumental").
2. Provide a 'confidence_score' between 0.0 (very uncertain) and 1.0 (very certain) for your inference.
3. If the lyrical language cannot be reasonably inferred or the song is known to be primarily instrumental, return "instrumental" for 'inferred_lyrical_language' and a confidence score reflecting the certainty of it being instrumental (e.g., 0.9 for well-known instrumentals, 0.1 if uncertain).
4. Return only raw, valid JSON matching the specified schema.

OUTPUT FORMAT (JSON Array):
[
  {
    "song_name": "string",
    "artist_name": "string",
    "inferred_lyrical_language": "string" | "unknown" | "instrumental", // e.g., "english", "spanish", "korean", "hebrew", "instrumental"
    "confidence_score": "number" // 0.0 - 1.0
  }
]

Example Inputs:
"Despacito by Luis Fonsi"
"Gangnam Style by PSY"
"Bohemian Rhapsody by Queen"
"Hallelujah by Leonard Cohen"
"Nessun Dorma by Luciano Pavarotti"
"Toccata and Fugue in D Minor by Johann Sebastian Bach"
"Classical Gas by Mason Williams"
`;
    
    // Process tracks in batches to avoid excessively long prompts or API limits
    const BATCH_SIZE = 10; // Process 10 tracks per Gemini call
    const results = [];

    for (let i = 0; i < tracks.length; i += BATCH_SIZE) {
      const batch = tracks.slice(i, i + BATCH_SIZE);
      const prompt = `Infer the dominant lyrical language for the following songs:\n${batch.map(t => `- ${t}`).join('\n')}`;
      console.log(`[API/INFER-LYRICAL-LANGUAGE] Processing batch ${i/BATCH_SIZE + 1} of ${Math.ceil(tracks.length/BATCH_SIZE)}. Prompt (first 500 chars):`, prompt.substring(0, 500));

      let geminiResponseText = "";
      try {
        const response = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  song_name: { type: Type.STRING },
                  artist_name: { type: Type.STRING },
                  inferred_lyrical_language: { type: Type.STRING },
                  confidence_score: { type: Type.NUMBER }
                },
                required: ["song_name", "artist_name", "inferred_lyrical_language", "confidence_score"],
              },
            },
            thinkingConfig: { thinkingBudget: 0 }
          }
        });
        geminiResponseText = response.text;
      } catch (geminiError) {
        console.error(`[API/INFER-LYRICAL-LANGUAGE] Error calling Gemini API for batch ${i/BATCH_SIZE + 1}:`, geminiError);
        console.error(`[API/INFER-LYRICAL-LANGUAGE] Gemini Error Details: Name=${(geminiError).name}, Message=${(geminiError).message}`);
        console.error("[API/INFER-LYRICAL-LANGUAGE] Gemini Error Object:", JSON.stringify(geminiError, null, 2));
        if ((geminiError).stack) {
          console.error("[API/INFER-LYRICAL-LANGUAGE] Gemini Error Stack:", (geminiError).stack);
        }
        // For batch errors, push an error placeholder or re-throw if critical
        batch.forEach(trackString => {
          const [song_name, artist_name] = trackString.split(' by ', 2);
          results.push({
            song_name: song_name || 'Unknown Song',
            artist_name: artist_name || 'Unknown Artist',
            inferred_lyrical_language: 'unknown',
            confidence_score: 0.0,
            error: `Gemini API failed for this track: ${(geminiError).message}`
          });
        });
        continue; // Continue to next batch even if one fails
      }

      console.log(`[API/INFER-LYRICAL-LANGUAGE] Raw Gemini Response Text (Batch ${i/BATCH_SIZE + 1} - first 500 chars):`, geminiResponseText ? geminiResponseText.substring(0, 500) : "No text received.");
      const cleanText = geminiResponseText.replace(/```json|```/g, '').trim();
      try {
        const parsedData = JSON.parse(cleanText);
        // Ensure parsing aligns with batch input for consistency
        if (Array.isArray(parsedData)) {
          // If Gemini returns fewer items than requested, align with input batch
          batch.forEach((trackString, idx) => {
            const [song_name, artist_name] = trackString.split(' by ', 2);
            results.push(parsedData[idx] || {
              song_name: song_name || 'Unknown Song',
              artist_name: artist_name || 'Unknown Artist',
              inferred_lyrical_language: 'unknown',
              confidence_score: 0.0,
              error: 'Gemini did not return data for this specific track in batch'
            });
          });
        } else {
           console.warn(`[API/INFER-LYRICAL-LANGUAGE] Gemini returned non-array for batch ${i/BATCH_SIZE + 1}. Raw: ${cleanText}`);
           batch.forEach(trackString => {
              const [song_name, artist_name] = trackString.split(' by ', 2);
              results.push({
                song_name: song_name || 'Unknown Song',
                artist_name: artist_name || 'Unknown Artist',
                inferred_lyrical_language: 'unknown',
                confidence_score: 0.0,
                error: 'Gemini response malformed for batch'
              });
            });
        }
      } catch (parseError) {
        console.error(`[API/INFER-LYRICAL-LANGUAGE] Error parsing batch ${i/BATCH_SIZE + 1} JSON:`, parseError);
        console.error(`[API/INFER-LYRICAL-LANGUAGE] Parsing Error Details: Name=${(parseError).name}, Message=${(parseError).message}`);
        console.error(`[API/INFER-LYRICAL-LANGUAGE] Malformed response text (batch ${i/BATCH_SIZE + 1}):`, cleanText);
        batch.forEach(trackString => {
          const [song_name, artist_name] = trackString.split(' by ', 2);
          results.push({
            song_name: song_name || 'Unknown Song',
            artist_name: artist_name || 'Unknown Artist',
            inferred_lyrical_language: 'unknown',
            confidence_score: 0.0,
            error: `Failed to parse AI response for this batch: ${(parseError).message}`
          });
        });
      }
    }
    
    const t_handler_end = Date.now();
    console.log(`[API/INFER-LYRICAL-LANGUAGE] Handler finished successfully in ${t_handler_end - t_handler_start}ms.`);
    return res.status(200).json(results);

  } catch (error) {
    console.error("[API/INFER-LYRICAL-LANGUAGE] Uncaught Error:", error);
    console.error(`[API/INFER-LYRICAL-LANGUAGE] Uncaught Error Details: Name=${(error).name}, Message=${(error).message}`);
    console.error("[API/INFER-LYRICAL-LANGUAGE] Uncaught Error Object:", JSON.stringify(error, null, 2));
    if ((error).stack) {
      console.error("[API/INFER-LYRICAL-LANGUAGE] Uncaught Error Stack:", (error).stack);
    }
    
    const t_handler_end = Date.now();
    console.log(`[API/INFER-LYRICAL-LANGUAGE] Handler finished with uncaught error in ${t_handler_end - t_handler_start}ms.`);
    return res.status(500).json({ error: (error).message || 'Internal Server Error', serverErrorName: (error).name || 'UnknownServerError' });
  }
}