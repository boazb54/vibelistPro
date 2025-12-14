
import { AnalyzedTrack, SessionSemanticProfile } from '../types';

const CONFIDENCE_WEIGHTS: Record<string, number> = {
  'high': 1.0,
  'medium': 0.6,
  'low': 0.3
};

function getWeight(confidence: string): number {
  return CONFIDENCE_WEIGHTS[confidence?.toLowerCase()] || 0.3;
}

export const aggregateSessionData = (tracks: AnalyzedTrack[]): SessionSemanticProfile => {
  
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


  // 2. GENRE AGGREGATION
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

  // Filter outliers (< 10-15%) & Keep Top 3
  const dominantGenres = Object.entries(genreScores)
    .map(([genre, score]) => ({ genre, score, percentage: score / (totalGenreWeight || 1) }))
    .filter(item => item.percentage >= 0.10) // Drop low-frequency outliers
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(item => item.genre);


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

  return {
      dominant_genres: dominantGenres,
      energy_bias: energyBias,
      energy_distribution: energyDistribution,
      dominant_moods: dominantMoods,
      tempo_bias: tempoBias,
      vocals_bias: vocalsBias,
      texture_bias: textureBias,
      artist_examples: topArtists
  };
};
