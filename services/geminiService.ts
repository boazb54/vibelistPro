
import { GoogleGenAI, HarmCategory, HarmBlockThreshold, Type } from "@google/genai";
import { GeminiResponseWithMetrics, GeneratedPlaylistRaw, AnalyzedTrack, ContextualSignals, UserTasteProfile, PlaylistIntelligence } from "../types";

export const generatePlaylistFromMood = async (
  mood: string, 
  contextSignals: ContextualSignals,
  tasteProfile?: UserTasteProfile,
  excludeSongs?: string[]
): Promise<GeminiResponseWithMetrics> => {
  
  if (!process.env.API_KEY) {
    throw new Error("API Key not found.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = "gemini-3-flash-preview";
  
  const t_prompt_start = performance.now();

  const systemInstruction = `You are a professional music curator/DJ with deep knowledge of audio engineering and music theory.
  Your goal is to create a playlist that matches the **physical audio requirements** of the user's intent, prioritizing physics over genre labels.

  ### 1. THE "AUDIO PHYSICS" HIERARCHY (ABSOLUTE RULES)
  When selecting songs, you must evaluate them in this order:
  
  1. **INTENT (PHYSICAL CONSTRAINTS):** Does the song's audio texture match the requested activity?
  2. **CONTEXT:** Time of day and location tuning.
  3. **TASTE (STYLISTIC COMPASS):** Use the user's taste (including organizational archetypes) to steer the vibes.

  ### 2. TEMPORAL + LINGUISTIC POLARITY
  Determine whether the user describes a PROBLEM or a GOAL.

  ### 3. FORMATTING
  1. Language Mirroring: Match user's language for title/description.
  2. Songs Metadata: Keep in original language.
  3. Conciseness: Description < 20 words.
  
  Return raw JSON only.`;

  const promptPayload = {
      user_target: { query: mood, modality: contextSignals.input_modality },
      environmental_context: {
          local_time: contextSignals.local_time,
          day_of_week: contextSignals.day_of_week,
          device_type: contextSignals.device_type,
          browser_language: contextSignals.browser_language,
          country: contextSignals.country || 'Unknown'
      },
      taste_bias: tasteProfile ? {
          type: tasteProfile.session_analysis?.taste_profile_type || 'unknown',
          top_artists: tasteProfile.topArtists.slice(0, 20),
          top_genres: tasteProfile.topGenres.slice(0, 10),
          vibe_fingerprint: tasteProfile.session_analysis,
          playlist_archetypes: tasteProfile.playlist_intelligence
      } : null,
      exclusions: excludeSongs || []
  };

  const prompt = JSON.stringify(promptPayload, null, 2);

  const t_prompt_end = performance.now();
  const promptBuildTimeMs = Math.round(t_prompt_end - t_prompt_start);

  const t_api_start = performance.now();

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      ],
    }
  });

  const t_api_end = performance.now();
  const geminiApiTimeMs = Math.round(t_api_end - t_api_start);

  const cleanText = response.text.replace(/```json|```/g, '').trim();
  const rawData = JSON.parse(cleanText) as GeneratedPlaylistRaw;
  return {
      ...rawData,
      promptText: prompt,
      metrics: { promptBuildTimeMs, geminiApiTimeMs }
  };
};

export const transcribeAudio = async (base64Audio: string, mimeType: string): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("API Key missing");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const model = "gemini-3-flash-preview";
    const response = await ai.models.generateContent({
        model,
        contents: [
            { inlineData: { mimeType: mimeType, data: base64Audio } },
            { text: "Transcribe the following audio exactly as spoken." }
        ]
    });
    return response.text || "";
};

export const analyzeUserTopTracks = async (tracks: string[]): Promise<AnalyzedTrack[] | { error: string }> => {
    if (!process.env.API_KEY) throw new Error("API Key missing");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const model = "gemini-3-flash-preview";
    const trackList = tracks.join('\n');
    const systemInstruction = `Analyze the provided list of songs. Return JSON array.`;
    const prompt = `Here are the songs to analyze:\n${trackList}`;
    const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { systemInstruction, responseMimeType: "application/json" }
    });
    if (response.text) return JSON.parse(response.text.replace(/```json|```/g, '').trim());
    return { error: "Failed to analyze" };
};

/**
 * NEW: Analyze Spotify Playlists for Intelligence & Archetypes
 */
export interface PlaylistData {
    name: string;
    tracks: { name: string, artist: string }[];
}

export const analyzePlaylistIntelligence = async (playlists: PlaylistData[]): Promise<PlaylistIntelligence[]> => {
    if (!process.env.API_KEY) throw new Error("API Key missing");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const model = "gemini-3-flash-preview";

    const systemInstruction = `You are a professional music analyst. Analyze user playlists to discover "Organizational Archetypes".
    
    For each playlist, return:
    1. top_genres: (Array of top 3 genres)
    2. audio_averages: Estimated Energy, Tempo, and Texture as numbers 0.0 to 1.0.
    3. archetype: A professional curator's interpretation of the "Organizational Archetype" (e.g., "The user has a 'Focus' playlist, so they prefer Lofi over Classical for concentration"). 
    
    CRITICAL: Avoid "Lazy AI" assumptions. Judge based on the actual tracks provided.
    
    Return result as a JSON array corresponding to the input order.`;

    const prompt = JSON.stringify(playlists);

    const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        top_genres: { type: Type.ARRAY, items: { type: Type.STRING } },
                        audio_averages: {
                            type: Type.OBJECT,
                            properties: {
                                energy: { type: Type.NUMBER },
                                tempo: { type: Type.NUMBER },
                                texture: { type: Type.NUMBER }
                            },
                            required: ["energy", "tempo", "texture"]
                        },
                        archetype: { type: Type.STRING }
                    },
                    required: ["top_genres", "audio_averages", "archetype"]
                }
            }
        }
    });

    const results = JSON.parse(response.text.replace(/```json|```/g, '').trim());
    return results.map((res: any, i: number) => ({
        name: playlists[i].name,
        tracks: playlists[i].tracks.map(t => `${t.name} - ${t.artist}`),
        ...res
    }));
};
