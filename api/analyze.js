
import { GoogleGenAI, Type } from "@google/genai";

const GEMINI_MODEL = 'gemini-2.5-flash';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type, tracks, playlistTracks } = req.body;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    if (type === 'playlists') {
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
        }
      });

      const cleanText = response.text.replace(/```json|```/g, '').trim();
      return res.status(200).json(JSON.parse(cleanText));
    } 
    
    if (type === 'tracks') {
      const systemInstruction = `Analyze music track list. Return JSON array of AnalyzedTrack objects with semantic_tags (energy, mood, genre, tempo, vocals, texture).`;
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: tracks.join('\n'),
        config: { systemInstruction, responseMimeType: "application/json" }
      });
      const cleanText = response.text.replace(/```json|```/g, '').trim();
      return res.status(200).json(JSON.parse(cleanText));
    }

    return res.status(400).json({ error: 'Invalid analysis type' });
  } catch (error) {
    console.error("Analyze API Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
