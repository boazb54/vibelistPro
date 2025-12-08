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

// STRATEGY G: JSONP Helper to bypass CORS/Network Blocks
// Instead of fetch(), we inject a <script> tag.
const fetchJsonp = (url: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    // Generate a unique callback name
    const callbackName = `itunes_callback_${Math.random().toString(36).substr(2, 9)}`;
    const script = document.createElement('script');
    
    // Timeout to prevent hanging if network is dead (5 seconds)
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('JSONP request timed out'));
    }, 5000);

    const cleanup = () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
      // @ts-ignore
      delete window[callbackName];
      clearTimeout(timeoutId);
    };

    // Define the global callback function that iTunes will call
    // @ts-ignore
    window[callbackName] = (data: any) => {
      cleanup();
      resolve(data);
    };

    // Construct URL with callback param
    // iTunes specifically supports &callback=...
    script.src = `${url}&callback=${callbackName}`;
    script.onerror = () => {
      cleanup();
      reject(new Error('JSONP script load failed (Network Error)'));
    };

    document.body.appendChild(script);
  });
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
      // STRATEGY G: Using JSONP means we just need the base URL, fetchJsonp adds the callback
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&limit=1&entity=song`;
      
      try {
          // STRATEGY G: Switch from fetch() to fetchJsonp()
          const data = await fetchJsonp(url);
          
          if (data.resultCount > 0) {
            result = data.results[0];
            break; // Found it! Stop searching.
          }
      } catch (innerErr) {
          console.warn(`iTunes JSONP search failed for query: ${q}`, innerErr);
          lastError = innerErr;
          // Continue to next query attempt
      }
    }

    // STRATEGY E: Propagate Error for Logging
    if (!result && lastError) {
        // If we found NO results after all tries, and the last attempt was a Network Error, throw it.
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