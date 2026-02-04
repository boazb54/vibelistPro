

import { supabase } from './supabaseClient';
import { Playlist, SpotifyUserProfile, UserTasteProfile, VibeGenerationStats } from '../types';

/**
 * Saves or updates a generated playlist in the 'generated_vibes' table.
 * If an existingVibeId is provided, it updates that record. Otherwise, it inserts a new one.
 */
export const saveVibe = async (
  mood: string, 
  playlist: Partial<Playlist> & { title: string; description: string },
  userId: string | null,
  stats: Partial<VibeGenerationStats>,
  userJourneyPhase: 'pre_auth_teaser' | 'post_auth_generation' | 'validation_failure', // Added validation_failure
  existingVibeId?: string
) => {
  try {
    const payload: any = { 
      user_id: userId,
      mood_prompt: mood,
      playlist_json: playlist,
      is_exported: false,
      is_failed: false,
      user_journey_phase: userJourneyPhase
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

    let query;
    if (existingVibeId) {
      // Update existing record, primarily to add user_id and full playlist details
      query = supabase
        .from('generated_vibes')
        .update(payload)
        .eq('id', existingVibeId)
        .select()
        .single();
    } else {
      // Insert a new record (for pre-auth teasers or remixes without a pending vibe)
      query = supabase
        .from('generated_vibes')
        .insert([payload])
        .select()
        .single();
    }
    
    const { data, error } = await query;

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
 * Fetches a single vibe record from the database by its ID.
 */
export const fetchVibeById = async (vibeId: string) => {
  try {
    const { data, error } = await supabase
      .from('generated_vibes')
      .select('id, mood_prompt, playlist_json')
      .eq('id', vibeId)
      .single();

    if (error) {
      console.error("Supabase error fetching vibe by ID:", error);
    }
    return { data, error };
  } catch (error: any) {
    console.error("Exception fetching vibe by ID:", error);
    return { data: null, error };
  }
};


export const logGenerationFailure = async (
  mood: string,
  errorReason: string,
  userId: string | null,
  stats?: Partial<VibeGenerationStats>,
  userJourneyPhase?: 'pre_auth_teaser' | 'post_auth_generation' | 'validation_failure' // Added validation_failure
) => {
  try {
    const payload: any = {
      user_id: userId,
      mood_prompt: mood,
      playlist_json: null, 
      is_failed: true,
      error_message: errorReason,
      is_exported: false,
      user_journey_phase: userJourneyPhase || (userId ? 'post_auth_generation' : 'pre_auth_teaser'),
      
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
 * Saves essential user account info and the new UserTasteProfileV1.
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

    // NEW: Save the UserTasteProfileV1 to a dedicated column
    if (tasteProfile?.unified_analysis?.user_taste_profile_v1) {
      payload.unified_taste_profile_v1_json = tasteProfile.unified_analysis.user_taste_profile_v1;
    }

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

/**
 * Fetches user profile data from the database.
 */
export const fetchUserProfile = async (userId: string) => {
  try {
    // NEW: Also select the unified_taste_profile_v1_json column
    const { data, error } = await supabase
      .from('users')
      .select('email, display_name, country, product, created_at, unified_taste_profile_v1_json')
      .eq('id', userId)
      .single();

    return { data, error };
  } catch (error) {
    console.error("Error fetching user profile:", error);
    return { data: null, error };
  }
};
