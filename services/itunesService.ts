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
    .replace(/\s+/g, " ")                 // Collapse spaces
    .trim();
};

export const fetchSongMetadata = async (generatedSong: GeneratedSongRaw): Promise<Song> => {
  try {
    const cleanTitle = cleanText(generatedSong.title);
    const cleanArtist = cleanText(generatedSong.artist);

    // STRATEGY B: Multi-Attempt Search
    const queries = [
      generatedSong.search_query,
      `${cleanTitle} ${cleanArtist}`,
      `${generatedSong.title} ${generatedSong.artist}`,
      cleanTitle
    ];

    // Deduplicate queries
    const uniqueQueries = Array.from(new Set(queries));

    let result: ItunesResult | null = null;
    let lastError: any = null;

    // STRATEGY I: Smart Routing
    // Check if we are running on the live Vercel site
    const isProduction = typeof window !== 'undefined' && 
                         window.location.hostname !== 'localhost' && 
                         window.location.hostname !== '127.0.0.1';

    for (const q of uniqueQueries) {
      if (!q.trim()) continue;

      let url = '';

      if (isProduction) {
          // PRODUCTION: Use the Server-Side Proxy (api/search.js)
          // This bypasses Mobile Carrier blocks and CORS issues completely.
          // Note: The proxy function internally adds country=US, limit=1, etc.
          url = `/api/search?term=${encodeURIComponent(q)}`;
      } else {
          // LOCALHOST: Use Direct Connection
          // Development machines usually don't have carrier blocks, and /api/ isn't served by Vite by default.
          url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&limit=1&entity=song&country=US&lang=en_us`;
      }
      
      try {
          // Standard Fetch (No JSONP, No CORS hacks needed for Proxy)
          const response = await fetch(url);
          
          if (!response.ok) {
             // If proxy fails or iTunes fails
             throw new Error(`Status ${response.status}`);
          }

          const data = await response.json();
          
          if (data.resultCount > 0) {
            result = data.results[0];
            break; // Found it! Stop searching.
          }
      } catch (innerErr) {
          console.warn(`Search failed for query: ${q}`, innerErr);
          lastError = innerErr;
      }
    }

    // Propagate Error for Logging if absolutely everything failed
    if (!result && lastError) {
        throw lastError; 
    }

    if (!result) {
      // Fallback: return generated data with null preview
      return {
        id: `gen-${Math.random().toString(36).substr(2, 9)}`,
        title: generatedSong.title,
        artist: generatedSong.artist,
        album: generatedSong.album,
        previewUrl: null,
        artworkUrl: null,
        searchQuery: generatedSong.search_query
      };
    }

    return {
      id: result.trackId.toString(),
      title: result.trackName,
      artist: result.artistName,
      album: result.collectionName,
      previewUrl: result.previewUrl,
      artworkUrl: result.artworkUrl100.replace('100x100', '600x600'),
      itunesUrl: result.trackViewUrl,
      durationMs: result.trackTimeMillis,
      searchQuery: generatedSong.search_query
    };

  } catch (error) {
    throw error;
  }
};