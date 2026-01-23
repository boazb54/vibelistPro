
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';

interface PostSavePopupProps {
  onPlayNow: () => void;
  onCreateNew: () => void;
  onDismiss: () => void;
}

const PostSavePopup: React.FC<PostSavePopupProps> = ({ onPlayNow, onCreateNew, onDismiss }) => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const content = (
    <div 
      className="fixed inset-0 z-[100] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onDismiss}
    >
      <div 
        className={`glass-panel w-full max-w-lg overflow-hidden transition-all duration-300 ${
          isMobile 
            ? 'rounded-t-[32px] p-6 pb-12 animate-slide-up' 
            : 'rounded-3xl p-8 mx-4 animate-fade-in-up'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile Drag Indicator */}
        {isMobile && <div className="w-12 h-1.5 bg-slate-700 rounded-full mx-auto mb-6"></div>}

        <div className="text-center md:text-left mb-8">
          <div className="inline-flex items-center gap-2 text-green-400 font-bold mb-3 uppercase tracking-wider text-sm">
            <span>Saved to Spotify ✓</span>
          </div>
          <h3 className="text-2xl font-bold text-white mb-3">Before you leave…</h3>
          <p className="text-slate-300 leading-relaxed text-lg">
            Do you want to play this playlist on Spotify now, or create a new vibe and listen later?
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <button 
            onClick={onPlayNow}
            className="w-full bg-[#1DB954] text-black font-bold py-4 rounded-2xl hover:bg-[#1ed760] transition-colors shadow-lg shadow-green-500/10 active:scale-[0.98]"
          >
            Play on Spotify now
          </button>
          <button 
            onClick={onCreateNew}
            className="w-full bg-slate-800 text-white font-bold py-4 rounded-2xl hover:bg-slate-700 transition-colors active:scale-[0.98]"
          >
            Create new vibe
          </button>
        </div>

        {/* Desktop Close Button */}
        {!isMobile && (
          <button 
            onClick={onDismiss}
            className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
};

export default PostSavePopup;
