import React from 'react';
import { Playlist, Song, PlayerState } from '../types';
import { PlayIcon, PauseIcon, SparklesIcon, SpotifyIcon, ShareIcon } from './Icons';
import { isRtl } from '../utils/textUtils';
// import { openExternalLink } from '../utils/linkUtils'; // Removed NEW import

interface PlaylistViewProps {
  playlist: Playlist;
  currentSong: Song | null;
  playerState: PlayerState;
  onPlaySong: (song: Song) => void;
  onPause: () => void;
  onReset: () => void;
  onExport: () => void;
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
  onShare,
  exporting
}) => {
  // Calculate duration in "X hr Y min" format
  const totalDurationMs = playlist.songs.reduce((acc, song) => acc + (song.durationMs || 0), 0);
  const hours = Math.floor(totalDurationMs / 3600000);
  const minutes = Math.floor((totalDurationMs % 3600000) / 60000);
  
  // Format: "1 hr 03 min" or "45 min"
  const formattedDuration = hours > 0 
    ? `${hours} hr ${minutes.toString().padStart(2, '0')} min`
    : `${minutes} min`;

  // Dynamic RTL Detection for Playlist Meta
  const isRightToLeft = isRtl(playlist.title) || isRtl(playlist.description);
  
  // Logic: 
  // 1. Meta Container uses Flex-Align (End vs Start)
  // 2. Text Content uses Dir attribute (RTL vs LTR)
  const containerAlign = isRightToLeft ? 'items-end' : 'items-start';
  const textAlign = isRightToLeft ? 'text-right' : 'text-left';
  const contentDir = isRightToLeft ? 'rtl' : 'ltr';
  const fontClass = isRightToLeft ? "font-['Heebo']" : "";

  // 1. UNIFIED BUTTON CLASSES
  const secondaryActionBtnClass = "bg-white/5 border border-white/10 hover:bg-white/20 text-white p-2 md:px-4 md:py-2.5 rounded-xl flex items-center justify-center gap-2 transition-colors duration-200 group h-full";
  const primaryBtnClass = "bg-[#1DB954] text-black font-bold rounded-full px-8 py-3.5 flex items-center justify-center gap-2 hover:scale-105 transition-transform shadow-lg shadow-green-500/20 w-full md:w-auto";
  const iconClass = "w-5 h-5 flex-shrink-0";

  return (
    <div className="h-full w-full overflow-y-auto custom-scrollbar">
      <div className="w-full max-w-4xl mx-auto p-4 pb-32 animate-fade-in">
        <div className="glass-panel rounded-3xl p-6 md:p-10 mb-6 relative overflow-hidden">
          {/* Background Ambient Glow */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-purple-600 rounded-full filter blur-[120px] opacity-20 -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

          {/* NEW: Exit Button (X) */}
          <button 
            onClick={onReset}
            className="absolute top-6 left-6 text-slate-400 hover:text-white transition-colors z-10"
            aria-label="Exit playlist view"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="relative z-10 flex flex-col">
            
            {/* NEW: Fixed Left-aligned Label */}
            <div className="flex items-center gap-2 text-purple-300 uppercase tracking-wider text-xs font-bold mb-4">
                <SparklesIcon className="w-4 h-4" />
                <span>Mood-driven playlists</span>
            </div>

            {/* LAYER 1: META (Hybrid Alignment) - Now only contains title and duration */}
            <div className={`flex flex-col gap-2 mb-4 ${containerAlign}`}> 
                <h1 className={`text-3xl md:text-5xl font-bold text-white leading-tight ${textAlign} ${fontClass}`} dir={contentDir}>
                  {playlist.title}
                </h1>
                
                {/* Hybrid Meta Line: Flex-End (Layout) + Dir LTR (Text Integrity) */}
                <div className={`w-full flex ${isRightToLeft ? 'justify-end' : 'justify-start'}`}>
                  <div className={`text-sm text-slate-400 font-medium ${fontClass}`} dir="ltr">
                    {playlist.songs.length} Songs • {formattedDuration}
                  </div>
                </div>
            </div>

            {/* LAYER 2: CONTENT (Description - Mirrored) */}
            <div className={`mb-8 w-full ${textAlign}`} dir={contentDir}>
                <p className={`text-slate-300 text-base md:text-lg leading-relaxed max-w-3xl ${isRightToLeft ? 'ml-auto' : ''} ${fontClass}`}>
                  {playlist.description}
                </p>
            </div>
              
            {/* LAYER 3: ACTION LAYER (Always LTR, Right Anchored) */}
            <div className="flex flex-col-reverse md:flex-row md:items-center md:justify-end gap-4 md:gap-6 w-full border-t border-white/10 pt-6" dir="ltr">
                
                {/* Secondary Actions - Now only "Share Playlist" */}
                <div className="flex md:block w-full md:w-auto"> {/* Adjusted for standalone desktop share button */}
                    <button onClick={onShare} title="Share Playlist" className={`${secondaryActionBtnClass} w-full`}>
                      <ShareIcon className={iconClass} />
                      <span className="text-[10px] md:text-sm font-medium whitespace-nowrap">Share Playlist</span>
                    </button>
                </div>

                {/* Primary Action */}
                <button onClick={onExport} disabled={exporting} className={primaryBtnClass}>
                  <SpotifyIcon className={iconClass} />
                  <span>{exporting ? 'Saving...' : 'Save to Spotify'}</span>
                </button>

              </div>
            </div>

            {/* Track List */}
            <div className="mt-8 space-y-3">
              {playlist.songs.map((song) => {
                const isPlaying = currentSong?.id === song.id && playerState === PlayerState.PLAYING;
                const isCurrent = currentSong?.id === song.id;
                const hasPreview = !!song.previewUrl;

                // Row-Level RTL Detection
                const isSongRtl = isRtl(song.title) || isRtl(song.artist);
                const songTextAlign = isSongRtl ? 'text-right' : 'text-left';
                const songDir = isSongRtl ? 'rtl' : 'ltr';
                const songFont = isSongRtl ? "font-['Heebo']" : "";

                return (
                  <div 
                    key={song.id} 
                    className={`group flex items-center gap-4 p-3 rounded-xl transition-all duration-300 ease-in-out cursor-pointer 
                                ${isCurrent ? 'bg-slate-800/80 border-l-4 border-purple-500 shadow-lg shadow-purple-500/20 scale-[1.02]' : 'border-l-4 border-transparent hover:bg-slate-800/50 hover:border-purple-500/30 hover:scale-[1.01]'}`}
                    onClick={() => hasPreview && (isPlaying ? onPause() : onPlaySong(song))}
                  >
                    {/* Artwork & Play Button (Fixed Anchor: Always Left) */}
                    <div className="relative flex-shrink-0 w-12 h-12 md:w-16 md:h-16 rounded-lg overflow-hidden bg-slate-800 shadow-lg">
                      {song.artworkUrl ? <img src={song.artworkUrl} alt={song.album} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-slate-600 bg-slate-900"><span className="text-xs">No Art</span></div>}
                      
                      {hasPreview ? (
                          <button onClick={(e) => { e.stopPropagation(); isPlaying ? onPause() : onPlaySong(song); }} className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity opacity-100`}>
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
                    
                    {/* Track Info (Text Alignment conditional on language, no truncate) */}
                    <div className={`flex-grow min-w-0 ${songTextAlign}`} dir={songDir}>
                      <h3 className={`font-semibold ${isCurrent ? 'text-purple-300' : 'text-white'} ${songFont}`}>{song.title}</h3>
                      <p className={`text-sm text-slate-400 ${songFont}`}>{song.artist} • {song.album}</p>
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
