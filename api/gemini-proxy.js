import { GoogleGenAI, GenerateContentResponse, Chat } from "@google/genai";

// Helper function to extract base64 data from a data URL string
function extractBase64Data(dataUrl) {
  const parts = dataUrl.split(',');
  if (parts.length > 1) {
    return parts[1];
  }
  return dataUrl; // Assume it's already base64 if no comma
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // CRITICAL RISK: API Key Accountability. This key must be set in Vercel Environment Variables.
  // Proof: Per @google/genai guidelines, API key must be process.env.API_KEY
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured in serverless environment.' });
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  try {
    const { 
      type, // 'generateContent', 'transcribeAudio', 'analyzeUserPlaylistsForMood', 'analyzeUserTopTracks'
      model, 
      contents, 
      config, 
      systemInstruction, 
      responseMimeType, 
      responseSchema, 
      safetySettings, 
      thinkingConfig, 
      tools,
      chatHistory, // For chat sessions
      message, // For chat sessions
    } = req.body;

    const t_api_start = performance.now();
    let response;
    let textResult;
    let isStreaming = false;

    if (type === 'generateContent' || type === 'analyzeUserPlaylistsForMood' || type === 'analyzeUserTopTracks') {
      // Common parameters for models.generateContent
      const generateParams = {
        model,
        contents,
        config: {
          ...config,
          systemInstruction,
          responseMimeType,
          responseSchema,
          safetySettings,
          thinkingConfig,
          tools,
        },
      };

      if (req.headers['x-gemini-stream'] === 'true') {
        isStreaming = true;
        res.setHeader('Content-Type', 'text/plain'); // For streaming, we send chunks of text
        res.setHeader('Transfer-Encoding', 'chunked');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        const streamResponse = await ai.models.generateContentStream(generateParams);
        for await (const chunk of streamResponse) {
          const c = chunk;
          if (c.text) {
            res.write(c.text); // Send text chunks directly
          }
        }
        res.end();
        return; // Exit as streaming response is handled
      } else {
        response = await ai.models.generateContent(generateParams);
        textResult = response.text;
      }
    } else if (type === 'transcribeAudio') {
      const { base64Audio, mimeType } = contents;
      const inlineDataContent = {
        inlineData: {
          mimeType: mimeType,
          data: extractBase64Data(base64Audio), // Ensure raw base64
        },
      };
      
      response = await ai.models.generateContent({
        model,
        contents: [inlineDataContent, { text: "Transcribe the following audio exactly as spoken. Do not translate it. Return only the transcription text, no preamble." }],
        config: { thinkingConfig: { thinkingBudget: 0 } }, // Explicitly disable thinking for transcription
      });
      textResult = response.text;
    } else if (type === 'chatSendMessage') {
      const chat = ai.chats.create({
        model,
        config: {
          ...config,
          systemInstruction,
          safetySettings,
          thinkingConfig,
        },
        history: chatHistory,
      });

      if (req.headers['x-gemini-stream'] === 'true') {
        isStreaming = true;
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Transfer-Encoding', 'chunked');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const streamResponse = await chat.sendMessageStream({ message });
        for await (const chunk of streamResponse) {
          const c = chunk;
          if (c.text) {
            res.write(c.text);
          }
        }
        res.end();
        return;
      } else {
        response = await chat.sendMessage({ message });
        textResult = response.text;
      }
    } else {
      return res.status(400).json({ error: 'Unsupported Gemini operation type' });
    }

    const t_api_end = performance.now();
    const geminiApiTimeMs = Math.round(t_api_end - t_api_start);

    // For non-streaming requests, respond with JSON
    if (!isStreaming) {
      res.status(200).json({
        text: textResult,
        geminiApiTimeMs: geminiApiTimeMs,
      });
    }

  } catch (error) {
    console.error('Gemini API proxy error:', error);
    // Attempt to extract more specific error message from the Gemini SDK
    let errorMessage = 'An unknown error occurred with the Gemini API.';
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (error && typeof error === 'object' && 'message' in error) {
      errorMessage = (error as any).message;
    }
    res.status(500).json({ error: errorMessage });
  }
}