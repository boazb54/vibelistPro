
import React, { useState } from 'react';
import { Playlist, Song, PlayerState } from '../types';
import { PlayIcon, PauseIcon, SparklesIcon, SpotifyIcon } from './Icons';
import { isRtl } from '../utils/textUtils';
import { Browser } from '@capacitor/browser';

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
  hasExported: boolean;
  lastExportedUrl: string | null;
}

const PlaylistView: React.FC<PlaylistViewProps> = ({
  playlist,
  currentSong,
  playerState,
  onPlaySong,
  onPause,
  onReset,
  onExport,
  exporting,
  hasExported,
  lastExportedUrl
}) => {
  const [showExitGate, setShowExitGate] = useState(false);

  // Calculate duration in "X hr Y min" format
  const totalDurationMs = playlist.songs.reduce((acc, song) => acc + (song.durationMs || 0), 0);
  const hours = Math.floor(totalDurationMs / 3600000);
  const minutes = Math.floor((totalDurationMs % 3600000) / 60000);
  
  const formattedDuration = hours > 0 
    ? `${hours} hr ${minutes.toString().padStart(2, '0')} min`
    : `${minutes} min`;

  const isRightToLeft = isRtl(playlist.title) || isRtl(playlist.description);
  
  const containerAlign = isRightToLeft ? 'items-end' : 'items-start';
  const textAlign = isRightToLeft ? 'text-right' : 'text-left';
  const contentDir = isRightToLeft ? 'rtl' : 'ltr';
  const fontClass = isRightToLeft ? "font-['Heebo']" : "";

  const primaryBtnClass = "bg-[#1DB954] text-black font-bold rounded-full px-8 py-3.5 flex items-center justify-center gap-2 hover:scale-105 transition-transform shadow-lg shadow-green-500/20 w-full md:w-auto";
  const iconClass = "w-5 h-5 flex-shrink-0";

  const handleCloseClick = () => {
    if (hasExported) {
      setShowExitGate(true);
    } else {
      onReset();
    }
  };

  const handlePlayNow = async () => {
    if (lastExportedUrl) {
      try {
        await Browser.open({ url: lastExportedUrl });
      } catch (e) {
        window.open(lastExportedUrl, '_blank');
      }
    }
    setShowExitGate(false);
  };

  const handleCreateNewVibe = () => {
    setShowExitGate(false);
    onReset();
  };

  return (
    <div className="h-full w-full overflow-y-auto custom-scrollbar">
      <div className="w-full max-w-4xl mx-auto p-4 pb-32 animate-fade-in">
        <div className="glass-panel rounded-3xl p-6 md:p-10 mb-6 relative overflow-hidden">
          
          {/* Version 2.1.2: Top Left Close Button */}
          <button 
            onClick={handleCloseClick}
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

            <div className={`flex flex-col gap-2 mb-4 ${containerAlign}`}> 
                <h1 className={`text-3xl md:text-5xl font-bold text-white leading-tight ${textAlign} ${fontClass}`} dir={contentDir}>
                  {playlist.title}
                </h1>
                
                <div className={`w-full flex ${isRightToLeft ? 'justify-end' : 'justify-start'}`}>
                  <div className={`text-sm text-slate-400 font-medium ${fontClass}`} dir="ltr">
                    {playlist.songs.length} Songs • {formattedDuration}
                  </div>
                </div>
            </div>

            <div className={`mb-8 w-full ${textAlign}`} dir={contentDir}>
                <p className={`text-slate-300 text-base md:text-lg leading-relaxed max-w-3xl ${isRightToLeft ? 'ml-auto' : ''} ${fontClass}`}>
                  {playlist.description}
                </p>
            </div>
              
            <div className="flex flex-col-reverse md:flex-row md:items-center md:justify-end gap-4 md:gap-6 w-full border-t border-white/10 pt-6" dir="ltr">
                <button onClick={onExport} disabled={exporting} className={primaryBtnClass}>
                  <SpotifyIcon className={iconClass} />
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
              const songTextAlign = isSongRtl ? 'text-right' : 'text-left';
              const songDir = isSongRtl ? 'rtl' : 'ltr';
              const songFont = isSongRtl ? "font-['Heebo']" : "";

              return (
                <div key={song.id} className={`group flex items-center gap-4 p-3 rounded-xl transition-all duration-300 ease-in-out ${isCurrent ? 'bg-slate-800/80 border-l-4 border-purple-500 shadow-lg shadow-purple-500/20 scale-[1.02]' : 'border-l-4 border-transparent hover:bg-slate-800/50 hover:border-purple-500/30 hover:scale-[1.01]'}`}>
                  <div className="relative flex-shrink-0 w-12 h-12 md:w-16 md:h-16 rounded-lg overflow-hidden bg-slate-800 shadow-lg">
                    {song.artworkUrl ? <img src={song.artworkUrl} alt={song.album} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-slate-600 bg-slate-900"><span className="text-xs">No Art</span></div>}
                    
                    {hasPreview ? (
                        <button onClick={() => isPlaying ? onPause() : onPlaySong(song)} className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity opacity-100`}>
                        {isPlaying ? <PauseIcon className="w-6 h-6 text-white" /> : <PlayIcon className="w-6 h-6 text-white" />}
                        </button>
                    ) : (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-100">
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
                  
                  <div className={`flex-grow min-w-0 ${songTextAlign}`} dir={songDir}>
                    <h3 className={`font-semibold truncate ${isCurrent ? 'text-purple-300' : 'text-white'} ${songFont}`}>{song.title}</h3>
                    <p className={`text-sm text-slate-400 truncate ${songFont}`}>{song.artist} • {song.album}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Safe Exit Gate Bottom Sheet (Version 2.1.2) */}
      {showExitGate && (
        <div 
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in" 
          onClick={() => setShowExitGate(false)}
        >
          <div 
            className="w-full max-w-lg bg-[#1e293b] rounded-t-[32px] p-6 pb-12 shadow-2xl animate-slide-up"
            onClick={e => e.stopPropagation()}
          >
            {/* Drag Indicator */}
            <div className="w-12 h-1.5 bg-slate-700 rounded-full mx-auto mb-6"></div>
            
            <h3 className="text-xl font-bold text-white mb-2 text-center md:text-left">Before you leave…</h3>
            <p className="text-slate-300 mb-8 leading-relaxed text-center md:text-left">
              Do you want to play this playlist on Spotify now, or create a new vibe and listen later?
            </p>
            
            <div className="flex flex-col gap-3">
              <button 
                onClick={handlePlayNow}
                className="w-full bg-[#1DB954] text-black font-bold py-4 rounded-2xl hover:bg-[#1ed760] transition-colors"
              >
                Play on Spotify now
              </button>
              <button 
                onClick={handleCreateNewVibe}
                className="w-full bg-slate-800 text-white font-bold py-4 rounded-2xl hover:bg-slate-700 transition-colors"
              >
                Create new vibe
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlaylistView;
