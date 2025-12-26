import { GoogleGenAI, Type } from "@google/genai";

const GEMINI_MODEL = 'gemini-2.5-flash';

export default async function handler(req, res) {
  const t_handler_start = Date.now();
  console.log(`[API/TEASER] Handler started at ${new Date().toISOString()}. Region: ${process.env.VERCEL_REGION || 'unknown'}`);

  if (req.method !== 'POST') {
    console.warn(`[API/TEASER] Method not allowed: ${req.method}`);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const API_KEY = process.env.API_KEY;
  if (!API_KEY) {
    console.error("[API/TEASER] API_KEY environment variable is not set or is empty.");
    return res.status(401).json({ error: 'API_KEY environment variable is missing from serverless function.' });
  }

  const { mood } = req.body;

  if (!mood) {
    console.error("[API/TEASER] Missing mood parameter.");
    return res.status(400).json({ error: 'Missing mood parameter' });
  }
  
  console.log(`[API/TEASER] Incoming request for mood: "${mood}"`);

  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const systemInstruction = `You are a creative music curator. Your goal is to generate a creative, evocative playlist title and a short, compelling description.

RULES:
1. The description MUST be under 20 words.
2. Mirror the language of the user's mood (e.g., Hebrew input gets a Hebrew title).
3. Return ONLY a raw JSON object with 'playlist_title' and 'description'.

LEARN FROM EXAMPLES:
- GOOD EXAMPLE (Concise): "Unleash focus. Instrumental soundscapes for deep work." (7 words)
- BAD EXAMPLE (Verbose): "This playlist is designed to help you by providing a series of songs that are really good for when you need to concentrate on your work for a long time." (30 words)`;

    const t_api_start = Date.now();
    const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: `Generate a playlist title and description for the mood: "${mood}"`,
        config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    playlist_title: { type: Type.STRING },
                    description: { type: Type.STRING }
                },
                required: ["playlist_title", "description"]
            },
            thinkingConfig: { thinkingBudget: 0 }
        }
    });
    const t_api_end = Date.now();

    const geminiResponseText = response.text;
    console.log("[API/TEASER] Raw Gemini Response Text:", geminiResponseText);
    const parsedData = JSON.parse(geminiResponseText);
    
    const t_handler_end = Date.now();
    console.log(`[API/TEASER] Handler finished successfully in ${t_handler_end - t_handler_start}ms.`);
    
    return res.status(200).json({
      ...parsedData,
      metrics: {
        geminiApiTimeMs: t_api_end - t_api_start
      }
    });

  } catch (error) {
    console.error("[API/TEASER] Teaser API Handler - Uncaught Error:", error);
    const t_handler_end = Date.now();
    console.log(`[API/TEASER] Handler finished with uncaught error in ${t_handler_end - t_handler_start}ms.`);
    return res.status(500).json({ error: (error).message || 'Internal Server Error' });
  }
}