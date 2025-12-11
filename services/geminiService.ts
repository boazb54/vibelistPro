
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { GeminiResponseWithMetrics, GeneratedPlaylistRaw } from "../types";

export const generatePlaylistFromMood = async (
  mood: string, 
  userContext?: { country?: string, explicit_filter_enabled?: boolean },
  tasteProfile?: { topArtists: string[], topGenres: string[] },
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
  // We inject instructions to use the taste profile as a compass, not a map.
  const systemInstruction = `You are a professional music curator/DJ with deep knowledge of music across all genres.
  Your goal is to create a perfect playlist for the user's requested mood or activity.
  You should pick 15 songs that perfectly match the vibe.
  
  CRITICAL: Return the result as raw, valid JSON only. Do not use Markdown formatting (no \`\`\`json or backticks). Do not include any text before or after the JSON object.
  
  Use this exact JSON structure for your output:
  {
    "playlist_title": "Creative Title",
    "mood": "The mood requested",
    "description": "Short description of the vibe",
    "songs": [
      {
        "title": "Song Title",
        "artist": "Artist Name"
      }
    ]
  }

  CRITICAL RULES:
  1. The songs should be real and findable on Spotify/iTunes.
  2. If "User Taste" is provided: Use it as a stylistic compass to understand the user's preferred energy. Do NOT just list the user's top artists. Find "Hidden Gems", B-sides, and adjacent artists that match their taste profile but offer true discovery.
  3. If "Exclusion List" is provided: Do NOT include any of the songs listed. The user has already seen them and wants something new (Remix Mode).`;

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
      thinkingConfig: { thinkingBudget: 0 }, // <--- THE FIX: FORCE DISABLE THINKING
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
