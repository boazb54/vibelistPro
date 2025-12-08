import { Song, GeneratedSongRaw } from "../types";

interface ItunesResult {
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName: string;
  previewUrl: string;
  artworkUrl100: string;
  trackViewUrl: string;
  trackTimeMillis: number;
}

// HELPER: Smart Cleaning to make iTunes Search reliable
// iTunes is picky. We need to strip "feat.", "Remastered", "Radio Edit" etc.
const cleanText = (text: string): string => {
  return text
    .replace(/\(feat\..*?\)/gi, "")       // Remove (feat. X)
    .replace(/\(ft\..*?\)/gi, "")         // Remove (ft. X)
    .replace(/\(with.*?\)/gi, "")         // Remove (with X)
    .replace(/\[.*?\]/g, "")              // Remove [Remastered] etc
    .replace(/\(.*?\)/g, "")              // Remove any other parens like (2011 Remaster)
    .replace(/- .*?remaster.*?/gi, "")    // Remove "- 2009 Remaster"
    .replace(/- .*?version.*?/gi, "")     // Remove "- Album Version"
    .replace(/- .*?edit.*?/gi, "")        // Remove "- Radio Edit"
    .replace(/single/gi, "")
    .replace(/official video/gi, "")
    // STRATEGY C: Removed aggressive non-word remover to keep accents/intl chars
    .replace(/\s+/g, " ")                 // Collapse spaces
    .trim();
};

export const fetchSongMetadata = async (generatedSong: GeneratedSongRaw): Promise<Song> => {
  try {
    const cleanTitle = cleanText(generatedSong.title);
    const cleanArtist = cleanText(generatedSong.artist);

    // STRATEGY B: Multi-Attempt Search
    // 1. AI's specific query
    // 2. Clean Title + Artist (The "Magic" Query)
    // 3. Raw Title + Artist (Fallback)
    // 4. Clean Title Only (The "Hail Mary" - guarantees a hit if artist is wrong)
    const queries = [
      generatedSong.search_query,
      `${cleanTitle} ${cleanArtist}`,
      `${generatedSong.title} ${generatedSong.artist}`,
      cleanTitle
    ];

    // Deduplicate queries to save network calls
    const uniqueQueries = Array.from(new Set(queries));

    let result: ItunesResult | null = null;
    let lastError: any = null;

    for (const q of uniqueQueries) {
      if (!q.trim()) continue;

      // STRATEGY D: REMOVED country=US param
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&limit=1&entity=song`;
      
      try {
          // FIX: Mobile Network Filter Bypass (no-referrer)
          const response = await fetch(url, { referrerPolicy: "no-referrer" });
          if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
          }

          const data = await response.json();
          
          if (data.resultCount > 0) {
            result = data.results[0];
            break; // Found it! Stop searching.
          }
      } catch (innerErr) {
          console.warn(`iTunes search failed for query: ${q}`, innerErr);
          lastError = innerErr;
          // Continue to next query attempt
      }
    }

    // STRATEGY E: Propagate Error for Logging
    if (!result && lastError) {
        // If we found NO results after all tries, and the last attempt was a Network Error, throw it.
        // This allows App.tsx to see "Network Error" in the debug logs instead of just "No Preview".
        throw lastError; 
    }

    if (!result) {
      // Fallback if not found: return the generated data with null preview
      return {
        id: `gen-${Math.random().toString(36).substr(2, 9)}`,
        title: generatedSong.title,
        artist: generatedSong.artist,
        album: generatedSong.album,
        previewUrl: null,
        artworkUrl: null, // Could use a default placeholder
        searchQuery: generatedSong.search_query
      };
    }

    return {
      id: result.trackId.toString(),
      title: result.trackName,
      artist: result.artistName,
      album: result.collectionName,
      previewUrl: result.previewUrl,
      artworkUrl: result.artworkUrl100.replace('100x100', '600x600'), // Get higher res
      itunesUrl: result.trackViewUrl,
      durationMs: result.trackTimeMillis,
      searchQuery: generatedSong.search_query
    };

  } catch (error) {
    // If we re-threw the network error above, it catches here.
    // Re-throw it again so App.tsx sees it.
    throw error;
  }
};