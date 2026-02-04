
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { 
  AdminDataInspectorProps, 
  AnalyzedPlaylistContextItem, 
  AnalyzedTopTrack, 
  // REMOVED: ConfidenceLevel, AudioPhysics, SemanticTags are no longer directly used in AdminDataInspector for AnalyzedTopTrack
} from '../types';

// Helper for collapsible sections
const CollapsibleSection: React.FC<{ title: string; children: React.ReactNode; defaultOpen?: boolean }> = ({ title, children, defaultOpen = true }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="mb-4 last:mb-0">
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        className="flex justify-between items-center w-full text-left text-slate-300 hover:text-white transition-colors py-2 px-3 rounded-md bg-slate-700/30 hover:bg-slate-700/50"
      >
        <span className="font-semibold text-lg">{title}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className={`w-5 h-5 transition-transform ${isOpen ? 'rotate-90' : ''}`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </button>
      {isOpen && <div className="mt-2 pl-4 border-l border-slate-700">{children}</div>}
    </div>
  );
};

const AdminDataInspector: React.FC<AdminDataInspectorProps> = ({ isOpen, onClose, userTaste, aggregatedPlaylists, debugLogs }) => {
  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-md animate-fade-in p-4">
      <div className="bg-[#0f172a] border border-slate-700 rounded-lg shadow-2xl w-full max-w-3xl h-[90vh] flex flex-col relative overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b border-slate-700 flex-shrink-0">
          <h2 className="text-xl font-bold text-white">Admin / Debug Data Inspector</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-grow overflow-y-auto p-4 custom-scrollbar text-sm text-slate-300">
          {userTaste && (
            <CollapsibleSection title="User Taste Profile" defaultOpen={true}>
              {userTaste.unified_analysis ? (
                <>
                  <p className="mb-2"><span className="font-semibold text-white">Overall Mood Category:</span> {userTaste.unified_analysis.overall_mood_category}</p>
                  <p className="mb-2"><span className="font-semibold text-white">Overall Mood Confidence:</span> {userTaste.unified_analysis.overall_mood_confidence?.toFixed(2)}</p>

                  <CollapsibleSection title="Session Semantic Profile" defaultOpen={false}>
                    <pre className="bg-slate-800 p-3 rounded-md overflow-x-auto text-green-300">
                      {JSON.stringify(userTaste.unified_analysis.session_semantic_profile, null, 2)}
                    </pre>
                  </CollapsibleSection>

                  <CollapsibleSection title="Analyzed Top Tracks" defaultOpen={false}>
                    <pre className="bg-slate-800 p-3 rounded-md overflow-x-auto text-green-300">
                      {JSON.stringify(userTaste.unified_analysis.analyzed_top_tracks, null, 2)}
                    </pre>
                  </CollapsibleSection>

                  <CollapsibleSection title="Analyzed Playlist Contexts" defaultOpen={false}>
                    <pre className="bg-slate-800 p-3 rounded-md overflow-x-auto text-green-300">
                      {JSON.stringify(userTaste.unified_analysis.playlist_contexts, null, 2)}
                    </pre>
                  </CollapsibleSection>
                </>
              ) : (
                <p>No unified taste analysis available.</p>
              )}
              {/* Also show basic taste profile if available */}
              {userTaste.topArtists.length > 0 && (
                <CollapsibleSection title="Raw Spotify Top Artists" defaultOpen={false}>
                  <p className="break-words">{userTaste.topArtists.join(', ')}</p>
                </CollapsibleSection>
              )}
              {userTaste.topGenres.length > 0 && (
                <CollapsibleSection title="Raw Spotify Top Genres" defaultOpen={false}>
                  <p className="break-words">{userTaste.topGenres.join(', ')}</p>
                </CollapsibleSection>
              )}
              {userTaste.topTracks.length > 0 && (
                <CollapsibleSection title="Raw Spotify Top Tracks" defaultOpen={false}>
                  <p className="break-words">{userTaste.topTracks.join(', ')}</p>
                </CollapsibleSection>
              )}
            </CollapsibleSection>
          )}

          {aggregatedPlaylists && aggregatedPlaylists.length > 0 && (
            <CollapsibleSection title="Aggregated Spotify Playlists" defaultOpen={false}>
              <pre className="bg-slate-800 p-3 rounded-md overflow-x-auto text-green-300">
                {JSON.stringify(aggregatedPlaylists, null, 2)}
              </pre>
            </CollapsibleSection>
          )}

          <CollapsibleSection title="Debug Logs" defaultOpen={false}>
            <div className="bg-black/70 p-3 rounded-md h-64 overflow-y-auto font-mono text-xs text-green-400">
              {debugLogs.map((log, i) => (
                <div key={i} className="mb-1 break-words whitespace-pre-wrap">{log}</div>
              ))}
            </div>
          </CollapsibleSection>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default AdminDataInspector;
