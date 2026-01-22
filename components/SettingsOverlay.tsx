
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { Browser } from '@capacitor/browser';
import { SpotifyUserProfile } from '../types';
import { isRtl } from '../utils/textUtils';
import { fetchUserProfile } from '../services/historyService';

interface SettingsOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile: SpotifyUserProfile | null;
  onSignOut: () => void;
  isAuthenticated: boolean; // NEW: isAuthenticated flag
}

const SettingsOverlay: React.FC<SettingsOverlayProps> = ({ isOpen, onClose, userProfile, onSignOut, isAuthenticated }) => {
  const [dbProfile, setDbProfile] = useState<any>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // Determine if mobile for responsive display
    const checkIsMobile = () => {
      setIsMobile(window.innerWidth < 768); // Tailwind's 'md' breakpoint
    };
    checkIsMobile();
    window.addEventListener('resize', checkIsMobile);

    if (isOpen && isAuthenticated && userProfile?.id) {
       fetchUserProfile(userProfile.id).then(({ data }) => {
         if (data) setDbProfile(data);
       });
    }

    return () => {
      window.removeEventListener('resize', checkIsMobile);
    };
  }, [isOpen, isAuthenticated, userProfile]);

  if (!isOpen) return null;

  const handleExternalLink = async (path: string) => {
    // V2.1.1: Convert relative doc paths into valid absolute URLs for the native Browser plugin 
    // and prevent UI freeze caused by unhandled promise rejections.
    try {
      const url = new URL(path, window.location.origin).toString();
      await Browser.open({ url });
    } catch (e) {
      console.error('Failed to open external link', e);
      if ((window as any).addLog) (window as any).addLog(`Browser.open error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      onClose(); // Always close menu to ensure UI responsiveness
    }
  };

  const handleContactSupport = () => {
    window.open('mailto:support@vibelistpro.app?subject=VibeList Support', '_self');
    onClose(); // Auto-close menu on link tap
  };

  const menuItems = [
    { label: 'Privacy Policy', action: () => handleExternalLink('/doc/privacy-policy.html') },
    { label: 'Terms of Use', action: () => handleExternalLink('/doc/terms-of-use.html') },
    { label: 'About VibeList', action: () => handleExternalLink('/doc/about-vibelist-Pro.html') },
    { label: 'Contact Support', action: handleContactSupport },
  ];


  const overlayClasses = `fixed inset-0 z-[100] flex ${isMobile ? 'items-end' : 'items-center justify-center'} bg-black/60 backdrop-blur-sm animate-fade-in`;
  const panelClasses = `relative p-[1px] rounded-3xl bg-gradient-to-br from-purple-500 to-blue-500 shadow-2xl ${isMobile ? 'w-full rounded-b-none max-h-[90vh] animate-slide-up' : 'w-full max-w-md mx-4 animate-fade-in-up'}`;
  const innerPanelClasses = `bg-[#0f172a] rounded-[23px] ${isMobile ? 'rounded-b-none' : ''} p-6 md:p-8 relative overflow-hidden h-full flex flex-col`;


  return ReactDOM.createPortal(
    <div className={overlayClasses} onClick={onClose} aria-modal="true" role="dialog">
      <div className={panelClasses} onClick={(e) => e.stopPropagation()}>
        <div className={innerPanelClasses}>
           {/* Close Button */}
           <button 
             onClick={onClose}
             className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors z-10"
             aria-label="Close menu"
           >
             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
               <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
             </svg>
           </button>

           {!isAuthenticated ? (
             // Pre-Login Menu: "About VibeList"
             <>
               <h2 className="text-2xl font-bold text-white mb-6">About VibeList</h2>
               <div className="space-y-2 flex-grow">
                 {menuItems.map((item, index) => (
                   <button
                     key={index}
                     onClick={item.action}
                     className="flex items-center justify-between w-full py-3 px-4 rounded-lg hover:bg-white/5 transition-colors text-white"
                     aria-label={item.label}
                   >
                     <span className="text-lg">{item.label}</span>
                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-slate-400">
                       <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                     </svg>
                   </button>
                 ))}
               </div>
             </>
           ) : (
             // Post-Login Menu: Account Settings
             <>
               {/* No title for post-login as per spec - implicitly "Account Settings" */}
               {userProfile && (
                 <div className="space-y-6 flex flex-col flex-grow">
                   {/* Section A: Account Identity & Details (Read-Only) */}
                   <div className="flex items-center gap-4">
                     {userProfile.images?.[0] ? (
                       <img src={userProfile.images[0].url} alt="Profile" className="w-20 h-20 rounded-full border-2 border-purple-500/30" />
                     ) : (
                        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-2xl font-bold">
                          {userProfile.display_name?.[0] || 'U'}
                        </div>
                     )}
                     <div className="flex-1 min-w-0">
                        <div 
                          className={`text-xl font-bold text-white truncate ${isRtl(userProfile.display_name) ? 'text-right font-["Heebo"]' : 'text-left'}`}
                          dir={isRtl(userProfile.display_name) ? 'rtl' : 'ltr'}
                        >
                          {userProfile.display_name}
                        </div>
                        <div className="text-sm text-slate-400 truncate">{userProfile.email}</div>
                     </div>
                   </div>

                   <div className="bg-white/5 rounded-xl p-4 space-y-3 border border-white/5">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-400">Country</span>
                        <span className="text-white font-medium">{userProfile.country}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-400">Plan</span>
                        <span className="text-white font-medium capitalize">{userProfile.product}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-400">Member Since</span>
                        <span className="text-white font-medium">
                          {dbProfile?.created_at ? new Date(dbProfile.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long' }) : '...'}
                        </span>
                      </div>
                   </div>

                   {/* Section B: Account Actions & Utilities */}
                   <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mt-8 mb-2">Account & Support</h3>
                   <div className="space-y-2 flex-grow">
                     {menuItems.map((item, index) => (
                       <button
                         key={index}
                         onClick={item.action}
                         className="flex items-center justify-between w-full py-3 px-4 rounded-lg hover:bg-white/5 transition-colors text-white"
                         aria-label={item.label}
                       >
                         <span className="text-lg">{item.label}</span>
                         <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-slate-400">
                           <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                         </svg>
                       </button>
                     ))}
                   </div>
                   
                   {/* Destructive Action: Log Out */}
                   <button
                     onClick={onSignOut}
                     className="w-full py-3 mt-4 rounded-xl font-bold text-white bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 shadow-lg shadow-red-600/20 transition-all transform active:scale-95"
                     aria-label="Sign out of VibeList Pro"
                   >
                     Log Out
                   </button>
                 </div>
               )}
             </>
           )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SettingsOverlay;
