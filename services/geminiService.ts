
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { GeminiResponseWithMetrics, GeneratedPlaylistRaw } from "../types";

export const generatePlaylistFromMood = async (
  mood: string, 
  userContext?: { country?: string, explicit_filter_enabled?: boolean },
  tasteProfile?: { topArtists: string[], topGenres: string[] }, // REVERTED: Removed topTracks
  excludeSongs?: string[]
): Promise<GeminiResponseWithMetrics> => {
  
  // 1. Explicit Check: Ensure the key exists before crashing the SDK
  if (!process.env.API_KEY) {
    throw new Error("API Key not found. Please add 'API_KEY' to your Vercel Environment Variables.");
  }

  // Lazy initialization inside the function to prevent top-level crashes
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = "gemini-2.5-flash";
  
  // MEASURE STEP C: Prompt Building
  const t_prompt_start = performance.now();

  // STRATEGY: DISCOVERY BRIDGE & PERSONALIZATION (PROMPT ENGINEERING VERSION)
  const systemInstruction = `You are a professional music curator/DJ with deep knowledge of music across all genres.
  Your goal is to create a perfect playlist for the user's requested mood or activity.
  You should pick 15 songs that perfectly match the vibe.
  
  CRITICAL: Return the result as raw, valid JSON only. Do not use Markdown formatting.
  
  Use this exact JSON structure for your output:
  {
    "playlist_title": "Creative Title",
    "mood": "The mood requested",
    "description": "Short description of the vibe",
    "songs": [
      {
        "title": "Song Title",
        "artist": "Artist Name",
        "estimated_vibe": {
          "energy": "Low" | "Medium" | "High" | "Explosive",
          "mood": "Adjective (e.g. Uplifting, Melancholic)",
          "genre_hint": "Specific Sub-genre"
        }
      }
    ]
  }

  CRITICAL RULES:
  1. The songs should be real and findable on Spotify/iTunes.
  2. If "User Taste" is provided: Use it as a stylistic compass. Find "Hidden Gems" that match their taste profile but offer true discovery.
  3. If "Exclusion List" is provided: Do NOT include any of the songs listed.
  4. "estimated_vibe": Use your knowledge of the song to estimate its qualitative feel. Do not invent fake numeric metrics.`;

  let prompt = `Create a playlist for the mood: "${mood}".`;
  
  if (userContext) {
    if (userContext.country) prompt += ` The user is in ${userContext.country}.`;
    if (userContext.explicit_filter_enabled) prompt += ` Please avoid explicit content if possible.`;
  }

  // INJECT TASTE (PERSONALIZATION)
  if (tasteProfile) {
    prompt += `\n\nUSER TASTE PROFILE (Session Context - Use for style adaptation, but prioritize discovery):`;
    
    if (tasteProfile.topArtists.length > 0) {
      prompt += `\n- Top Artists they like: ${tasteProfile.topArtists.slice(0, 30).join(', ')}`;
    }
    
    if (tasteProfile.topGenres.length > 0) {
      prompt += `\n- Top Genres: ${tasteProfile.topGenres.join(', ')}`;
    }

    // REVERTED: Removed topTracks injection
  }

  // INJECT EXCLUSIONS (REMIX LOGIC)
  if (excludeSongs && excludeSongs.length > 0) {
    prompt += `\n\nEXCLUSION LIST (The user just saw these, do NOT repeat them):
    ${excludeSongs.join(', ')}`;
  }

  const t_prompt_end = performance.now();
  const promptBuildTimeMs = Math.round(t_prompt_end - t_prompt_start);

  // MEASURE STEP D: API Call
  const t_api_start = performance.now();

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
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
    }
  });

  const t_api_end = performance.now();
  const geminiApiTimeMs = Math.round(t_api_end - t_api_start);

  if (response.text) {
      // CLEANUP: Remove potential markdown wrapping before parsing
      const cleanText = response.text.replace(/```json|```/g, '').trim();
      const rawData = JSON.parse(cleanText) as GeneratedPlaylistRaw;
      return {
          ...rawData,
          promptText: prompt,
          metrics: {
              promptBuildTimeMs,
              geminiApiTimeMs
          }
      };
  }
  
  throw new Error("Failed to generate playlist content");
};

export const transcribeAudio = async (base64Audio: string, mimeType: string): Promise<string> => {
    if (!process.env.API_KEY) {
        throw new Error("API Key missing");
    }

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
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
                text: "Transcribe the following audio exactly as spoken. Do not translate it. Return only the transcription text, no preamble."
            }
        ]
    });

    return response.text || "";
};

// --- NEW: ANALYZE USER TASTE (DEBUGGER FEATURE) ---
export const analyzeUserTopTracks = async (tracks: string[]) => {
    if (!process.env.API_KEY) throw new Error("API Key missing");
    if (!tracks || tracks.length === 0) return { error: "No tracks to analyze" };

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const model = "gemini-2.5-flash";

    const trackList = tracks.join('\n');
    
    const systemInstruction = `You are a music analysis engine. 
    Analyze the provided list of songs.
    
    For each song, return a JSON object with these exact fields:
    - song: The input song title/artist
    - genre: Specific sub-genre (e.g. "Dream Pop", "Techno", "Trap")
    - energy: Low, Medium, High, or Explosive
    - mood: Joyful, Melancholic, Aggressive, Calm, or Romantic
    - tempo: Downtempo, Mid-Tempo, or Uptempo
    - vocals: Instrumental, Minimal, or Lyrical
    - texture: Organic, Electric, or Synthetic
    
    Return the result as a raw JSON array.`;

    const prompt = `Here are the songs:\n${trackList}`;

    const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
            systemInstruction,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 0 }
        }
    });

    if (response.text) {
        return JSON.parse(response.text.replace(/```json|```/g, '').trim());
    }
    return { error: "Failed to analyze" };
};