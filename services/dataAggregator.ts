
import { 
  AnalyzedTopTrack, 
  SessionSemanticProfile, 
  UnifiedTasteAnalysis, 
  UnifiedTasteGeminiResponse, 
  AnalyzedPlaylistContextItem,
  ConfidenceLevel, // NEW: Import ConfidenceLevel
  AudioPhysics, // NEW: Import AudioPhysics
  // MoodAnalysis, // REMOVED: MoodAnalysis is no longer a separate interface
  SemanticTags 
} from '../types';

// Updated Confidence Weights to reflect the new structure.
// This is an internal constant for the aggregator's *own* logic,
// and does not directly map to the model's new 'confidence' values yet.
const CONFIDENCE_WEIGHTS: Record<ConfidenceLevel | string, number> = { 
  'high': 1.0,
  'medium': 0.6,
  'low': 0.3
};

function getWeight(confidence: ConfidenceLevel | undefined): number { 
  if (!confidence) return 0.3; 
  return CONFIDENCE_WEIGHTS[confidence.toLowerCase()] || 0.3;
}

// Renamed and now extracts SessionSemanticProfile from AnalyzedTopTrack[]
const createSessionSemanticProfile = (
  tracks: AnalyzedTopTrack[],
  playlists: AnalyzedPlaylistContextItem[]
): SessionSemanticProfile => {
  // If no tracks and no playlists, return a default empty profile
  if ((!tracks || tracks.length === 0) && (!playlists || playlists.length === 0)) {
    return {
      taste_profile_type: 'diverse',
      dominant_genres: [],
      energy_bias: 'medium',
      energy_distribution: { low: 0, medium: 0, high: 0 },
      dominant_moods: [],
      tempo_bias: 'unknown',
      vocals_bias: 'unknown',
      texture_bias: 'unknown',
      artist_examples: [],
      language_distribution: {},
    };
  }
  
  // 1. ARTIST AGGREGATION (Weighted & Capped)
  const artistScores: Record<string, { score: number, count: number }> = {};
  
  tracks.forEach(track => {
    const artist = track.artist_name.trim();
    // In v2.3.0, 'track.confidence' is re-introduced and used directly.
    const w = getWeight(track.confidence || 'medium'); // Use re-introduced top-level track confidence

    if (!artistScores[artist]) {
      artistScores[artist] = { score: 0, count: 0 };
    }
    
    // Cap influence: Max 2 tracks per artist per session
    if (artistScores[artist].count < 2) {
      artistScores[artist].score += w;
      artistScores[artist].count += 1;
    }
  });

  const topArtists = Object.entries(artistScores)
    .sort(([, a], [, b]) => b.score - a.score)
    .slice(0, 5) // Keep top 5 artists
    .map(([name]) => name);


  // 2. GENRE AGGREGATION (Updated with Diversity Fallback)
  const genreScores: Record<string, number> = {};
  let totalGenreWeight = 0;

  tracks.forEach(track => {
    // For v2.3.0, `track.confidence` is always available.
    const trackOverallConfidence = track.confidence; 

    // Access semantic_tags directly, as its structure is now flattened.
    const tags: SemanticTags = track.semantic_tags; 

    // Primary Genre
    const pGenre = tags.primary_genre?.toLowerCase().trim();
    // Use `tags.primary_genre_confidence` directly.
    const pGenreWeight = getWeight(tags.primary_genre_confidence || trackOverallConfidence || 'medium');

    if (pGenre) {
      genreScores[pGenre] = (genreScores[pGenre] || 0) + (1.0 * pGenreWeight);
      totalGenreWeight += (1.0 * pGenreWeight);
    }

    // Secondary Genres
    if (tags.secondary_genres && Array.isArray(tags.secondary_genres)) {
      // Use `tags.secondary_genres_confidence` directly.
      const sGenreWeight = getWeight(tags.secondary_genres_confidence || trackOverallConfidence || 'medium');
      tags.secondary_genres.forEach((g: string) => {
        const sGenre = g.toLowerCase().trim();
        genreScores[sGenre] = (genreScores[sGenre] || 0) + (0.5 * sGenreWeight);
        totalGenreWeight += (0.5 * sGenreWeight);
      });
    }
  });

  // Calculate percentages and sort
  const allGenres = Object.entries(genreScores)
      .map(([genre, score]) => ({ 
          genre, 
          score, 
          percentage: totalGenreWeight > 0 ? score / totalGenreWeight : 0 
      }))
      .sort((a, b) => b.score - a.score);

  let tasteProfileType: 'diverse' | 'focused' = 'diverse';
  let dominantGenres: string[] = [];
  const topGenre = allGenres[0];

  if (topGenre && topGenre.percentage >= 0.20) {
      tasteProfileType = 'focused';
      dominantGenres = allGenres
          .filter(g => g.percentage >= 0.10)
          .map(g => g.genre);
  } else {
      tasteProfileType = 'diverse';
      dominantGenres = allGenres
          .slice(0, 5)
          .map(g => g.genre);
  }
  
  if (dominantGenres.length === 0 && allGenres.length > 0) {
      dominantGenres = allGenres.slice(0, 3).map(g => g.genre);
  }


  // 3. ENERGY DISTRIBUTION (Now using AudioPhysics.energy_level and AudioPhysics.energy_confidence)
  const energyCounts: Record<string, number> = { low: 0, medium: 0, high: 0 };
  let totalEnergyWeight = 0;

  tracks.forEach(track => {
     // Access audio_physics directly, as it's guaranteed to be present.
     const audioPhysics: AudioPhysics = track.audio_physics; 
     // For v2.3.0, `track.confidence` is always available.
     const trackOverallConfidence = track.confidence; 

     // Use new field, no fallback needed to old `semantic_tags.energy`
     const energyLevel = audioPhysics.energy_level?.toLowerCase(); 

     let bucket = energyLevel;
     if (bucket === 'explosive') bucket = 'high';
     // Also handle new granular levels for robust fallback
     if (bucket === 'low_medium') bucket = 'medium';
     if (bucket === 'medium_high') bucket = 'high';
     
     if (!['low', 'medium', 'high'].includes(bucket)) return;

     // Use new energy_confidence if available, else fallback to old track.confidence
     const w = getWeight(audioPhysics.energy_confidence || trackOverallConfidence || 'medium');
     
     energyCounts[bucket] = (energyCounts[bucket] || 0) + w;
     totalEnergyWeight += w;
  });

  const energyDistribution: Record<string, number> = {};
  let maxEnergyScore = -1;
  let energyBias = 'medium';

  Object.entries(energyCounts).forEach(([level, score]) => {
      const pct = totalEnergyWeight > 0 ? score / totalEnergyWeight : 0;
      energyDistribution[level] = Number(pct.toFixed(2));
      
      if (score > maxEnergyScore) {
          maxEnergyScore = score;
          energyBias = level;
      }
  });


  // 4. MOOD AGGREGATION (Now using flattened emotional/cognitive/somatic tags directly from SemanticTags)
  const moodScores: Record<string, number> = {}; // This will aggregate ALL mood tags (emotional, cognitive, somatic)

  tracks.forEach(track => {
    // For v2.3.0, `track.confidence` is always available.
    const trackOverallConfidence = track.confidence; 
    const semanticTags: SemanticTags = track.semantic_tags; // Access semantic_tags directly

    // Aggregate emotional_tags
    if (semanticTags.emotional_tags && Array.isArray(semanticTags.emotional_tags)) {
        const w = getWeight(semanticTags.emotional_confidence || trackOverallConfidence || 'medium');
        semanticTags.emotional_tags.forEach(m => {
            const mood = m.toLowerCase().trim();
            moodScores[mood] = (moodScores[mood] || 0) + w;
        });
    }
    // Aggregate cognitive_tags
    if (semanticTags.cognitive_tags && Array.isArray(semanticTags.cognitive_tags)) {
        const w = getWeight(semanticTags.cognitive_confidence || trackOverallConfidence || 'medium');
        semanticTags.cognitive_tags.forEach(m => {
            const mood = m.toLowerCase().trim();
            moodScores[mood] = (moodScores[mood] || 0) + w;
        });
    }
    // Aggregate somatic_tags
    if (semanticTags.somatic_tags && Array.isArray(semanticTags.somatic_tags)) {
        const w = getWeight(semanticTags.somatic_confidence || trackOverallConfidence || 'medium');
        semanticTags.somatic_tags.forEach(m => {
            const mood = m.toLowerCase().trim();
            moodScores[mood] = (moodScores[mood] || 0) + w;
        });
    }
  });

  const dominantMoods = Object.entries(moodScores)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3) // Keep top 3 moods
    .map(([m]) => m);


  // 5. TEMPO / VOCALS / TEXTURE (Weighted Majority Vote) - Adapted for AudioPhysics
  const calculateBias = (
    valueExtractor: (t: AnalyzedTopTrack) => string | undefined,
    confidenceExtractor: (t: AnalyzedTopTrack) => ConfidenceLevel | undefined
  ): string => { 
      const scores: Record<string, number> = {};
      let maxScore = -1;
      let bias = 'unknown';

      tracks.forEach(t => {
          const val = valueExtractor(t)?.toLowerCase();
          if (!val) return;
          // Use confidenceExtractor directly, fallback to track.confidence
          const w = getWeight(confidenceExtractor(t) || t.confidence || 'medium');
          scores[val] = (scores[val] || 0) + w;
      });

      Object.entries(scores).forEach(([val, score]) => {
          if (score > maxScore) {
              maxScore = score;
              bias = val;
          }
      });
      return bias;
  };

  // Tempo Bias
  const tempoBias = calculateBias(
    t => t.audio_physics.tempo_feel, 
    t => t.audio_physics.tempo_confidence 
  );
  // Vocals Bias
  const vocalsBias = calculateBias(
    t => t.audio_physics.vocals_type, 
    t => t.audio_physics.vocals_confidence 
  );
  // Texture Bias
  const textureBias = calculateBias(
    t => t.audio_physics.texture_type, 
    t => t.audio_physics.texture_confidence 
  );


  // 6. LANGUAGE AGGREGATION (NEW & MODIFIED to include playlists and new semantic_tags.language_iso_639_1)
  const languageCounts: Record<string, number> = {};
  let totalLanguageScore = 0;

  // Aggregate from AnalyzedTopTrack (new logic)
  tracks.forEach(track => {
    // For v2.3.0, `track.confidence` is always available.
    const trackOverallConfidence = track.confidence; 

    // Use new semantic_tags.language_iso_639_1 directly
    const newLang = track.semantic_tags.language_iso_639_1;
    const newLangConfidence = track.semantic_tags.language_confidence;
    const newLangWeight = getWeight(newLangConfidence || trackOverallConfidence || 'medium');

    if (newLang) {
      const normalizedLang = newLang.toLowerCase().trim();
      if (normalizedLang) {
        languageCounts[normalizedLang] = (languageCounts[normalizedLang] || 0) + newLangWeight;
        totalLanguageScore += newLangWeight;
      }
    }
    // REMOVED: Fallback to old semantic_tags.language
  });

  // Aggregate from AnalyzedPlaylistContextItem (existing logic)
  playlists.forEach(playlistContext => {
    const w = getWeight(playlistContext.confidence || 'medium'); // Use playlist context confidence
    if (playlistContext.playlist_language_distribution && Array.isArray(playlistContext.playlist_language_distribution)) {
      playlistContext.playlist_language_distribution.forEach(langItem => {
        const normalizedLang = langItem.language.toLowerCase().trim();
        const weightedPercentage = langItem.percentage * w; 
        if (normalizedLang) {
          languageCounts[normalizedLang] = (languageCounts[normalizedLang] || 0) + weightedPercentage;
          totalLanguageScore += weightedPercentage;
        }
      });
    }
  });

  const languageDistribution: Record<string, number> = {};
  Object.entries(languageCounts).forEach(([lang, score]) => {
    if (totalLanguageScore > 0) {
      languageDistribution[lang] = Number((score / totalLanguageScore).toFixed(2));
    } else {
      languageDistribution[lang] = 0;
    }
  });

  return {
      taste_profile_type: tasteProfileType,
      dominant_genres: dominantGenres,
      energy_bias: energyBias,
      energy_distribution: energyDistribution,
      dominant_moods: dominantMoods,
      tempo_bias: tempoBias,
      vocals_bias: vocalsBias,
      texture_bias: textureBias,
      artist_examples: topArtists,
      language_distribution: languageDistribution,
  };
};

// NEW: Main aggregation function that takes the unified Gemini response
export const aggregateSessionData = (unifiedGeminiResponse: UnifiedTasteGeminiResponse): UnifiedTasteAnalysis => { 
  const { analyzed_50_top_tracks, analyzed_playlist_context } = unifiedGeminiResponse; 

  const sessionSemanticProfile = createSessionSemanticProfile(analyzed_50_top_tracks, analyzed_playlist_context);

  let overallMoodCategory: string = "Mixed Moods";
  let overallMoodConfidence: number = 0.5;

  if (analyzed_playlist_context && analyzed_playlist_context.length > 0) {
    const firstContext = analyzed_playlist_context[0];
    overallMoodCategory = firstContext.playlist_emotional_direction;
    overallMoodConfidence = CONFIDENCE_WEIGHTS[firstContext.confidence?.toLowerCase()] || 0.5;
  }

  return {
    overall_mood_category: overallMoodCategory, 
    overall_mood_confidence: overallMoodConfidence, 
    session_semantic_profile: sessionSemanticProfile,
    playlist_contexts: analyzed_playlist_context, 
    analyzed_top_tracks: analyzed_50_top_tracks,
    user_taste_profile_v1: undefined, // NEW: Placeholder for future aggregation (v2.4.0)
  };
};
