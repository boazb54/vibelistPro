import { supabase } from './supabaseClient';
import { Playlist } from '../types';

/**
 * Saves a generated playlist to the 'generated_vibes' table.
 * This creates the "Memory" for our LLM to learn from later.
 * Returns { data, error } object so the UI can handle logging.
 */
export const saveVibe = async (mood: string, playlist: Playlist, userId: string | null) => {
  try {
    const { data, error } = await supabase
      .from('generated_vibes')
      .insert([
        { 
          user_id: userId,
          mood_prompt: mood,
          playlist_json: playlist,
          is_exported: false
        }
      ])
      .select()
      .single();

    return { data, error };
  } catch (error: any) {
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