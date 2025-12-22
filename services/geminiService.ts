
import { HarmCategory, HarmBlockThreshold, Type } from "@google/genai";
import { GeminiResponseWithMetrics, GeneratedPlaylistRaw, AnalyzedTrack, ContextualSignals, UserTasteProfile, UserPlaylistMoodAnalysis } from "../types";
import { GEMINI_MODEL } from "../constants";

// Helper for making API calls to the proxy
async function callGeminiProxy<T>(payload: any, expectsJson: boolean = false, isStreaming: boolean = false): Promise<T> {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (isStreaming) {
    headers['X-Gemini-Stream'] = 'true';
  }

  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorDetail = 'Unknown error';
    try {
      const errorJson = await response.json();
      errorDetail = errorJson.error || errorDetail;
    } catch (e) {
      errorDetail = await response.text();
    }
    throw new Error(`Gemini proxy failed (${response.status}): ${errorDetail}`);
  }

  if (isStreaming) {
    // For streaming, the proxy directly writes to the response stream
    // The client-side function must handle the ReadableStream directly
    return response.body as T;
  }

  const jsonResponse = await response.json();
  if (expectsJson) {
    // For responses that are expected to be JSON, the proxy returns text which we then parse.
    // The proxy might return raw JSON string in 'text' field, or a parsed object.
    return JSON.parse(jsonResponse.text) as T;
  }
  return jsonResponse as T;
}

// NEW: Analyze User Playlists for overall mood
export const analyzeUserPlaylistsForMood = async (playlistTracks: string[]): Promise<UserPlaylistMoodAnalysis | null> => {
    if (!playlistTracks || playlistTracks.length === 0) return null;

    const systemInstruction = `You are an expert music psychologist and mood categorizer.
    Your task is to analyze a list of song titles and artists, representing a user's collection of personal playlists.
    Based on this combined list, infer the overarching, most dominant "mood category" that these playlists collectively represent.
    Also, provide a confidence score for your categorization.

    RULES:
    1. The 'playlist_mood_category' should be a concise, descriptive phrase (e.g., "High-Energy Workout Mix", "Relaxed Indie Vibes", "Chill Study Focus").
    2. The 'confidence_score' must be a floating-point number between 0.0 (very uncertain) and 1.0 (very certain).
    3. Return only raw, valid JSON matching the specified schema.

    OUTPUT FORMAT:
    {
      "playlist_mood_category": "string",
      "confidence_score": "number"
    }
    `;

    const prompt = `Analyze the collective mood represented by these songs from a user's playlists:\n${playlistTracks.join('\n')}`;

    try {
        const payload = {
            type: 'analyzeUserPlaylistsForMood',
            model: GEMINI_MODEL,
            contents: prompt,
            config: {
                systemInstruction,
                responseMimeType: "application/json",
                responseSchema: { // Define response schema for structured output
                    type: Type.OBJECT,
                    properties: {
                        playlist_mood_category: {
                            type: Type.STRING,
                            description: "A descriptive phrase for the overall mood of the user's combined playlists."
                        },
                        confidence_score: {
                            type: Type.NUMBER,
                            description: "A confidence score (0.0 to 1.0) for the mood categorization."
                        }
                    },
                    required: ["playlist_mood_category", "confidence_score"],
                    propertyOrdering: ["playlist_mood_category", "confidence_score"],
                },
                thinkingConfig: { thinkingBudget: 0 }
            }
        };

        return await callGeminiProxy<UserPlaylistMoodAnalysis>(payload, true);
    } catch (error) {
        console.error("Error analyzing user playlist mood:", error);
        throw error; // Re-throw to be caught in App.tsx for logging/handling
    }
};


export const generatePlaylistFromMood = async (
  mood: string, 
  contextSignals: ContextualSignals,
  tasteProfile?: UserTasteProfile,
  excludeSongs?: string[]
): Promise<GeminiResponseWithMetrics> => {
  
  const t_prompt_start = performance.now();

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
     - **NEW: DEEPER TASTE UNDERSTANDING:** If provided, leverage the 'user_playlist_mood' as a strong signal for the user's overall, inherent musical taste. This is *beyond* just top artists/genres and represents a more holistic "vibe fingerprint" for the user. Use it to fine-tune song selection, especially when there are multiple songs that fit the physical constraints.

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
          vibe_fingerprint: tasteProfile.session_analysis 
            ? { 
                energy: tasteProfile.session_analysis.energy_bias, 
                favored_genres: tasteProfile.session_analysis.dominant_genres 
              } 
            : null,
          user_playlist_mood: tasteProfile.playlistMoodAnalysis 
      } : null,
      exclusions: excludeSongs || []
  };

  const promptText = JSON.stringify(promptPayload, null, 2);

  const t_prompt_end = performance.now();
  const promptBuildTimeMs = Math.round(t_prompt_end - t_prompt_start);

  try {
      const payload = {
          type: 'generateContent',
          model: GEMINI_MODEL,
          contents: promptText, // Send the full prompt as contents
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
      };
      
      const proxyResponse = await callGeminiProxy<{text: string, geminiApiTimeMs: number}>(payload);
      
      if (proxyResponse.text) {
          const cleanText = proxyResponse.text.replace(/```json|```/g, '').trim();
          const rawData = JSON.parse(cleanText) as GeneratedPlaylistRaw;
          return {
              ...rawData,
              promptText: promptText, // Use the locally built prompt text
              metrics: {
                  promptBuildTimeMs,
                  geminiApiTimeMs: proxyResponse.geminiApiTimeMs // Use the time from the proxy
              }
          };
      }
      
      throw new Error("Failed to generate playlist content from proxy");

  } catch (error) {
      console.error("Error generating playlist via proxy:", error);
      throw error;
  }
};

export const transcribeAudio = async (base64Audio: string, mimeType: string): Promise<string> => {
    try {
        const payload = {
            type: 'transcribeAudio',
            model: GEMINI_MODEL,
            contents: { base64Audio, mimeType }, // Contents will be handled by proxy
        };
        const proxyResponse = await callGeminiProxy<{text: string}>(payload);
        return proxyResponse.text || "";
    } catch (error) {
        console.error("Error transcribing audio via proxy:", error);
        throw error;
    }
};

export const analyzeUserTopTracks = async (tracks: string[]): Promise<AnalyzedTrack[] | { error: string }> => {
    if (!tracks || tracks.length === 0) return { error: "No tracks to analyze" };

    const trackList = tracks.join('\n');
    
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

    try {
        const payload = {
            type: 'analyzeUserTopTracks',
            model: GEMINI_MODEL,
            contents: prompt,
            config: {
                systemInstruction,
                responseMimeType: "application/json",
                thinkingConfig: { thinkingBudget: 0 }
            }
        };

        return await callGeminiProxy<AnalyzedTrack[]>(payload, true);
    } catch (error) {
        console.error("Error analyzing top tracks via proxy:", error);
        throw error;
    }
};