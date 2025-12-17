import React from 'react';
import { MicIcon, SparkIcon, MusicNoteIcon } from './Icons';

const HowItWorks: React.FC = () => {
  // V.1.2.6 - Dual-layered "Spectral" Halo
  // Matches the Purple-to-Blue energy of the main input textbox
  const iconShineClass = "text-purple-400 brightness-125 drop-shadow-[0_0_5px_rgba(168,85,247,0.9)] drop-shadow-[0_0_15px_rgba(59,130,246,0.6)]";

  return (
    <div className="w-full animate-fade-in mt-3 px-0">
      {/* 
        V.1.2.8 Mobile Legibility Polish
        - Icon Glow: Dual-tonal "glory halo" (Purple core + Blue outer glow).
        - Typography (Mobile): Boosted to text-[11px] and text-slate-300 for crisp visibility.
        - Typography (Desktop): Remains text-lg / font-normal / text-slate-400.
        - Layout: Maintains wide-lens gap-28 symmetry.
      */}

      {/* MOBILE VIEW: Grid (No Lines) - Enhanced Visibility Typography & Spectral Icons */}
      <div className="md:hidden grid grid-cols-3 w-full items-center px-2">
        {/* Step 1: Share a moment */}
        <div className="flex justify-start">
          <div className="flex items-center gap-1.5">
            <MicIcon className={`w-3.5 h-3.5 ${iconShineClass}`} />
            <span className="text-[11px] text-slate-300 font-normal whitespace-nowrap">
              Share a moment
            </span>
          </div>
        </div>

        {/* Step 2: Set the Vibe */}
        <div className="flex justify-center">
          <div className="flex items-center gap-1.5">
            <SparkIcon className={`w-3.5 h-3.5 ${iconShineClass}`} />
            <span className="text-[11px] text-slate-300 font-normal whitespace-nowrap">
              Set the Vibe
            </span>
          </div>
        </div>

        {/* Step 3: Get your list */}
        <div className="flex justify-end">
          <div className="flex items-center gap-1.5">
            <MusicNoteIcon className={`w-3.5 h-3.5 ${iconShineClass}`} />
            <span className="text-[11px] text-slate-300 font-normal whitespace-nowrap">
              Get your list
            </span>
          </div>
        </div>
      </div>

      {/* DESKTOP VIEW: Wide-Lens Symmetry - Sub-Header Matched Typography & Spectral Icons */}
      <div className="hidden md:flex items-center justify-center w-full gap-8">
        {/* Extended Left Symmetry Line */}
        <div className="w-28 h-px bg-slate-600/30"></div>

        {/* Centered Instruction Set - wider spacing (gap-28) */}
        <div className="flex items-center gap-28">
          {/* Step 1 */}
          <div className="flex items-center gap-3">
            <MicIcon className={`w-6 h-6 ${iconShineClass}`} />
            <span className="text-lg text-slate-400 font-normal whitespace-nowrap">
              Share a moment
            </span>
          </div>

          {/* Step 2 */}
          <div className="flex items-center gap-3">
            <SparkIcon className={`w-6 h-6 ${iconShineClass}`} />
            <span className="text-lg text-slate-400 font-normal whitespace-nowrap">
              Set the Vibe
            </span>
          </div>

          {/* Step 3 */}
          <div className="flex items-center gap-3">
            <MusicNoteIcon className={`w-6 h-6 ${iconShineClass}`} />
            <span className="text-lg text-slate-400 font-normal whitespace-nowrap">
              Get your list
            </span>
          </div>
        </div>

        {/* Extended Right Symmetry Line */}
        <div className="w-28 h-px bg-slate-600/30"></div>
      </div>
    </div>
  );
};

export default HowItWorks;