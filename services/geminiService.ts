
import { GeminiResponseWithMetrics, GeneratedPlaylistRaw, AnalyzedTrack, ContextualSignals, UserTasteProfile, UserPlaylistMoodAnalysis } from "../types";
import { GEMINI_MODEL } from "../constants"; // GEMINI_MODEL is passed to the API routes, not used directly here

declare const addLog: (message: string) => void;

const API_REQUEST_TIMEOUT_MS = 60 * 1000; // Reverted to 60 seconds
const BILLING_DOCS_URL = "ai.google.dev/gemini-api/docs/billing";

// Helper to handle API key selection if needed
async function handleApiKeyMissingError(responseStatus: number, errorData: any) {
  if (responseStatus === 401 && errorData?.error?.includes('API_KEY environment variable is missing')) {
    addLog("API Key Missing (401). Attempting to prompt user for key selection.");
    if (typeof window !== 'undefined' && (window as any).aistudio && (window as any).aistudio.openSelectKey) {
      await (window as any).aistudio.openSelectKey();
      const userError = new Error(`Authentication Error: Gemini API key is missing or invalid. Please retry after selecting a valid API key from a paid GCP project. See billing info at ${BILLING_DOCS_URL}`);
      userError.name = 'ApiKeyRequiredError';
      throw userError;
    } else {
      const userError = new Error(`Authentication Error: Gemini API key is missing or invalid. Please ensure it's configured in your environment variables. See billing info at ${BILLING_DOCS_URL}`);
      userError.name = 'ApiKeyRequiredError';
      throw userError;
    }
  }
}

// NEW: Analyze User Playlists for overall mood
export const analyzeUserPlaylistsForMood = async (playlistTracks: string[]): Promise<UserPlaylistMoodAnalysis | null> => {
    if (!playlistTracks || playlistTracks.length === 0) {
        addLog("Skipping playlist mood analysis: No tracks provided.");
        return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);

    addLog(`Calling /api/analyze.mjs (playlists) with ${playlistTracks.length} tracks... (Timeout: ${API_REQUEST_TIMEOUT_MS / 1000}s)`);
    try {
        const response = await fetch('/api/analyze.mjs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'playlists', playlistTracks }),
            signal: controller.signal, // Pass the abort signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({})); // Attempt to parse error even if not JSON
            const errorMessage = errorData.error || response.statusText || JSON.stringify(errorData); // Capture more details
            addLog(`Error from /api/analyze.mjs (playlists): Status ${response.status} - ${response.statusText}, Data: ${JSON.stringify(errorData)}`);
            
            await handleApiKeyMissingError(response.status, errorData); // Check for API key issue

            const serverError = new Error(`Server error: ${errorMessage}`);
            serverError.name = errorData.serverErrorName || 'ServerError'; // Use server's error name if available
            (serverError as any).details = errorData; // Attach original error data for client-side debugging
            throw serverError;
        }

        const data = await response.json() as UserPlaylistMoodAnalysis;
        addLog(`Successfully analyzed playlist mood. Category: ${data.playlist_mood_category}`);
        return data;
    } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            const customError = new Error(`Client-side: Request timed out after ${API_REQUEST_TIMEOUT_MS / 1000}s.`);
            customError.name = 'ClientAbortError';
            addLog(`${customError.name}: ${customError.message}`);
            throw customError;
        } else if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
            const customError = new Error(`Client-side: Network connection error or CORS issue.`);
            customError.name = 'ClientNetworkError';
            addLog(`${customError.name}: ${customError.message}`);
            throw customError;
        } else {
            const msg = error.message || String(error);
            const customError = new Error(`Proxy call failed: ${msg}`);
            customError.name = error.name || 'UnknownClientError';
            addLog(`${customError.name}: ${customError.message}. Original: ${error.name || 'Unknown'}`);
            console.error("Error analyzing user playlist mood:", error);
            throw customError;
        }
    }
};


export const generatePlaylistFromMood = async (
  mood: string, 
  contextSignals: ContextualSignals,
  tasteProfile?: UserTasteProfile,
  excludeSongs?: string[]
): Promise<GeminiResponseWithMetrics> => {
  
  const t_prompt_start = performance.now();

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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);

  addLog(`Calling /api/vibe.mjs with mood "${mood}" and context... (Timeout: ${API_REQUEST_TIMEOUT_MS / 1000}s)`);
  try {
      const response = await fetch('/api/vibe.mjs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mood, contextSignals, tasteProfile, excludeSongs, promptText }), // Pass promptText to API for logging/metrics
          signal: controller.signal, // Pass the abort signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = errorData.error || response.statusText || JSON.stringify(errorData); // Capture more details
          addLog(`Error from /api/vibe.mjs: Status ${response.status} - ${response.statusText}, Data: ${JSON.stringify(errorData)}`);
          
          await handleApiKeyMissingError(response.status, errorData); // Check for API key issue

          const serverError = new Error(`Server error: ${errorMessage}`);
          serverError.name = errorData.serverErrorName || 'ServerError'; // Use server's error name if available
          (serverError as any).details = errorData; // Attach original error data
          throw serverError;
      }
      
      const rawData = await response.json() as GeneratedPlaylistRaw & { metrics: { geminiApiTimeMs: number } };
      addLog(`Playlist generation successful for mood "${mood}".`);
      return {
          ...rawData,
          promptText: promptText, // Use client-calculated promptText
          metrics: {
              promptBuildTimeMs,
              geminiApiTimeMs: rawData.metrics.geminiApiTimeMs // Server-calculated Gemini API time
          }
      };
  } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
          const customError = new Error(`Client-side: Request timed out after ${API_REQUEST_TIMEOUT_MS / 1000}s.`);
          customError.name = 'ClientAbortError';
          addLog(`${customError.name}: ${customError.message}`);
          throw customError;
      } else if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
          const customError = new Error(`Client-side: Network connection error or CORS issue.`);
          customError.name = 'ClientNetworkError';
          addLog(`${customError.name}: ${customError.message}`);
          throw customError;
      } else {
          const msg = error.message || String(error);
          const customError = new Error(`Proxy call failed: ${msg}`);
          customError.name = error.name || 'UnknownClientError';
          addLog(`${customError.name}: ${customError.message}. Original: ${error.name || 'Unknown'}`);
          console.error("Vibe generation failed through proxy:", error);
          throw customError;
      }
  }
};

export const transcribeAudio = async (base64Audio: string, mimeType: string): Promise<string> => {
    if (!base64Audio) {
        addLog("Skipping audio transcription: No audio data provided.");
        return "";
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);

    addLog(`Calling /api/transcribe.mjs with audio (length: ${base64Audio.length}, type: ${mimeType})... (Timeout: ${API_REQUEST_TIMEOUT_MS / 1000}s)`);
    try {
        const response = await fetch('/api/transcribe.mjs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64Audio, mimeType }),
            signal: controller.signal, // Pass the abort signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMessage = errorData.error || response.statusText || JSON.stringify(errorData); // Capture more details
            addLog(`Error from /api/transcribe.mjs: Status ${response.status} - ${response.statusText}, Data: ${JSON.stringify(errorData)}`);
            
            await handleApiKeyMissingError(response.status, errorData); // Check for API key issue

            const serverError = new Error(`Server error: ${errorMessage}`);
            serverError.name = errorData.serverErrorName || 'ServerError'; // Use server's error name if available
            (serverError as any).details = errorData; // Attach original error data
            throw serverError;
        }

        const data = await response.json();
        addLog(`Audio transcription successful. Text: "${data.text.substring(0, 50)}..."`);
        return data.text || "";
    } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            const customError = new Error(`Client-side: Audio transcription failed through proxy: Request timed out after ${API_REQUEST_TIMEOUT_MS / 1000}s.`);
            customError.name = 'ClientAbortError';
            addLog(`${customError.name}: ${customError.message}`);
            throw customError;
        } else if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
            const customError = new Error(`Client-side: Network connection error or CORS issue.`);
            customError.name = 'ClientNetworkError';
            addLog(`${customError.name}: ${customError.message}`);
            throw customError;
        } else {
            const msg = error.message || String(error);
            const customError = new Error(`Proxy call failed: ${msg}`);
            customError.name = error.name || 'UnknownClientError';
            addLog(`${customError.name}: ${customError.message}. Original: ${error.name || 'Unknown'}`);
            console.error("Audio transcription failed through proxy:", error);
            throw customError;
        }
    }
};

export const analyzeUserTopTracks = async (tracks: string[]): Promise<AnalyzedTrack[] | { error: string }> => {
    if (!tracks || tracks.length === 0) {
        addLog("Skipping top tracks analysis: No tracks to analyze.");
        return { error: "No tracks to analyze" };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);

    addLog(`Calling /api/analyze.mjs (tracks) with ${tracks.length} tracks... (Timeout: ${API_REQUEST_TIMEOUT_MS / 1000}s)`);
    try {
        const response = await fetch('/api/analyze.mjs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'tracks', tracks }),
            signal: controller.signal, // Pass the abort signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMessage = errorData.error || response.statusText || JSON.stringify(errorData); // Capture more details
            addLog(`Error from /api/analyze.mjs (tracks): Status ${response.status} - ${response.statusText}, Data: ${JSON.stringify(errorData)}`);
            
            await handleApiKeyMissingError(response.status, errorData); // Check for API key issue

            const serverError = new Error(`Server error: ${errorMessage}`);
            serverError.name = errorData.serverErrorName || 'ServerError'; // Use server's error name if available
            (serverError as any).details = errorData; // Attach original error data
            throw serverError;
        }

        const data = await response.json() as AnalyzedTrack[];
        addLog(`Successfully analyzed ${data.length} top tracks.`);
        return data;
    } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            const customError = new Error(`Client-side: Error analyzing user top tracks via proxy: Request timed out after ${API_REQUEST_TIMEOUT_MS / 1000}s.`);
            customError.name = 'ClientAbortError';
            addLog(`${customError.name}: ${customError.message}`);
            throw customError;
        } else if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
            const customError = new Error(`Client-side: Error analyzing user top tracks via proxy: Network connection error or CORS issue.`);
            customError.name = 'ClientNetworkError';
            addLog(`${customError.name}: ${customError.message}`);
            throw customError;
        } else {
            const msg = error.message || String(error);
            const customError = new Error(`Proxy call failed: ${msg}`);
            customError.name = error.name || 'UnknownClientError';
            addLog(`${customError.name}: ${customError.message}. Original: ${error.name || 'Unknown'}`);
            console.error("Error analyzing user top tracks:", error);
            throw customError;
        }
    }
};