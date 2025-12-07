import React, { useEffect, useRef } from 'react';
import { Song, PlayerState } from '../types';
import { PlayIcon, PauseIcon } from './Icons';

interface PlayerControlsProps {
  currentSong: Song | null;
  playerState: PlayerState;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  playlistTitle?: string;
}

const PlayerControls: React.FC<PlayerControlsProps> = ({
  currentSong,
  playerState,
  onTogglePlay,
  onNext,
  onPrev,
  onClose,
  playlistTitle
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (audioRef.current) {
      if (playerState === PlayerState.PLAYING) {
        audioRef.current.play().catch(e => console.warn("Playback prevented:", e));
      } else {
        audioRef.current.pause();
      }
    }
  }, [playerState, currentSong]); // Re-run if song or state changes

  useEffect(() => {
     // When song changes, reload source
    if (audioRef.current && currentSong?.previewUrl) {
      audioRef.current.load();
      if (playerState === PlayerState.PLAYING) {
         audioRef.current.play().catch(console.error);
      }
    }
  }, [currentSong]);

  if (!currentSong) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 p-4 z-50 animate-slide-up">
      <div className="max-w-4xl mx-auto glass-panel rounded-2xl p-4 flex items-center gap-4 shadow-2xl border-t border-white/10 relative">
        
        {/* Hidden Audio Element */}
        <audio
          ref={audioRef}
          src={currentSong.previewUrl || ''}
          onEnded={onNext}
          onError={() => {
            console.error("Audio error, skipping");
            onNext();
          }}
        />

        {/* Artwork */}
        <div className="h-12 w-12 md:h-14 md:w-14 rounded-lg overflow-hidden bg-slate-800 flex-shrink-0 relative group">
           <img 
            src={currentSong.artworkUrl || 'https://picsum.photos/200'} 
            alt="Now Playing" 
            className={`w-full h-full object-cover ${playerState === PlayerState.PLAYING ? 'animate-pulse' : ''}`}
           />
        </div>

        {/* Info */}
        <div className="flex-grow min-w-0">
          <div className="text-xs text-purple-300 uppercase font-bold tracking-wider mb-0.5">
            {playlistTitle ? `Playing from: ${playlistTitle}` : 'Now Playing Preview'}
          </div>
          <h3 className="text-white font-semibold truncate">{currentSong.title}</h3>
          <p className="text-slate-400 text-sm truncate">{currentSong.artist}</p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 md:gap-4">
          <button onClick={onPrev} className="text-slate-400 hover:text-white transition-colors p-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 md:w-6 md:h-6">
              <path d="M9.195 18.44c1.25.713 2.805-.19 2.805-1.629v-2.34l6.945 3.968c1.25.714 2.805-.188 2.805-1.628V8.688c0-1.44-1.555-2.342-2.805-1.628L12 11.03v-2.34c0-1.44-1.555-2.343-2.805-1.629l-7.108 4.062c-1.26.72-1.26 2.536 0 3.256l7.108 4.061z" />
            </svg>
          </button>

          <button 
            onClick={onTogglePlay}
            className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-full bg-white text-black hover:scale-105 active:scale-95 transition-all shadow-lg shadow-white/20"
          >
            {playerState === PlayerState.PLAYING ? (
              <PauseIcon className="w-5 h-5 md:w-6 md:h-6" />
            ) : (
              <PlayIcon className="w-5 h-5 md:w-6 md:h-6 ml-0.5" />
            )}
          </button>

          <button onClick={onNext} className="text-slate-400 hover:text-white transition-colors p-2">
             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 md:w-6 md:h-6">
              <path d="M5.055 7.06c-1.25-.714-2.805.189-2.805 1.628v8.123c0 1.44 1.555 2.342 2.805 1.628L12 14.471v2.34c0 1.44 1.555 2.342 2.805 1.628l7.108-4.061c1.26-.72 1.26-2.536 0-3.256l-7.108-4.062c-1.25-.713-2.805.19-2.805 1.629v2.34l-6.945-3.968z" />
            </svg>
          </button>
        </div>

        {/* Separator */}
        <div className="w-px h-8 bg-white/10 hidden md:block"></div>

        {/* Close Button */}
        <button 
          onClick={onClose}
          className="text-slate-500 hover:text-white hover:bg-white/10 rounded-full p-2 transition-all"
          title="Close Player"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

      </div>
    </div>
  );
};

export default PlayerControls;