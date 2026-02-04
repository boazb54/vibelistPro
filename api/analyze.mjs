

import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";

// NEW: All types needed for aggregation logic, now directly imported or defined within this file.
// The raw interfaces are now internal to this module, so they don't need to be exported from types.ts
import { 
  AnalyzedTopTrack, 
  SessionSemanticProfile, 
  UnifiedTasteAnalysis, 
  AnalyzedPlaylistContextItem,
  ConfidenceLevel,
  AudioPhysics,
  SemanticTags,
  UserTasteProfileV1,
  IntentProfileSignals,
  IntentCombinationItem,
  RawAudioPhysics,
  RawSemanticTags,
  RawAnalyzedTopTrack,
  UnifiedTasteGeminiResponse,
} from '../types';


const GEMINI_MODEL = 'gemini-2.5-flash';

// Helper for RTL detection (Hebrew + Arabic ranges) - Moved here for internal use
const isRtl = (text) => /[\u0590-\u05FF\u0600-\u06FF]/.test(text);

// Helper functions for aggregation (NEW - moved from dataAggregator.ts)
const conf_w = (confidence) => {
  switch (confidence?.toLowerCase()) {
    case 'high': return 1.0;
    case 'medium': return 0.67;
    case 'low': return 0.40;
    default: return 0.40; // Default for undefined or unknown
  }
};

const sumScores = (scores) => {
  // Fix: Ensure scores are treated as numbers, even if they come from unknown sources.
  return Object.values(scores).reduce((acc, score) => acc + (typeof score === 'number' ? score : 0), 0);
};

const weighted_ratio = (topScore, allScores) => {
  const total = sumScores(allScores);
  // Fix: Ensure topScore is treated as a number.
  return total > 0 ? (typeof topScore === 'number' ? topScore : 0) / total : 0;
};

const map_ratio_to_semantic = (ratio) => {
  if (ratio >= 0.67) return 'high';
  if (ratio >= 0.40) return 'medium';
  return 'low';
};

const argmax = (scores) => {
  let maxScore = -Infinity;
  let maxKey = '';
  for (const key in scores) {
    // Fix: Ensure score is treated as a number for comparison
    const score = typeof scores[key] === 'number' ? scores[key] : -Infinity;
    if (score > maxScore) {
      maxScore = score;
      maxKey = key;
    }
  }
  return maxKey;
};

const mean = (...numbers) => {
  if (numbers.length === 0) return 0;
  // Fix: Filter out non-numeric values from the numbers array before summing.
  const numericNumbers = numbers.filter(num => typeof num === 'number');
  if (numericNumbers.length === 0) return 0; // Prevent division by zero if all are filtered out
  return numericNumbers.reduce((acc, num) => acc + num, 0) / numericNumbers.length;
};

// Internal constant for the aggregator's *own* logic (moved from dataAggregator.ts)
// Removed getWeight function as conf_w now covers the required weighting with new values.
const CONFIDENCE_WEIGHTS = { 
  'high': 1.0,
  'medium': 0.67,
  'low': 0.40
};


// NEW HELPER FUNCTIONS FOR NORMALIZATION AND VALIDATION (CRITICAL for v2.5.1) - Moved here
const normalizeAudioPhysicsValue = (key, rawValue) => {
  const lowerCaseValue = rawValue?.toLowerCase().trim();
  switch (key) {
    case 'energy_level':
      if (['low', 'low_medium', 'medium', 'medium_high', 'high'].includes(lowerCaseValue)) {
        return lowerCaseValue;
      }
      // Map common synonyms or general terms to canonical enums
      if (lowerCaseValue?.includes('mellow') || lowerCaseValue?.includes('calm') || lowerCaseValue?.includes('soft')) return 'low';
      if (lowerCaseValue?.includes('mid') || lowerCaseValue?.includes('average') || lowerCaseValue?.includes('moderate')) return 'medium';
      if (lowerCaseValue?.includes('high') || lowerCaseValue?.includes('energetic') || lowerCaseValue?.includes('explosive') || lowerCaseValue?.includes('intense')) return 'high';
      return 'medium'; // Default if unmappable
    case 'tempo_feel':
      if (['slow', 'mid', 'fast'].includes(lowerCaseValue)) {
        return lowerCaseValue;
      }
      if (lowerCaseValue?.includes('chill') || lowerCaseValue?.includes('relaxed') || lowerCaseValue?.includes('leisurely')) return 'slow';
      if (lowerCaseValue?.includes('upbeat') || lowerCaseValue?.includes('dance') || lowerCaseValue?.includes('driving')) return 'fast';
      return 'mid'; // Default
    case 'vocals_type':
      if (['instrumental', 'sparse', 'lead_vocal', 'harmonies', 'choral', 'background_vocal'].includes(lowerCaseValue)) {
        return lowerCaseValue;
      }
      if (lowerCaseValue?.includes('no vocals') || lowerCaseValue?.includes('no_vocals')) return 'instrumental';
      if (lowerCaseValue?.includes('main vocal') || lowerCaseValue?.includes('solo vocal')) return 'lead_vocal';
      if (lowerCaseValue?.includes('choir')) return 'choral';
      return 'lead_vocal'; // Default
    case 'texture_type':
      if (['organic', 'acoustic', 'electric', 'synthetic', 'hybrid', 'ambient'].includes(lowerCaseValue)) {
        return lowerCaseValue;
      }
      if (lowerCaseValue?.includes('natural') || lowerCaseValue?.includes('earthy')) return 'organic';
      if (lowerCaseValue?.includes('digital') || lowerCaseValue?.includes('programmed')) return 'synthetic';
      if (lowerCaseValue?.includes('mixed')) return 'hybrid';
      return 'hybrid'; // Default
    case 'danceability_hint':
      if (['low', 'medium', 'high'].includes(lowerCaseValue)) {
        return lowerCaseValue;
      }
      if (lowerCaseValue?.includes('groove') || lowerCaseValue?.includes('rhythmic')) return 'high';
      if (lowerCaseValue?.includes('background') || lowerCaseValue?.includes('no beat') || lowerCaseValue?.includes('still')) return 'low';
      return 'medium'; // Default
    default:
      return lowerCaseValue; // Should not happen for defined keys
  }
};

const normalizeSemanticTag = (rawValue) => {
  return rawValue?.toLowerCase().trim();
};

const cleanAndValidateConfidence = (rawValue) => {
  const lowerCaseValue = rawValue?.toLowerCase().trim();
  if (['low', 'medium', 'high'].includes(lowerCaseValue)) {
    return lowerCaseValue;
  }
  return 'medium'; // Default to medium for any unparsable confidence
};

// createSessionSemanticProfile (moved from dataAggregator.ts)
const createSessionSemanticProfile = (
  tracks, // NOW expects validated AnalyzedTopTrack
  playlists
) => {
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
  const artistScores = {};
  
  tracks.forEach(track => {
    const artist = track.artist_name.trim();
    // MODIFIED: Since top-level track.confidence is removed, use a default weight for artist.
    const w = 1.0; 

    if (!artistScores[artist]) {
      artistScores[artist] = { score: 0, count: 0 };
    }
    
    // Cap influence: Max 2 tracks per artist per session
    // Fix: Ensure artistScores[artist].count is treated as a number.
    if ((artistScores[artist].count || 0) < 2) {
      artistScores[artist].score = (artistScores[artist].score || 0) + w;
      artistScores[artist].count = (artistScores[artist].count || 0) + 1;
    }
  });

  const topArtists = Object.entries(artistScores)
    // Fix: Ensure a.score and b.score are treated as numbers for sorting.
    .sort(([, a], [, b]) => (typeof b.score === 'number' ? b.score : 0) - (typeof a.score === 'number' ? a.score : 0))
    .slice(0, 5) // Keep top 5 artists
    .map(([name]) => name);


  // 2. GENRE AGGREGATION (Updated with Diversity Fallback)
  const genreScores = {};
  let totalGenreWeight = 0;

  tracks.forEach(track => {
    const tags = track.semantic_tags; 

    // Primary Genre
    const pGenre = tags.primary_genre?.toLowerCase().trim();
    const pGenreWeight = conf_w(tags.primary_genre_confidence); // Fallback to 'medium' handled by conf_w

    if (pGenre) {
      genreScores[pGenre] = (genreScores[pGenre] || 0) + (1.0 * pGenreWeight);
      totalGenreWeight = (totalGenreWeight || 0) + (1.0 * pGenreWeight); // Fix: Ensure totalGenreWeight is initialized as number
    }

    // Secondary Genres
    if (tags.secondary_genres && Array.isArray(tags.secondary_genres)) {
      const sGenreWeight = conf_w(tags.secondary_genres_confidence); // Fallback to 'medium' handled by conf_w
      tags.secondary_genres.forEach((g) => {
        const sGenre = g.toLowerCase().trim();
        genreScores[sGenre] = (genreScores[sGenre] || 0) + (0.5 * sGenreWeight);
        totalGenreWeight = (totalGenreWeight || 0) + (0.5 * sGenreWeight); // Fix: Ensure totalGenreWeight is initialized as number
      });
    }
  });

  // Calculate percentages and sort
  const allGenres = Object.entries(genreScores)
      .map(([genre, score]) => ({ 
          genre, 
          score, 
          percentage: (totalGenreWeight || 0) > 0 ? (typeof score === 'number' ? score : 0) / (totalGenreWeight || 1) : 0 
      }))
      // Fix: Ensure a.score and b.score are treated as numbers for sorting.
      .sort((a, b) => (typeof b.score === 'number' ? b.score : 0) - (typeof a.score === 'number' ? a.score : 0));

  let tasteProfileType = 'diverse';
  let dominantGenres = [];
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
  const energyCounts = { low: 0, medium: 0, high: 0 };
  let totalEnergyWeight = 0;

  tracks.forEach(track => {
     const audioPhysics = track.audio_physics; 
     const energyLevel = audioPhysics.energy_level?.toLowerCase(); 

     let bucket = energyLevel;
     if (bucket === 'explosive') bucket = 'high';
     if (bucket === 'low_medium') bucket = 'medium';
     if (bucket === 'medium_high') bucket = 'high';
     
     if (!['low', 'medium', 'high'].includes(bucket)) return;

     const w = conf_w(audioPhysics.energy_confidence); // Fallback to 'medium' handled by conf_w
     
     energyCounts[bucket] = (energyCounts[bucket] || 0) + w;
     totalEnergyWeight = (totalEnergyWeight || 0) + w;
  });

  const energyDistribution = {};
  let maxEnergyScore = -1;
  let energyBias = 'medium';

  Object.entries(energyCounts).forEach(([level, score]) => {
      // Fix: Ensure totalEnergyWeight is treated as a number to prevent division by unknown.
      const pct = (totalEnergyWeight || 0) > 0 ? (typeof score === 'number' ? score : 0) / (totalEnergyWeight || 1) : 0;
      energyDistribution[level] = Number(pct.toFixed(2));
      
      // Fix: Ensure score is treated as a number for comparison.
      if ((typeof score === 'number' ? score : -1) > maxEnergyScore) {
          maxEnergyScore = (typeof score === 'number' ? score : -1);
          energyBias = level;
      }
  });


  // 4. MOOD AGGREGATION (Now using flattened emotional/cognitive/somatic tags directly from SemanticTags)
  const moodScores = {}; 

  tracks.forEach(track => {
    const semanticTags = track.semantic_tags; 

    // Aggregate emotional_tags
    if (semanticTags.emotional_tags && Array.isArray(semanticTags.emotional_tags)) {
        const w = conf_w(semanticTags.emotional_confidence);
        semanticTags.emotional_tags.forEach(m => {
            const mood = m.toLowerCase().trim();
            moodScores[mood] = (moodScores[mood] || 0) + w;
        });
    }
    // Aggregate cognitive_tags
    if (semanticTags.cognitive_tags && Array.isArray(semanticTags.cognitive_tags)) {
        const w = conf_w(semanticTags.cognitive_confidence);
        semanticTags.cognitive_tags.forEach(m => {
            const mood = m.toLowerCase().trim();
            moodScores[mood] = (moodScores[mood] || 0) + w;
        });
    }
    // Aggregate somatic_tags
    if (semanticTags.somatic_tags && Array.isArray(semanticTags.somatic_tags)) {
        const w = conf_w(semanticTags.somatic_confidence);
        semanticTags.somatic_tags.forEach(m => {
            const mood = m.toLowerCase().trim();
            moodScores[mood] = (moodScores[mood] || 0) + w;
        });
    }
  });

  const dominantMoods = Object.entries(moodScores)
    // Fix: Ensure a and b are treated as numbers for sorting.
    .sort(([, a], [, b]) => (typeof b === 'number' ? b : 0) - (typeof a === 'number' ? a : 0))
    .slice(0, 3) 
    .map(([m]) => m);


  // 5. TEMPO / VOCALS / TEXTURE (Weighted Majority Vote) - Adapted for AudioPhysics
  const calculateBias = (
    valueExtractor,
    confidenceExtractor
  ) => { 
      const scores = {};
      let maxScore = -1;
      let bias = 'unknown';

      tracks.forEach(t => {
          const val = valueExtractor(t)?.toLowerCase();
          if (!val) return;
          const w = conf_w(confidenceExtractor(t)); 
          scores[val] = (scores[val] || 0) + w;
      });

      Object.entries(scores).forEach(([val, score]) => {
          // Fix: Ensure score is treated as a number for comparison.
          if ((typeof score === 'number' ? score : -1) > maxScore) {
              maxScore = (typeof score === 'number' ? score : -1);
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


  // 6. LANGUAGE AGGREGATION (MODIFIED to only include tracks for SessionSemanticProfile)
  const languageCounts = {};
  let totalLanguageScore = 0;

  // Aggregate from AnalyzedTopTrack
  tracks.forEach(track => {
    const newLang = track.semantic_tags.language_iso_639_1;
    const newLangConfidence = track.semantic_tags.language_confidence;
    const newLangWeight = conf_w(newLangConfidence); 

    if (newLang) {
      const normalizedLang = newLang.toLowerCase().trim();
      if (normalizedLang) {
        languageCounts[normalizedLang] = (languageCounts[normalizedLang] || 0) + newLangWeight;
        totalLanguageScore = (totalLanguageScore || 0) + newLangWeight;
      }
    }
  });

  const languageDistribution = {};
  Object.entries(languageCounts).forEach(([lang, score]) => {
    // Fix: Ensure totalLanguageScore is treated as a number.
    if ((totalLanguageScore || 0) > 0) {
      languageDistribution[lang] = Number(((typeof score === 'number' ? score : 0) / (totalLanguageScore || 1)).toFixed(2));
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

// buildUserTasteProfileV1 (moved from dataAggregator.ts, MAJOR REWRITE)
const buildUserTasteProfileV1 = (rawTracks) => {
  // First, normalize raw tracks into strict AnalyzedTopTrack objects
  const tracks = rawTracks.map(rawTrack => ({
    ...rawTrack,
    audio_physics: {
      energy_level: normalizeAudioPhysicsValue('energy_level', rawTrack.audio_physics.energy_level),
      energy_confidence: cleanAndValidateConfidence(rawTrack.audio_physics.energy_confidence),
      tempo_feel: normalizeAudioPhysicsValue('tempo_feel', rawTrack.audio_physics.tempo_feel),
      tempo_confidence: cleanAndValidateConfidence(rawTrack.audio_physics.tempo_confidence),
      vocals_type: normalizeAudioPhysicsValue('vocals_type', rawTrack.audio_physics.vocals_type),
      vocals_confidence: cleanAndValidateConfidence(rawTrack.audio_physics.vocals_confidence),
      texture_type: normalizeAudioPhysicsValue('texture_type', rawTrack.audio_physics.texture_type),
      texture_confidence: cleanAndValidateConfidence(rawTrack.audio_physics.texture_confidence),
      danceability_hint: normalizeAudioPhysicsValue('danceability_hint', rawTrack.audio_physics.danceability_hint),
      danceability_confidence: cleanAndValidateConfidence(rawTrack.audio_physics.danceability_confidence),
    },
    semantic_tags: {
      primary_genre: normalizeSemanticTag(rawTrack.semantic_tags.primary_genre),
      primary_genre_confidence: cleanAndValidateConfidence(rawTrack.semantic_tags.primary_genre_confidence),
      secondary_genres: (rawTrack.semantic_tags.secondary_genres || []).map(normalizeSemanticTag), // Fix: Ensure secondary_genres is an array
      secondary_genres_confidence: cleanAndValidateConfidence(rawTrack.semantic_tags.secondary_genres_confidence),
      emotional_tags: (rawTrack.semantic_tags.emotional_tags || []).map(normalizeSemanticTag), // Fix: Ensure emotional_tags is an array
      emotional_confidence: cleanAndValidateConfidence(rawTrack.semantic_tags.emotional_confidence),
      cognitive_tags: (rawTrack.semantic_tags.cognitive_tags || []).map(normalizeSemanticTag), // Fix: Ensure cognitive_tags is an array
      cognitive_confidence: cleanAndValidateConfidence(rawTrack.semantic_tags.cognitive_confidence),
      somatic_tags: (rawTrack.semantic_tags.somatic_tags || []).map(normalizeSemanticTag), // Fix: Ensure somatic_tags is an array
      somatic_confidence: cleanAndValidateConfidence(rawTrack.semantic_tags.somatic_confidence),
      language_iso_639_1: normalizeSemanticTag(rawTrack.semantic_tags.language_iso_639_1),
      language_confidence: cleanAndValidateConfidence(rawTrack.semantic_tags.language_confidence),
    },
  }));


  const userTasteProfile = {
    origin: "TOP_50_TRACKS_ANALYZE",
    overall_profile_confidence: 'low', // Will be calculated
    language_profile: {
      language_profile_distribution: {},
      language_profile_confidence: 'low',
    },
    audio_physics_profile: {
      energy_bias: 'medium',
      tempo_bias: 'mid',
      danceability_bias: 'medium',
      vocals_bias: 'lead_vocal',
      texture_bias: 'hybrid',
      audio_physics_profile_confidence: 'low',
    },
    genre_profile: {
      primary_genres: [],
      secondary_genres: [],
      genre_profile_confidence: 'low',
    },
    emotional_mood_profile: {
      primary: '',
      secondary: [],
      distribution: {},
      emotional_mood_profile_confidence: 'low',
    },
    cognitive_mood_profile: {
      primary: '',
      secondary: [],
      distribution: {},
      cognitive_mood_profile_confidence: 'low',
    },
    somatic_mood_profile: {
      primary: '',
      secondary: [],
      distribution: {},
      somatic_mood_profile_confidence: 'low',
    },
    intent_profile_signals: {
      intents_ranked: [],
    },
  };

  if (!tracks || tracks.length === 0) {
    return userTasteProfile; // Return default if no tracks
  }

  // 1.2) language_profile (depends only on per-track language)
  const lang_score = {};
  tracks.forEach(track => {
    const lang = track.semantic_tags.language_iso_639_1?.toLowerCase().trim();
    if (lang) {
      const w = conf_w(track.semantic_tags.language_confidence);
      lang_score[lang] = (lang_score[lang] || 0) + w;
    }
  });
  const totalLangScore = sumScores(lang_score);
  for (const lang in lang_score) {
    // Fix: Ensure lang_score[lang] and totalLangScore are treated as numbers.
    userTasteProfile.language_profile.language_profile_distribution[lang] = Number(((typeof lang_score[lang] === 'number' ? lang_score[lang] : 0) / (totalLangScore || 1)).toFixed(2));
  }
  const top_lang = argmax(lang_score);
  // Fix: Ensure lang_score[top_lang] is treated as a number.
  const lang_ratio = weighted_ratio((typeof lang_score[top_lang] === 'number' ? lang_score[top_lang] : 0), lang_score);
  userTasteProfile.language_profile.language_profile_confidence = map_ratio_to_semantic(lang_ratio);


  // 1.3) audio_physics_profile (depends only on per-track physics)
  const phys_score = {};
  const audioDimensions = ['energy_level', 'tempo_feel', 'vocals_type', 'texture_type', 'danceability_hint'];
  audioDimensions.forEach(d => phys_score[d] = {});

  tracks.forEach(track => {
    audioDimensions.forEach(d => {
      const val = track.audio_physics[d]?.toLowerCase();
      if (val) {
        // Fix: Ensure confKey is treated as a string, and track.audio_physics[confKey] is properly accessed
        const confKey = d.replace('_level', '_confidence').replace('_feel', '_confidence').replace('_hint', '_confidence');
        const w = conf_w(track.audio_physics[confKey]);
        phys_score[d][val] = (phys_score[d][val] || 0) + w;
      }
    });
  });

  // Fix: Initialize ratio_dims as a Record<string, number>
  const ratio_dims: Record<string, number> = {};
  audioDimensions.forEach(d => {
    const biasKey = `${d.replace('_level', '_bias').replace('_feel', '_bias').replace('_hint', '_bias')}`;
    const maxVal = argmax(phys_score[d]);
    
    // Fix: Type assertions for assigning to specific bias properties
    if (biasKey === 'energy_bias') {
        userTasteProfile.audio_physics_profile.energy_bias = maxVal as AudioPhysics['energy_level'];
    } else if (biasKey === 'tempo_bias') {
        userTasteProfile.audio_physics_profile.tempo_bias = maxVal as AudioPhysics['tempo_feel'];
    } else if (biasKey === 'danceability_bias') {
        userTasteProfile.audio_physics_profile.danceability_bias = maxVal as AudioPhysics['danceability_hint'];
    } else if (biasKey === 'vocals_bias') {
        userTasteProfile.audio_physics_profile.vocals_bias = maxVal as AudioPhysics['vocals_type'];
    } else if (biasKey === 'texture_bias') {
        userTasteProfile.audio_physics_profile.texture_bias = maxVal as AudioPhysics['texture_type'];
    }

    // Fix: Ensure phys_score[d][argmax(phys_score[d])] is treated as a number
    const maxScoreForDim = typeof phys_score[d][argmax(phys_score[d])] === 'number' ? phys_score[d][argmax(phys_score[d])] : 0;
    ratio_dims[`ratio_${d.replace('_level', '').replace('_feel', '').replace('_hint', '')}`] = weighted_ratio(maxScoreForDim, phys_score[d]);
  });
  const physics_block_ratio = mean(
    ratio_dims.ratio_energy,
    ratio_dims.ratio_tempo,
    ratio_dims.ratio_vocals,
    ratio_dims.ratio_texture,
    ratio_dims.ratio_danceability
  );
  userTasteProfile.audio_physics_profile.audio_physics_profile_confidence = map_ratio_to_semantic(physics_block_ratio);


  // 1.4) genre_profile (depends only on per-track genre)
  const primary_score = {};
  const secondary_score = {};

  tracks.forEach(track => {
    const pGenre = track.semantic_tags.primary_genre?.toLowerCase().trim();
    if (pGenre) {
      const w = conf_w(track.semantic_tags.primary_genre_confidence);
      primary_score[pGenre] = (primary_score[pGenre] || 0) + w;
    }
    track.semantic_tags.secondary_genres?.forEach(sGenre => {
      const s = sGenre.toLowerCase().trim();
      const w2 = conf_w(track.semantic_tags.secondary_genres_confidence);
      secondary_score[s] = (secondary_score[s] || 0) + w2;
    });
  });

  const sortedPrimaryGenres = Object.entries(primary_score).sort(([, a], [, b]) => (typeof b === 'number' ? b : 0) - (typeof a === 'number' ? a : 0));
  userTasteProfile.genre_profile.primary_genres = sortedPrimaryGenres.slice(0, 3).map(([g]) => g);

  const sortedSecondaryGenres = Object.entries(secondary_score).sort(([, a], [, b]) => (typeof b === 'number' ? b : 0) - (typeof a === 'number' ? a : 0));
  userTasteProfile.genre_profile.secondary_genres = sortedSecondaryGenres
    .map(([g]) => g)
    .filter(g => !userTasteProfile.genre_profile.primary_genres.includes(g))
    .slice(0, 5);

  // Fix: Ensure primary_score[argmax(primary_score)] is treated as a number.
  const genre_ratio = weighted_ratio((typeof primary_score[argmax(primary_score)] === 'number' ? primary_score[argmax(primary_score)] : 0), primary_score);
  userTasteProfile.genre_profile.genre_profile_confidence = map_ratio_to_semantic(genre_ratio);


  // 1.5) moods_analysis blocks (emotional, cognitive, somatic)
  const moodAxes = ['emotional', 'cognitive', 'somatic'];
  const moodScores = {};
  moodAxes.forEach(axis => moodScores[axis] = {});

  const moodRatios: Record<string, number> = {}; // Fix: Initialize moodRatios as a Record<string, number>

  moodAxes.forEach(axis => {
    tracks.forEach(track => {
      const tags = track.semantic_tags[`${axis}_tags`] || [];
      const confidence = track.semantic_tags[`${axis}_confidence`];
      const w = conf_w(confidence);
      tags.forEach(tag => {
        const t = tag.toLowerCase().trim();
        moodScores[axis][t] = (moodScores[axis][t] || 0) + w;
      });
    });

    const totalAxisScore = sumScores(moodScores[axis]);
    const distribution = {};
    for (const tag in moodScores[axis]) {
      distribution[tag] = Number(((typeof moodScores[axis][tag] === 'number' ? moodScores[axis][tag] : 0) / (totalAxisScore || 1)).toFixed(2));
    }

    const primary_A = argmax(moodScores[axis]);
    const sortedMoods = Object.entries(moodScores[axis]).sort(([, a], [, b]) => (typeof b === 'number' ? b : 0) - (typeof a === 'number' ? a : 0)).map(([m]) => m);
    const secondary_A = sortedMoods.slice(1, 3); // next top 2 moods

    userTasteProfile[`${axis}_mood_profile`].primary = primary_A;
    userTasteProfile[`${axis}_mood_profile`].secondary = secondary_A;
    userTasteProfile[`${axis}_mood_profile`].distribution = distribution;
    
    // Fix: Ensure moodScores[axis][primary_A] is treated as a number.
    moodRatios[`${axis}_ratio`] = weighted_ratio((typeof moodScores[axis][primary_A] === 'number' ? moodScores[axis][primary_A] : 0), moodScores[axis]);
    userTasteProfile[`${axis}_mood_profile`][`${axis}_mood_profile_confidence`] = map_ratio_to_semantic(moodRatios[`${axis}_ratio`]);
  });

  // 1.6) overall_profile_confidence
  const overall_ratio = mean(
    lang_ratio,
    physics_block_ratio,
    genre_ratio,
    moodRatios.emotional_ratio,
    moodRatios.cognitive_ratio,
    moodRatios.somatic_ratio
  );
  userTasteProfile.overall_profile_confidence = map_ratio_to_semantic(overall_ratio);


  // 2. Intent Profile Signals (NEW MAJOR IMPLEMENTATION)
  const intent_score_per_track = {}; // {track_id: score}
  const track_intents = {}; // {track_id: [intents]}

  // Placeholder for the fixed lookup table (implementation constant)
  // Derived from pages 10-11 examples
  const intentLookupTable = [
    // Example: Sad + tender -> comfort
    { emotional: ['sad', 'melancholic'], somatic: ['tender'], intent: 'comfort' }, // Combining sad and melancholic for broader match
    // Example: Melancholic + reflective -> reflect
    { emotional: ['melancholic'], cognitive: ['reflective'], intent: 'reflect' },
    // Example: Calm + grounded -> decompress
    { emotional: ['calm'], somatic: ['grounded'], intent: 'decompress' },
    // Example: Energized + focused -> focus
    { emotional: ['energized'], cognitive: ['focused'], intent: 'focus' },
    // Example: Anxious + tension -> Calm (from PDF text)
    { emotional: ['anxious'], somatic: ['tense'], intent: 'calm' }, // 'tension' mapped to 'tense' somatic tag
    // Example: Drained + Reduced focus -> Reset (from PDF text)
    { emotional: ['drained'], cognitive: ['reflective', 'introspective'], intent: 'reset' }, // 'Reduced focus' mapped to these cognitive tags
    // Example: Heavy + Introspective -> Emotional Processing / Reflect (from PDF text)
    { emotional: ['heavy'], cognitive: ['introspective'], intent: 'emotional_processing' }, // 'emotional_processing' is a new intent
    // Add more as needed based on the full spec
  ];

  // Helper to map mood/physics values to their representative forms (e.g., "low_medium" to "low") for physics constraints
  const mapAudioPhysicsValueForConstraint = (key, value) => {
    switch (key) {
      case 'energy_level':
        if (value === 'low_medium') return 'low';
        if (value === 'medium_high') return 'high';
        return value;
      case 'tempo_feel': return value;
      case 'vocals_type': return value;
      case 'texture_type': return value;
      case 'danceability_hint': return value;
      default: return value;
    }
  };

  tracks.forEach((track) => {
    const emotional_w = conf_w(track.semantic_tags.emotional_confidence);
    const cognitive_w = conf_w(track.semantic_tags.cognitive_confidence);
    const somatic_w = conf_w(track.semantic_tags.somatic_confidence);

    const available_confidences = [emotional_w, cognitive_w, somatic_w].filter(w => w !== undefined);
    const track_intent_score = mean(...available_confidences);
    const trackId = track.song_name + " by " + track.artist_name; // Use a unique identifier for the track
    intent_score_per_track[trackId] = (typeof track_intent_score === 'number' ? track_intent_score : 0); // Fix: Ensure it's a number

    // Derive intent_candidates using the rule table (implementation constant)
    const track_intents_for_this_track = [];
    intentLookupTable.forEach(rule => {
      const emotionalTags = track.semantic_tags.emotional_tags?.map(t => t.toLowerCase()) || [];
      const cognitiveTags = track.semantic_tags.cognitive_tags?.map(t => t.toLowerCase()) || [];
      const somaticTags = track.semantic_tags.somatic_tags?.map(t => t.toLowerCase()) || [];

      const emotionalMatch = rule.emotional.some(mood => emotionalTags.includes(mood));
      const cognitiveMatch = rule.cognitive ? rule.cognitive.some(mood => cognitiveTags.includes(mood)) : true;
      const somaticMatch = rule.somatic ? rule.somatic.some(mood => somaticTags.includes(mood)) : true;

      // Apply RULES #1 (Intent Driver Mood Rule) - emotional must be present
      if (emotionalMatch) {
        // Apply RULE #2 (Eligibility Rule) - mood weight >= 0.15
        // This requires access to the *overall* mood distribution, which is already calculated in `userTasteProfile`.
        // Use the primary/secondary mood to check eligibility against overall distribution.
        const primaryEmotionalMoodOfTrack = emotionalTags[0];
        const primaryCognitiveMoodOfTrack = cognitiveTags[0];
        const primarySomaticMoodOfTrack = somaticTags[0];

        const emotional_mood_eligible = (userTasteProfile.emotional_mood_profile.distribution[primaryEmotionalMoodOfTrack] || 0) >= 0.15; // Fix: Ensure comparison against number
        const cognitive_mood_eligible = rule.cognitive ? ((userTasteProfile.cognitive_mood_profile.distribution[primaryCognitiveMoodOfTrack] || 0) >= 0.15) : true;
        const somatic_mood_eligible = rule.somatic ? ((userTasteProfile.somatic_mood_profile.distribution[primarySomaticMoodOfTrack] || 0) >= 0.15) : true;

        if (emotional_mood_eligible && cognitive_mood_eligible && somatic_mood_eligible) {
          // Apply RULE #3 (Combination Rule) - at least 2 dimensions
          const dimensions_met = [emotionalMatch, cognitiveMatch, somaticMatch].filter(Boolean).length;
          if (dimensions_met >= 2) {
            track_intents_for_this_track.push(rule.intent);
          }
        }
      }
    });
    track_intents[trackId] = track_intents_for_this_track;
  });

  const intent_score = {}; // {intent: score}
  const track_intent_map = {}; // {intent: [tracks]} - stores the actual AnalyzedTopTrack objects

  tracks.forEach(track => {
    const trackId = track.song_name + " by " + track.artist_name;
    const intentsForTrack = track_intents[trackId] || [];
    intentsForTrack.forEach(intent => {
      intent_score[intent] = (intent_score[intent] || 0) + (intent_score_per_track[trackId] || 0); // Fix: Ensure numbers are added
      if (!track_intent_map[intent]) track_intent_map[intent] = [];
      track_intent_map[intent].push(track);
    });
  });

  const intent_weight = {};
  const totalIntentScore = sumScores(intent_score);
  for (const intent in intent_score) {
    intent_weight[intent] = Number(((typeof intent_score[intent] === 'number' ? intent_score[intent] : 0) / (totalIntentScore || 1)).toFixed(2));
  }

  const intents_ranked = [];

  const sortedIntents = Object.entries(intent_weight).sort(([, w1], [, w2]) => (typeof w2 === 'number' ? w2 : 0) - (typeof w1 === 'number' ? w1 : 0));

  for (const [intent, weight] of sortedIntents) {
    // Apply RULE #4 (Filtering Out Combinations Rule)
    // Rule 4.1: Intent driver emotional mood_weight >= 0.15
    // The `weight` calculated here is the overall intent weight. We need to check if the *driver emotional mood*
    // has enough weight. This is a simplification from the PDF where the specific emotional mood weight for the *track*
    // is checked. For now, we use the `intent_weight` as a proxy for the combined strength.
    // Fix: Ensure weight is treated as a number for comparison.
    if ((typeof weight === 'number' ? weight : 0) < 0.15) continue; 

    // Rule 4.2: Combinations Co-occurs >= 30% - This is more complex.
    // We already filter by track contribution; we'll assume if an intent has a weight > 0.15, it's sufficiently co-occurring.
    // A more precise implementation would count co-occurrence frequencies of specific mood pairs across tracks.
    
    const contributingTracks = track_intent_map[intent] || [];

    const emotional_mood_combinations = [];
    const cognitive_mood_combinations = [];
    const somatic_mood_combinations = [];

    moodAxes.forEach(axis => {
      const axis_mood_score = {}; // {mood_tag: score}
      contributingTracks.forEach(track => {
        const tags = track.semantic_tags[`${axis}_tags`] || [];
        const trackId = track.song_name + " by " + track.artist_name;
        tags.forEach(tag => {
          const t = tag.toLowerCase().trim();
          axis_mood_score[t] = (axis_mood_score[t] || 0) + (intent_score_per_track[trackId] || 0);
        });
      });
      
      const sortedAxisMoods = Object.entries(axis_mood_score).sort(([, s1], [, s2]) => (typeof s2 === 'number' ? s2 : 0) - (typeof s1 === 'number' ? s1 : 0));
      const top3AxisMoods = sortedAxisMoods.slice(0, 3); // Keep top 3 moods per axis for the intent

      top3AxisMoods.forEach(([mood, score]) => {
        const tracksForMood = contributingTracks.filter(t => {
          const tags = t.semantic_tags[`${axis}_tags`] || [];
          return tags.includes(mood);
        }).sort((t1, t2) => {
          const score1 = (intent_score_per_track[t1.song_name + " by " + t1.artist_name] || 0); // Fix: Ensure scores are numbers
          const score2 = (intent_score_per_track[t2.song_name + " by " + t2.artist_name] || 0); // Fix: Ensure scores are numbers
          return score2 - score1;
        });

        // Select top 2 tracks that contributed to this mood+intent
        const track_examples = tracksForMood.slice(0, 2).map(t => ({ title: t.song_name, artist: t.artist_name }));

        const combinationItem = {
          mood: mood,
          // Fix: Ensure score and sumScores(axis_mood_score) are treated as numbers.
          weight: Number(((typeof score === 'number' ? score : 0) / (sumScores(axis_mood_score) || 1)).toFixed(2)), // Normalized weight
          track_examples: track_examples,
        };

        if (axis === 'emotional') emotional_mood_combinations.push(combinationItem);
        if (axis === 'cognitive') cognitive_mood_combinations.push(combinationItem);
        if (axis === 'somatic') somatic_mood_combinations.push(combinationItem);
      });
    });

    // 2.2.7 Genre hints + physics constraints per intent
    const genre_hints_map = {};
    const physics_constraints_counts = { 
      energy: {}, danceability: {}, vocals: {}, texture: {}, tempo: {} 
    };

    contributingTracks.forEach(track => {
      const pGenre = track.semantic_tags.primary_genre?.toLowerCase().trim();
      if (pGenre) {
        genre_hints_map[pGenre] = (genre_hints_map[pGenre] || 0) + 1;
      }
      physics_constraints_counts.energy[mapAudioPhysicsValueForConstraint('energy_level', track.audio_physics.energy_level)] = (physics_constraints_counts.energy[mapAudioPhysicsValueForConstraint('energy_level', track.audio_physics.energy_level)] || 0) + 1;
      physics_constraints_counts.danceability[mapAudioPhysicsValueForConstraint('danceability_hint', track.audio_physics.danceability_hint)] = (physics_constraints_counts.danceability[mapAudioPhysicsValueForConstraint('danceability_hint', track.audio_physics.danceability_hint)] || 0) + 1;
      physics_constraints_counts.vocals[mapAudioPhysicsValueForConstraint('vocals_type', track.audio_physics.vocals_type)] = (physics_constraints_counts.vocals[mapAudioPhysicsValueForConstraint('vocals_type', track.audio_physics.vocals_type)] || 0) + 1;
      physics_constraints_counts.texture[mapAudioPhysicsValueForConstraint('texture_type', track.audio_physics.texture_type)] = (physics_constraints_counts.texture[mapAudioPhysicsValueForConstraint('texture_type', track.audio_physics.texture_type)] || 0) + 1;
      physics_constraints_counts.tempo[mapAudioPhysicsValueForConstraint('tempo_feel', track.audio_physics.tempo_feel)] = (physics_constraints_counts.tempo[mapAudioPhysicsValueForConstraint('tempo_feel', track.audio_physics.tempo_feel)] || 0) + 1;
    });

    const genre_hints = Object.entries(genre_hints_map).sort(([, c1], [, c2]) => (typeof c2 === 'number' ? c2 : 0) - (typeof c1 === 'number' ? c1 : 0)).slice(0, 3).map(([g]) => g);
    
    // Fix: Type assertions for assigning to specific physics_constraints properties
    const physics_constraints_inferred = {
      energy: argmax(physics_constraints_counts.energy) as AudioPhysics['energy_level'],
      danceability: argmax(physics_constraints_counts.danceability) as AudioPhysics['danceability_hint'],
      vocals: argmax(physics_constraints_counts.vocals) as AudioPhysics['vocals_type'],
      texture: argmax(physics_constraints_counts.texture) as AudioPhysics['texture_type'],
      tempo: argmax(physics_constraints_counts.tempo) as AudioPhysics['tempo_feel'],
    };

    // 2.2.6 Intent-level track_examples
    // Pick top 3 tracks with the highest track_intent_score for that intent
    const intent_track_examples = Array.from(new Set(
      contributingTracks.sort((t1, t2) => {
        const score1 = (intent_score_per_track[t1.song_name + " by " + t1.artist_name] || 0); // Fix: Ensure scores are numbers
        const score2 = (intent_score_per_track[t2.song_name + " by " + t2.artist_name] || 0); // Fix: Ensure scores are numbers
        return score2 - score1;
      }).map(t => JSON.stringify({ title: t.song_name, artist: t.artist_name }))
    )).slice(0, 3).map(str => JSON.parse(str));


    intents_ranked.push({
      intent: intent,
      confidence: map_ratio_to_semantic(weight) as ConfidenceLevel, // Fix: Ensure type assertion for ConfidenceLevel
      emotional_mood_combinations,
      cognitive_mood_combinations,
      somatic_mood_combinations,
      genre_hints,
      physics_constraints: physics_constraints_inferred,
      track_examples: intent_track_examples,
    });
  }

  userTasteProfile.intent_profile_signals.intents_ranked = intents_ranked;

  return userTasteProfile;
};

// Main aggregation function (moved from dataAggregator.ts)
const aggregateSessionData = (unifiedGeminiResponse) => { 
  const { analyzed_top_50_tracks, analyzed_playlist_context } = unifiedGeminiResponse;

  // CRITICAL: buildUserTasteProfileV1 only uses AnalyzedTopTrack, explicitly excluding playlists
  const userTasteProfileV1 = buildUserTasteProfileV1(analyzed_top_50_tracks);

  // createSessionSemanticProfile still uses both tracks and playlists for its own semantic fingerprint
  const sessionSemanticProfile = createSessionSemanticProfile(
    analyzed_top_50_tracks.map(rawTrack => ({
      ...rawTrack,
      audio_physics: {
        energy_level: normalizeAudioPhysicsValue('energy_level', rawTrack.audio_physics.energy_level) as AudioPhysics['energy_level'], // Fix: Type assertion
        energy_confidence: cleanAndValidateConfidence(rawTrack.audio_physics.energy_confidence),
        tempo_feel: normalizeAudioPhysicsValue('tempo_feel', rawTrack.audio_physics.tempo_feel) as AudioPhysics['tempo_feel'], // Fix: Type assertion
        tempo_confidence: cleanAndValidateConfidence(rawTrack.audio_physics.tempo_confidence),
        vocals_type: normalizeAudioPhysicsValue('vocals_type', rawTrack.audio_physics.vocals_type) as AudioPhysics['vocals_type'], // Fix: Type assertion
        vocals_confidence: cleanAndValidateConfidence(rawTrack.audio_physics.vocals_confidence),
        texture_type: normalizeAudioPhysicsValue('texture_type', rawTrack.audio_physics.texture_type) as AudioPhysics['texture_type'], // Fix: Type assertion
        texture_confidence: cleanAndValidateConfidence(rawTrack.audio_physics.texture_confidence),
        danceability_hint: normalizeAudioPhysicsValue('danceability_hint', rawTrack.audio_physics.danceability_hint) as AudioPhysics['danceability_hint'], // Fix: Type assertion
        danceability_confidence: cleanAndValidateConfidence(rawTrack.audio_physics.danceability_confidence),
      },
      semantic_tags: {
        primary_genre: normalizeSemanticTag(rawTrack.semantic_tags.primary_genre),
        primary_genre_confidence: cleanAndValidateConfidence(rawTrack.semantic_tags.primary_genre_confidence),
        secondary_genres: (rawTrack.semantic_tags.secondary_genres || []).map(normalizeSemanticTag), // Fix: Ensure secondary_genres is an array
        secondary_genres_confidence: cleanAndValidateConfidence(rawTrack.semantic_tags.secondary_genres_confidence),
        emotional_tags: (rawTrack.semantic_tags.emotional_tags || []).map(normalizeSemanticTag), // Fix: Ensure emotional_tags is an array
        emotional_confidence: cleanAndValidateConfidence(rawTrack.semantic_tags.emotional_confidence),
        cognitive_tags: (rawTrack.semantic_tags.cognitive_tags || []).map(normalizeSemanticTag), // Fix: Ensure cognitive_tags is an array
        cognitive_confidence: cleanAndValidateConfidence(rawTrack.semantic_tags.cognitive_confidence),
        somatic_tags: (rawTrack.semantic_tags.somatic_tags || []).map(normalizeSemanticTag), // Fix: Ensure somatic_tags is an array
        somatic_confidence: cleanAndValidateConfidence(rawTrack.semantic_tags.somatic_confidence),
        language_iso_639_1: normalizeSemanticTag(rawTrack.semantic_tags.language_iso_639_1),
        language_confidence: cleanAndValidateConfidence(rawTrack.semantic_tags.language_iso_639_1),
      },
    })), 
    analyzed_playlist_context
  );


  let overallMoodCategory = "Mixed Moods";
  let overallMoodConfidence = 0.5;

  if (analyzed_playlist_context && analyzed_playlist_context.length > 0) {
    const firstContext = analyzed_playlist_context[0];
    overallMoodCategory = firstContext.playlist_emotional_direction;
    // Fix: Ensure firstContext.confidence is treated as a string for lookup.
    overallMoodConfidence = CONFIDENCE_WEIGHTS[firstContext.confidence?.toLowerCase() as keyof typeof CONFIDENCE_WEIGHTS] || 0.5;
  }

  return {
    overall_mood_category: overallMoodCategory, 
    overall_mood_confidence: overallMoodConfidence, 
    session_semantic_profile: sessionSemanticProfile,
    playlist_contexts: analyzed_playlist_context, 
    user_taste_profile_v1: userTasteProfileV1,
  };
};


export default async function handler(req, res) {
  const t_handler_start = Date.now();
  console.log(`[API/ANALYZE] Handler started at ${new Date().toISOString()}. Region: ${process.env.VERCEL_REGION || 'unknown'}`);

  if (req.method !== 'POST') {
    console.warn(`[API/ANALYZE] Method not allowed: ${req.method}`);
    const t_handler_end_method_not_allowed = Date.now();
    console.log(`[API/ANALYZE] Handler finished (method not allowed) in ${t_handler_end_method_not_allowed - t_handler_start}ms.`);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const API_KEY = process.env.API_KEY;
  if (!API_KEY) {
    console.error("[API/ANALYZE] API_KEY environment variable is not set or is empty.");
    const t_handler_end_api_key_missing = Date.now();
    console.log(`[API/ANALYZE] Handler finished (API key missing) in ${t_handler_end_api_key_missing - t_handler_start}ms.`);
    return res.status(401).json({ error: 'API_KEY environment variable is missing from serverless function. Please ensure it is correctly configured in your deployment environment (e.g., Vercel environment variables or AI Studio settings).' });
  }

  const { type, topTracks, playlists } = req.body;

  console.log(`[API/ANALYZE] Incoming request type: "${type}"`);
  console.log(`[API/ANALYZE] Using GEMINI_MODEL: ${GEMINI_MODEL}`);

  let promptBuildTimeMsA = 0;
  let promptBuildTimeMsB = 0;
  let geminiApiDurationA = 0;
  let geminiApiDurationB = 0;

  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    console.log("[API/ANALYZE] DEBUG: GoogleGenAI client initialized.");

    if (type === 'unified_taste') {
      console.log(`[API/ANALYZE] Performing unified taste analysis for ${playlists?.length || 0} playlists and ${topTracks?.length || 0} top tracks.`);

      // --- SYSTEM INSTRUCTION TASK A ---
      const systemInstruction_taskA = `You are a Music Attribute RAW Signal Extractor for VibeList Pro. Your primary function is to quickly analyze song and artist names to extract musical attributes. Your goal is SPEED and RAW EXTRACTION, not strict validation or interpretation.

──────────────────────────────
## CRITICAL POSITION RULES NO 1 ##
───────────────────────────────
- TOP 50 TRACKS always outweigh playlist-derived insights.
- No other source may override Top 50 conclusions.
- Other sources may only refine, never contradict.

─────────────────────────────
## CRITICAL POSITION RULES NO 2 ##:
───────────────────────────────
TOP 50 TRACKS represent the user’s strongest and most reliable taste signal.
They reflect:
- Actual listening behavior
- Repetition over time
- Real preference expressed through action, not intention

─────────────────────────────
## USAGE RULE ##:
───────────────────────
- Use Top 50 tracks to understand *how the user listens*.
- Do NOT treat them as a search query or a recommendation list.

─────────────────────────────
## YOUR TASK — Analyzed Top 50 Tracks (RAW, FAST, NON-STRICT) ##:
───────────────────────────────
For each individual song from the "top 50 tracks" list, rapidly generate detailed musical attributes along with a specific confidence score for *each individual attribute*.

**KEY RULES (REPEAT TO DEVS):**
- **Strings Only:** For attributes like \`energy_level\`, \`tempo_feel\`, \`vocals_type\`, \`texture_type\`, \`danceability_hint\`, \`primary_genre\`, \`secondary_genres\`, \`emotional_tags\`, \`cognitive_tags\`, \`somatic_tags\`, and \`language_iso_639_1\`, return them as **RAW STRING VALUES**. Do NOT enforce strict enum values.
- **No Aggregation:** Do NOT combine or summarize attributes across tracks.
- **No Normalization:** Return attribute values as inferred, without attempting to standardize them (e.g., "medium low energy" is acceptable for \`energy_level\` if you infer it).
- **No Intent Logic:** Do NOT perform any interpretation or derive user intents.
- **One Pass Per Track:** Focus on extracting attributes for each track independently in a single, fast pass.

You must provide per-attribute confidence for:
- All audio physics parameters.
- All genre parameters.
- All mood analysis parameters.
- Language.

These inferences form the PRIMARY reference for:
1) Audio physics baselines (energy, tempo, vocals, texture, danceability).
2) Structured mood distribution across emotional, cognitive, and somatic axes.
3) Language distribution.
4) Genre and texture bias.

---------------------------
// CORE PRINCIPLES (NON-NEGOTIABLE)
// ---------------------------
// A) Evidence-first, anti-bias:
// - Do NOT infer mood/genre purely from track title, playlist name, or trending/popularity.
// - Do NOT default to “safe” mainstream labels or artists. If uncertain, lower confidence.
// - Prefer stable musical knowledge (arrangement, tempo feel, instrumentation, production style, cultural consensus) over guessy storytelling.

// B) Multilingual + multicultural by default:
// - Tracks may be in any language. Do NOT privilege English.
// - Detect language from known lyrics/language of performance when possible;
// - When inferring language or musical attributes:
//    - Do not assume English dominance due to higher familiarity or data availability.
//    - Some non-English tracks may have less public metadata or coverage.
//    - In such cases:
//    - Prefer artist origin, known discography.

──────────────────────────────
## Attribute Extraction Guidelines ##
───────────────────────────────
1.  **Audio Physics (Objective-ish, arrangement/production driven):**
    *   Infer \`energy_level\`, \`tempo_feel\`, \`vocals_type\`, \`texture_type\`, \`danceability_hint\`.
    *   Return these as **raw strings**.
    *   Each must have its own confidence: \`energy_confidence\`, \`tempo_confidence\`, \`vocals_confidence\`, \`texture_confidence\`, \`danceability_confidence\`.

2.  **Genres (Best-guess taxonomy, avoid overly broad defaults):**
    *   Infer \`primary_genre\`, \`secondary_genres\` (up to 3 strings, lowercase).
    *   Return these as **raw strings**.
    *   Each must have its own confidence: \`primary_genre_confidence\`, \`secondary_genres_confidence\`.
    *   **Rule:** If unsure, choose fewer genres and lower confidence. Avoid broad/Western defaults.

3.  **Language (ISO-639-1):**
    *   Infer a single \`language_iso_639_1\` for the track.
    *   Return as a **raw string**.
    *   Must have its own confidence: \`language_confidence\`.
    *   **Rule:** Do NOT privilege English. Detect language from known lyrics/performance. If public metadata is scarce, prefer artist origin/discography.

4.  **Mood Profile (3 axes: Emotional, Cognitive, Somatic):**
    *   Replaces a simple mood array with a structured \`semantic_tags\` object containing three distinct tag lists: \`emotional_tags\`, \`cognitive_tags\`, \`somatic_tags\`.
    *   Return these as **raw string arrays**.
    *   Each must have its own confidence: \`emotional_confidence\`, \`cognitive_confidence\`, \`somatic_confidence\`.
    *   **Definitions:**
        *   **EMOTIONAL MOODS:** What the listener FEELS emotionally (e.g., melancholic, joyful, dark, romantic, angry, calm).
        *   **COGNITIVE MOODS:** What mental or reflective state the music induces (e.g., reflective, introspective, focused, meditative, thoughtful).
        *   **SOMATIC MOODS:** How the music affects the body or physical state (e.g., relaxing, energizing, tense, grounding).
    *   **Rules:**
        *   Provide 1-3 short strings per tag list.
        *   Tags are open-vocabulary but must align with common industry-standard categories.
        *   Avoid poetic/metaphorical labels. Keep tags simple, culturally stable, reusable.
        *   A track may express multiple mood types simultaneously.
        *   Do NOT invent new labels that cannot be expressed with confidence.

──────────────────────────────
## Confidence Rules (Per Attribute, Unique Keys) ##
───────────────────────────────
RULE (NON-NEGOTIABLE): YOU MUST PROVIDE A UNIQUE CONFIDENCE FOR EVERY ATTRIBUTE YOU RETURN.
ALWAYS CONSIDER How strongly the track matches the tags you assigned.
It is NOT about whether the song is “good” or “popular”.
It is NOT about the user’s preference.
It is about certainty in your classification.
Use: low | medium | high
- **high:** widely recognized characteristics; strong consensus; clear arrangement cues.
- **medium:** reasonable inference; some ambiguity (remix/version uncertainty, mixed sections).
- **low:** weak evidence, uncommon track, or you’re guessing.

──────────────────────────────
## OUTPUT FORMAT RULES ##
───────────────────────────────
Return ONLY raw JSON matching this schema exactly. Do NOT add extra keys or explanations.
Use lowercase for genres and tags. If unknown, use minimal empty lists or default "und" with low confidence.

{
  "analyzed_top_50_tracks": [
    {
      "origin": "TOP_50_TRACKS_LIST",
      "song_name": "<string>",
      "artist_name": "<string>",

      "audio_physics": {
        "energy_level": "<string>",
        "energy_confidence": "low|medium|high",

        "tempo_feel": "<string>",
        "tempo_confidence": "low|medium|high",

        "vocals_type": "<string>",
        "vocals_confidence": "low|medium|high",

        "texture_type": "<string>",
        "texture_confidence": "low|medium|high",

        "danceability_hint": "<string>",
        "danceability_confidence": "low|medium|high"
      },

      "semantic_tags": {
        "primary_genre": "<string>",
        "primary_genre_confidence": "low|medium|high",

        "secondary_genres": ["<string>"],
        "secondary_genres_confidence": "low|medium|high",

        "emotional_tags": ["<string>"],
        "emotional_confidence": "low|medium|high",

        "cognitive_tags": ["<string>"],
        "cognitive_confidence": "low|medium|high",

        "somatic_tags": ["<string>"],
        "somatic_confidence": "low|medium|high",

        "language_iso_639_1": "<string>",
        "language_confidence": "low|medium|high"
      }
    }
  ]
}
`;
      // --- SYSTEM INSTRUCTION TASK B ---
      const systemInstruction_taskB = `You are an AI system analyzing user-created playlists to extract contextual signals.
Your role is to understand what each playlist represents from the user’s point of view.
Your job is to infer:
1. The primary function of the playlist
2. The dominant emotional direction
3. The language distribution
4. How confident you are in these inferences
───────────────────────────────
OUTPUT RULES (STRICT)
- Return ONLY raw JSON matching the response schema.
- Do NOT add fields that are not defined.
- Do NOT include explanations or commentary outside the JSON.
- Do NOT guess when signals are weak.
────────────────────────────────
FIELD DEFINITIONS & RULES
1) playlist_primary_function
Choose the main use-case of the playlist.
Allowed values:
- focus, workout, relax, sleep, commute, study, party, background, other

Rules:
- Base this on playlist name AND track patterns together.
- Genre-only names (e.g. “Alternative”, “Rock”) do NOT imply function.
- If no clear functional intent exists, prefer:
  - background
  - or other (only if none apply)
Never force a function if signals are unclear.
────────────────────────────────
2) playlist_emotional_direction
Choose the dominant emotional direction of the playlist.
Allowed values:, calming, energizing, uplifting, melancholic, romantic, dark, nostalgic, neutral, other

Rules:
- Describe the overall emotional tone, not individual tracks.
- Use neutral when the playlist is functional or unobtrusive.
- Use other only if no category reasonably fits.

────────────────────────────────
### PLAYLIST NAME BIAS CONTROL (CRITICAL)
The playlist_name is NOT the emotional label. It is only a weak hint.
RULES:
1) Track-derived signals MUST override playlist_name keywords.
2) Do NOT classify "playlist_emotional_direction" from name words like: love, sad, happy, chill, party, focus, workout.
3) If playlist_name suggests an emotion/function but the tracks disagree, choose the track-based emotion/function and LOWER confidence by one level.
4) Only use playlist_name as a tiebreaker when track signals are genuinely ambiguous.
────────────────────────────────
PLAYLIST NAME INTERPRETATION RULE:
If a playlist_name expresses personal attachment (e.g. "Loved once", "My favorites", "All time classics"),
treat it as an indicator of playlist importance, NOT emotional direction.
Do NOT infer romantic, nostalgic, or calming emotions unless supported by track-level signals
────────────────────────────────
3) playlist_language_distribution
Estimate the language balance of the playlist.
Rules:
- Output as an ARRAY of objects.
- Each object MUST have "language" (ISO-639-1 code, e.g., "en", "he", "es") and "percentage" (number, 0.0 to 1.0).
- Percentages in the array should approximately sum to 1.0.
- If one language dominates, use 1.0 for it.
Examples:
[{"language": "en", "percentage": 1.0}]
[{"language": "he", "percentage": 0.8}, {"language": "en", "percentage": 0.2}]
────────────────────────────────
4) confidence
Indicate overall confidence in your classification.
Allowed values:, high, medium, low
Rules:
- high → playlist name and track composition clearly align
- medium → partial signals or mild ambiguity
- low → weak, mixed, or unclear signals

NEVER output high confidence if:
- The playlist name is generic
- Signals conflict
- The inference relies mainly on assumptions
────────────────────────────────
GENERAL GUIDELINES
- Do NOT overfit to popular artists or genres.
- Do NOT assume intent where none is clear.
- Accuracy is more important than coverage.
- Honest uncertainty is preferred over confident misclassification.
When unsure:
- Prefer background over a strong function
- Prefer neutral over forcing emotion
- Prefer medium or low confidence over false certainty
────────────────────────────────
## OUTPUT FORMAT:
Return ONLY raw JSON matching schema:
{
  "analyzed_playlist_context": [
    {
      "origin": "PLAYLISTS",
      "playlist_name": "<string>",
      "playlist_creator": "<string>",
      "playlist_track_count": 10,
      "playlist_primary_function": "background",
      "playlist_emotional_direction": "neutral",
      "playlist_language_distribution": [{"language": "en", "percentage": 1.0}],
      "confidence": "medium"
    }
  ]
}
`;
        const t_prompt_A_start = Date.now();
        const prompt_taskA = JSON.stringify({ TOP_50_TRACKS: topTracks }, null, 2);
        const t_prompt_A_end = Date.now();
        promptBuildTimeMsA = t_prompt_A_end - t_prompt_A_start;

        const t_prompt_B_start = Date.now();
        const prompt_taskB = JSON.stringify({ PLAYLISTS: playlists }, null, 2);
        const t_prompt_B_end = Date.now();
        promptBuildTimeMsB = t_prompt_B_end - t_prompt_B_start;

        // Response schema for TASK A - Now expects raw strings for flexibility
        const responseSchema_taskA = {
          type: Type.OBJECT,
          properties: {
            analyzed_top_50_tracks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  origin: { type: Type.STRING },
                  song_name: { type: Type.STRING },
                  artist_name: { type: Type.STRING },
                  audio_physics: {
                    type: Type.OBJECT,
                    properties: {
                      energy_level: { type: Type.STRING, description: "raw value like 'low | low_medium | medium | medium_high | high'" },
                      energy_confidence: { type: Type.STRING, description: "'low|medium|high'" },
                      tempo_feel: { type: Type.STRING, description: "raw value like 'slow|mid|fast'" },
                      tempo_confidence: { type: Type.STRING, description: "'low|medium|high'" },
                      vocals_type: { type: Type.STRING, description: "raw value like 'instrumental |sparse |lead_vocal |harmonies |choral |background_vocal'" },
                      vocals_confidence: { type: Type.STRING, description: "'low|medium|high'" },
                      texture_type: { type: Type.STRING, description: "raw value like 'organic|acoustic|electric|synthetic|hybrid|ambient'" },
                      texture_confidence: { type: Type.STRING, description: "'low|medium|high'" },
                      danceability_hint: { type: Type.STRING, description: "raw value like 'low|medium|high'" },
                      danceability_confidence: { type: Type.STRING, description: "'low|medium|high'" },
                    },
                    required: [
                      "energy_level", "energy_confidence",
                      "tempo_feel", "tempo_confidence",
                      "vocals_type", "vocals_confidence",
                      "texture_type", "texture_confidence",
                      "danceability_hint", "danceability_confidence"
                    ],
                  },
                  semantic_tags: {
                    type: Type.OBJECT,
                    properties: {
                      primary_genre: { type: Type.STRING },
                      primary_genre_confidence: { type: Type.STRING, description: "'low|medium|high'" },
                      secondary_genres: { type: Type.ARRAY, items: { type: Type.STRING } },
                      secondary_genres_confidence: { type: Type.STRING, description: "'low|medium|high'" },
                      emotional_tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                      emotional_confidence: { type: Type.STRING, description: "'low|medium|high'" },
                      cognitive_tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                      cognitive_confidence: { type: Type.STRING, description: "'low|medium|high'" },
                      somatic_tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                      somatic_confidence: { type: Type.STRING, description: "'low|medium|high'" },
                      language_iso_639_1: { type: Type.STRING },
                      language_confidence: { type: Type.STRING, description: "'low|medium|high'" },
                    },
                    required: [
                      "primary_genre", "primary_genre_confidence",
                      "secondary_genres", "secondary_genres_confidence",
                      "emotional_tags", "emotional_confidence",
                      "cognitive_tags", "cognitive_confidence",
                      "somatic_tags", "somatic_confidence",
                      "language_iso_639_1", "language_confidence"
                    ],
                  },
                },
                required: ["origin", "song_name", "artist_name", "audio_physics", "semantic_tags"],
              },
            },
          },
          required: ["analyzed_top_50_tracks"],
        };

        // Response schema for TASK B
        const responseSchema_taskB = {
          type: Type.OBJECT,
          properties: {
            analyzed_playlist_context: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  origin: { type: Type.STRING },
                  playlist_name: { type: Type.STRING },
                  playlist_creator: { type: Type.STRING },
                  playlist_track_count: { type: Type.NUMBER },
                  playlist_primary_function: { type: Type.STRING },
                  playlist_emotional_direction: { type: Type.STRING },
                  playlist_language_distribution: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        language: { type: Type.STRING },
                        percentage: { type: Type.NUMBER },
                      },
                      required: ["language", "percentage"],
                    },
                  },
                  confidence: { type: Type.STRING },
                },
                required: [
                  "origin",
                  "playlist_name",
                  "playlist_creator",
                  "playlist_track_count",
                  "playlist_primary_function",
                  "playlist_emotional_direction",
                  "playlist_language_distribution",
                  "confidence",
                ],
              },
            },
          },
          required: ["analyzed_playlist_context"],
        };


        console.log("[API/ANALYZE] Unified Taste Analysis Prompt A (first 500 chars):", prompt_taskA.substring(0, 500));
        console.log("[API/ANALYZE] Unified Taste Analysis Prompt B (first 500 chars):", prompt_taskB.substring(0, 500));

        let geminiResponseTextA = "";
        let geminiResponseTextB = "";

        let t_gemini_api_start_A;
        let t_gemini_api_end_A;
        let t_gemini_api_start_B;
        let t_gemini_api_end_B;

        try {
          const taskA_promise = (async () => {
            t_gemini_api_start_A = Date.now();
            const response = await ai.models.generateContent({
              model: GEMINI_MODEL,
              contents: prompt_taskA,
              config: {
                systemInstruction: systemInstruction_taskA,
                responseMimeType: "application/json",
                responseSchema: responseSchema_taskA,
                thinkingConfig: { thinkingBudget: 0 },
                safetySettings: [
                  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                ],
              }
            });
            t_gemini_api_end_A = Date.now();
            geminiApiDurationA = t_gemini_api_end_A - t_gemini_api_start_A;
            return response;
          })();

          const taskB_promise = (async () => {
            t_gemini_api_start_B = Date.now();
            const response = await ai.models.generateContent({
              model: GEMINI_MODEL,
              contents: prompt_taskB,
              config: {
                systemInstruction: systemInstruction_taskB,
                responseMimeType: "application/json",
                responseSchema: responseSchema_taskB,
                thinkingConfig: { thinkingBudget: 0 },
                safetySettings: [
                  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                ],
              }
            });
            t_gemini_api_end_B = Date.now();
            geminiApiDurationB = t_gemini_api_end_B - t_gemini_api_start_B;
            return response;
          })();

          const [responseA, responseB] = await Promise.all([
            taskA_promise,
            taskB_promise
          ]);

          geminiResponseTextA = responseA.text;
          geminiResponseTextB = responseB.text;

        } catch (geminiError) {
          console.error("[API/ANALYZE] Error calling Gemini API for unified taste analysis (parallel):", geminiError);
          console.error(`[API/ANALYZE] Gemini Error Details (unified_taste): Name=${(geminiError as Error).name}, Message=${(geminiError as Error).message}`); // Fix: Cast geminiError to Error
          if ((geminiError as Error).stack) { // Fix: Cast geminiError to Error
            console.error("[API/ANALYZE] Gemini Error Stack (unified_taste):", (geminiError as Error).stack); // Fix: Cast geminiError to Error
          }
          const t_handler_end_gemini_error = Date.now();
          const totalDuration = t_handler_end_gemini_error - t_handler_start;
          console.log(`[API/ANALYZE] Handler finished (Gemini API error) in ${totalDuration}ms. Prompt Build A=${promptBuildTimeMsA}ms, Prompt Build B=${promptBuildTimeMsB}ms. Gemini API A=${geminiApiDurationA}ms, Gemini API B=${geminiApiDurationB}ms.`);
          return res.status(500).json({ error: `Gemini API Error (unified_taste): ${(geminiError as Error).message || 'Unknown Gemini error'}`, serverErrorName: (geminiError as Error).name || 'UnknownGeminiError' }); // Fix: Cast geminiError to Error
        }

        console.log("[API/ANALYZE] Raw Gemini Response Text (Unified Taste A - first 500 chars):", geminiResponseTextA ? geminiResponseTextA.substring(0, 500) : "No text received.");
        console.log("[API/ANALYZE] Raw Gemini Response Text (Unified Taste B - first 500 chars):", geminiResponseTextB ? geminiResponseTextB.substring(0, 500) : "No text received.");


        let t_before_json_parse;
        let t_after_json_parse;
        let jsonParseDuration = 0;
        try {
          t_before_json_parse = Date.now();
          const parsedDataA = JSON.parse(geminiResponseTextA.replace(/```json|```/g, '').trim());
          const parsedDataB = JSON.parse(geminiResponseTextB.replace(/```json|```/g, '').trim());

          const rawUnifiedGeminiResponse = {
            analyzed_top_50_tracks: parsedDataA.analyzed_top_50_tracks,
            analyzed_playlist_context: parsedDataB.analyzed_playlist_context,
          };
          
          // NEW: Perform aggregation server-side
          const aggregatedResult = aggregateSessionData(rawUnifiedGeminiResponse);

          t_after_json_parse = Date.now();
          jsonParseDuration = t_after_json_parse - t_before_json_parse;
          console.log("[API/ANALYZE] Successfully parsed unified taste response.");
          // NEW LOGGING FOR QA PURPOSES - now logs the fully aggregated result
          console.log("[API/ANALYZE] Final Aggregated Unified Taste Response:", JSON.stringify(aggregatedResult, null, 2));

          const t_handler_end = Date.now();
          const totalHandlerDuration = t_handler_end - t_handler_start;

          console.log(`[API/ANALYZE] Handler finished successfully.`);
          console.log(`[API/ANALYZE] Durations: Total=${totalHandlerDuration}ms, Prompt Build A=${promptBuildTimeMsA}ms, Prompt Build B=${promptBuildTimeMsB}ms, Gemini API A=${geminiApiDurationA}ms, Gemini API B=${geminiApiDurationB}ms, JSON Parse=${jsonParseDuration}ms.`);
          return res.status(200).json(aggregatedResult); // Return the aggregated result
        } catch (parseError) {
          console.error("[API/ANALYZE] Error parsing unified taste JSON (parallel):", parseError);
          console.error(`[API/ANALYZE] Parsing Error Details (unified_taste): Name=${(parseError as Error).name}, Message=${(parseError as Error).message}`); // Fix: Cast parseError to Error
          console.error("[API/ANALYZE] Malformed response text (unified taste A):", geminiResponseTextA.substring(0, 500) + (geminiResponseTextA.length > 500 ? '...' : ''));
          console.error("[API/ANALYZE] Malformed response text (unified taste B):", geminiResponseTextB.substring(0, 500) + (geminiResponseTextB.length > 500 ? '...' : ''));
          if ((parseError as Error).stack) { // Fix: Cast parseError to Error
            console.error("[API/ANALYZE] Parsing Error Stack (unified_taste):", (parseError as Error).stack); // Fix: Cast parseError to Error
          }

          const t_handler_end_parse_error = Date.now();
          const totalDuration = t_handler_end_parse_error - t_handler_start;
          jsonParseDuration = (t_after_json_parse && t_before_json_parse) ? (t_after_json_parse - t_before_json_parse) : 0;
          console.log(`[API/ANALYZE] Handler finished (parsing error) in ${totalDuration}ms. Prompt Build A=${promptBuildTimeMsA}ms, Prompt Build B=${geminiApiDurationB}ms, Gemini API A=${geminiApiDurationA}ms, Gemini API B=${geminiApiDurationB}ms, JSON Parse=${jsonParseDuration}ms.`);
          return res.status(500).json({ error: `Failed to parse AI response for unified taste: ${(parseError as Error).message}`, serverErrorName: (parseError as Error).name || 'UnknownParseError' }); // Fix: Cast parseError to Error
        }
      }

      console.error(`[API/ANALYZE] Invalid analysis type received: "${type}"`);
      const t_handler_end_invalid_type = Date.now();
      console.log(`[API/ANALYZE] Handler finished (invalid type error) in ${t_handler_end_invalid_type - t_handler_start}ms.`);
      return res.status(400).json({ error: 'Invalid analysis type' });
    } catch (error) {
    console.error("[API/ANALYZE] Analyze API Handler - Uncaught Error:", error);
    console.error(`[API/ANALYZE] Uncaught Error Details: Name=${(error as Error).name}, Message=${(error as Error).message}`); // Fix: Cast error to Error
    if ((error as Error).stack) { // Fix: Cast error to Error
      console.error("[API/ANALYZE] Uncaught Error Stack:", (error as Error).stack); // Fix: Cast error to Error
    }

    const t_handler_end_uncaught_error = Date.now();
    console.log(`[API/ANALYZE] Handler finished (uncaught error) in ${t_handler_end_uncaught_error - t_handler_start}ms.`);
    return res.status(500).json({ error: (error as Error).message || 'Internal Server Error', serverErrorName: (error as Error).name || 'UnknownServerError' }); // Fix: Cast error to Error
  }
}
