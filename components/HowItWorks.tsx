import React from 'react';
import { MicIcon, SparklesIcon, SpotifyIcon } from './Icons';

const HowItWorks: React.FC = () => {
  return (
    <div className="w-full max-w-4xl mx-auto animate-fade-in">
      {/* Ribbon Container: Thin horizontal row (max ~60px) */}
      <div className="flex flex-row items-center justify-between px-3 md:px-8 py-3 bg-white/5 border border-white/10 rounded-full backdrop-blur-md shadow-2xl mx-1 md:mx-0">
        
        {/* Step 1: Input */}
        <div className="flex items-center gap-2 md:gap-3 flex-1 justify-center md:justify-start">
            <div className="p-1.5 rounded-full bg-purple-500/20 text-purple-400 flex-shrink-0">
                <MicIcon className="w-4 h-4 md:w-5 md:h-5" />
            </div>
            <span className="text-xs md:text-sm font-medium text-slate-200 whitespace-nowrap">
                <span className="md:hidden">Voice</span>
                <span className="hidden md:inline">Text or Voice</span>
            </span>
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-white/10 mx-1 md:mx-2"></div>

        {/* Step 2: AI */}
        <div className="flex items-center gap-2 md:gap-3 flex-1 justify-center">
            <div className="p-1.5 rounded-full bg-cyan-500/20 text-cyan-400 flex-shrink-0">
                <SparklesIcon className="w-4 h-4 md:w-5 md:h-5" />
            </div>
            <span className="text-xs md:text-sm font-medium text-slate-200 whitespace-nowrap">
                <span className="md:hidden">AI Mood</span>
                <span className="hidden md:inline">Mood & Energy AI</span>
            </span>
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-white/10 mx-1 md:mx-2"></div>

        {/* Step 3: Spotify */}
        <div className="flex items-center gap-2 md:gap-3 flex-1 justify-center md:justify-end">
             <div className="p-1.5 rounded-full bg-[#1DB954]/20 text-[#1DB954] flex-shrink-0">
                <SpotifyIcon className="w-4 h-4 md:w-5 md:h-5" />
            </div>
            <span className="text-xs md:text-sm font-medium text-slate-200 whitespace-nowrap">
                <span className="md:hidden">Spotify</span>
                <span className="hidden md:inline">Works with Spotify</span>
            </span>
        </div>

      </div>
    </div>
  );
};

export default HowItWorks;