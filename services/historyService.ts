
import { supabase } from './supabaseClient';
import { Playlist, SpotifyUserProfile, UserTasteProfile, VibeGenerationStats } from '../types';

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
      is_exported: false
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

      // NEW: Granular metrics & Prompt Log
      payload.context_time_ms = stats.contextTimeMs;
      payload.prompt_build_time_ms = stats.promptBuildTimeMs;
      payload.gemini_api_time_ms = stats.geminiApiTimeMs;
      payload.prompt_text = stats.promptText;
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
 */
export const saveUserProfile = async (profile: SpotifyUserProfile, taste: UserTasteProfile | null) => {
  try {
    const { error } = await supabase
      .from('users')
      .upsert({
        id: profile.id,
        email: profile.email,
        display_name: profile.display_name,
        country: profile.country,
        product: profile.product,
        explicit_filter: profile.explicit_content?.filter_enabled || false,
        top_artists: taste?.topArtists || [],
        top_genres: taste?.topGenres || [],
        last_login: new Date().toISOString()
      }, { onConflict: 'id' });

    if (error) {
      console.error("Failed to save user profile:", error);
    } else {
      console.log("User profile synced to Supabase.");
    }
  } catch (error) {
    console.error("Error saving user profile:", error);
  }
};
