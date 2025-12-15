
import { supabase } from './supabaseClient';
import { Playlist, SpotifyUserProfile, UserTasteProfile, VibeGenerationStats } from '../types';

/**
 * Saves a generated playlist to the 'generated_vibes' table.
 */
export const saveVibe = async (
  mood: string, 
  playlist: Playlist, 
  userId: string | null,
  stats?: VibeGenerationStats 
) => {
  try {
    const payload: any = { 
      user_id: userId,
      mood_prompt: mood,
      playlist_json: playlist,
      is_exported: false,
      is_failed: false 
    };

    if (stats) {
      payload.gemini_time_ms = stats.geminiTimeMs;
      payload.itunes_time_ms = stats.itunesTimeMs;
      payload.total_duration_ms = stats.totalDurationMs;
      payload.success_count = stats.successCount;
      payload.fail_count = stats.failCount;
      payload.failure_details = stats.failureDetails;

      payload.context_time_ms = stats.contextTimeMs;
      payload.prompt_build_time_ms = stats.promptBuildTimeMs;
      payload.gemini_api_time_ms = stats.geminiApiTimeMs;
      payload.prompt_text = stats.promptText;

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

export const logGenerationFailure = async (
  mood: string,
  errorReason: string,
  userId: string | null,
  stats?: Partial<VibeGenerationStats>
) => {
  try {
    const payload: any = {
      user_id: userId,
      mood_prompt: mood,
      playlist_json: null, 
      is_failed: true,
      error_message: errorReason,
      is_exported: false,
      
      total_duration_ms: stats?.totalDurationMs || 0,
      context_time_ms: stats?.contextTimeMs || 0,
      gemini_time_ms: stats?.geminiTimeMs || 0,
      prompt_text: stats?.promptText || null,

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
    }
  } catch (e) {
    console.error("Error logging failure:", e);
  }
};

export const markVibeAsExported = async (vibeId: string) => {
  try {
    const { error } = await supabase
      .from('generated_vibes')
      .update({ is_exported: true })
      .eq('id', vibeId);

    if (error) throw error;
  } catch (error) {
    console.warn('Failed to update vibe export status:', error);
  }
};

/**
 * Saves essential user account info only.
 * REMOVED: Saving of top_artists and top_genres to comply with Spotify Developer Terms.
 */
export const saveUserProfile = async (
  profile: SpotifyUserProfile,
  tasteProfile: UserTasteProfile | null
) => {
  try {
    const payload: any = {
        id: profile.id,
        email: profile.email,
        display_name: profile.display_name,
        country: profile.country,
        product: profile.product,
        explicit_filter: profile.explicit_content?.filter_enabled || false,
        last_login: new Date().toISOString()
    };

    // NOTE: We deliberately do NOT save tasteProfile.topArtists or topGenres to the database
    // to strictly adhere to data minimization principles.

    const { error } = await supabase
      .from('users')
      .upsert(payload, { onConflict: 'id' });

    if (error) {
      console.error("Failed to save user profile:", error);
    }
  } catch (error) {
    console.error("Error saving user profile:", error);
  }
};
