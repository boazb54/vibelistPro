
import { AnalyzedTopTrack, SessionSemanticProfile, UnifiedTasteAnalysis, UnifiedTasteGeminiResponse, AnalyzedPlaylistContextItem } from '../types';

const CONFIDENCE_WEIGHTS: Record<string, number> = {
  'high': 1.0,
  'medium': 0.6,
  'low': 0.3
};

function getWeight(confidence: string): number {
  return CONFIDENCE_WEIGHTS[confidence?.toLowerCase()] || 0.3;
}

// Renamed and now extracts SessionSemanticProfile from AnalyzedTopTrack[]
const createSessionSemanticProfile = (tracks: AnalyzedTopTrack[]): SessionSemanticProfile => {
  if (!tracks || tracks.length === 0) {
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
      language_distribution: {}, // Default empty for no tracks
    };
  }
  
  // 1. ARTIST AGGREGATION (Weighted & Capped)
  const artistScores: Record<string, { score: number, count: number }> = {};
  
  tracks.forEach(track => {
    // Normalize artist name
    const artist = track.artist_name.trim();
    const w = getWeight(track.confidence);
    
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
    const w = getWeight(track.confidence);
    const tags = track.semantic_tags;

    // Primary Genre: 1.0 * weight
    const pGenre = tags.primary_genre?.toLowerCase().trim();
    if (pGenre) {
      genreScores[pGenre] = (genreScores[pGenre] || 0) + (1.0 * w);
      totalGenreWeight += (1.0 * w);
    }

    // Secondary Genres: 0.5 * weight
    if (tags.secondary_genres && Array.isArray(tags.secondary_genres)) {
      tags.secondary_genres.forEach(g => {
        const sGenre = g.toLowerCase().trim();
        genreScores[sGenre] = (genreScores[sGenre] || 0) + (0.5 * w);
        totalGenreWeight += (0.5 * w);
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

  // LOGIC: IF top genre commands >= 20% of the weight, it's a "Focused" session.
  // Otherwise, it's "Diverse" (entropy is high).
  if (topGenre && topGenre.percentage >= 0.20) {
      tasteProfileType = 'focused';
      // Focused: Only keep significant genres (>= 10%)
      dominantGenres = allGenres
          .filter(g => g.percentage >= 0.10)
          .map(g => g.genre);
  } else {
      tasteProfileType = 'diverse';
      // Diverse: Keep top 5 genres regardless of how small their share is
      dominantGenres = allGenres
          .slice(0, 5)
          .map(g => g.genre);
  }
  
  // Safety Fallback: Ensure we never return an empty list if data exists
  if (dominantGenres.length === 0 && allGenres.length > 0) {
      dominantGenres = allGenres.slice(0, 3).map(g => g.genre);
  }


  // 3. ENERGY DISTRIBUTION
  const energyCounts: Record<string, number> = { low: 0, medium: 0, high: 0 };
  let totalEnergyWeight = 0;

  tracks.forEach(track => {
     const w = getWeight(track.confidence);
     const e = track.semantic_tags.energy?.toLowerCase();
     
     // Normalize buckets
     let bucket = e;
     if (bucket === 'explosive') bucket = 'high';
     if (!['low', 'medium', 'high'].includes(bucket)) return;

     energyCounts[bucket] = (energyCounts[bucket] || 0) + w;
     totalEnergyWeight += w;
  });

  const energyDistribution: Record<string, number> = {};
  let maxEnergyScore = -1;
  let energyBias = 'medium';

  Object.entries(energyCounts).forEach(([level, score]) => {
      // Calculate precise percentage
      const pct = totalEnergyWeight > 0 ? score / totalEnergyWeight : 0;
      energyDistribution[level] = Number(pct.toFixed(2));
      
      // Determine bias
      if (score > maxEnergyScore) {
          maxEnergyScore = score;
          energyBias = level;
      }
  });


  // 4. MOOD AGGREGATION
  const moodScores: Record<string, number> = {};
  
  tracks.forEach(track => {
    const w = getWeight(track.confidence);
    if (track.semantic_tags.mood && Array.isArray(track.semantic_tags.mood)) {
        track.semantic_tags.mood.forEach(m => {
            const mood = m.toLowerCase().trim();
            moodScores[mood] = (moodScores[mood] || 0) + w;
        });
    }
  });

  const dominantMoods = Object.entries(moodScores)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3) // Keep top 3 moods
    .map(([m]) => m);


  // 5. TEMPO / VOCALS / TEXTURE (Weighted Majority Vote)
  const calculateBias = (extractor: (t: AnalyzedTopTrack) => string | undefined): string => { // MODIFIED: input type
      const scores: Record<string, number> = {};
      let maxScore = -1;
      let bias = 'unknown';

      tracks.forEach(t => {
          const val = extractor(t)?.toLowerCase();
          if (!val) return;
          const w = getWeight(t.confidence);
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

  const tempoBias = calculateBias(t => t.semantic_tags.tempo);
  const vocalsBias = calculateBias(t => t.semantic_tags.vocals);
  const textureBias = calculateBias(t => t.semantic_tags.texture);

  // 6. LANGUAGE AGGREGATION (NEW)
  const languageCounts: Record<string, number> = {};
  let totalLanguageScore = 0; // Use 'score' for weighted sum

  tracks.forEach(track => {
    const w = getWeight(track.confidence); // Apply confidence weight
    if (track.semantic_tags.language && Array.isArray(track.semantic_tags.language)) {
      track.semantic_tags.language.forEach(lang => {
        const normalizedLang = lang.toLowerCase().trim(); // Normalize language string (e.g., 'en', 'he')
        if (normalizedLang) {
          languageCounts[normalizedLang] = (languageCounts[normalizedLang] || 0) + w;
          totalLanguageScore += w; // Accumulate total weighted score
        }
      });
    }
  });

  const languageDistribution: Record<string, number> = {};
  // Calculate percentages
  Object.entries(languageCounts).forEach(([lang, score]) => {
    if (totalLanguageScore > 0) {
      languageDistribution[lang] = Number((score / totalLanguageScore).toFixed(2)); // Round to two decimal places
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
      language_distribution: languageDistribution, // NEW: Add to the returned profile
  };
};

// NEW: Main aggregation function that takes the unified Gemini response
export const aggregateSessionData = (unifiedGeminiResponse: UnifiedTasteGeminiResponse): UnifiedTasteAnalysis => { // MODIFIED: input type
  const { analyzed_50_top_tracks, analyzed_playlist_context } = unifiedGeminiResponse; // MODIFIED: destructure new fields

  // Use the helper function to get the session semantic profile
  const sessionSemanticProfile = createSessionSemanticProfile(analyzed_50_top_tracks); // MODIFIED: use analyzed_50_top_tracks

  // Placeholder logic for overall_mood_category and overall_mood_confidence
  // as per clarification: "prioritize the mood category and confidence from the first available
  // AnalyzedPlaylistContextItem, or a simple concatenation/average if multiple are present."
  let overallMoodCategory: string = "Mixed Moods";
  let overallMoodConfidence: number = 0.5;

  if (analyzed_playlist_context && analyzed_playlist_context.length > 0) {
    // Simple placeholder: take from the first playlist context
    const firstContext = analyzed_playlist_context[0];
    overallMoodCategory = firstContext.playlist_emotional_direction;
    // Convert confidence from string "low"|"medium"|"high" to number for overall_mood_confidence
    overallMoodConfidence = CONFIDENCE_WEIGHTS[firstContext.confidence?.toLowerCase()] || 0.5;
    // Further refinement for multiple contexts will be in future versions
  }

  return {
    overall_mood_category: overallMoodCategory, // MODIFIED
    overall_mood_confidence: overallMoodConfidence, // MODIFIED
    session_semantic_profile: sessionSemanticProfile,
    playlist_contexts: analyzed_playlist_context, // NEW
  };
};
