
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

const cleanText = (text: string): string => {
  return text
    .replace(/\(feat\..*?\)/gi, "")       
    .replace(/\(ft\..*?\)/gi, "")         
    .replace(/\(with.*?\)/gi, "")         
    .replace(/\[.*?\]/g, "")              
    .replace(/\(.*?\)/g, "")              
    .replace(/- .*?remaster.*?/gi, "")    
    .replace(/- .*?version.*?/gi, "")     
    .replace(/- .*?edit.*?/gi, "")        
    .replace(/single/gi, "")
    .replace(/official video/gi, "")
    .replace(/\s+/g, " ")                 
    .trim();
};

const searchItunes = async (query: string): Promise<ItunesResult | null> => {
    if (!query.trim()) return null;
    
    const isProduction = typeof window !== 'undefined' && 
                         window.location.hostname !== 'localhost' && 
                         window.location.hostname !== '127.0.0.1';

    // A. Try Proxy (Production)
    if (isProduction) {
        try {
            const proxyUrl = `/api/search?term=${encodeURIComponent(query)}`;
            const response = await fetch(proxyUrl);
            if (response.ok) {
                const data = await response.json();
                return data.results && data.results.length > 0 ? data.results[0] : null;
            }
        } catch (e) {
            console.error("Proxy search failed", e);
        }
    }

    // B. Localhost / Fallback: Direct Call
    try {
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=1&entity=song`;
        const response = await fetch(url);
        const data = await response.json();
        return data.results && data.results.length > 0 ? data.results[0] : null;
    } catch (error) {
        console.error("iTunes Search Error:", error);
        return null;
    }
};

export const fetchSongMetadata = async (generatedSong: GeneratedSongRaw): Promise<Song | null> => {
  try {
    const queries = [
      `${generatedSong.title} ${generatedSong.artist}`,
      `${generatedSong.title}`, 
      `${generatedSong.artist} ${generatedSong.title}`
    ];

    for (const q of queries) {
      const result = await searchItunes(cleanText(q));
      if (result && result.previewUrl) {
        return {
          id: result.trackId.toString(),
          title: result.trackName,
          artist: result.artistName,
          album: result.collectionName,
          previewUrl: result.previewUrl,
          artworkUrl: result.artworkUrl100.replace('100x100', '600x600'),
          durationMs: result.trackTimeMillis,
          itunesUrl: result.trackViewUrl,
          searchQuery: q,
          estimatedVibe: generatedSong.estimated_vibe // Pass the qualitative AI data
        };
      }
    }
    return null;
  } catch (error) {
    console.error("Metadata fetch failed", error);
    return null;
  }
};
