
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { AdminDataInspectorProps } from '../types';

const CollapsibleSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <div className="mb-4 last:mb-0">
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        className="flex justify-between items-center w-full text-left text-lg font-bold text-cyan-400 hover:text-white transition-colors py-2 border-b border-slate-700"
      >
        <span>{title}</span>
        <span>{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && <div className="mt-3 text-slate-300 text-sm overflow-x-auto">{children}</div>}
    </div>
  );
};


const AdminDataInspector: React.FC<AdminDataInspectorProps> = ({ isOpen, onClose, userTaste, aggregatedPlaylists, debugLogs }) => {
  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="glass-panel relative w-full max-w-2xl h-[90vh] mx-4 p-6 md:p-8 rounded-3xl shadow-2xl flex flex-col">
        <div className="flex justify-between items-center border-b border-white/10 pb-4 mb-4 flex-shrink-0">
          <h2 className="text-2xl font-bold text-white">Admin Data Inspector</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-grow overflow-y-auto custom-scrollbar pr-2">
          
          {/* V1.2.2: Unified Semantic Pass Results */}
          <CollapsibleSection title="Quantum Taste: Unified Semantic Analysis">
            {userTaste?.unified_analysis ? (
              <div className="space-y-4">
                <div className="bg-purple-900/20 border border-purple-500/30 p-4 rounded-xl">
                  <h4 className="text-purple-300 font-bold mb-1 uppercase text-xs">Inferred Mood Category</h4>
                  <div className="text-xl font-bold text-white">{userTaste.unified_analysis.playlist_mood.playlist_mood_category}</div>
                  <div className="text-xs text-slate-400 mt-1">Confidence Score: {(userTaste.unified_analysis.playlist_mood.confidence_score * 100).toFixed(1)}%</div>
                </div>
                
                <div className="bg-slate-800/50 p-4 rounded-xl">
                  <h4 className="text-cyan-400 font-bold mb-3 uppercase text-xs">Top Tracks Semantic Tags</h4>
                  <div className="space-y-2">
                    {userTaste.unified_analysis.analyzed_tracks.slice(0, 10).map((track, i) => (
                      <div key={i} className="text-xs border-b border-white/5 pb-2">
                        <div className="font-bold text-slate-200">{track.song_name} - {track.artist_name}</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          <span className="bg-blue-500/20 text-blue-300 px-1.5 rounded">{track.semantic_tags.primary_genre}</span>
                          <span className="bg-orange-500/20 text-orange-300 px-1.5 rounded">Energy: {track.semantic_tags.energy}</span>
                          <span className="bg-green-500/20 text-green-300 px-1.5 rounded">Tempo: {track.semantic_tags.tempo}</span>
                        </div>
                      </div>
                    ))}
                    {userTaste.unified_analysis.analyzed_tracks.length > 10 && (
                        <div className="text-slate-500 italic text-[10px]">+ {userTaste.unified_analysis.analyzed_tracks.length - 10} more analyzed tracks</div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-slate-500 italic">No unified analysis data present.</p>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="Spotify Top 50 Artists (Raw)">
            {userTaste?.topArtists && userTaste.topArtists.length > 0 ? (
              <ol className="list-decimal list-inside space-y-1">
                {userTaste.topArtists.map((artist, i) => (
                  <li key={i}>{artist}</li>
                ))}
              </ol>
            ) : (
              <p>No top artists data available.</p>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="Spotify Top 50 Tracks (Raw)">
            {userTaste?.topTracks && userTaste.topTracks.length > 0 ? (
              <ol className="list-decimal list-inside space-y-1">
                {userTaste.topTracks.map((track, i) => (
                  <li key={i}>{track}</li>
                ))}
              </ol>
            ) : (
              <p>No top tracks data available.</p>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="User Playlists & Aggregated Tracks (Raw)">
            {aggregatedPlaylists && aggregatedPlaylists.length > 0 ? (
              <div className="space-y-4">
                {aggregatedPlaylists.map((playlistGroup, i) => (
                  <div key={i} className="bg-slate-800/50 p-3 rounded-md">
                    <h4 className="font-semibold text-white mb-2">{playlistGroup.playlistName} ({playlistGroup.tracks.length} tracks)</h4>
                    <ol className="list-decimal list-inside space-y-0.5 text-slate-400">
                      {playlistGroup.tracks.map((track, j) => (
                        <li key={j}>{track}</li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            ) : (
              <p>No user playlist data available.</p>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="Session Debug Logs">
            {debugLogs && debugLogs.length > 0 ? (
              <div className="bg-black/80 p-3 rounded-md max-h-48 overflow-y-auto text-green-400 text-xs font-mono">
                {debugLogs.map((log, i) => (
                  <div key={i} className="mb-1 break-words whitespace-pre-wrap">{log}</div>
                ))}
              </div>
            ) : (
              <p>No debug logs available.</p>
            )}
          </CollapsibleSection>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default AdminDataInspector;
