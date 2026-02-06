

import { config as dotenvConfig } from 'dotenv';
import { GoogleGenAI } from "@google/genai";

// Load environment variables from .env file (for local development)
dotenvConfig();

const GEMINI_MODEL = 'gemini-2.5-flash';
const TRANSCRIPTION_PROMPT_TEXT = "Transcribe the following audio exactly as spoken. Do not translate it. Return only the transcription text, no preamble.";
const ACOUSTIC_DURATION_THRESHOLD_MS = 800; // Minimum duration for valid speech signal

/**
 * Classifies raw Gemini transcription output into 'ok', 'no_speech', or 'error'.
 * This function enforces the transcription contract at the server boundary.
 * @param {string} rawText - The raw text received from the Gemini API.
 * @param {string} promptTextSentToModel - The exact prompt text that was sent to the Gemini API for transcription.
 * @returns {import("../types").TranscriptionResult} - Structured transcription result.
 */
function classifyTranscription(rawText, promptTextSentToModel) {
  const trimmedText = rawText.trim();
  const lowerCaseTrimmedText = trimmedText.toLowerCase();

  // Condition 1: Empty or whitespace
  if (trimmedText === "") {
    console.log("[API/TRANSCRIBE] Text Factor B failed: Empty or whitespace output. Returning 'no_speech'.");
    return { status: 'no_speech', reason: "No discernible speech detected in the audio." };
  }

  // Condition 2: Prompt-echoing or explicit 'no speech' phrases from Gemini
  const lowerCasePrompt = promptTextSentToModel.toLowerCase().trim();

  if (lowerCaseTrimmedText === lowerCasePrompt || // Exact echo of the prompt
      lowerCaseTrimmedText.includes("i cannot transcribe") ||
      lowerCaseTrimmedText.includes("no discernible speech") ||
      lowerCaseTrimmedText.includes("there was no speech detected") ||
      lowerCaseTrimmedText.includes("no speech was detected") ||
      lowerCaseTrimmedText.includes("the audio was silent") ||
      lowerCaseTrimmedText.includes("i could not understand the audio") ||
      lowerCaseTrimmedText.includes("no audio input received")
  ) {
    console.log(`[API/TRANSCRIBE] Text Factor B failed: Model output includes instruction-like or 'no speech' patterns. Raw output: "${rawText.substring(0, 100)}...". Returning 'no_speech'.`);
    return { status: 'no_speech', reason: "No clear speech detected in the audio." };
  }

  // NEW Condition 3 (v2.2.3): Non-speech event filtering
  const eventTokenRegex = /\[.*?\]/g;
  const hasEventTokens = eventTokenRegex.test(trimmedText);
  const textWithoutEventTokens = trimmedText.replace(eventTokenRegex, '').trim();

  // Check 3.1: Output consists ONLY of event markers
  if (trimmedText.length > 0 && textWithoutEventTokens.length === 0 && hasEventTokens) {
      console.log("[API/TRANSCRIBE] Text Factor B failed: Output consists only of event markers. Returning 'no_speech'.");
      return { status: 'no_speech', reason: "No speech detected. Only environmental sounds or non-linguistic events." };
  }

  // Check 3.2: Output is dominated by bracketed tokens (more than 50% of non-whitespace characters)
  const allNonWhitespaceLength = trimmedText.replace(/\s/g, '').length;
  const eventTokenStrippedLength = textWithoutEventTokens.replace(/\s/g, '').length;
  const lengthOfEventTokens = allNonWhitespaceLength - eventTokenStrippedLength;

  if (allNonWhitespaceLength > 0 && (lengthOfEventTokens / allNonWhitespaceLength) > 0.5) {
      console.log("[API/TRANSCRIBE] Text Factor B failed: Output dominated by bracketed event tokens. Returning 'no_speech'.");
      return { status: 'no_speech', reason: "No clear speech detected. Input appears to be mostly environmental sounds or non-linguistic events." };
  }

  // Check 3.3: Repetitive non-lexical markers (e.g., "uh uh uh", "mmm mmm")
  const repetitiveNonLexicalRegex = /(uh|um|mm|ah|oh)\s*(\1\s*){1,}/i; // Detects "uh uh uh", "um um um", etc.
  if (repetitiveNonLexicalRegex.test(lowerCaseTrimmedText)) {
      console.log("[API/TRANSCRIBE] Text Factor B failed: Repetitive non-lexical markers detected. Returning 'no_speech'.");
      return { status: 'no_speech', reason: "No clear speech detected. Input contains repetitive non-linguistic sounds." };
  }

  // Check 3.4: Very short, non-linguistic input (e.g., just "uh", "mm", or single sounds)
  const words = textWithoutEventTokens.split(/\s+/).filter(Boolean); // Get actual words after removing events
  if (trimmedText.length < 5 && words.length < 2) { // Short raw text, very few actual words
    const commonFillers = ['uh', 'um', 'mm', 'oh', 'ah', 'er', 'hm'];
    // If all detected 'words' are common fillers, or the text without event tokens is extremely short
    if (words.every(word => commonFillers.includes(word.toLowerCase())) || textWithoutEventTokens.length < 3) {
        console.log("[API/TRANSCRIBE] Text Factor B failed: Very short non-linguistic input detected. Returning 'no_speech'.");
        return { status: 'no_speech', reason: "No discernible speech detected in the audio." };
    }
  }

  // Final Condition: Otherwise, it's valid speech
  console.log("[API/TRANSCRIBE] Text Factor B passed. Transcription classified as 'ok'.");
  return { status: 'ok', text: rawText };
}


export default async function handler(req, res) {
  const t_handler_start = Date.now();
  console.log(`[API/TRANSCRIBE] Handler started at ${new Date().toISOString()}. Region: ${process.env.VERCEL_REGION || 'unknown'}`);

  if (req.method !== 'POST') {
    console.warn(`[API/TRANSCRIBE] Method not allowed: ${req.method}`);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- API KEY VALIDATION ---
  const API_KEY = process.env.API_KEY; // Capture it here
  if (!API_KEY) { // Use the captured value
    console.error("[API/TRANSCRIBE] API_KEY environment variable is not set or is empty.");
    return res.status(401).json({ error: 'API_KEY environment variable is missing from serverless function. Please ensure it is correctly configured in your deployment environment (e.g., Vercel environment variables or AI Studio settings).' });
  }
  // --- END API KEY VALIDATION ---

  // NEW: Destructure acousticMetadata from the request body
  const { base64Audio, mimeType, acousticMetadata } = req.body;

  console.log(`[API/TRANSCRIBE] Incoming request for transcription.`);
  console.log(`[API/TRANSCRIBE] Audio MIME Type: "${mimeType}", Data length: ${base64Audio ? base64Audio.length : 0}`);
  console.log(`[API/TRANSCRIBE] Acoustic Metadata: ${JSON.stringify(acousticMetadata)}`); // Log acoustic metadata
  console.log(`[API/TRANSCRIBE] Using GEMINI_MODEL: ${GEMINI_MODEL}`);

  if (!base64Audio) {
    console.error("[API/TRANSCRIBE] Missing audio data for transcription.");
    // Return structured error for missing audio data
    return res.status(400).json({ status: 'error', reason: 'Missing audio data for transcription.' });
  }

  // v2.2.4 - FACTOR A: ACOUSTIC SIGNAL CHECK (Server-side authoritative)
  // Ensure acousticMetadata is present, otherwise assume no speech signal
  const effectiveAcousticMetadata = acousticMetadata || { durationMs: 0, speechDetected: false };
  const acousticFactorA_pass = effectiveAcousticMetadata.speechDetected && effectiveAcousticMetadata.durationMs >= ACOUSTIC_DURATION_THRESHOLD_MS;

  if (!acousticFactorA_pass) {
    console.log(`[API/TRANSCRIBE] Acoustic Factor A failed. Speech detected: ${effectiveAcousticMetadata.speechDetected}, Duration: ${effectiveAcousticMetadata.durationMs}ms (Threshold: ${ACOUSTIC_DURATION_THRESHOLD_MS}ms). Returning 'no_speech' regardless of Gemini output.`);
    const t_handler_end = Date.now();
    console.log(`[API/TRANSCRIBE] Handler finished with 'no_speech' due to acoustic factor in ${t_handler_end - t_handler_start}ms.`);
    return res.status(200).json({ status: 'no_speech', reason: "No sufficient speech signal detected in the audio." });
  }

  // If acoustic factor passes, proceed with Gemini transcription and text-based classification (Factor B)
  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY }); // Use the validated API_KEY
    console.log("[API/TRANSCRIBE] DEBUG: GoogleGenAI client initialized.");
    
    // Use the defined constant prompt text
    console.log("[API/TRANSCRIBE] Transcription Prompt:", TRANSCRIPTION_PROMPT_TEXT);

    let geminiResponseText = "";
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          { inlineData: { mimeType: mimeType, data: base64Audio } },
          { text: TRANSCRIPTION_PROMPT_TEXT }
        ],
        config: {
          thinkingConfig: { thinkingBudget: 0 }
        }
      });
      geminiResponseText = response.text;
    } catch (geminiError) {
      console.error("[API/TRANSCRIBE] Error calling Gemini API for transcription:", geminiError);
      console.error(`[API/TRANSCRIBE] Gemini Error Details: Name=${(geminiError).name}, Message=${(geminiError).message}`);
      console.error("[API/TRANSCRIBE] Gemini Error Object:", JSON.stringify(geminiError, null, 2));
      if ((geminiError).stack) {
        console.error("[API/TRANSCRIBE] Gemini Error Stack (transcription):", (geminiError).stack);
      }
      // Map Gemini API errors to structured error response
      const t_handler_end = Date.now();
      console.log(`[API/TRANSCRIBE] Handler finished with Gemini API error in ${t_handler_end - t_handler_start}ms.`);
      return res.status(500).json({ status: 'error', reason: `Gemini API Error: ${(geminiError).message || 'Unknown Gemini error'}` });
    }

    console.log("[API/TRANSCRIBE] Raw Gemini Response Text (Transcription - first 500 chars):", geminiResponseText ? geminiResponseText.substring(0, 500) : "No text received.");
    
    // Classify the transcription result using text heuristics (Factor B)
    const textQualityResult = classifyTranscription(geminiResponseText || "", TRANSCRIPTION_PROMPT_TEXT);

    const t_handler_end = Date.now();
    console.log(`[API/TRANSCRIBE] Handler finished successfully in ${t_handler_end - t_handler_start}ms. Final status: '${textQualityResult.status}'.`);
    return res.status(200).json(textQualityResult); // Return the structured result from text quality
    // Note: If acousticFactorA_pass was false, this part would not be reached.
    // The previous check already returned 'no_speech'.

  } catch (error) {
    console.error("[API/TRANSCRIBE] Transcribe API Handler - Uncaught Error:", error);
    console.error(`[API/TRANSCRIBE] Uncaught Error Details: Name=${(error).name}, Message=${(error).message}`);
    console.error("[API/TRANSCRIBE] Uncaught Error Object:", JSON.stringify(error, null, 2));
    if ((error).stack) {
      console.error("[API/TRANSCRIBE] Uncaught Error Stack:", (error).stack);
    }
    
    const t_handler_end = Date.now();
    console.log(`[API/TRANSCRIBE] Handler finished with uncaught error in ${t_handler_end - t_handler_start}ms.`);
    // Map uncaught errors to structured error response
    return res.status(500).json({ status: 'error', reason: (error).message || 'Internal Server Error' });
  }
}
