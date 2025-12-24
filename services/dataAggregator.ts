
// Vercel cache bust: Added comment to force re-evaluation.
import { AnalyzedTrack, SessionSemanticProfile, CulturalTasteInSongs, InferredLyricalLanguageResult } from '../types';
import { inferLyricalLanguageForTracks } from './geminiService'; // NEW: Import the Gemini service for lyrical inference

// Removed: isRtl as it's no longer used for cultural bias detection.
// The previous CONFIDENCE_WEIGHTS and getWeight function for semantic tags are now only used in aggregateSessionData
// and not for cultural taste, as cultural taste relies purely on Gemini's inference confidence.

function getWeight(confidence: string): number {
  const CONFIDENCE_WEIGHTS: Record<string, number> = {
    'high': 1.0,
    'medium': 0.6,
    'low': 0.3
  };
  return CONFIDENCE_WEIGHTS[confidence?.toLowerCase()] || 0.3;
}

export const aggregateSessionData = (tracks: AnalyzedTrack[]): SessionSemanticProfile => {
  // REMOVED `userProfile: SpotifyUserProfile | null` from parameters
  
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
  const calculateBias = (extractor: (t: AnalyzedTrack) => string | undefined): string => {
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

  // REMOVED: All cultural_bias detection logic from here, including languageScores, languageKeywordMap, detectTrackLanguage, isFromDominantLocaleWithContent.

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
      // REMOVED: cultural_bias field from here
  };
};

/**
 * NEW: Calculates cultural taste *exclusively* from Gemini's lyrical language inference.
 * This function completely replaces the previous metadata-based cultural bias calculation.
 * It takes a consolidated list of unique track strings and calls the Gemini service for inference.
 * The confidence score from Gemini's inference is used as the weight for each language.
 */
export const calculateCulturalTasteInSongs = async (
  allUniqueTracks: string[] // Consolidated list of "Song by Artist" strings
): Promise<CulturalTasteInSongs> => {
  const languageScores: Record<string, number> = {};
  let totalLanguageWeight = 0;

  if (allUniqueTracks.length === 0) {
    // If no tracks to analyze, default to English with 100%
    return { dominant_language: 'english', language_distribution: { 'english': 1.0 } };
  }

  // Step 1: Call the new service to get Gemini's lyrical language inference for all unique songs
  let inferredLanguages: InferredLyricalLanguageResult[] = [];
  try {
    inferredLanguages = await inferLyricalLanguageForTracks(allUniqueTracks);
  } catch (error) {
    console.error("Error fetching lyrical language inference from Gemini:", error);
    // Fallback: If inference fails, default to English
    return { dominant_language: 'english', language_distribution: { 'english': 1.0 } };
  }

  // Step 2: Aggregate the results using Gemini's confidence as the weight
  inferredLanguages.forEach(inference => {
    const lang = inference.inferred_lyrical_language?.toLowerCase();
    const confidence = inference.confidence_score;

    // Only count languages we could confidently infer and are not 'unknown' or 'instrumental'
    // Also, require a minimum confidence score (e.g., > 0) to avoid noisy data
    if (lang && lang !== 'unknown' && lang !== 'instrumental' && confidence > 0) {
      languageScores[lang] = (languageScores[lang] || 0) + confidence;
      totalLanguageWeight += confidence;
    }
  });

  // Step 3: Calculate percentage distribution and determine dominant language
  const languageDistribution: Record<string, number> = {};
  let dominantLanguage: string | undefined;
  let maxScore = -1;

  if (totalLanguageWeight === 0) {
    // If no lyrical language was confidently inferred for any track, default to English.
    return { dominant_language: 'english', language_distribution: { 'english': 1.0 } };
  }

  Object.entries(languageScores).forEach(([lang, score]) => {
    const pct = score / totalLanguageWeight;
    languageDistribution[lang] = Number(pct.toFixed(2)); // Round to 2 decimal places for consistency

    if (score > maxScore) {
      maxScore = score;
      dominantLanguage = lang;
    }
  });

  return {
    dominant_language: dominantLanguage,
    language_distribution: languageDistribution,
  };
};
