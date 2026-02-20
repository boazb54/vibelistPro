import { 
  AnalyzedTopTrack, 
  SessionSemanticProfile, // DEPRECATED - but kept for now due to App.tsx still referencing it
  UnifiedTasteAnalysis, 
  UnifiedTasteGeminiResponse, 
  AnalyzedPlaylistContextItem, // DEPRECATED - but kept for now due to App.tsx still referencing it
  ConfidenceLevel, 
  AudioPhysics, 
  SemanticTags,
  UserTasteProfileV1 // NEW: Import UserTasteProfileV1
} from '../types';

// Updated Confidence Weights for aggregation logic
const CONFIDENCE_WEIGHTS: Record<ConfidenceLevel | string, number> = { 
  'high': 1.0,
  'medium': 0.6,
  'low': 0.3
};

function getWeight(confidence: ConfidenceLevel | undefined): number { 
  if (!confidence) return 0.3; 
  return CONFIDENCE_WEIGHTS[confidence.toLowerCase()] || 0.3;
}

// NEW: Helper to get the actual ConfidenceLevel from an array of weighted confidences
function getOverallConfidence<T>(scores: { item: T; weight: number; confidence: ConfidenceLevel }[]): ConfidenceLevel {
  if (scores.length === 0) return 'low';

  let totalWeightedScore = 0;
  let totalWeight = 0;

  scores.forEach(s => {
    const weightValue = CONFIDENCE_WEIGHTS[s.confidence] || 0.3;
    totalWeightedScore += s.weight * weightValue;
    totalWeight += s.weight;
  });

  if (totalWeight === 0) return 'low'; // Avoid division by zero

  const averageConfidence = totalWeightedScore / totalWeight;

  if (averageConfidence >= CONFIDENCE_WEIGHTS['high'] * 0.8) return 'high';
  if (averageConfidence >= CONFIDENCE_WEIGHTS['medium'] * 0.8) return 'medium';
  return 'low';
}

// NEW: Utility function to normalize a distribution to sum to 1.0
function normalizeDistribution(distribution: Record<string, number>): Record<string, number> {
  const sum = Object.values(distribution).reduce((acc, val) => acc + val, 0);
  if (sum === 0) return distribution; // Avoid division by zero for empty distributions
  return Object.fromEntries(
    Object.entries(distribution).map(([key, value]) => [key, parseFloat((value / sum).toFixed(2))])
  );
}

// This function is effectively replaced by the logic within aggregateSessionData for UserTasteProfileV1
// However, the signature is kept for App.tsx compatibility, returning a default SessionSemanticProfile.
// This will be removed in a subsequent release.
const createSessionSemanticProfile = (
  tracks: AnalyzedTopTrack[],
  playlists: AnalyzedPlaylistContextItem[] // No longer used, but kept for compatibility
): SessionSemanticProfile => {
  // This is a placeholder for backward compatibility with App.tsx's `session_semantic_profile` field.
  // The actual new taste profile is generated in `aggregateSessionData` into `user_taste_profile_v1`.
  return {
    taste_profile_type: 'diverse',
    dominant_genres: [],
    energy_bias: 'medium',
    energy_distribution: { low: 0, medium: 0, high: 0 },
    dominant_moods: [],
    tempo_bias: 'mid',
    vocals_bias: 'lead_vocal',
    texture_bias: 'hybrid',
    artist_examples: [],
    language_distribution: {},
  };
};

// NEW: Main aggregation function that creates the UserTasteProfileV1
export const aggregateSessionData = (unifiedGeminiResponse: UnifiedTasteGeminiResponse): UnifiedTasteAnalysis => { 
  const { analyzed_50_top_tracks: tracks } = unifiedGeminiResponse; 

  // Initialize all parts of UserTasteProfileV1 with defaults
  const userTasteProfileV1: UserTasteProfileV1 = {
    origin: "TOP_50_TRACKS_ANALYZE",
    overall_profile_confidence: 'low',
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
      primary_genre_profile_distribution: {},
      secondary_genre_profile_distribution: {},
      primary_genres: [],
      secondary_genres: [],
      genre_profile_confidence: 'low',
    },
    emotional_mood_profile: {
      primary: 'neutral',
      secondary: [],
      distribution: {},
      emotional_mood_profile_confidence: 'low',
    },
    cognitive_mood_profile: {
      primary: 'neutral',
      secondary: [],
      distribution: {},
      cognitive_mood_profile_confidence: 'low',
    },
    somatic_mood_profile: {
      primary: 'neutral',
      secondary: [],
      distribution: {},
      somatic_mood_profile_confidence: 'low',
    },
    intent_profile_signals: {
      intents_ranked: [], // Placeholder, not populated in this release
    },
  };

  if (!tracks || tracks.length === 0) {
    return { user_taste_profile_v1: userTasteProfileV1 };
  }

  // --- Intermediate Aggregation Structures ---
  const energyLevelScores: { item: AudioPhysics['energy_level']; weight: number; confidence: ConfidenceLevel }[] = [];
  const tempoFeelScores: { item: AudioPhysics['tempo_feel']; weight: number; confidence: ConfidenceLevel }[] = [];
  const danceabilityHintScores: { item: AudioPhysics['danceability_hint']; weight: number; confidence: ConfidenceLevel }[] = [];
  const vocalsTypeScores: { item: AudioPhysics['vocals_type']; weight: number; confidence: ConfidenceLevel }[] = [];
  const textureTypeScores: { item: AudioPhysics['texture_type']; weight: number; confidence: ConfidenceLevel }[] = [];
  
  const primaryGenreDistribution: Record<string, number> = {};
  const secondaryGenreDistribution: Record<string, number> = {};
  const genreConfidenceScores: { item: string; weight: number; confidence: ConfidenceLevel }[] = [];

  const emotionalMoodDistribution: Record<string, number> = {};
  const cognitiveMoodDistribution: Record<string, number> = {};
  const somaticMoodDistribution: Record<string, number> = {};
  const moodConfidenceScores: { item: string; weight: number; confidence: ConfidenceLevel }[] = [];

  const languageDistribution: Record<string, number> = {};
  const languageConfidenceScores: { item: string; weight: number; confidence: ConfidenceLevel }[] = [];



  // --- Process Each Track ---
  tracks.forEach(track => {
    const trackWeight = 1; // All tracks now have equal weight since individual confidence is removed.

    // Audio Physics
    const audioPhysics = track.audio_physics;
    const physicsConfidence = audioPhysics.audio_physics_profile_confidence;
    
    energyLevelScores.push({ item: audioPhysics.energy_level, weight: trackWeight, confidence: physicsConfidence });
    tempoFeelScores.push({ item: audioPhysics.tempo_feel, weight: trackWeight, confidence: physicsConfidence });
    danceabilityHintScores.push({ item: audioPhysics.danceability_hint, weight: trackWeight, confidence: physicsConfidence });
    vocalsTypeScores.push({ item: audioPhysics.vocals_type, weight: trackWeight, confidence: physicsConfidence });
    textureTypeScores.push({ item: audioPhysics.texture_type, weight: trackWeight, confidence: physicsConfidence });

    // Semantic Tags
    const semanticTags = track.semantic_tags;
    const tagsConfidence = semanticTags.semantic_tags_profile_confidence;

    // Genres
    const primaryGenre = semanticTags.primary_genre?.toLowerCase().trim();
    if (primaryGenre) {
      primaryGenreDistribution[primaryGenre] = (primaryGenreDistribution[primaryGenre] || 0) + trackWeight * getWeight(tagsConfidence);
      genreConfidenceScores.push({ item: primaryGenre, weight: trackWeight, confidence: tagsConfidence });
    }
    semanticTags.secondary_genres?.forEach(genre => {
      const secondaryGenre = genre?.toLowerCase().trim();
      if (secondaryGenre) {
        secondaryGenreDistribution[secondaryGenre] = (secondaryGenreDistribution[secondaryGenre] || 0) + trackWeight * getWeight(tagsConfidence) * 0.5; // Secondary genres have less weight
        genreConfidenceScores.push({ item: secondaryGenre, weight: trackWeight * 0.5, confidence: tagsConfidence });
      }
    });

    // Moods
    semanticTags.emotional_tags?.forEach(mood => {
      const m = mood?.toLowerCase().trim();
      if (m) {
        emotionalMoodDistribution[m] = (emotionalMoodDistribution[m] || 0) + trackWeight * getWeight(tagsConfidence);
        moodConfidenceScores.push({ item: m, weight: trackWeight, confidence: tagsConfidence });
      }
    });
    semanticTags.cognitive_tags?.forEach(mood => {
      const m = mood?.toLowerCase().trim();
      if (m) {
        cognitiveMoodDistribution[m] = (cognitiveMoodDistribution[m] || 0) + trackWeight * getWeight(tagsConfidence);
        moodConfidenceScores.push({ item: m, weight: trackWeight, confidence: tagsConfidence });
      }
    });
    semanticTags.somatic_tags?.forEach(mood => {
      const m = mood?.toLowerCase().trim();
      if (m) {
        somaticMoodDistribution[m] = (somaticMoodDistribution[m] || 0) + trackWeight * getWeight(tagsConfidence);
        moodConfidenceScores.push({ item: m, weight: trackWeight, confidence: tagsConfidence });
      }
    });

    // Language
    const language = semanticTags.language_iso_639_1?.toLowerCase().trim();
    if (language) {
      languageDistribution[language] = (languageDistribution[language] || 0) + trackWeight * getWeight(tagsConfidence);
      languageConfidenceScores.push({ item: language, weight: trackWeight, confidence: tagsConfidence });
    }
  });

  // --- Calculate Aggregated Profile Values ---

  // Audio Physics Profile
  userTasteProfileV1.audio_physics_profile.energy_bias = (energyLevelScores.length > 0 ? energyLevelScores.sort((a, b) => b.weight - a.weight)[0].item : 'medium');
  userTasteProfileV1.audio_physics_profile.tempo_bias = (tempoFeelScores.length > 0 ? tempoFeelScores.sort((a, b) => b.weight - a.weight)[0].item : 'mid');
  userTasteProfileV1.audio_physics_profile.danceability_bias = (danceabilityHintScores.length > 0 ? danceabilityHintScores.sort((a, b) => b.weight - a.weight)[0].item : 'medium');
  userTasteProfileV1.audio_physics_profile.vocals_bias = (vocalsTypeScores.length > 0 ? vocalsTypeScores.sort((a, b) => b.weight - a.weight)[0].item : 'lead_vocal');
  userTasteProfileV1.audio_physics_profile.texture_bias = (textureTypeScores.length > 0 ? textureTypeScores.sort((a, b) => b.weight - a.weight)[0].item : 'hybrid');
  userTasteProfileV1.audio_physics_profile.audio_physics_profile_confidence = getOverallConfidence([
    ...energyLevelScores, ...tempoFeelScores, ...danceabilityHintScores, ...vocalsTypeScores, ...textureTypeScores
  ]);

  // Genre Profile
  userTasteProfileV1.genre_profile.primary_genre_profile_distribution = normalizeDistribution(primaryGenreDistribution);
  userTasteProfileV1.genre_profile.secondary_genre_profile_distribution = normalizeDistribution(secondaryGenreDistribution);
  userTasteProfileV1.genre_profile.primary_genres = Object.entries(primaryGenreDistribution).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([genre]) => genre);
  userTasteProfileV1.genre_profile.secondary_genres = Object.entries(secondaryGenreDistribution).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([genre]) => genre);
  userTasteProfileV1.genre_profile.genre_profile_confidence = getOverallConfidence(genreConfidenceScores);

  // Mood Profiles
  const getMoodProfile = (distribution: Record<string, number>, confidenceScores: { item: string; weight: number; confidence: ConfidenceLevel }[]) => {
    const normalizedDist = normalizeDistribution(distribution);
    const sortedMoods = Object.entries(normalizedDist).sort((a, b) => b[1] - a[1]);
    return {
      primary: sortedMoods.length > 0 ? sortedMoods[0][0] : 'neutral',
      secondary: sortedMoods.slice(1, 3).map(([mood]) => mood),
      distribution: normalizedDist,
      confidence: getOverallConfidence(confidenceScores),
    };
  };

  const emotionalProfile = getMoodProfile(emotionalMoodDistribution, moodConfidenceScores);
  userTasteProfileV1.emotional_mood_profile = { ...emotionalProfile, emotional_mood_profile_confidence: emotionalProfile.confidence };

  const cognitiveProfile = getMoodProfile(cognitiveMoodDistribution, moodConfidenceScores);
  userTasteProfileV1.cognitive_mood_profile = { ...cognitiveProfile, cognitive_mood_profile_confidence: cognitiveProfile.confidence };

  const somaticProfile = getMoodProfile(somaticMoodDistribution, moodConfidenceScores);
  userTasteProfileV1.somatic_mood_profile = { ...somaticProfile, somatic_mood_profile_confidence: somaticProfile.confidence };

  // Language Profile
  userTasteProfileV1.language_profile.language_profile_distribution = normalizeDistribution(languageDistribution);
  userTasteProfileV1.language_profile.language_profile_confidence = getOverallConfidence(languageConfidenceScores);

  // --- Overall Profile Confidence (NEW CALCULATION) ---
  const mapConfidenceToNumber = (confidence: ConfidenceLevel): number => {
    switch (confidence) {
      case 'low': return 0;
      case 'medium': return 1;
      case 'high': return 2;
    }
  };

  const bucketConfidenceScore = (score: number): ConfidenceLevel => {
    if (score >= 1.5) return 'high';
    if (score >= 0.5) return 'medium';
    return 'low';
  };

  const A_num = mapConfidenceToNumber(userTasteProfileV1.audio_physics_profile.audio_physics_profile_confidence);
  const G_num = mapConfidenceToNumber(userTasteProfileV1.genre_profile.genre_profile_confidence);
  const M_num = mapConfidenceToNumber(userTasteProfileV1.emotional_mood_profile.emotional_mood_profile_confidence);
  const L_num = mapConfidenceToNumber(userTasteProfileV1.language_profile.language_profile_confidence);

  let S_overall = (0.40 * A_num + 0.25 * G_num + 0.25 * M_num + 0.10 * L_num);

  // Safety cap (optional but recommended):
  // If A = low → cap overall_profile_confidence at medium
  if (userTasteProfileV1.audio_physics_profile.audio_physics_profile_confidence === 'low') {
    S_overall = Math.min(S_overall, mapConfidenceToNumber('medium'));
  }

  // If two or more of {G, M, L} are low → cap at medium
  let lowConfidenceCount = 0;
  if (userTasteProfileV1.genre_profile.genre_profile_confidence === 'low') lowConfidenceCount++;
  if (userTasteProfileV1.emotional_mood_profile.emotional_mood_profile_confidence === 'low') lowConfidenceCount++;
  if (userTasteProfileV1.language_profile.language_profile_confidence === 'low') lowConfidenceCount++;

  if (lowConfidenceCount >= 2) {
    S_overall = Math.min(S_overall, mapConfidenceToNumber('medium'));
  }

  userTasteProfileV1.overall_profile_confidence = bucketConfidenceScore(S_overall);

  return {
    user_taste_profile_v1: userTasteProfileV1,
    // DEPRECATED fields, kept for compatibility with App.tsx, will be removed later:
    overall_mood_category: userTasteProfileV1.emotional_mood_profile.primary,
    overall_mood_confidence: userTasteProfileV1.emotional_mood_profile.emotional_mood_profile_confidence === 'high' ? 1.0 : (userTasteProfileV1.emotional_mood_profile.emotional_mood_profile_confidence === 'medium' ? 0.6 : 0.3),
    session_semantic_profile: createSessionSemanticProfile([], []), // Placeholder for compatibility
    playlist_contexts: [], // No longer used in aggregation
    analyzed_top_tracks: tracks,
  };
};
