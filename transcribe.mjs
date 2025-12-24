
import { GoogleGenAI } from "@google/genai";

const GEMINI_MODEL = 'gemini-2.5-flash';

export default async function handler(req, res) {
  const t_handler_start = Date.now();
  console.log(`[API/TRANSCRIBE] Handler started at ${new Date().toISOString()}. Region: ${process.env.VERCEL_REGION || 'unknown'}`);

  if (req.method !== 'POST') {
    console.warn(`[API/TRANSCRIBE] Method not allowed: ${req.method}`);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- API KEY VALIDATION ---
  const API_KEY = process.env.API_KEY; // Capture it here
  if (!API_KEY) { // Use the captured value
    console.error("[API/TRANSCRIBE] API_KEY environment variable is not set or is empty.");
    return res.status(401).json({ error: 'API_KEY environment variable is missing from serverless function. Please ensure it is correctly configured in your deployment environment (e.g., Vercel environment variables or AI Studio settings).' });
  }
  // --- END API KEY VALIDATION ---

  const { base64Audio, mimeType } = req.body;

  console.log(`[API/TRANSCRIBE] Incoming request for transcription.`);
  console.log(`[API/TRANSCRIBE] Audio MIME Type: "${mimeType}", Data length: ${base64Audio ? base64Audio.length : 0}`);
  console.log(`[API/TRANSCRIBE] Using GEMINI_MODEL: ${GEMINI_MODEL}`);

  if (!base64Audio) {
    console.error("[API/TRANSCRIBE] Missing audio data for transcription.");
    return res.status(400).json({ error: 'Missing audio data' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY }); // Use the validated API_KEY
    console.log("[API/TRANSCRIBE] DEBUG: GoogleGenAI client initialized.");
    const promptText = "Transcribe the following audio exactly as spoken. Do not translate it. Return only the transcription text, no preamble.";
    console.log("[API/TRANSCRIBE] Transcription Prompt:", promptText);

    let geminiResponseText = "";
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          { inlineData: { mimeType: mimeType, data: base64Audio } },
          { text: promptText }
        ],
        config: {
          thinkingConfig: { thinkingBudget: 0 }
        }
      });
      geminiResponseText = response.text;
    } catch (geminiError) { // Removed : any
      console.error("[API/TRANSCRIBE] Error calling Gemini API for transcription:", geminiError);
      console.error(`[API/TRANSCRIBE] Gemini Error Details: Name=${(geminiError as Error).name}, Message=${(geminiError as Error).message}`);
      console.error("[API/TRANSCRIBE] Gemini Error Object:", JSON.stringify(geminiError, null, 2));
      if ((geminiError as Error).stack) {
        console.error("[API/TRANSCRIBE] Gemini Error Stack (transcription):", (geminiError as Error).stack);
      }
      throw new Error(`Gemini API Error (transcription): ${(geminiError as Error).message || 'Unknown Gemini error'}`);
    }

    console.log("[API/TRANSCRIBE] Raw Gemini Response Text (Transcription - first 500 chars):", geminiResponseText ? geminiResponseText.substring(0, 500) : "No text received.");
    
    const t_handler_end = Date.now();
    console.log(`[API/TRANSCRIBE] Handler finished successfully in ${t_handler_end - t_handler_start}ms.`);
    return res.status(200).json({ text: geminiResponseText || "" });
  } catch (error) { // Removed : any
    console.error("[API/TRANSCRIBE] Transcribe API Handler - Uncaught Error:", error);
    console.error(`[API/TRANSCRIBE] Uncaught Error Details: Name=${(error as Error).name}, Message=${(error as Error).message}`);
    console.error("[API/TRANSCRIBE] Uncaught Error Object:", JSON.stringify(error, null, 2));
    if ((error as Error).stack) {
      console.error("[API/TRANSCRIBE] Uncaught Error Stack:", (error as Error).stack);
    }
    
    const t_handler_end = Date.now();
    console.log(`[API/TRANSCRIBE] Handler finished with uncaught error in ${t_handler_end - t_handler_start}ms.`);
    return res.status(500).json({ error: (error as Error).message || 'Internal Server Error', serverErrorName: (error as Error).name || 'UnknownServerError' });
  }
}