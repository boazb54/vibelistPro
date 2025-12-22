
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";

const GEMINI_MODEL = 'gemini-2.5-flash';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { mood, contextSignals, tasteProfile, excludeSongs } = req.body;

  if (!mood) {
    return res.status(400).json({ error: 'Missing mood parameter' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const systemInstruction = `You are a professional music curator/DJ. 
    Your goal is to create a playlist of 15 songs matching the user's intent. 
    Prioritize "Audio Physics": if they ask for workout, they need steady beats; if they ask for sleep, they need beatless textures.
    
    Language Rule: If the user query is in Hebrew/Spanish/etc, localized 'playlist_title' and 'description' to that language. Keep song titles/artists in original English/International.
    `;

    const promptPayload = {
      user_target: { query: mood, modality: contextSignals.input_modality },
      environmental_context: contextSignals,
      taste_bias: tasteProfile ? {
          top_artists: tasteProfile.topArtists.slice(0, 20),
          vibe_fingerprint: tasteProfile.session_analysis,
          user_playlist_mood: tasteProfile.playlistMoodAnalysis
      } : null,
      exclusions: excludeSongs || []
    };

    const prompt = JSON.stringify(promptPayload, null, 2);
    const t_api_start = Date.now();
    
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        ],
      }
    });

    const t_api_end = Date.now();
    const text = response.text;
    
    if (text) {
      const cleanText = text.replace(/```json|```/g, '').trim();
      const rawData = JSON.parse(cleanText);
      
      return res.status(200).json({
        ...rawData,
        promptText: prompt,
        metrics: {
          geminiApiTimeMs: t_api_end - t_api_start
        }
      });
    }

    throw new Error("Empty response from AI");
  } catch (error) {
    console.error("Vibe API Error:", error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
