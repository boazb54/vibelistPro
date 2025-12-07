import { GoogleGenAI, Type, Schema } from "@google/genai";
import { GeneratedPlaylistRaw } from "../types";

// Support both local process.env (for sandbox) and Vite import.meta.env (for Vercel)
const apiKey = (import.meta as any).env?.VITE_API_KEY || process.env.API_KEY;
const ai = new GoogleGenAI({ apiKey: apiKey });

const songSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: "Title of the song" },
    artist: { type: Type.STRING, description: "Primary artist name" },
    album: { type: Type.STRING, description: "Album name" },
    search_query: { type: Type.STRING, description: "Optimized search query for iTunes API (e.g. 'Artist Name Song Title')" }
  },
  required: ["title", "artist", "album", "search_query"]
};

const playlistSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    playlist_title: { type: Type.STRING, description: "A creative title for the playlist based on the scenario" },
    mood: { type: Type.STRING, description: "A 1-3 word summary of the vibe (e.g. 'Melancholy Rain', 'High Energy')" },
    description: { type: Type.STRING, description: "A short description explaining how these songs fit the user's scenario or story." },
    songs: {
      type: Type.ARRAY,
      items: songSchema,
      description: "A list of 10 real, popular songs that exist on major streaming platforms. We request more to ensure we can filter out those without previews."
    }
  },
  required: ["playlist_title", "mood", "description", "songs"]
};

export interface UserContext {
  country?: string;
  explicit_filter_enabled?: boolean;
}

export const generatePlaylistFromMood = async (userInput: string, userContext?: UserContext): Promise<GeneratedPlaylistRaw> => {
  try {
    let systemInstruction = `
      Act as a world-class DJ and Music Curator.
      
      User Input: "${userInput}"
      
      Task: 
      1. Analyze the input. It might be a simple mood (e.g., "Happy"), a genre, or a complex story/scenario (e.g., "I just broke up with my partner but I feel relieved").
      2. If it is a story, infer the emotional arc and the context (time of day, energy level).
      3. Curate a playlist of 10 distinct songs that perfectly match this specific context.
      4. Ensure the songs are real, commercially released tracks.
      
      The output must be valid JSON matching the schema provided.
    `;

    if (userContext) {
        if (userContext.country) {
            systemInstruction += `\nConsider that the user is located in ${userContext.country}. Include a mix of international hits and relevant local/regional hits if appropriate for the vibe.`;
        }
        if (userContext.explicit_filter_enabled) {
            systemInstruction += `\nSTRICT REQUIREMENT: The user has an explicit content filter enabled. Do NOT include any songs with explicit lyrics (swearing, violence, etc.). Choose clean versions or safe-for-work songs only.`;
        }
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: systemInstruction,
      config: {
        responseMimeType: "application/json",
        responseSchema: playlistSchema,
        temperature: 0.7,
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");
    
    return JSON.parse(text) as GeneratedPlaylistRaw;
  } catch (error) {
    console.error("Error generating playlist:", error);
    throw error;
  }
};