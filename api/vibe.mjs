import { GoogleGenAI, HarmCategory, HarmBlockThreshold, Type } from "@google/genai";
import { GEMINI_MODEL } from "../constants";

// --- START: VERY EARLY DIAGNOSTIC LOG (v1.2.3) ---
// This log runs when the module is first loaded by the Node.js runtime on Vercel.
// If this doesn't appear in logs, it indicates a failure before our code even starts.
console.log(`[API/VIBE] Module loaded successfully at ${new Date().toISOString()}.`);
// --- END: VERY EARLY DIAGNOSTIC LOG (v1.2.3) ---

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
  console.log(`[API/VIBE] API Key Status: ${API_KEY ? 'Present' : 'Missing'}. First 5 chars: ${API_KEY ? API_KEY.substring(0, 5) : 'N/A'}`);
  // --- END API KEY VALIDATION ---

  const { mood, contextSignals, isAuthenticated, tasteProfile, excludeSongs, promptText } = req.body; // Receive promptText and isAuthenticated flag from client

  console.log(`[API/VIBE] Incoming request for mood: "${mood}" (Authenticated: ${isAuthenticated})`);
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

    // --- STAGE 1: Mood Validation (Absorbed from api/validate.mjs) ---
    const validationSystemInstruction = `You are an AI gatekeeper for a music playlist generator. Your task is to validate a user's input based on whether it's a plausible request for a music vibe.

You must classify the input into one of three categories:
1.  'VIBE_VALID': The input describes a mood, activity, memory, or scenario suitable for music (e.g., "rainy day", "post-breakup", "coding at 2am", "שמח"). This is the most common case.
2.  'VIBE_INVALID_GIBBERISH': The input is nonsensical, random characters, or keyboard mashing (e.g., "asdfasdf", "jhgjhgj").
3.  'VIBE_INVALID_OFF_TOPIC': The input is a coherent question or statement but is NOT about a mood or music (e.g., "what's the weather", "tell me a joke", "מתכון לעוגה").

RULES:
1.  Provide a concise, user-friendly 'reason' for your decision.
2.  **LANGUAGE MIRRORING (CRITICAL):** The 'reason' MUST be in the same language as the user's input.
3.  Return ONLY a raw JSON object matching the schema.`;

    console.log("[API/VIBE] Performing mood validation...");
    const t_validation_api_start = Date.now();
    const validationResponse = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: `Validate the following user input: "${mood}"`,
        config: {
            systemInstruction: validationSystemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    validation_status: { type: Type.STRING },
                    reason: { type: Type.STRING }
                },
                required: ["validation_status", "reason"]
            },
            thinkingConfig: { thinkingBudget: 0 },
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
            ],
        }
    });
    const t_validation_api_end = Date.now();
    const validationData = JSON.parse(validationResponse.text);
    console.log(`[API/VIBE] Validation status: ${validationData.validation_status}`);

    if (validationData.validation_status !== 'VIBE_VALID') {
        const t_handler_end = Date.now();
        console.log(`[API/VIBE] Handler finished with validation error in ${t_handler_end - t_handler_start}ms.`);
        return res.status(200).json({
            validation_status: validationData.validation_status,
            reason: validationData.reason,
            metrics: { geminiApiTimeMs: t_validation_api_end - t_validation_api_start }
        });
    }

    // --- STAGE 2: Teaser or Full Playlist Generation ---
    let systemInstruction;
    let geminiContent;
    let responseSchema = {};
    let isFullPlaylistGeneration = false;

    if (!isAuthenticated) {
        // Teaser Generation (Absorbed from api/teaser.mjs)
        console.log("[API/VIBE] Generating playlist teaser...");
        systemInstruction = `You are a creative music curator. Your goal is to generate a creative, evocative playlist title and a short, compelling description.

RULES:
1.
