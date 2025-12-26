import React from 'react';
import { SparklesIcon, SpotifyIcon, PlayIcon } from './Icons';
import { isRtl } from '../utils/textUtils';

interface TeaserPlaylist {
  title: string;
  description: string;
  mood: string;
}

interface TeaserPlaylistViewProps {
  playlist: TeaserPlaylist;
  isConfirmationStep: boolean;
  onUnlock: () => void;
  onConfirm: () => void;
  onTryAnother: () => void;
}

const TeaserPlaylistView: React.FC<TeaserPlaylistViewProps> = ({ playlist, isConfirmationStep, onUnlock, onConfirm, onTryAnother }) => {
  const isRightToLeft = isRtl(playlist.title) || isRtl(playlist.description);
  
  const containerAlign = isRightToLeft ? 'items-end' : 'items-start';
  const textAlign = isRightToLeft ? 'text-right' : 'text-left';
  const contentDir = isRightToLeft ? 'rtl' : 'ltr';
  const fontClass = isRightToLeft ? "font-['Heebo']" : "";
  
  const unlockBtnClass = "bg-[#1DB954] text-black font-bold rounded-full px-8 py-3.5 flex items-center justify-center gap-2 hover:scale-105 transition-transform shadow-lg shadow-green-500/20 w-full md:w-auto";
  const confirmBtnClass = "bg-gradient-to-r from-purple-500 to-cyan-400 text-white font-bold rounded-full px-10 py-4 flex items-center justify-center gap-2 hover:scale-105 transition-transform shadow-lg shadow-purple-500/20 w-full md:w-auto";
  const iconClass = "w-5 h-5 flex-shrink-0";

  const renderActions = () => {
    if (isConfirmationStep) {
      return (
        <div className="flex flex-col items-center justify-center gap-4 w-full mt-6" dir="ltr">
          {/*
            [Architectural Decision v1.5.2]
            The "Try another moment" button is deliberately removed from the post-authentication confirmation step.
            This is to prevent user confusion and create a single, clear path to generating the selected vibe.
            The user must now use primary navigation (e.g., the logo) to intentionally reset the flow.
          */}
          <button onClick={onConfirm} className={`${confirmBtnClass} max-w-xs mt-2`}>
            <span>One last touch</span>
          </button>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center gap-4 w-full mt-6" dir="ltr">
          <button onClick={onUnlock} className={`${unlockBtnClass} max-w-xs`}>
            <SpotifyIcon className={iconClass} />
            <span>Unlock on Spotify</span>
          </button>

          <button 
            onClick={onTryAnother}
            className="text-slate-300 font-medium hover:text-white transition-colors"
          >
            Try another moment
          </button>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/80 backdrop-blur-md animate-fade-in p-4">
      <div className="glass-panel w-full max-w-2xl rounded-3xl p-6 md:p-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-purple-600 rounded-full filter blur-[120px] opacity-20 -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

        <div className="relative z-10 flex flex-col">
          
          <div className="flex items-center gap-2 text-purple-300 uppercase tracking-wider text-xs font-bold mb-4">
              <SparklesIcon className="w-4 h-4" />
              <span>Mood-driven playlists</span>
          </div>

          <div className={`flex flex-col gap-2 mb-4 ${containerAlign}`}> 
              <h1 className={`text-3xl md:text-5xl font-bold text-white leading-tight ${textAlign} ${fontClass}`} dir={contentDir}>
                {playlist.title}
              </h1>
              
              <div className={`w-full flex ${isRightToLeft ? 'justify-end' : 'justify-start'}`}>
                <div className={`text-sm text-slate-400 font-medium ${fontClass}`} dir="ltr">
                  15 Songs • 59 min
                </div>
              </div>
          </div>

          <div className={`mb-6 w-full ${textAlign}`} dir={contentDir}>
              <p className={`text-slate-300 text-base md:text-lg leading-normal max-w-3xl ${isRightToLeft ? 'ml-auto' : ''} ${fontClass}`}>
                {playlist.description}
              </p>
          </div>
            
          <div 
            className="space-y-3 relative border-t border-white/10 pt-4" 
            style={{
              maskImage: 'linear-gradient(to bottom, black 70%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 70%, transparent 100%)'
            }}
          >
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-2 animate-pulse">
                <div className="relative flex-shrink-0 w-12 h-12 rounded-lg bg-slate-800">
                    <div className="absolute inset-0 flex items-center justify-center">
                        <PlayIcon className="w-6 h-6 text-slate-700" />
                    </div>
                </div>
                <div className="flex-grow min-w-0 space-y-2.5">
                  <div className={`h-3 bg-slate-800 rounded w-3/4`}></div>
                  <div className={`h-3 bg-slate-800 rounded w-1/2`}></div>
                </div>
                <div className="flex-shrink-0 h-8 w-24 rounded-full bg-slate-800 hidden md:block"></div>
              </div>
            ))}
          </div>
        </div>
        
        {renderActions()}
      </div>
    </div>
  );
};

export default TeaserPlaylistView;