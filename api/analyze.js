
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
      Analyze the list of songs and infer the overarching mood category.
      Return only valid JSON.`;

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

      const text = response.text;
      if (!text) throw new Error("Empty AI response during playlist analysis");
      const cleanText = text.replace(/```json|```/g, '').trim();
      return res.status(200).json(JSON.parse(cleanText));
    } 
    
    if (type === 'tracks') {
      const systemInstruction = `Analyze music track list. Provide deep semantic tagging for each track.`;
      
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: tracks.join('\n'),
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
                confidence: { type: Type.STRING },
                semantic_tags: {
                  type: Type.OBJECT,
                  properties: {
                    primary_genre: { type: Type.STRING },
                    secondary_genres: { type: Type.ARRAY, items: { type: Type.STRING } },
                    energy: { type: Type.STRING },
                    mood: { type: Type.ARRAY, items: { type: Type.STRING } },
                    tempo: { type: Type.STRING },
                    vocals: { type: Type.STRING },
                    texture: { type: Type.STRING }
                  },
                  required: ["primary_genre", "energy", "mood", "tempo", "vocals", "texture"]
                }
              },
              required: ["song_name", "artist_name", "semantic_tags", "confidence"]
            }
          }
        }
      });

      const text = response.text;
      if (!text) throw new Error("Empty AI response during track analysis");
      const cleanText = text.replace(/```json|```/g, '').trim();
      return res.status(200).json(JSON.parse(cleanText));
    }

    return res.status(400).json({ error: 'Invalid analysis type' });
  } catch (error) {
    console.error("Analyze API Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
