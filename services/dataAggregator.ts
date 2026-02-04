

import { 
  AnalyzedTopTrack, 
  SessionSemanticProfile, 
  UnifiedTasteAnalysis, 
  UnifiedTasteGeminiResponse, 
  AnalyzedPlaylistContextItem,
  ConfidenceLevel,
  AudioPhysics,
  SemanticTags,
  UserTasteProfileV1,
  IntentProfileSignals,
  IntentCombinationItem,
  RawAnalyzedTopTrack, // NEW: Import RawAnalyzedTopTrack
  RawAudioPhysics,      // NEW: Import RawAudioPhysics
  RawSemanticTags       // NEW: Import RawSemanticTags
} from '../types';

// Helper for RTL detection (Hebrew + Arabic ranges) - Moved here for internal use
const isRtl = (text: string) => /[\u0590-\u05FF\u0600-\u06FF]/.test(text);

// Helper functions for aggregation (NEW)
const conf_w = (confidence: ConfidenceLevel | undefined): number => {
  switch (confidence?.toLowerCase()) {
    case 'high': return 1.0;
    case 'medium': return 0.67;
    case 'low': return 0.40;
    default: return 0.40; // Default for undefined or unknown
  }
};

const sumScores = (scores: Record<string, number>): number => {
  return Object.values(scores).reduce((acc, score) => acc + score, 0);
};

const weighted_ratio = (topScore: number, allScores: Record<string, number>): number => {
  const total = sumScores(allScores);
  return total > 0 ? topScore / total : 0;
};

const map_ratio_to_semantic = (ratio: number): ConfidenceLevel => {
  if (ratio >= 0.67) return 'high';
  if (ratio >= 0.40) return 'medium';
  return 'low';
};

const argmax = (scores: Record<string, number>): string => {
  let maxScore = -Infinity;
  let maxKey: string = '';
  for (const key in scores) {
    if (scores[key] > maxScore) {
      maxScore = scores[key];
      maxKey = key;
    }
  }
  return maxKey;
};

const mean = (...numbers: number[]): number => {
  if (numbers.length === 0) return 0;
  return numbers.reduce((acc, num) => acc + num, 0) / numbers.length;
};

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

// NEW HELPER FUNCTIONS FOR NORMALIZATION AND VALIDATION (CRITICAL for v2.5.1)
const normalizeAudioPhysicsValue = <T extends keyof AudioPhysics>(key: T, rawValue: string): AudioPhysics[T] => {
  const lowerCaseValue = rawValue?.toLowerCase().trim();
  switch (key) {
    case 'energy_level':
      if (['low', 'low_medium', 'medium', 'medium_high', 'high'].includes(lowerCaseValue)) {
        return lowerCaseValue as AudioPhysics[T];
      }
      // Map common synonyms or general terms to canonical enums
      if (lowerCaseValue.includes('mellow') || lowerCaseValue.includes('calm')) return 'low' as AudioPhysics[T];
      if (lowerCaseValue.includes('mid') || lowerCaseValue.includes('average')) return 'medium' as AudioPhysics[T];
      if (lowerCaseValue.includes('high') || lowerCaseValue.includes('energetic') || lowerCaseValue.includes('explosive')) return 'high' as AudioPhysics[T];
      return 'medium' as AudioPhysics[T]; // Default if unmappable
    case 'tempo_feel':
      if (['slow', 'mid', 'fast'].includes(lowerCaseValue)) {
        return lowerCaseValue as AudioPhysics[T];
      }
      if (lowerCaseValue.includes('chill') || lowerCaseValue.includes('relaxed')) return 'slow' as AudioPhysics[T];
      if (lowerCaseValue.includes('upbeat') || lowerCaseValue.includes('dance')) return 'fast' as AudioPhysics[T];
      return 'mid' as AudioPhysics[T]; // Default
    case 'vocals_type':
      if (['instrumental', 'sparse', 'lead_vocal', 'harmonies', 'choral', 'background_vocal'].includes(lowerCaseValue)) {
        return lowerCaseValue as AudioPhysics[T];
      }
      if (lowerCaseValue.includes('no vocals')) return 'instrumental' as AudioPhysics[T];
      if (lowerCaseValue.includes('main vocal')) return 'lead_vocal' as AudioPhysics[T];
      if (lowerCaseValue.includes('choir')) return 'choral' as AudioPhysics[T];
      return 'lead_vocal' as AudioPhysics[T]; // Default
    case 'texture_type':
      if (['organic', 'acoustic', 'electric', 'synthetic', 'hybrid', 'ambient'].includes(lowerCaseValue)) {
        return lowerCaseValue as AudioPhysics[T];
      }
      if (lowerCaseValue.includes('natural')) return 'organic' as AudioPhysics[T];
      if (lowerCaseValue.includes('digital')) return 'synthetic' as AudioPhysics[T];
      if (lowerCaseValue.includes('mixed')) return 'hybrid' as AudioPhysics[T];
      return 'hybrid' as AudioPhysics[T]; // Default
    case 'danceability_hint':
      if (['low', 'medium', 'high'].includes(lowerCaseValue)) {
        return lowerCaseValue as AudioPhysics[T];
      }
      if (lowerCaseValue.includes('groove') || lowerCaseValue.includes('rhythmic')) return 'high' as AudioPhysics[T];
      if (lowerCaseValue.includes('background') || lowerCaseValue.includes('no beat')) return 'low' as AudioPhysics[T];
      return 'medium' as AudioPhysics[T]; // Default
    default:
      return lowerCaseValue as AudioPhysics[T]; // Should not happen for defined keys
  }
};

const normalizeSemanticTag = (rawValue: string): string => {
  return rawValue?.toLowerCase().trim();
};

const cleanAndValidateConfidence = (rawValue: string | undefined): ConfidenceLevel => {
  const lowerCaseValue = rawValue?.toLowerCase().trim();
  if (['low', 'medium', 'high'].includes(lowerCaseValue)) {
    return lowerCaseValue as ConfidenceLevel;
  }
  return 'medium'; // Default to medium for any unparsable confidence
};


// Renamed and now extracts SessionSemanticProfile from AnalyzedTopTrack[]
const createSessionSemanticProfile = (
  tracks: AnalyzedTopTrack[], // NOW expects validated AnalyzedTopTrack
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
    // MODIFIED: Since top-level track.confidence is removed, use a default weight for artist.
    const w = 1.0; 

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
    // MODIFIED: `trackOverallConfidence` removed as top-level track.confidence is gone.
    // Access semantic_tags directly, as its structure is now flattened.
    const tags: SemanticTags = track.semantic_tags; 

    // Primary Genre
    const pGenre = tags.primary_genre?.toLowerCase().trim();
    // Use `tags.primary_genre_confidence` directly.
    const pGenreWeight = getWeight(tags.primary_genre_confidence || 'medium'); // Fallback to 'medium'

    if (pGenre) {
      genreScores[pGenre] = (genreScores[pGenre] || 0) + (1.0 * pGenreWeight);
      totalGenreWeight += (1.0 * pGenreWeight);
    }

    // Secondary Genres
    if (tags.secondary_genres && Array.isArray(tags.secondary_genres)) {
      // Use `tags.secondary_genres_confidence` directly.
      const sGenreWeight = getWeight(tags.secondary_genres_confidence || 'medium'); // Fallback to 'medium'
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
     // MODIFIED: `trackOverallConfidence` removed.

     // Use new field, no fallback needed to old `semantic_tags.energy`
     const energyLevel = audioPhysics.energy_level?.toLowerCase(); 

     let bucket = energyLevel;
     if (bucket === 'explosive') bucket = 'high';
     // Also handle new granular levels for robust fallback
     if (bucket === 'low_medium') bucket = 'medium';
     if (bucket === 'medium_high') bucket = 'high';
     
     if (!['low', 'medium', 'high'].includes(bucket)) return;

     // Use new energy_confidence
     const w = getWeight(audioPhysics.energy_confidence || 'medium'); // Fallback to 'medium'
     
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
    // MODIFIED: `trackOverallConfidence` removed.
    const semanticTags: SemanticTags = track.semantic_tags; // Access semantic_tags directly

    // Aggregate emotional_tags
    if (semanticTags.emotional_tags && Array.isArray(semanticTags.emotional_tags)) {
        const w = getWeight(semanticTags.emotional_confidence || 'medium');
        semanticTags.emotional_tags.forEach(m => {
            const mood = m.toLowerCase().trim();
            moodScores[mood] = (moodScores[mood] || 0) + w;
        });
    }
    // Aggregate cognitive_tags
    if (semanticTags.cognitive_tags && Array.isArray(semanticTags.cognitive_tags)) {
        const w = getWeight(semanticTags.cognitive_confidence || 'medium');
        semanticTags.cognitive_tags.forEach(m => {
            const mood = m.toLowerCase().trim();
            moodScores[mood] = (moodScores[mood] || 0) + w;
        });
    }
    // Aggregate somatic_tags
    if (semanticTags.somatic_tags && Array.isArray(semanticTags.somatic_tags)) {
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
    valueExtractor: (t: AnalyzedTopTrack) => string | undefined,
    confidenceExtractor: (t: AnalyzedTopTrack) => ConfidenceLevel | undefined
  ): string => { 
      const scores: Record<string, number> = {};
      let maxScore = -1;
      let bias = 'unknown';

      tracks.forEach(t => {
          const val = valueExtractor(t)?.toLowerCase();
          if (!val) return;
          // Use confidenceExtractor directly
          const w = getWeight(confidenceExtractor(t) || 'medium'); // Fallback to 'medium'
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
    // MODIFIED: `trackOverallConfidence` removed.

    // Use new semantic_tags.language_iso_639_1 directly
    const newLang = track.semantic_tags.language_iso_639_1;
    const newLangConfidence = track.semantic_tags.language_confidence;
    const newLangWeight = getWeight(newLangConfidence || 'medium'); // Fallback to 'medium'

    if (newLang) {
      const normalizedLang = newLang.toLowerCase().trim();
      if (normalizedLang) {
        languageCounts[normalizedLang] = (languageCounts[normalizedLang] || 0) + newLangWeight;
        totalLanguageScore += newLangWeight;
      }
    }
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


// NEW: Function to build the comprehensive UserTasteProfileV1
const buildUserTasteProfileV1 = (rawTracks: RawAnalyzedTopTrack[], playlists: AnalyzedPlaylistContextItem[]): UserTasteProfileV1 => {
  // First, normalize raw tracks into strict AnalyzedTopTrack objects
  const tracks: AnalyzedTopTrack[] = rawTracks.map(rawTrack => ({
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
      secondary_genres: rawTrack.semantic_tags.secondary_genres.map(normalizeSemanticTag),
      secondary_genres_confidence: cleanAndValidateConfidence(rawTrack.semantic_tags.secondary_genres_confidence),
      emotional_tags: rawTrack.semantic_tags.emotional_tags.map(normalizeSemanticTag),
      emotional_confidence: cleanAndValidateConfidence(rawTrack.semantic_tags.emotional_confidence),
      cognitive_tags: rawTrack.semantic_tags.cognitive_tags.map(normalizeSemanticTag),
      cognitive_confidence: cleanAndValidateConfidence(rawTrack.semantic_tags.cognitive_confidence),
      somatic_tags: rawTrack.semantic_tags.somatic_tags.map(normalizeSemanticTag),
      somatic_confidence: cleanAndValidateConfidence(rawTrack.semantic_tags.somatic_confidence),
      language_iso_639_1: normalizeSemanticTag(rawTrack.semantic_tags.language_iso_639_1),
      language_confidence: cleanAndValidateConfidence(rawTrack.semantic_tags.language_confidence),
    },
  }));


  const userTasteProfile: UserTasteProfileV1 = {
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

  // 1.2) language_profile
  const lang_score: Record<string, number> = {};
  tracks.forEach(track => {
    const lang = track.semantic_tags.language_iso_639_1?.toLowerCase().trim();
    if (lang) {
      // Fix: Ensure conf_w is called with a ConfidenceLevel type by asserting
      const w = conf_w(track.semantic_tags.language_confidence as ConfidenceLevel);
      lang_score[lang] = (lang_score[lang] || 0) + w;
    }
  });
  const totalLangScore = sumScores(lang_score);
  for (const lang in lang_score) {
    userTasteProfile.language_profile.language_profile_distribution[lang] = Number((lang_score[lang] / totalLangScore).toFixed(2));
  }
  const top_lang = argmax(lang_score);
  const lang_ratio = weighted_ratio(lang_score[top_lang], lang_score);
  userTasteProfile.language_profile.language_profile_confidence = map_ratio_to_semantic(lang_ratio);

  // 1.3) audio_physics_profile
  const phys_score: Record<string, Record<string, number>> = {};
  const audioDimensions = ['energy_level', 'tempo_feel', 'vocals_type', 'texture_type', 'danceability_hint'];
  audioDimensions.forEach(d => phys_score[d] = {});

  tracks.forEach(track => {
    audioDimensions.forEach(d => {
      const val = track.audio_physics[d as keyof AudioPhysics]?.toLowerCase();
      if (val) {
        // Construct confidence key dynamically
        const confKey = (d.replace('_level', '_confidence').replace('_feel', '_confidence').replace('_hint', '_confidence')) as keyof AudioPhysics;
        // Fix: Assert that the value accessed via confKey is a ConfidenceLevel
        const w = conf_w(track.audio_physics[confKey] as ConfidenceLevel);
        phys_score[d][val] = (phys_score[d][val] || 0) + w;
      }
    });
  });

  const ratio_dims: Record<string, number> = {};
  audioDimensions.forEach(d => {
    const biasKey = `${d.replace('_level', '_bias').replace('_feel', '_bias').replace('_hint', '_bias')}` as keyof UserTasteProfileV1['audio_physics_profile'];
    const maxVal = argmax(phys_score[d]);
    
    // Fix: Use a type assertion to the specific literal type for each bias
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

    ratio_dims[`ratio_${d.replace('_level', '').replace('_feel', '').replace('_hint', '')}`] = weighted_ratio(phys_score[d][argmax(phys_score[d])], phys_score[d]);
  });
  const physics_block_ratio = mean(
    ratio_dims.ratio_energy,
    ratio_dims.ratio_tempo,
    ratio_dims.ratio_vocals,
    ratio_dims.ratio_texture,
    ratio_dims.ratio_danceability
  );
  userTasteProfile.audio_physics_profile.audio_physics_profile_confidence = map_ratio_to_semantic(physics_block_ratio);


  // 1.4) genre_profile
  const primary_score: Record<string, number> = {};
  const secondary_score: Record<string, number> = {};

  tracks.forEach(track => {
    const pGenre = track.semantic_tags.primary_genre?.toLowerCase().trim();
    if (pGenre) {
      // Fix: Ensure conf_w is called with a ConfidenceLevel type by asserting
      const w = conf_w(track.semantic_tags.primary_genre_confidence as ConfidenceLevel);
      primary_score[pGenre] = (primary_score[pGenre] || 0) + w;
    }
    track.semantic_tags.secondary_genres?.forEach(sGenre => {
      const s = sGenre.toLowerCase().trim();
      // Fix: Ensure conf_w is called with a ConfidenceLevel type by asserting
      const w2 = conf_w(track.semantic_tags.secondary_genres_confidence as ConfidenceLevel);
      secondary_score[s] = (secondary_score[s] || 0) + w2;
    });
  });

  const sortedPrimaryGenres = Object.entries(primary_score).sort(([, a], [, b]) => b - a);
  userTasteProfile.genre_profile.primary_genres = sortedPrimaryGenres.slice(0, 3).map(([g]) => g);

  const sortedSecondaryGenres = Object.entries(secondary_score).sort(([, a], [, b]) => b - a);
  // Filter out primary genres from secondary, as per PDF note
  userTasteProfile.genre_profile.secondary_genres = sortedSecondaryGenres
    .map(([g]) => g)
    .filter(g => !userTasteProfile.genre_profile.primary_genres.includes(g))
    .slice(0, 5);

  const genre_ratio = weighted_ratio(primary_score[argmax(primary_score)], primary_score);
  userTasteProfile.genre_profile.genre_profile_confidence = map_ratio_to_semantic(genre_ratio);


  // 1.5) moods_analysis blocks (emotional, cognitive, somatic)
  const moodAxes = ['emotional', 'cognitive', 'somatic'];
  const moodScores: Record<string, Record<string, number>> = {};
  moodAxes.forEach(axis => moodScores[axis] = {});

  const moodRatios: Record<string, number> = {};

  moodAxes.forEach(axis => {
    tracks.forEach(track => {
      const tags = track.semantic_tags[`${axis}_tags` as keyof SemanticTags] as string[] || [];
      const confidence = track.semantic_tags[`${axis}_confidence` as keyof SemanticTags] as ConfidenceLevel;
      const w = conf_w(confidence);
      tags.forEach(tag => {
        const t = tag.toLowerCase().trim();
        moodScores[axis][t] = (moodScores[axis][t] || 0) + w;
      });
    });

    const totalAxisScore = sumScores(moodScores[axis]);
    const distribution: Record<string, number> = {};
    for (const tag in moodScores[axis]) {
      distribution[tag] = Number((moodScores[axis][tag] / totalAxisScore).toFixed(2));
    }

    const primary_A = argmax(moodScores[axis]);
    const sortedMoods = Object.entries(moodScores[axis]).sort(([, a], [, b]) => b - a).map(([m]) => m);
    const secondary_A = sortedMoods.slice(1, 3); // next top 2 moods

    userTasteProfile[`${axis}_mood_profile`].primary = primary_A;
    userTasteProfile[`${axis}_mood_profile`].secondary = secondary_A;
    userTasteProfile[`${axis}_mood_profile`].distribution = distribution;
    
    moodRatios[`${axis}_ratio`] = weighted_ratio(moodScores[axis][primary_A], moodScores[axis]);
    userTasteProfile[`${axis}_mood_profile`][`${axis}_mood_profile_confidence` as keyof UserTasteProfileV1['emotional_mood_profile']] = map_ratio_to_semantic(moodRatios[`${axis}_ratio`]);
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


  // 2. Intent Profile Signals
  const intent_score_per_track: Record<string, number> = {}; // {track_id: score}
  const track_intents: Record<string, string[]> = {}; // {track_id: [intents]}

  // Placeholder for the fixed lookup table (implementation constant)
  // This needs to be defined based on the PDF's examples (e.g., Sad + tender -> comfort)
  const intentLookupTable: Array<{
    emotional: string[];
    cognitive?: string[];
    somatic?: string[];
    intent: string;
  }> = [
    { emotional: ['sad'], somatic: ['tender'], intent: 'comfort' },
    { emotional: ['melancholic'], cognitive: ['reflective'], intent: 'reflect' },
    { emotional: ['calm'], somatic: ['grounded'], intent: 'decompress' },
    { emotional: ['energized'], cognitive: ['focused'], intent: 'focus' },
    // Add more from PDF (e.g., Anxious + tension -> Calm, Drained + Reduced focus -> Reset)
  ];

  // Helper to map mood/physics values to their representative forms (e.g., "low_medium" to "low")
  const mapAudioPhysicsValue = (key: keyof AudioPhysics, value: string): string => {
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

  tracks.forEach((track, index) => {
    // 2.2.3 Intent Confidence score track-based accumulation
    // Fix: Ensure conf_w is called with a ConfidenceLevel type by asserting
    const emotional_w = conf_w(track.semantic_tags.emotional_confidence as ConfidenceLevel);
    const cognitive_w = conf_w(track.semantic_tags.cognitive_confidence as ConfidenceLevel);
    const somatic_w = conf_w(track.semantic_tags.somatic_confidence as ConfidenceLevel);

    const available_confidences = [emotional_w, cognitive_w, somatic_w].filter(w => w !== undefined);
    const track_intent_score = mean(...available_confidences);
    intent_score_per_track[track.song_name + track.artist_name] = track_intent_score; // Simple track identifier

    // Derive intent_candidates using the rule table (implementation constant)
    const track_intents_for_this_track: string[] = [];
    intentLookupTable.forEach(rule => {
      const emotionalMatch = rule.emotional.some(mood => track.semantic_tags.emotional_tags?.includes(mood));
      const cognitiveMatch = rule.cognitive ? rule.cognitive.some(mood => track.semantic_tags.cognitive_tags?.includes(mood)) : true;
      const somaticMatch = rule.somatic ? rule.somatic.some(mood => track.semantic_tags.somatic_tags?.includes(mood)) : true;

      // Apply RULES #1 (Intent Driver Mood) - emotional must be present
      if (emotionalMatch) {
        // Apply RULE #2 (Eligibility) - mood weight >= 0.15
        const emotional_mood_eligible = userTasteProfile.emotional_mood_profile.distribution[track.semantic_tags.emotional_tags[0]?.toLowerCase()] >= 0.15;
        const cognitive_mood_eligible = rule.cognitive ? userTasteProfile.cognitive_mood_profile.distribution[track.semantic_tags.cognitive_tags[0]?.toLowerCase()] >= 0.15 : true;
        const somatic_mood_eligible = rule.somatic ? userTasteProfile.somatic_mood_profile.distribution[track.semantic_tags.somatic_tags[0]?.toLowerCase()] >= 0.15 : true;

        if (emotional_mood_eligible && cognitive_mood_eligible && somatic_mood_eligible) {
          // Apply RULE #3 (Combination Rule) - at least 2 dimensions
          const dimensions_met = [emotionalMatch, cognitiveMatch, somaticMatch].filter(Boolean).length;
          if (dimensions_met >= 2) {
            track_intents_for_this_track.push(rule.intent);
          }
        }
      }
    });
    track_intents[track.song_name + track.artist_name] = track_intents_for_this_track;
  });

  const intent_score: Record<string, number> = {}; // {intent: score}
  const track_intent_map: Record<string, AnalyzedTopTrack[]> = {}; // {intent: [tracks]}

  tracks.forEach(track => {
    const trackId = track.song_name + track.artist_name;
    const intentsForTrack = track_intents[trackId] || [];
    intentsForTrack.forEach(intent => {
      intent_score[intent] = (intent_score[intent] || 0) + intent_score_per_track[trackId];
      if (!track_intent_map[intent]) track_intent_map[intent] = [];
      track_intent_map[intent].push(track);
    });
  });

  const intent_weight: Record<string, number> = {};
  const totalIntentScore = sumScores(intent_score);
  for (const intent in intent_score) {
    intent_weight[intent] = Number((intent_score[intent] / totalIntentScore).toFixed(2));
  }

  const intents_ranked: IntentProfileSignals[] = [];

  const sortedIntents = Object.entries(intent_weight).sort(([, w1], [, w2]) => w2 - w1);

  for (const [intent, weight] of sortedIntents) {
    // Apply RULE #4 (Filtering Out Combinations) - Co-occurs >= 30% - This is a more complex check, simplified for now
    // For a more precise implementation, one would need to calculate co-occurrence frequencies.
    // For this implementation, we'll assume the intent_score accumulation implicitly handles this to some extent.
    
    if (weight < 0.15) continue; // Rule #4.1: Intent driver mood_weight >= 0.15 from top 50 (represented by intent_weight here)

    const contributingTracks = track_intent_map[intent] || [];

    const emotional_mood_combinations: IntentCombinationItem[] = [];
    const cognitive_mood_combinations: IntentCombinationItem[] = [];
    const somatic_mood_combinations: IntentCombinationItem[] = [];

    moodAxes.forEach(axis => {
      const axis_mood_score: Record<string, number> = {};
      contributingTracks.forEach(track => {
        const tags = track.semantic_tags[`${axis}_tags` as keyof SemanticTags] as string[] || [];
        const trackId = track.song_name + track.artist_name;
        tags.forEach(tag => {
          const t = tag.toLowerCase().trim();
          axis_mood_score[t] = (axis_mood_score[t] || 0) + (intent_score_per_track[trackId] || 0);
        });
      });
      
      const sortedAxisMoods = Object.entries(axis_mood_score).sort(([, s1], [, s2]) => s2 - s1);
      const top3AxisMoods = sortedAxisMoods.slice(0, 3); // Keep top 3 moods per axis for the intent

      top3AxisMoods.forEach(([mood, score]) => {
        const tracksForMood = contributingTracks.filter(t => {
          const tags = t.semantic_tags[`${axis}_tags` as keyof SemanticTags] as string[] || [];
          return tags.includes(mood);
        }).sort((t1, t2) => {
          const score1 = intent_score_per_track[t1.song_name + t1.artist_name] || 0;
          const score2 = intent_score_per_track[t2.song_name + t2.artist_name] || 0;
          return score2 - score1;
        });

        // Select top 2 tracks that contributed to this mood+intent
        const track_examples = tracksForMood.slice(0, 2).map(t => ({ title: t.song_name, artist: t.artist_name }));

        const combinationItem: IntentCombinationItem = {
          mood: mood,
          weight: Number((score / sumScores(axis_mood_score)).toFixed(2)), // Normalized weight
          track_examples: track_examples,
        };

        if (axis === 'emotional') emotional_mood_combinations.push(combinationItem);
        if (axis === 'cognitive') cognitive_mood_combinations.push(combinationItem);
        if (axis === 'somatic') somatic_mood_combinations.push(combinationItem);
      });
    });

    // 2.2.7 Genre hints + physics constraints per intent
    const genre_hints_map: Record<string, number> = {};
    const physics_constraints_counts: { 
      energy: Record<string, number>, danceability: Record<string, number>, vocals: Record<string, number>, texture: Record<string, number>, tempo: Record<string, number> 
    } = { energy: {}, danceability: {}, vocals: {}, texture: {}, tempo: {} };

    contributingTracks.forEach(track => {
      const pGenre = track.semantic_tags.primary_genre?.toLowerCase().trim();
      if (pGenre) {
        genre_hints_map[pGenre] = (genre_hints_map[pGenre] || 0) + 1;
      }
      physics_constraints_counts.energy[mapAudioPhysicsValue('energy_level', track.audio_physics.energy_level)] = (physics_constraints_counts.energy[mapAudioPhysicsValue('energy_level', track.audio_physics.energy_level)] || 0) + 1;
      physics_constraints_counts.danceability[track.audio_physics.danceability_hint] = (physics_constraints_counts.danceability[track.audio_physics.danceability_hint] || 0) + 1;
      physics_constraints_counts.vocals[track.audio_physics.vocals_type] = (physics_constraints_counts.vocals[track.audio_physics.vocals_type] || 0) + 1;
      physics_constraints_counts.texture[track.audio_physics.texture_type] = (physics_constraints_counts.texture[track.audio_physics.texture_type] || 0) + 1;
      physics_constraints_counts.tempo[track.audio_physics.tempo_feel] = (physics_constraints_counts.tempo[track.audio_physics.tempo_feel] || 0) + 1;
    });

    const genre_hints = Object.entries(genre_hints_map).sort(([, c1], [, c2]) => c2 - c1).slice(0, 3).map(([g]) => g);
    
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
        const score1 = intent_score_per_track[t1.song_name + t1.artist_name] || 0;
        const score2 = intent_score_per_track[t2.song_name + t2.artist_name] || 0;
        return score2 - score1;
      }).map(t => JSON.stringify({ title: t.song_name, artist: t.artist_name }))
    )).slice(0, 3).map(str => JSON.parse(str));


    intents_ranked.push({
      intent: intent,
      confidence: map_ratio_to_semantic(weight), // Use intent_weight for confidence
      emotional_mood_combinations,
      cognitive_mood_combinations,
      somatic_mood_combinations,
      genre_hints,
      physics_constraints: physics_constraints_inferred,
      track_examples: intent_track_examples,
    });
  }

  userTasteProfile.intent_profile_signals.intents_ranked = intents_ranked;
  // Sort intents_ranked by intent_weight descending (already done by sortedIntents)

  return userTasteProfile;
};


// NEW: Main aggregation function that takes the unified Gemini response
export const aggregateSessionData = (unifiedGeminiResponse: UnifiedTasteGeminiResponse): UnifiedTasteAnalysis => { 
  const { analyzed_top_50_tracks, analyzed_playlist_context } = unifiedGeminiResponse; // Renamed

  // Original SessionSemanticProfile (for client-side display and legacy vibe generation)
  const sessionSemanticProfile = createSessionSemanticProfile(
    analyzed_top_50_tracks.map(rawTrack => ({
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
        secondary_genres: rawTrack.semantic_tags.secondary_genres.map(normalizeSemanticTag),
        secondary_genres_confidence: cleanAndValidateConfidence(rawTrack.semantic_tags.secondary_genres_confidence),
        emotional_tags: rawTrack.semantic_tags.emotional_tags.map(normalizeSemanticTag),
        emotional_confidence: cleanAndValidateConfidence(rawTrack.semantic_tags.emotional_confidence),
        cognitive_tags: rawTrack.semantic_tags.cognitive_tags.map(normalizeSemanticTag),
        cognitive_confidence: cleanAndValidateConfidence(rawTrack.semantic_tags.cognitive_confidence),
        somatic_tags: rawTrack.semantic_tags.somatic_tags.map(normalizeSemanticTag),
        somatic_confidence: cleanAndValidateConfidence(rawTrack.semantic_tags.somatic_confidence),
        language_iso_639_1: normalizeSemanticTag(rawTrack.semantic_tags.language_iso_639_1),
        language_confidence: cleanAndValidateConfidence(rawTrack.semantic_tags.language_confidence),
      },
    })), 
    analyzed_playlist_context
  );

  // NEW: Build the comprehensive UserTasteProfileV1
  const userTasteProfileV1 = buildUserTasteProfileV1(analyzed_top_50_tracks, analyzed_playlist_context);


  let overallMoodCategory: string = "Mixed Moods";
  let overallMoodConfidence: number = 0.5;

  // Use Task B for simple overall mood, if available.
  // Note: For UserTasteProfileV1, moods are much more granular.
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
    // REMOVED: analyzed_top_tracks: analyzed_top_50_tracks, // Use renamed key
    user_taste_profile_v1: userTasteProfileV1, // NEW: Populate the aggregated taste profile
  };
};
