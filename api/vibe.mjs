
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";

const GEMINI_MODEL = 'gemini-2.5-flash';

export default async function handler(req, res) {
  const t_handler_start = Date.now();
  console.log(`[API/VIBE] Handler started at ${new Date().toISOString()}. Region: ${process.env.VERCEL_REGION || 'unknown'}`);

  if (req.method !== 'POST') {
    console.warn(`[API/VIBE] Method not allowed: ${req.method}`);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- API KEY VALIDATION ---
  const API_KEY = process.env.API_KEY; // Capture it here
  if (!API_KEY) { // Use the captured value
    console.error("[API/VIBE] API_KEY environment variable is not set or is empty.");
    return res.status(401).json({ error: 'API_KEY environment variable is missing from serverless function. Please ensure it is correctly configured in your deployment environment (e.g., Vercel environment variables or AI Studio settings).' });
  }
  // --- END API KEY VALIDATION ---

  const { mood, contextSignals, tasteProfile, excludeSongs, promptText } = req.body; // Receive promptText from client

  console.log(`[API/VIBE] Incoming request for mood: "${mood}"`);
  console.log(`[API/VIBE] Context Signals: ${JSON.stringify(contextSignals)}`);
  console.log(`[API/VIBE] Taste Profile provided: ${!!tasteProfile}`);
  console.log(`[API/VIBE] Exclude Songs count: ${excludeSongs ? excludeSongs.length : 0}`);
  console.log(`[API/VIBE] Using GEMINI_MODEL: ${GEMINI_MODEL}`);

  if (!mood) {
    console.error("[API/VIBE] Missing mood parameter.");
    return res.status(400).json({ error: 'Missing mood parameter' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY }); // Use the validated API_KEY
    console.log("[API/VIBE] DEBUG: GoogleGenAI client initialized.");
    
    const systemInstruction = `You are a professional music curator/Mood-driven playlists with deep knowledge of audio engineering and music theory.
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

    console.log("[API/VIBE] Sending prompt to Gemini. Prompt Text (first 500 chars):", promptText.substring(0, 500));
    const t_api_start = Date.now();
    let geminiResponseText = "";
    
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: promptText, // Use promptText received from client
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
      geminiResponseText = response.text; // Assign to outer variable
    } catch (geminiError: any) {
      console.error("[API/VIBE] Error calling Gemini API:", geminiError);
      console.error(`[API/VIBE] Gemini Error Details: Name=${geminiError.name}, Message=${geminiError.message}`);
      // Log the full error object for more details
      console.error("[API/VIBE] Gemini Error Object:", JSON.stringify(geminiError, null, 2));
      if (geminiError.stack) {
        console.error("[API/VIBE] Gemini Error Stack:", geminiError.stack);
      }
      throw new Error(`Gemini API Error: ${geminiError.message || 'Unknown Gemini error'}`);
    }

    const t_api_end = Date.now();
    console.log(`[API/VIBE] Gemini API call completed in ${t_api_end - t_api_start}ms.`);
    console.log("[API/VIBE] Raw Gemini Response Text (first 500 chars):", geminiResponseText ? geminiResponseText.substring(0, 500) : "No text received.");
    
    if (geminiResponseText) {
      try {
        const cleanText = geminiResponseText.replace(/```json|```/g, '').trim();
        const rawData = JSON.parse(cleanText);
        console.log("[API/VIBE] Successfully parsed Gemini response.");
        
        const t_handler_end = Date.now();
        console.log(`[API/VIBE] Handler finished successfully in ${t_handler_end - t_handler_start}ms.`);
        
        return res.status(200).json({
          ...rawData,
          metrics: {
            geminiApiTimeMs: t_api_end - t_api_start
          }
        });
      } catch (parseError: any) {
        console.error("[API/VIBE] Error parsing Gemini response JSON:", parseError);
        console.error(`[API/VIBE] Parsing Error Details: Name=${parseError.name}, Message=${parseError.message}`);
        console.error("[API/VIBE] Malformed response text:", geminiResponseText);
        
        const t_handler_end = Date.now();
        console.log(`[API/VIBE] Handler finished with parsing error in ${t_handler_end - t_handler_start}ms.`);
        return res.status(500).json({ error: `Failed to parse AI response: ${parseError.message}` });
      }
    }

    console.error("[API/VIBE] Empty response from AI.");
    const t_handler_end = Date.now();
    console.log(`[API/VIBE] Handler finished with empty AI response in ${t_handler_end - t_handler_start}ms.`);
    throw new Error("Empty response from AI");
  } catch (error: any) {
    console.error("[API/VIBE] Vibe API Handler - Uncaught Error:", error);
    console.error(`[API/VIBE] Uncaught Error Details: Name=${error.name}, Message=${error.message}`);
    // Log the full error object for more details
    console.error("[API/VIBE] Uncaught Error Object:", JSON.stringify(error, null, 2));
    if (error.stack) {
      console.error("[API/VIBE] Uncaught Error Stack:", error.stack);
    }
    
    const t_handler_end = Date.now();
    console.log(`[API/VIBE] Handler finished with uncaught error in ${t_handler_end - t_handler_start}ms.`);
    return res.status(500).json({ error: error.message || 'Internal Server Error', serverErrorName: error.name || 'UnknownServerError' });
  }
}