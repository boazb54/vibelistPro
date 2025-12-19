import React from 'react';

const HowItWorks: React.FC = () => {
  /**
   * V.2.0.2 - Cross-Device Layout Alignment
   * 
   * STRATEGY: 
   * 1. Remove all icons and symmetry lines from Desktop.
   * 2. Use the mobile-inspired "dot-separator" layout for both views.
   * 3. Sync visual styling (uppercase, tracking) but remove Bold/Glow from Desktop.
   * 4. Maintain screen-specific copy.
   */

  return (
    <div className="w-full animate-fade-in mt-0 md:mt-2 px-0">
      
      {/* MOBILE VIEW: Minimalist single line (Condensed Copy) */}
      <div className="md:hidden flex justify-center items-center w-full px-2">
        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] whitespace-nowrap opacity-80">
          Share a moment • Set the Vibe • Get your list
        </span>
      </div>

      {/* DESKTOP VIEW: Minimalist single line (Full Copy) */}
      {/* V.2.0.2 Changes: Removed font-bold, removed icons, removed lines */}
      <div className="hidden md:flex justify-center items-center w-full">
        <span className="text-sm text-slate-400 uppercase tracking-[0.3em] whitespace-nowrap opacity-70 font-normal">
          Share a moment • Generate Vibe • Get your playlist
        </span>
      </div>
    </div>
  );
};

export default HowItWorks;