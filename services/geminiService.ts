
import { GeminiResponseWithMetrics, AnalyzedTrack, ContextualSignals, UserTasteProfile, UserPlaylistMoodAnalysis } from "../types";

export const analyzeUserPlaylistsForMood = async (playlistTracks: string[]): Promise<UserPlaylistMoodAnalysis | null> => {
    if (!playlistTracks || playlistTracks.length === 0) return null;

    try {
        const res = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'playlists', playlistTracks })
        });

        if (!res.ok) throw new Error("Failed to analyze playlists");
        return await res.json();
    } catch (error) {
        console.error("Error calling analyze proxy:", error);
        throw error;
    }
};

export const generatePlaylistFromMood = async (
  mood: string, 
  contextSignals: ContextualSignals,
  tasteProfile?: UserTasteProfile,
  excludeSongs?: string[]
): Promise<GeminiResponseWithMetrics> => {
  const t_prompt_start = performance.now();

  try {
    const res = await fetch('/api/vibe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mood, contextSignals, tasteProfile, excludeSongs })
    });

    if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to generate playlist");
    }

    const data = await res.json();
    const t_prompt_end = performance.now();

    return {
        ...data,
        metrics: {
            ...data.metrics,
            promptBuildTimeMs: Math.round(t_prompt_end - t_prompt_start)
        }
    };
  } catch (error) {
    console.error("Error calling vibe proxy:", error);
    throw error;
  }
};

export const transcribeAudio = async (base64Audio: string, mimeType: string): Promise<string> => {
    try {
        const res = await fetch('/api/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64Audio, mimeType })
        });
        if (!res.ok) throw new Error("Transcription failed");
        const data = await res.json();
        return data.text;
    } catch (error) {
        console.error("Error calling transcribe proxy:", error);
        throw error;
    }
};

export const analyzeUserTopTracks = async (tracks: string[]): Promise<AnalyzedTrack[] | { error: string }> => {
    try {
        const res = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'tracks', tracks })
        });
        if (!res.ok) throw new Error("Analysis failed");
        return await res.json();
    } catch (error) {
        console.error("Error calling track analysis proxy:", error);
        return { error: "Failed to analyze" };
    }
};
