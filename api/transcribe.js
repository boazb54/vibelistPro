
import { GoogleGenAI } from "@google/genai";

const GEMINI_MODEL = 'gemini-2.5-flash';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { base64Audio, mimeType } = req.body;

  if (!base64Audio) {
    return res.status(400).json({ error: 'Missing audio data' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        { inlineData: { mimeType: mimeType, data: base64Audio } },
        { text: "Transcribe the spoken audio exactly. Return only the text." }
      ]
    });
    return res.status(200).json({ text: response.text || "" });
  } catch (error) {
    console.error("Transcribe API Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
