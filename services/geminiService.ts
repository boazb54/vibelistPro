import { GoogleGenAI, Type } from "@google/genai";
import { GeneratedPlaylistRaw } from "../types";

export const generatePlaylistFromMood = async (mood: string, userContext?: any): Promise<GeneratedPlaylistRaw> => {
  // Lazy initialization inside the function to prevent top-level crashes
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = "gemini-2.5-flash";
  
  const systemInstruction = `You are a professional music curator/DJ with deep knowledge of music across all genres.
  Your goal is to create a perfect playlist for the user's requested mood or activity.
  You should pick 25 songs that perfectly match the vibe.
  Provide a creative title and a short description for the playlist.
  The songs should be real, popular enough to be found on Spotify/iTunes, but not just the top 10 hits (mix of hits and hidden gems).
  Structure the output strictly as JSON.`;

  let prompt = `Create a playlist for the mood: "${mood}".`;
  if (userContext) {
    if (userContext.country) prompt += ` The user is in ${userContext.country}.`;
    if (userContext.explicit_filter_enabled) prompt += ` Please avoid explicit content if possible.`;
  }

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      safetySettings: [
        {
          category: 'HARM_CATEGORY_HARASSMENT',
          threshold: 'BLOCK_ONLY_HIGH',
        },
        {
          category: 'HARM_CATEGORY_HATE_SPEECH',
          threshold: 'BLOCK_ONLY_HIGH',
        },
        {
          category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          threshold: 'BLOCK_ONLY_HIGH',
        },
        {
          category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
          threshold: 'BLOCK_ONLY_HIGH',
        },
      ],
      responseSchema: {
        type: Type.OBJECT,
        required: ["playlist_title", "mood", "description", "songs"],
        properties: {
          playlist_title: { type: Type.STRING },
          mood: { type: Type.STRING },
          description: { type: Type.STRING },
          songs: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ["title", "artist", "album", "search_query"],
              properties: {
                title: { type: Type.STRING },
                artist: { type: Type.STRING },
                album: { type: Type.STRING },
                search_query: { type: Type.STRING, description: "Optimized search query to find this exact song" }
              }
            }
          }
        }
      }
    }
  });

  if (response.text) {
      return JSON.parse(response.text) as GeneratedPlaylistRaw;
  }
  
  throw new Error("Failed to generate playlist content");
};