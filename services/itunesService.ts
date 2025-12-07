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

export const fetchSongMetadata = async (generatedSong: GeneratedSongRaw): Promise<Song> => {
  try {
    // Basic retry logic with slightly different queries if first fails
    const queries = [
      generatedSong.search_query,
      `${generatedSong.artist} ${generatedSong.title}`
    ];

    let result: ItunesResult | null = null;

    for (const q of queries) {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&limit=1&entity=song`;
      // Use a CORS proxy if necessary, but iTunes API often supports CORS or we rely on the browser.
      // Note: iTunes API supports JSONP but fetch is standard. Sometimes requires no-cors for opaque, but we need data.
      // Usually iTunes API works directly from browser for GET requests.
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.resultCount > 0) {
        result = data.results[0];
        break;
      }
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
    console.error(`Error fetching metadata for ${generatedSong.title}:`, error);
    return {
      id: `err-${Math.random().toString(36).substr(2, 9)}`,
      title: generatedSong.title,
      artist: generatedSong.artist,
      album: generatedSong.album,
      previewUrl: null,
      artworkUrl: null,
      searchQuery: generatedSong.search_query
    };
  }
};