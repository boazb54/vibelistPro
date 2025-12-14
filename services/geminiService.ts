
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { GeminiResponseWithMetrics, GeneratedPlaylistRaw, AnalyzedTrack, ContextualSignals, UserTasteProfile } from "../types";

export const generatePlaylistFromMood = async (
  mood: string, 
  contextSignals: ContextualSignals,
  tasteProfile?: UserTasteProfile,
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

  // STRATEGY: CONTEXT-AWARE INTENT PARSING
  const systemInstruction = `You are a professional music curator/DJ with deep knowledge of music across all genres.
  Your goal is to create a perfect playlist based on the user's intent.

  CRITICAL PRIORITY RULES (Intent > Context > Taste):
  1. USER INTENT (The 'query'): This is absolute. If they ask for "Party", give them party music, even if their history is only classical.
  2. CONTEXT (Time/Device/Lang): Use this to fine-tune the vibe. 
     - "Party" at 8 AM (local_time) -> "Morning Energy" / Funk / Soul.
     - "Focus" on "Mobile" -> Shorter, more engaging tracks.
     - "Text" input -> Follow literally. "Voice" input -> Interpret the emotion more loosely.
  3. TASTE BIAS: Use the user's history ONLY as a stylistic compass to pick songs they might like *within* the requested genre. Do not let taste override the requested mood.

  OUTPUT FORMAT:
  Return the result as raw, valid JSON only. Do not use Markdown formatting.
  
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
  1. Pick 15 songs.
  2. The songs must be real and findable on Spotify/iTunes.
  3. If "Exclusion List" is provided: Do NOT include any of the songs listed.
  4. "estimated_vibe": Use your knowledge of the song to estimate its qualitative feel.
  `;

  // NEW: STRUCTURED PROMPT PAYLOAD
  // We package everything into a JSON object so the model understands the relationships.
  const promptPayload = {
      user_target: {
          query: mood,
          modality: contextSignals.input_modality
      },
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
          // We provide the semantic profile if available for deeper alignment
          vibe_fingerprint: tasteProfile.session_analysis 
            ? { 
                energy: tasteProfile.session_analysis.energy_bias, 
                favored_genres: tasteProfile.session_analysis.dominant_genres 
              } 
            : null
      } : null,
      exclusions: excludeSongs || []
  };

  const prompt = JSON.stringify(promptPayload, null, 2);

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
          promptText: prompt, // We save the JSON string as the prompt text for debugging
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
export const analyzeUserTopTracks = async (tracks: string[]): Promise<AnalyzedTrack[] | { error: string }> => {
    if (!process.env.API_KEY) throw new Error("API Key missing");
    if (!tracks || tracks.length === 0) return { error: "No tracks to analyze" };

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const model = "gemini-2.5-flash";

    const trackList = tracks.join('\n');
    
    // UPDATED SCHEMA INSTRUCTION BASED ON USER SPECIFICATION
    const systemInstruction = `You are a music analysis engine. 
    Analyze the provided list of songs.
    
    For each song, return a JSON object using this exact schema:
    {
      "song_name": "Song Name",
      "artist_name": "Artist Name",
      "semantic_tags": {
        "primary_genre": "specific genre (lowercase)",
        "secondary_genres": ["genre1", "genre2"],
        "energy": "low" | "medium" | "high" | "explosive",
        "mood": ["mood1", "mood2"],
        "tempo": "slow" | "mid" | "fast",
        "vocals": "instrumental" | "lead_vocal" | "choral",
        "texture": "organic" | "electric" | "synthetic"
      },
      "confidence": "low" | "medium" | "high"
    }

    RULES:
    1. Split the input string (e.g. "Song by Artist") into "song_name" and "artist_name".
    2. Normalize values: Use lowercase, controlled vocabulary only.
    3. Use arrays for attributes that can be multiple (mood, secondary_genres).
    4. Interpret attributes as soft signals, not absolute facts.
    
    Return the result as a raw JSON array.`;

    const prompt = `Here are the songs to analyze:\n${trackList}`;

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
