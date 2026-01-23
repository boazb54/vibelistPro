
import React from 'react';
import { Playlist, Song, PlayerState } from '../types';
import { PlayIcon, PauseIcon, SparklesIcon, SpotifyIcon } from './Icons';
import { isRtl } from '../utils/textUtils';

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
  exporting
}) => {
  const totalDurationMs = playlist.songs.reduce((acc, song) => acc + (song.durationMs || 0), 0);
  const hours = Math.floor(totalDurationMs / 3600000);
  const minutes = Math.floor((totalDurationMs % 3600000) / 60000);
  const formattedDuration = hours > 0 
    ? `${hours} hr ${minutes.toString().padStart(2, '0')} min`
    : `${minutes} min`;

  const isRightToLeft = isRtl(playlist.title) || isRtl(playlist.description);
  const fontClass = isRightToLeft ? "font-['Heebo']" : "";

  return (
    <div className="h-full w-full overflow-y-auto custom-scrollbar">
      <div className="w-full max-w-4xl mx-auto p-4 pb-32 animate-fade-in">
        <div className="glass-panel rounded-3xl p-6 md:p-10 mb-6 relative overflow-hidden">
          
          {/* Version 2.1.2: Top Left Close Button */}
          <button 
            onClick={onReset}
            className="absolute top-6 left-6 md:top-8 md:left-8 text-slate-400 hover:text-white transition-colors z-20 p-2 rounded-full hover:bg-white/5"
            aria-label="Close Playlist"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="absolute top-0 right-0 w-96 h-96 bg-purple-600 rounded-full filter blur-[120px] opacity-20 -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

          <div className="relative z-10 flex flex-col">
            <div className={`flex items-center gap-2 text-purple-300 uppercase tracking-wider text-xs font-bold mb-4 mt-10 md:mt-0 ${isRightToLeft ? 'justify-end' : 'justify-start md:ml-12 ml-0'}`}>
                <SparklesIcon className="w-4 h-4" />
                <span>Mood-driven playlists</span>
            </div>

            <div className={`flex flex-col gap-2 mb-4 ${isRightToLeft ? 'items-end' : 'items-start'}`}> 
                <h1 className={`text-3xl md:text-5xl font-bold text-white leading-tight ${isRightToLeft ? 'text-right' : 'text-left'} ${fontClass}`} dir={isRightToLeft ? 'rtl' : 'ltr'}>
                  {playlist.title}
                </h1>
                <div className={`text-sm text-slate-400 font-medium ${fontClass}`} dir="ltr">
                  {playlist.songs.length} Songs • {formattedDuration}
                </div>
            </div>

            <div className={`mb-8 w-full ${isRightToLeft ? 'text-right' : 'text-left'}`} dir={isRightToLeft ? 'rtl' : 'ltr'}>
                <p className={`text-slate-300 text-base md:text-lg leading-relaxed max-w-3xl ${isRightToLeft ? 'ml-auto' : ''} ${fontClass}`}>
                  {playlist.description}
                </p>
            </div>
              
            {/* Action Area: Single CTA focus */}
            <div className="flex items-center justify-end w-full border-t border-white/10 pt-6">
                <button 
                  onClick={onExport} 
                  disabled={exporting} 
                  className="bg-[#1DB954] text-black font-bold rounded-full px-12 py-4 flex items-center justify-center gap-2 hover:scale-105 transition-all shadow-lg shadow-green-500/20 w-full md:w-auto active:scale-95 disabled:opacity-50"
                >
                  <SpotifyIcon className="w-5 h-5" />
                  <span>{exporting ? 'Saving...' : 'Save to Spotify'}</span>
                </button>
            </div>
          </div>

          <div className="mt-8 space-y-3">
            {playlist.songs.map((song) => {
              const isPlaying = currentSong?.id === song.id && playerState === PlayerState.PLAYING;
              const isCurrent = currentSong?.id === song.id;
              const hasPreview = !!song.previewUrl;
              const isSongRtl = isRtl(song.title) || isRtl(song.artist);

              return (
                <div key={song.id} className={`group flex items-center gap-4 p-3 rounded-xl transition-all duration-300 ${isCurrent ? 'bg-slate-800/80 border-l-4 border-purple-500 shadow-lg' : 'border-l-4 border-transparent hover:bg-slate-800/50'}`}>
                  <div className="relative flex-shrink-0 w-12 h-12 md:w-16 md:h-16 rounded-lg overflow-hidden bg-slate-800">
                    {song.artworkUrl && <img src={song.artworkUrl} alt={song.album} className="w-full h-full object-cover" />}
                    {hasPreview ? (
                        <button onClick={() => isPlaying ? onPause() : onPlaySong(song)} className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          {isPlaying ? <PauseIcon className="w-6 h-6 text-white" /> : <PlayIcon className="w-6 h-6 text-white" />}
                        </button>
                    ) : (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                            <span className="text-[10px] text-slate-300">No Preview</span>
                        </div>
                    )}
                  </div>
                  
                  <div className={`flex-grow min-w-0 ${isSongRtl ? 'text-right' : 'text-left'}`} dir={isSongRtl ? 'rtl' : 'ltr'}>
                    <h3 className={`font-semibold truncate ${isCurrent ? 'text-purple-300' : 'text-white'}`}>{song.title}</h3>
                    <p className="text-sm text-slate-400 truncate">{song.artist}</p>
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
