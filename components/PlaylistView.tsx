import React from 'react';
import { Playlist, Song, PlayerState } from '../types';
import { PlayIcon, PauseIcon, SparklesIcon, SpotifyIcon } from './Icons';

interface PlaylistViewProps {
  playlist: Playlist;
  currentSong: Song | null;
  playerState: PlayerState;
  onPlaySong: (song: Song) => void;
  onPause: () => void;
  onReset: () => void;
  onExport: () => void;
  onDownloadCsv: () => void;
  onYouTubeExport: () => void;
  onRemix: () => void;
  onShare: () => void;
  exporting: boolean;
}

const PlaylistView: React.FC<PlaylistViewProps> = ({
  playlist,
  currentSong,
  playerState,
  onPlaySong,
  onPause,
  onReset,
  onExport,
  onRemix,
  onShare,
  exporting
}) => {
  return (
    <div className="w-full max-w-4xl mx-auto p-4 pb-32 animate-fade-in">
      <div className="glass-panel rounded-3xl p-6 md:p-8 mb-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600 rounded-full filter blur-[100px] opacity-20 -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

        <div className="relative z-10">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 text-purple-300 mb-1 uppercase tracking-wider text-xs font-bold">
                <SparklesIcon className="w-4 h-4" />
                <span>AI Generated Vibe</span>
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-white mb-2 leading-tight">{playlist.title}</h1>
              <p className="text-slate-300 max-w-xl text-sm md:text-base">{playlist.description}</p>
            </div>
            
            <div className="flex flex-wrap gap-3 w-full md:w-auto items-center">
               <button onClick={onReset} className="px-4 py-2 rounded-full border border-slate-600 hover:bg-slate-800 text-slate-300 transition-colors text-sm font-medium w-auto">New Vibe</button>
               
               <button onClick={onRemix} className="px-4 py-2 rounded-full bg-purple-600/20 hover:bg-purple-600/40 text-purple-200 border border-purple-500/30 transition-colors text-sm font-medium flex items-center gap-1.5">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                 </svg>
                 Remix
               </button>

               <button onClick={onShare} className="p-2 rounded-full bg-slate-700/50 hover:bg-slate-600 text-slate-300 transition-colors" title="Copy Link">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                   <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                 </svg>
               </button>
               
              <button onClick={onExport} disabled={exporting} className="px-4 py-2 rounded-full bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold transition-transform hover:scale-105 active:scale-95 text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                {exporting ? 'Saving...' : 'Save to Spotify'}
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {playlist.songs.map((song) => {
              const isPlaying = currentSong?.id === song.id && playerState === PlayerState.PLAYING;
              const isCurrent = currentSong?.id === song.id;
              const hasPreview = !!song.previewUrl;

              const spotifyLink = song.spotifyUri 
                ? `https://open.spotify.com/track/${song.id}` 
                : `https://open.spotify.com/search/${encodeURIComponent(song.title + " " + song.artist)}`;

              return (
                <div key={song.id} className={`group flex items-center gap-4 p-3 rounded-xl transition-all duration-200 ${isCurrent ? 'bg-white/10 border-l-4 border-purple-500' : 'hover:bg-white/5 border-l-4 border-transparent'}`}>
                  <div className="relative flex-shrink-0 w-12 h-12 md:w-16 md:h-16 rounded-lg overflow-hidden bg-slate-800 shadow-lg">
                    {song.artworkUrl ? <img src={song.artworkUrl} alt={song.album} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-slate-600 bg-slate-900"><span className="text-xs">No Art</span></div>}
                    
                    {/* VISIBILITY FIX: Removed 'opacity-0 group-hover:opacity-100' so buttons are always visible on mobile/desktop */}
                    {hasPreview ? (
                        <button 
                            onClick={() => isPlaying ? onPause() : onPlaySong(song)} 
                            className={`absolute inset-0 bg-black/30 hover:bg-black/50 flex items-center justify-center transition-colors`}
                        >
                            {isPlaying ? <PauseIcon className="w-6 h-6 text-white" /> : <PlayIcon className="w-6 h-6 text-white" />}
                        </button>
                    ) : (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                            <span className="text-[10px] text-slate-300 text-center px-1">No Preview</span>
                        </div>
                    )}

                    {isPlaying && (
                       <div className="absolute bottom-0 left-0 right-0 h-4 flex items-end justify-center gap-0.5 pb-1 pointer-events-none">
                         <div className="w-1 bg-green-400 audio-wave-bar" style={{animationDelay: '0s'}}></div>
                         <div className="w-1 bg-green-400 audio-wave-bar" style={{animationDelay: '0.1s'}}></div>
                         <div className="w-1 bg-green-400 audio-wave-bar" style={{animationDelay: '0.2s'}}></div>
                       </div>
                    )}
                  </div>
                  <div className="flex-grow min-w-0">
                    <h3 className={`font-semibold truncate ${isCurrent ? 'text-purple-300' : 'text-white'}`}>{song.title}</h3>
                    <p className="text-sm text-slate-400 truncate">{song.artist} • {song.album}</p>
                  </div>
                  <div className="flex-shrink-0 flex gap-2">
                     <a 
                       href={spotifyLink} 
                       target="_blank" 
                       rel="noreferrer" 
                       className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors border bg-[#1DB954]/10 text-[#1DB954] border-[#1DB954]/30 hover:bg-[#1DB954] hover:text-black"
                     >
                       <SpotifyIcon className="w-3.5 h-3.5" />
                       <span className="font-medium hidden md:inline">Play on Spotify</span>
                     </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlaylistView;