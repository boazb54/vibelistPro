import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { GeneratedPlaylistRaw } from "../types";

export const generatePlaylistFromMood = async (
  mood: string, 
  userContext?: { country?: string, explicit_filter_enabled?: boolean },
  tasteProfile?: { topArtists: string[], topGenres: string[] },
  excludeSongs?: string[]
): Promise<GeneratedPlaylistRaw> => {
  
  // 1. Explicit Check: Ensure the key exists before crashing the SDK
  if (!process.env.API_KEY) {
    throw new Error("API Key not found. Please add 'API_KEY' to your Vercel Environment Variables.");
  }

  // Lazy initialization inside the function to prevent top-level crashes
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = "gemini-2.5-flash";
  
  // STRATEGY: DISCOVERY BRIDGE & PERSONALIZATION
  // We inject instructions to use the taste profile as a compass, not a map.
  const systemInstruction = `You are a professional music curator/DJ with deep knowledge of music across all genres.
  Your goal is to create a perfect playlist for the user's requested mood or activity.
  You should pick 25 songs that perfectly match the vibe.
  Provide a creative title and a short description for the playlist.
  
  CRITICAL RULES:
  1. The songs should be real and findable on Spotify/iTunes.
  2. Structure the output strictly as JSON.
  3. If "User Taste" is provided: Use it as a stylistic compass to understand the user's preferred energy. Do NOT just list the user's top artists. Find "Hidden Gems", B-sides, and adjacent artists that match their taste profile but offer true discovery.
  4. If "Exclusion List" is provided: Do NOT include any of the songs listed. The user has already seen them and wants something new (Remix Mode).`;

  let prompt = `Create a playlist for the mood: "${mood}".`;
  
  if (userContext) {
    if (userContext.country) prompt += ` The user is in ${userContext.country}.`;
    if (userContext.explicit_filter_enabled) prompt += ` Please avoid explicit content if possible.`;
  }

  // INJECT TASTE (PERSONALIZATION)
  if (tasteProfile && tasteProfile.topArtists.length > 0) {
    prompt += `\n\nUSER TASTE PROFILE (Use for style adaptation, but prioritize discovery):
    - Top Artists: ${tasteProfile.topArtists.join(', ')}
    - Top Genres: ${tasteProfile.topGenres.join(', ')}`;
  }

  // INJECT EXCLUSIONS (REMIX LOGIC)
  if (excludeSongs && excludeSongs.length > 0) {
    prompt += `\n\nEXCLUSION LIST (The user just saw these, do NOT repeat them):
    ${excludeSongs.join(', ')}`;
  }

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
      ],
      // FIX: Use string literals instead of Enum 'Type.OBJECT' to prevent import crashes
      responseSchema: {
        type: 'OBJECT',
        required: ["playlist_title", "mood", "description", "songs"],
        properties: {
          playlist_title: { type: 'STRING' },
          mood: { type: 'STRING' },
          description: { type: 'STRING' },
          songs: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              required: ["title", "artist", "album", "search_query"],
              properties: {
                title: { type: 'STRING' },
                artist: { type: 'STRING' },
                album: { type: 'STRING' },
                search_query: { type: 'STRING', description: "Optimized search query to find this exact song" }
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

// STRATEGY P: AI-Powered Audio Transcription
// Uses Gemini 2.5 Flash to accept raw audio and transcribe it.
export const transcribeAudio = async (base64Audio: string, mimeType: string): Promise<string> => {
    if (!process.env.API_KEY) {
        throw new Error("API Key missing");
    }

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    // Use 2.5 Flash for fast, cheap, multimodal transcription
    const model = "gemini-2.5-flash";

    const response = await ai.models.generateContent({
        model,
        contents: [
            {
                inlineData: {
                    mimeType: mimeType,
                    data: base64Audio
                }
            },
            {
                // STRATEGY Q: Native Transcription (No Translation)
                // We ask Gemini to transcribe exactly what was said in the original language.
                // This allows Hebrew/Spanish/etc to pass through correctly to the playlist generator.
                text: "Transcribe the following audio exactly as spoken. Do not translate it. Return only the transcription text, no preamble."
            }
        ]
    });

    return response.text || "";
};