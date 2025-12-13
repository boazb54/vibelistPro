

import { supabase } from './supabaseClient';
import { Playlist, SpotifyUserProfile, UserTasteProfile, VibeGenerationStats, ExtendedUserProfile } from '../types';

/**
 * Saves a generated playlist to the 'generated_vibes' table.
 * This creates the "Memory" for our LLM to learn from later.
 * Returns { data, error } object so the UI can handle logging.
 */
export const saveVibe = async (
  mood: string, 
  playlist: Playlist, 
  userId: string | null,
  stats?: VibeGenerationStats // NEW: Optional stats for logging
) => {
  try {
    const payload: any = { 
      user_id: userId,
      mood_prompt: mood,
      playlist_json: playlist,
      is_exported: false,
      is_failed: false // Explicitly mark as success
    };

    // Add logging stats if provided
    if (stats) {
      // Existing metrics
      payload.gemini_time_ms = stats.geminiTimeMs;
      payload.itunes_time_ms = stats.itunesTimeMs;
      payload.total_duration_ms = stats.totalDurationMs;
      payload.success_count = stats.successCount;
      payload.fail_count = stats.failCount;
      payload.failure_details = stats.failureDetails;

      // Granular metrics & Prompt Log
      payload.context_time_ms = stats.contextTimeMs;
      payload.prompt_build_time_ms = stats.promptBuildTimeMs;
      payload.gemini_api_time_ms = stats.geminiApiTimeMs;
      payload.prompt_text = stats.promptText;

      // NEW: Contextual Analytics mapping
      payload.local_time = stats.localTime;
      payload.day_of_week = stats.dayOfWeek;
      payload.browser_language = stats.browserLanguage;
      payload.input_modality = stats.inputModality;
      payload.device_type = stats.deviceType;
      payload.ip_address = stats.ipAddress;
    }

    const { data, error } = await supabase
      .from('generated_vibes')
      .insert([payload])
      .select()
      .single();

    if (error) {
      console.error("Supabase Raw Error:", error);
    }

    return { data, error };
  } catch (error: any) {
    console.error("Supabase Exception:", error);
    return { data: null, error };
  }
};

/**
 * NEW: Logs a failed generation attempt to the database.
 * This captures "Survivorship Bias" data - what were users asking for when it broke?
 */
export const logGenerationFailure = async (
  mood: string,
  errorReason: string,
  userId: string | null,
  stats?: Partial<VibeGenerationStats>
) => {
  try {
    console.log("Logging generation failure to DB...");
    
    const payload: any = {
      user_id: userId,
      mood_prompt: mood,
      playlist_json: null, // No playlist generated
      is_failed: true,
      error_message: errorReason,
      is_exported: false,
      
      // Capture whatever timing data we managed to get before the crash
      total_duration_ms: stats?.totalDurationMs || 0,
      context_time_ms: stats?.contextTimeMs || 0,
      gemini_time_ms: stats?.geminiTimeMs || 0,
      prompt_text: stats?.promptText || null,

      // NEW: Contextual Analytics mapping for failures
      local_time: stats?.localTime,
      day_of_week: stats?.dayOfWeek,
      browser_language: stats?.browserLanguage,
      input_modality: stats?.inputModality,
      device_type: stats?.deviceType,
      ip_address: stats?.ipAddress
    };

    const { error } = await supabase
      .from('generated_vibes')
      .insert([payload]);

    if (error) {
      console.error("Failed to log failure stats:", error.message);
    } else {
      console.log("Failure logged successfully.");
    }
  } catch (e) {
    console.error("Error logging failure:", e);
  }
};

/**
 * Marks a specific vibe as "exported" when the user saves it to Spotify.
 * This acts as a "Success Signal" for future LLM reinforcement learning.
 */
export const markVibeAsExported = async (vibeId: string) => {
  try {
    const { error } = await supabase
      .from('generated_vibes')
      .update({ is_exported: true })
      .eq('id', vibeId);

    if (error) throw error;
    console.log(`Vibe ${vibeId} marked as exported (Success Signal).`);
  } catch (error) {
    console.warn('Failed to update vibe export status:', error);
  }
};

/**
 * NEW: Syncs the Spotify User Profile + Taste Data to the 'users' table.
 * This runs every time the user logs in to ensure we have their latest data.
 * 
 * VERSION ONE UPDATE: Accepts optional 'extendedData' to save the deep profile analysis.
 */
export const saveUserProfile = async (
  profile: SpotifyUserProfile, 
  taste: UserTasteProfile | null,
  extendedData?: ExtendedUserProfile | null
) => {
  try {
    const payload: any = {
        id: profile.id,
        email: profile.email,
        display_name: profile.display_name,
        country: profile.country,
        product: profile.product,
        explicit_filter: profile.explicit_content?.filter_enabled || false,
        top_artists: taste?.topArtists || [],
        top_genres: taste?.topGenres || [],
        last_login: new Date().toISOString()
    };

    // Version One: Inject the large JSON blob if present
    if (extendedData) {
        payload.spotify_data = extendedData; // Contains tracks, artists, history
        payload.playlists_data = extendedData.playlists || []; // NEW: Dedicated column for Playlists
        payload.last_data_sync = new Date().toISOString();
    }

    const { error } = await supabase
      .from('users')
      .upsert(payload, { onConflict: 'id' });

    if (error) {
      console.error("Failed to save user profile:", error);
    } else {
      console.log(`User profile synced to Supabase (Extended Data: ${!!extendedData}).`);
    }
  } catch (error) {
    console.error("Error saving user profile:", error);
  }
};