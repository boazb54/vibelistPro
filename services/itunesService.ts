
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
                if (data.resultCount > 0 && data.results[0].previewUrl) {
                    return data.results[0];
                }
            }
        } catch (e) {
            // Proxy failed, continue to direct
        }
    }

    // B. Try Direct (Fallback/Local)
    try {
        const directUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=1&entity=song`;
        const response = await fetch(directUrl);
        if (response.ok) {
            const data = await response.json();
            if (data.resultCount > 0 && data.results[0].previewUrl) {
                return data.results[0];
            }
        }
    } catch (e) {
        // Direct failed
    }

    return null;
};

export const fetchSongMetadata = async (generatedSong: GeneratedSongRaw): Promise<Song | null> => {
    // STRATEGY: RETRY LOOP (SAFE MODE)
    // We try multiple variations to find a valid preview.
    
    // 1. Try Title + Artist (Standard)
    let result = await searchItunes(`${generatedSong.title} ${generatedSong.artist}`);

    // 2. Try Clean Title + Artist (Fallback)
    if (!result) {
        const cleaned = `${cleanText(generatedSong.title)} ${cleanText(generatedSong.artist)}`;
        result = await searchItunes(cleaned);
    }

    // STRICT FILTER: If still no result or no previewUrl, return null.
    if (!result || !result.previewUrl) {
        return null;
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
        searchQuery: `${generatedSong.title} ${generatedSong.artist}` // Manually constructed
    };
};
