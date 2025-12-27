
import { GoogleGenAI, Type } from "@google/genai";

const GEMINI_MODEL = 'gemini-2.5-flash';

export default async function handler(req, res) {
  const t_handler_start = Date.now();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const API_KEY = process.env.API_KEY;
  if (!API_KEY) {
    return res.status(401).json({ error: 'API_KEY environment variable is missing.' });
  }

  const { type, tracks, playlistTracks, topTracks } = req.body;
  
  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });

    if (type === 'unified_taste') {
      console.log(`[API/ANALYZE] Performing unified taste synthesis for ${topTracks?.length || 0} top and ${playlistTracks?.length || 0} playlist tracks.`);
      const systemInstruction = `You are an elite music psychologist. 
Analyze two datasets provided by the user: 
1. Top Tracks (recent high-frequency listening).
2. Playlist Tracks (historical collection context).

GOALS:
1. Provide semantic metadata (genre, energy, mood, tempo, texture) for the Top Tracks.
2. Infer the overarching 'vibe category' from the Playlist Tracks.

RULES:
- Be descriptive but concise.
- Focus on AUDIO PHYSICS for tagging.
- Return ONLY valid JSON matching the schema.

SCHEMA:
{
  "playlist_mood": {
    "playlist_mood_category": "string",
    "confidence_score": number
  },
  "analyzed_tracks": [
    {
      "song_name": "string",
      "artist_name": "string",
      "semantic_tags": {
        "primary_genre": "string",
        "secondary_genres": ["string"],
        "energy": "low"|"medium"|"high"|"explosive",
        "mood": ["string"],
        "tempo": "slow"|"mid"|"fast",
        "vocals": "instrumental"|"lead_vocal"|"choral",
        "texture": "organic"|"electric"|"synthetic"
      },
      "confidence": "low"|"medium"|"high"
    }
  ]
}`;

      const prompt = JSON.stringify({
        top_tracks: topTracks || [],
        playlist_tracks: playlistTracks || []
      });

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 }
        }
      });

      const parsedData = JSON.parse(response.text);
      return res.status(200).json(parsedData);
    }

    if (type === 'playlists' || type === 'tracks') {
        // Legacy support redirected to unified logic conceptually but kept for safety if needed
        return res.status(400).json({ error: 'Deprecated endpoint. Use unified_taste type.' });
    }

    return res.status(400).json({ error: 'Invalid analysis type' });
  } catch (error) {
    console.error("[API/ANALYZE] Uncaught Error:", error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
