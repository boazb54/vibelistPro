
import { GoogleGenAI, Type } from "@google/genai";

const GEMINI_MODEL = 'gemini-2.5-flash';

export default async function handler(req, res) {
  const t_handler_start = Date.now();
  console.log(`[API/VALIDATE] Handler started at ${new Date().toISOString()}. Region: ${process.env.VERCEL_REGION || 'unknown'}`);

  if (req.method !== 'POST') {
    console.warn(`[API/VALIDATE] Method not allowed: ${req.method}`);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const API_KEY = process.env.API_KEY;
  if (!API_KEY) {
    console.error("[API/VALIDATE] API_KEY environment variable is not set.");
    return res.status(401).json({ error: 'API_KEY environment variable is missing from serverless function.' });
  }

  const { mood } = req.body;
  if (!mood) {
    console.error("[API/VALIDATE] Missing mood parameter.");
    return res.status(400).json({ error: 'Missing mood parameter' });
  }

  console.log(`[API/VALIDATE] Incoming request for mood: "${mood}"`);

  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const systemInstruction = `You are an AI gatekeeper for a music playlist generator. Your task is to validate a user's input based on whether it's a plausible request for a music vibe.

You must classify the input into one of three categories:
1.  'VIBE_VALID': The input describes a mood, activity, memory, or scenario suitable for music (e.g., "rainy day", "post-breakup", "coding at 2am", "שמח"). This is the most common case.
2.  'VIBE_INVALID_GIBBERISH': The input is nonsensical, random characters, or keyboard mashing (e.g., "asdfasdf", "jhgjhgj").
3.  'VIBE_INVALID_OFF_TOPIC': The input is a coherent question or statement but is NOT about a mood or music (e.g., "what's the weather", "tell me a joke", "מתכון לעוגה").

RULES:
1.  Provide a concise, user-friendly 'reason' for your decision.
2.  **LANGUAGE MIRRORING (CRITICAL):** The 'reason' MUST be in the same language as the user's input.
3.  Return ONLY a raw JSON object matching the schema.`;
    
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `Validate the following user input: "${mood}"`,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            validation_status: { type: Type.STRING },
            reason: { type: Type.STRING }
          },
          required: ["validation_status", "reason"]
        },
        thinkingConfig: { thinkingBudget: 0 }
      }
    });

    const parsedData = JSON.parse(response.text);
    console.log(`[API/VALIDATE] Validation successful. Status: ${parsedData.validation_status}`);

    const t_handler_end = Date.now();
    console.log(`[API/VALIDATE] Handler finished successfully in ${t_handler_end - t_handler_start}ms.`);
    
    return res.status(200).json(parsedData);

  } catch (error) {
    console.error("[API/VALIDATE] Validation API Handler - Uncaught Error:", error);
    const t_handler_end = Date.now();
    console.log(`[API/VALIDATE] Handler finished with uncaught error in ${t_handler_end - t_handler_start}ms.`);
    return res.status(500).json({ error: (error).message || 'Internal Server Error' });
  }
}
