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

      // STRATEGY R: ROBUST FALLBACK
      // 1. Try Proxy (if Production)
      if (isProduction) {
          try {
              const proxyUrl = `/api/search?term=${encodeURIComponent(q)}`;
              const response = await fetch(proxyUrl);
              
              if (response.ok) {
                  const data = await response.json();
                  if (data.resultCount > 0) {
                      result = data.results[0];
                      break; // Found via Proxy!
                  }
                  // If response ok but 0 results, continue loop (try next query)
                  continue; 
              } else {
                  // If Proxy returns 404/500, throw to trigger fallback
                  console.warn(`Proxy failed for "${q}": ${response.status}`);
                  throw new Error(`ProxyStatus ${response.status}`);
              }
          } catch (proxyErr) {
              // Proxy failed (e.g. 404 Not Found), fall through to Direct attempt
              console.warn("Proxy unreachable, falling back to Direct", proxyErr);
          }
      }

      // 2. Direct Fallback (Localhost OR Production-Fallback)
      // If Proxy failed (or we are local), we try direct.
      // Note: On Mobile Production, this might still fail (CORS), but on Desktop Production, this SAVES the app.
      try {
          // FIX: Removed country=US from Direct Fetch to prevent Desktop CORS/Redirect failures
          const directUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&limit=1&entity=song`;
          
          const response = await fetch(directUrl);
          
          if (!response.ok) {
             throw new Error(`DirectStatus ${response.status}`);
          }

          const data = await response.json();
          
          if (data.resultCount > 0) {
            result = data.results[0];
            break; // Found via Direct!
          }
      } catch (directErr) {
          console.warn(`Direct search failed for query: ${q}`, directErr);
          lastError = directErr;
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