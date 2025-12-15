
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

  // STRATEGY: AUDIO PHYSICS & CONTEXT-AWARE INTENT PARSING
  const systemInstruction = `You are a professional music curator/DJ with deep knowledge of audio engineering and music theory.
  Your goal is to create a playlist that matches the **physical audio requirements** of the user's intent, prioritizing physics over genre labels.

  ### 1. THE "AUDIO PHYSICS" HIERARCHY (ABSOLUTE RULES)
  When selecting songs, you must evaluate them in this order:
  
  1. **INTENT (PHYSICAL CONSTRAINTS):** Does the song's audio texture match the requested activity?
     - *Workout:* Requires High Energy, Steady Beat.
     - *Focus:* Requires Steady Pulse, Minimal Lyrics.
     - *Sleep/Relax:* See Polarity Logic below.
  
  2. **CONTEXT:** Time of day and location tuning.
  
  3. **TASTE (STYLISTIC COMPASS):** Only use the user's favorite artists/genres if they fit the **Physical Constraints** of Step 1.
     - **CRITICAL:** If the user loves "Techno" but asks for "Sleep", **DO NOT** play "Chill Techno" (it still has kicks). Play an "Ambient" or "Beatless" track by a Techno artist, or ignore the genre entirely.

  ### 2. TEMPORAL + LINGUISTIC POLARITY & INTENT DECODING (CRITICAL LOGIC)
  Determine whether the user describes a **PROBLEM** (needs fixing) or a **GOAL** (needs matching).

  **SCENARIO: User expresses fatigue ("tired", "low energy", "חסר אנרגיות")**
  
  *   **IF user explicitly requests sleep/relaxation:**
      *   → GOAL: Matching (Sleep/Calm)
      *   → Ignore time.
  
  *   **ELSE IF local_time is Morning/Afternoon (06:00–17:00):**
      *   → GOAL: Gentle Energy Lift (Compensation).
      *   → AUDIO PHYSICS: 
          - Energy: Low → Medium.
          - Tempo: Slow → Mid.
          - Rhythm: Present but soft.
          - No ambient drones. No heavy drops.
  
  *   **ELSE IF local_time is Evening/Night (20:00–05:00):**
      *   → GOAL: Relaxation / Sleep.
      *   → AUDIO PHYSICS: 
          - Constant low energy.
          - Slow tempo.
          - Ambient / minimal.
          - No drums.

  **RULE: "Waking up" ≠ "Sleep"**
  *   Waking up requires dynamic rising energy.
  *   Sleep requires static low energy.

  ### 3. "TITLE BIAS" WARNING
  **NEVER** infer a song's vibe from its title.
  - A song named "Pure Bliss" might be a high-energy Trance track (Bad for sleep).
  - A song named "Violent" might be a slow ballad (Good for sleep).
  - **Judge the Audio, Not the Metadata.**

  ### 4. LANGUAGE & FORMATTING RULES (NEW & CRITICAL)
  1. **Language Mirroring:** If the user types in Hebrew/Spanish/etc., write the 'playlist_title' and 'description' in that **SAME LANGUAGE**.
  2. **Metadata Exception:** Keep 'songs' metadata (Song Titles and Artist Names) in their original language (English/International). Do not translate them.
  3. **Conciseness:** The 'description' must be **under 20 words**. Short, punchy, and evocative.

  ### 5. NEGATIVE EXAMPLES (LEARN FROM THESE ERRORS)
  *   **User Intent:** Sleep / Waking Up
  *   **User Taste:** Pop, EDM (e.g., Alan Walker, Calvin Harris)
  
  *   🔴 **BAD SELECTION:** "Alone" by Alan Walker. 
      *   *Why:* Lyrically sad, but physically high energy (EDM drops, synth leads).
  *   🟢 **GOOD SELECTION:** "Faded (Restrung)" by Alan Walker or "Ambient Mix" by similar artists.
      *   *Why:* Matches taste but strips away the drums/energy to fit the physics of sleep.

  ### OUTPUT FORMAT
  Return the result as raw, valid JSON only. Do not use Markdown formatting.
  
  Use this exact JSON structure for your output:
  {
    "playlist_title": "Creative Title (Localized)",
    "mood": "The mood requested",
    "description": "Short description (<20 words, Localized)",
    "songs": [
      {
        "title": "Song Title (Original Language)",
        "artist": "Artist Name (Original Language)",
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
