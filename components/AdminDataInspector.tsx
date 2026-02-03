
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { 
  AdminDataInspectorProps, 
  AnalyzedPlaylistContextItem, 
  AnalyzedTopTrack, 
  ConfidenceLevel, 
  AudioPhysics, 
  SemanticTags 
} from '../types';

// Helper for collapsible sections
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

// NEW: Helper function to render AudioPhysics
const renderAudioPhysics = (physics: AudioPhysics | undefined) => {
  if (!physics) return <p className="text-slate-500">No audio physics data.</p>;
  return (
    <div className="pl-4 border-l border-slate-700 space-y-1">
      <p><strong>Energy:</strong> {physics.energy_level} (Conf: {physics.energy_confidence})</p>
      <p><strong>Tempo:</strong> {physics.tempo_feel} (Conf: {physics.tempo_confidence})</p>
      <p><strong>Vocals:</strong> {physics.vocals_type} (Conf: {physics.vocals_confidence})</p>
      <p><strong>Texture:</strong> {physics.texture_type} (Conf: {physics.texture_confidence})</p>
      <p><strong>Danceability:</b> {physics.danceability_hint} (Conf: {physics.danceability_confidence})</p>
    </div>
  );
};

// REMOVED: renderMoodAnalysis helper function as mood analysis is now flattened
// const renderMoodAnalysis = (moodAnalysis: MoodAnalysis | undefined) => {
//   if (!moodAnalysis) return <p className="text-slate-500">No mood analysis data.</p>;
//   return (
//     <div className="pl-4 border-l border-slate-700 space-y-1">
//       <p><strong>Emotional Tags:</strong> {moodAnalysis.emotional_tags?.join(', ') || 'N/A'} (Conf: {moodAnalysis.emotional_confidence})</p>
//       <p><strong>Cognitive Tags:</strong> {moodAnalysis.cognitive_tags?.join(', ') || 'N/A'} (Conf: {moodAnalysis.cognitive_confidence})</p>
//       <p><strong>Somatic Tags:</strong> {moodAnalysis.somatic_tags?.join(', ') || 'N/A'} (Conf: {moodAnalysis.somatic_confidence})</p>
//       <p><strong>Language:</strong> {moodAnalysis.language_iso_639_1 || 'N/A'} (Conf: {moodAnalysis.language_confidence})</p>
//     </div>
//   );
// };

// NEW: Helper function to render SemanticTags (updated for flattened mood)
const renderSemanticTags = (tags: SemanticTags | undefined) => {
  if (!tags) return <p className="text-slate-500">No semantic tags data.</p>;
  
  return (
    <div className="pl-4 border-l border-slate-700 space-y-1">
      <p><strong>Primary Genre:</strong> {tags.primary_genre} (Conf: {tags.primary_genre_confidence})</p>
      {tags.secondary_genres?.length > 0 && <p><strong>Secondary Genres:</b> {tags.secondary_genres.join(', ')} (Conf: {tags.secondary_genres_confidence})</p>}
      
      {/* Flattened Mood Analysis Display */}
      <div className="mt-2">
        <p className="font-semibold text-slate-400">Mood Analysis:</p>
        <div className="pl-4 border-l border-slate-700 space-y-1">
          <p><strong>Emotional Tags:</b> {tags.emotional_tags?.join(', ') || 'N/A'} (Conf: {tags.emotional_confidence})</p>
          <p><strong>Cognitive Tags:</b> {tags.cognitive_tags?.join(', ') || 'N/A'} (Conf: {tags.cognitive_confidence})</p>
          <p><strong>Somatic Tags:</b> {tags.somatic_tags?.join(', ') || 'N/A'} (Conf: {tags.somatic_confidence})</p>
          <p><strong>Language:</b> {tags.language_iso_639_1 || 'N/A'} (Conf: {tags.language_confidence})</p>
        </div>
      </div>
    </div>
  );
};


const AdminDataInspector: React.FC<AdminDataInspectorProps> = ({ isOpen, onClose, userTaste, aggregatedPlaylists, debugLogs }) => {
  const localAddLog = (window as any).addLog || console.log;

  useEffect(() => {
    localAddLog(`AdminDataInspector: isOpen prop changed to ${isOpen}`);
    if (isOpen) {
      localAddLog("AdminDataInspector: Component is now open.");
    } else {
      localAddLog("AdminDataInspector: Component is now closed.");
    }
  }, [isOpen, localAddLog]);

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="glass-panel relative w-full max-w-2xl h-[90vh] mx-4 p-6 md:p-8 rounded-3xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center border-b border-white/10 pb-4 mb-4 flex-shrink-0">
          <h2 className="text-2xl font-bold text-white">Admin Data Inspector</h2>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-grow overflow-y-auto custom-scrollbar pr-2">
          
          {/* NEW: Unified Taste Analysis Results (Gemini-derived insights first) */}
          <CollapsibleSection title="Unified Taste Analysis (Gemini)">
            {userTaste?.unified_analysis ? (
              <div className="space-y-3">
                <p><strong>Overall Mood Category:</b> {userTaste.unified_analysis.overall_mood_category} (Confidence: {userTaste.unified_analysis.overall_mood_confidence.toFixed(2)})</p>
                
                {userTaste.unified_analysis.user_taste_profile_v1 && ( 
                  <>
                    <h4 className="font-semibold text-white mt-4 mb-2">User Taste Profile v1 (Aggregated):</h4>
                    <pre className="bg-slate-800/50 p-3 rounded-md overflow-x-auto text-xs">
                      {JSON.stringify(userTaste.unified_analysis.user_taste_profile_v1, null, 2)}
                    </pre>
                  </>
                )}

                <h4 className="font-semibold text-white mt-4 mb-2">Session Semantic Profile (Derived):</h4>
                <pre className="bg-slate-800/50 p-3 rounded-md overflow-x-auto text-xs">
                  {JSON.stringify(userTaste.unified_analysis.session_semantic_profile, null, 2)}
                </pre>

                {userTaste.unified_analysis.playlist_contexts && userTaste.unified_analysis.playlist_contexts.length > 0 && (
                    <>
                        <h4 className="font-semibold text-white mt-4 mb-2">Analyzed Playlist Contexts (Itemized):</h4>
                        <div className="space-y-3">
                            {userTaste.unified_analysis.playlist_contexts.map((context: AnalyzedPlaylistContextItem, index: number) => (
                                <pre key={index} className="bg-slate-800/50 p-3 rounded-md overflow-x-auto text-xs">
                                    {JSON.stringify(context, null, 2)}
                                </pre>
                            ))}
                        </div>
                    </>
                )}

                {userTaste.unified_analysis.analyzed_top_tracks && userTaste.unified_analysis.analyzed_top_tracks.length > 0 && (
                    <>
                        <h4 className="font-semibold text-white mt-4 mb-2">Analyzed Top 50 Tracks (Itemized):</h4>
                        <div className="space-y-3">
                            {userTaste.unified_analysis.analyzed_top_tracks.map((track: AnalyzedTopTrack, index: number) => ( 
                                <div key={index} className="bg-slate-800/50 p-3 rounded-md overflow-x-auto text-xs">
                                    <p><strong>Origin:</b> {track.origin || 'N/A'}</p>
                                    <p><strong>Song:</b> {track.song_name}</p>
                                    <p><strong>Artist:</b> {track.artist_name}</p>
                                    <p><strong>Overall Confidence:</b> {track.confidence}</p> 
                                    {/* NEW: Render AudioPhysics and SemanticTags with confidence */}
                                    <div className="mt-2">
                                      <p className="font-semibold text-slate-400">Audio Physics:</p>
                                      {renderAudioPhysics(track.audio_physics)}
                                    </div>
                                    <div className="mt-2">
                                      <p className="font-semibold text-slate-400">Semantic Tags:</p>
                                      {renderSemanticTags(track.semantic_tags)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}

              </div>
            ) : (
              <p>No unified taste analysis data available.</p>
            )}
          </CollapsibleSection>

          {/* Top 50 Artists */}
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

          {/* Top 50 Tracks (Raw) - now explicitly distinct from analyzed tracks*/}
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

          {/* Aggregated User Playlists & Tracks */}
          <CollapsibleSection title="User Playlists & Aggregated Tracks (Raw)">
            {aggregatedPlaylists && aggregatedPlaylists.length > 0 ? (
              <div className="space-y-4">
                {aggregatedPlaylists.map((playlistGroup, i) => (
                  <div key={i} className="bg-slate-800/50 p-3 rounded-md">
                    <h4 className="font-semibold text-white mb-2">
                        {playlistGroup.playlistName} ({playlistGroup.playlistTrackCount} tracks) - Creator: {playlistGroup.playlistCreator}
                    </h4>
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

          {/* Session Debug Logs */}
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
