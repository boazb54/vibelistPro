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

function getWeight(confidence: ConfidenceLevel | string | undefined): number { 
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
    // MODIFIED: top-level track confidence removed, default to 'medium' for artist scoring.
    const w = getWeight('medium'); 

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
    // MODIFIED: Extract semantic_tags and audio_physics from raw_ai_analysis_data
    const rawAnalysis = track.raw_ai_analysis_data;
    const semanticTags: SemanticTags = {
        primary_genre: rawAnalysis.primary_genre,
        primary_genre_confidence: rawAnalysis.primary_genre_confidence,
        secondary_genres: rawAnalysis.secondary_genres || [],
        secondary_genres_confidence: rawAnalysis.secondary_genres_confidence,
        emotional_tags: rawAnalysis.emotional_tags || [],
        emotional_confidence: rawAnalysis.emotional_confidence,
        cognitive_tags: rawAnalysis.cognitive_tags || [],
        cognitive_confidence: rawAnalysis.cognitive_confidence,
        somatic_tags: rawAnalysis.somatic_tags || [],
        somatic_confidence: rawAnalysis.somatic_confidence,
        language_iso_639_1: rawAnalysis.language_iso_639_1,
        language_confidence: rawAnalysis.language_confidence,
    };
    
    // Primary Genre
    const pGenre = semanticTags.primary_genre?.toLowerCase().trim();
    // Use `tags.primary_genre_confidence` directly.
    const pGenreWeight = getWeight(semanticTags.primary_genre_confidence || 'medium');

    if (pGenre) {
      genreScores[pGenre] = (genreScores[pGenre] || 0) + (1.0 * pGenreWeight);
      totalGenreWeight += (1.0 * pGenreWeight);
    }

    // Secondary Genres
    if (semanticTags.secondary_genres && Array.isArray(semanticTags.secondary_genres)) {
      // Use `tags.secondary_genres_confidence` directly.
      const sGenreWeight = getWeight(semanticTags.secondary_genres_confidence || 'medium');
      semanticTags.secondary_genres.forEach((g: string) => {
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
     // MODIFIED: Extract audio_physics from raw_ai_analysis_data
     const rawAnalysis = track.raw_ai_analysis_data;
     const audioPhysics: AudioPhysics = {
         energy_level: rawAnalysis.energy_level,
         energy_confidence: rawAnalysis.energy_confidence,
         tempo_feel: rawAnalysis.tempo_feel,
         tempo_confidence: rawAnalysis.tempo_confidence,
         vocals_type: rawAnalysis.vocals_type,
         vocals_confidence: rawAnalysis.vocals_confidence,
         texture_type: rawAnalysis.texture_type,
         texture_confidence: rawAnalysis.texture_confidence,
         danceability_hint: rawAnalysis.danceability_hint,
         danceability_confidence: rawAnalysis.danceability_confidence,
     };
     
     // Use new field, no fallback needed to old `semantic_tags.energy`
     const energyLevel = audioPhysics.energy_level?.toLowerCase(); 

     let bucket = energyLevel;
     if (bucket === 'explosive') bucket = 'high';
     // Also handle new granular levels for robust fallback
     if (bucket === 'low_medium') bucket = 'medium';
     if (bucket === 'medium_high') bucket = 'high';
     
     if (!['low', 'medium', 'high'].includes(bucket)) return;

     // Use new energy_confidence if available, else fallback to old track.confidence
     // MODIFIED: Removed trackOverallConfidence, default to 'medium' if energy_confidence is missing.
     const w = getWeight(audioPhysics.energy_confidence || 'medium');
     
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
    // MODIFIED: Extract semantic_tags from raw_ai_analysis_data
    const rawAnalysis = track.raw_ai_analysis_data;
    const semanticTags: SemanticTags = {
        primary_genre: rawAnalysis.primary_genre,
        primary_genre_confidence: rawAnalysis.primary_genre_confidence,
        secondary_genres: rawAnalysis.secondary_genres || [],
        secondary_genres_confidence: rawAnalysis.secondary_genres_confidence,
        emotional_tags: rawAnalysis.emotional_tags || [],
        emotional_confidence: rawAnalysis.emotional_confidence,
        cognitive_tags: rawAnalysis.cognitive_tags || [],
        cognitive_confidence: rawAnalysis.cognitive_confidence,
        somatic_tags: rawAnalysis.somatic_tags || [],
        somatic_confidence: rawAnalysis.somatic_confidence,
        language_iso_639_1: rawAnalysis.language_iso_639_1,
        language_confidence: rawAnalysis.language_confidence,
    };

    // Aggregate emotional_tags
    if (semanticTags.emotional_tags && Array.isArray(semanticTags.emotional_tags)) {
        // MODIFIED: Removed trackOverallConfidence
        const w = getWeight(semanticTags.emotional_confidence || 'medium');
        semanticTags.emotional_tags.forEach(m => {
            const mood = m.toLowerCase().trim();
            moodScores[mood] = (moodScores[mood] || 0) + w;
        });
    }
    // Aggregate cognitive_tags
    if (semanticTags.cognitive_tags && Array.isArray(semanticTags.cognitive_tags)) {
        // MODIFIED: Removed trackOverallConfidence
        const w = getWeight(semanticTags.cognitive_confidence || 'medium');
        semanticTags.cognitive_tags.forEach(m => {
            const mood = m.toLowerCase().trim();
            moodScores[mood] = (moodScores[mood] || 0) + w;
        });
    }
    // Aggregate somatic_tags
    if (semanticTags.somatic_tags && Array.isArray(semanticTags.somatic_tags)) {
        // MODIFIED: Removed trackOverallConfidence
        const w = getWeight(semanticTags.somatic_confidence || 'medium');
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
    // MODIFIED: Value and confidence extractors now work with raw_ai_analysis_data
    valueExtractor: (t: AnalyzedTopTrack) => string | undefined,
    confidenceExtractor: (t: AnalyzedTopTrack) => ConfidenceLevel | string | undefined
  ): string => { 
      const scores: Record<string, number> = {};
      let maxScore = -1;
      let bias = 'unknown';

      tracks.forEach(t => {
          const val = valueExtractor(t)?.toLowerCase();
          if (!val) return;
          // MODIFIED: Removed t.confidence fallback
          const w = getWeight(confidenceExtractor(t) || 'medium');
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
    t => t.raw_ai_analysis_data.tempo_feel, 
    t => t.raw_ai_analysis_data.tempo_confidence 
  );
  // Vocals Bias
  const vocalsBias = calculateBias(
    t => t.raw_ai_analysis_data.vocals_type, 
    t => t.raw_ai_analysis_data.vocals_confidence 
  );
  // Texture Bias
  const textureBias = calculateBias(
    t => t.raw_ai_analysis_data.texture_type, 
    t => t.raw_ai_analysis_data.texture_confidence 
  );


  // 6. LANGUAGE AGGREGATION (NEW & MODIFIED to include playlists and new semantic_tags.language_iso_639_1)
  const languageCounts: Record<string, number> = {};
  let totalLanguageScore = 0;

  // Aggregate from AnalyzedTopTrack (new logic)
  tracks.forEach(track => {
    // MODIFIED: Extract semantic_tags from raw_ai_analysis_data
    const rawAnalysis = track.raw_ai_analysis_data;
    const semanticTags: SemanticTags = {
        primary_genre: rawAnalysis.primary_genre,
        primary_genre_confidence: rawAnalysis.primary_genre_confidence,
        secondary_genres: rawAnalysis.secondary_genres || [],
        secondary_genres_confidence: rawAnalysis.secondary_genres_confidence,
        emotional_tags: rawAnalysis.emotional_tags || [],
        emotional_confidence: rawAnalysis.emotional_confidence,
        cognitive_tags: rawAnalysis.cognitive_tags || [],
        cognitive_confidence: rawAnalysis.cognitive_confidence,
        somatic_tags: rawAnalysis.somatic_tags || [],
        somatic_confidence: rawAnalysis.somatic_confidence,
        language_iso_639_1: rawAnalysis.language_iso_639_1,
        language_confidence: rawAnalysis.language_confidence,
    };

    // Use new semantic_tags.language_iso_639_1 directly
    const newLang = semanticTags.language_iso_639_1;
    const newLangConfidence = semanticTags.language_confidence;
    // MODIFIED: Removed trackOverallConfidence
    const newLangWeight = getWeight(newLangConfidence || 'medium');

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
  // MODIFIED: Use new field name analyzed_top_50_tracks
  const { analyzed_top_50_tracks, analyzed_playlist_context } = unifiedGeminiResponse; 

  const sessionSemanticProfile = createSessionSemanticProfile(analyzed_top_50_tracks, analyzed_playlist_context);

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
    analyzed_top_tracks: analyzed_top_50_tracks, // MODIFIED: Use new field name
    user_taste_profile_v1: undefined, // NEW: Placeholder for future aggregation (v2.4.0)
  };
};
