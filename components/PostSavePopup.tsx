
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';

interface PostSavePopupProps {
  isOpen: boolean;
  onDecision: (choice: 'play' | 'new') => void;
}

const PostSavePopup: React.FC<PostSavePopupProps> = ({ isOpen, onDecision }) => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkIsMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkIsMobile();
    window.addEventListener('resize', checkIsMobile);
    return () => window.removeEventListener('resize', checkIsMobile);
  }, []);

  if (!isOpen) return null;

  const overlayClasses = `fixed inset-0 z-[110] flex ${isMobile ? 'items-end' : 'items-center justify-center'} bg-black/70 backdrop-blur-sm animate-fade-in`;
  const panelClasses = `relative p-[1px] rounded-3xl bg-gradient-to-br from-[#1DB954] to-blue-500 shadow-2xl ${isMobile ? 'w-full rounded-b-none animate-slide-up' : 'w-full max-w-sm mx-4 animate-fade-in-up'}`;
  const innerPanelClasses = `bg-[#0f172a] rounded-[23px] ${isMobile ? 'rounded-b-none' : ''} p-8 flex flex-col items-center text-center relative overflow-hidden`;

  return ReactDOM.createPortal(
    <div className={overlayClasses} onClick={() => onDecision('new')} aria-modal="true" role="dialog">
      <div className={panelClasses} onClick={(e) => e.stopPropagation()}>
        <div className={innerPanelClasses}>
          
          {/* Dismiss Button (X) - Use Case 1C */}
          <button 
            onClick={() => onDecision('new')}
            className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors"
            aria-label="Dismiss"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="mb-6">
            <div className="w-16 h-16 bg-[#1DB954]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">✓</span>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Saved to Spotify</h2>
            <p className="text-slate-300 text-sm leading-relaxed">
                Do you want to play this playlist on Spotify now, or create a new vibe and listen later?
            </p>
          </div>

          <div className="w-full space-y-4">
            {/* Primary Action: Play Now */}
            <button
              onClick={() => onDecision('play')}
              className="w-full py-4 rounded-full font-bold text-black bg-[#1DB954] hover:bg-[#1ed760] transition-all transform active:scale-95 shadow-lg shadow-[#1DB954]/20"
            >
              Play on Spotify now
            </button>

            {/* Secondary Action: Create New Vibe */}
            <button
              onClick={() => onDecision('new')}
              className="w-full py-3 rounded-full font-medium text-slate-300 border border-white/10 hover:bg-white/5 transition-all transform active:scale-95"
            >
              Create a new vibe
            </button>
          </div>

        </div>
      </div>
    </div>,
    document.body
  );
};

export default PostSavePopup;
