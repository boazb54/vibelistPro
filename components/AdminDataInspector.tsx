import React, { useState } from 'react';
import { ExtendedUserProfile, SpotifyTimeRange } from '../types';

interface AdminDataInspectorProps {
  data: ExtendedUserProfile | null;
  onClose: () => void;
}

type Tab = 'tracks' | 'artists';

const AdminDataInspector: React.FC<AdminDataInspectorProps> = ({ data, onClose }) => {
  const [activeTab, setActiveTab] = useState<Tab>('tracks');
  const [timeRange, setTimeRange] = useState<SpotifyTimeRange>('short_term');

  if (!data) return null;

  const renderTimeRangeSelector = () => (
    <div className="flex gap-2 mb-4">
      {(['short_term', 'medium_term', 'long_term'] as SpotifyTimeRange[]).map((range) => (
        <button
          key={range}
          onClick={() => setTimeRange(range)}
          className={`px-3 py-1 text-xs border uppercase tracking-wider font-mono ${
            timeRange === range 
              ? 'bg-green-900/50 text-white border-green-500' 
              : 'text-gray-500 border-gray-800 hover:border-gray-600'
          }`}
        >
          {range.replace('_', ' ')}
        </button>
      ))}
    </div>
  );

  const renderTracksTable = () => {
    const tracks = data.top_tracks[timeRange] || [];
    
    if (tracks.length === 0) {
      return <div className="p-4 text-gray-500 italic">No track data available for this range.</div>;
    }

    return (
      <div className="overflow-auto h-full pb-20 custom-scrollbar">
        <table className="w-full text-left border-collapse text-xs font-mono">
          <thead className="sticky top-0 bg-black border-b border-gray-800 z-10">
            <tr>
              <th className="p-3 text-gray-500">#</th>
              <th className="p-3 text-gray-500">ID</th>
              <th className="p-3 text-gray-500">SONG</th>
              <th className="p-3 text-gray-500">ARTIST</th>
              <th className="p-3 text-right text-gray-500">DANCE</th>
              <th className="p-3 text-right text-gray-500">ENERGY</th>
              <th className="p-3 text-right text-gray-500">VALENCE</th>
              <th className="p-3 text-right text-gray-500">ACOUSTIC</th>
              <th className="p-3 text-right text-gray-500">TEMPO</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((track, idx) => (
              <tr key={track.id} className="border-b border-gray-900 hover:bg-gray-900 transition-colors">
                <td className="p-3 text-gray-500">{idx + 1}</td>
                <td className="p-3 text-gray-600 select-all cursor-copy" title="Click to copy ID">{track.id}</td>
                <td className="p-3 text-white truncate max-w-[200px]" title={track.name}>{track.name}</td>
                <td className="p-3 text-gray-400 truncate max-w-[150px]">{track.artists[0]?.name}</td>
                <td className="p-3 text-right text-green-400">{track.audio_features?.danceability?.toFixed(3) ?? '-'}</td>
                <td className="p-3 text-right text-green-400">{track.audio_features?.energy?.toFixed(3) ?? '-'}</td>
                <td className="p-3 text-right text-blue-400">{track.audio_features?.valence?.toFixed(3) ?? '-'}</td>
                <td className="p-3 text-right text-yellow-600">{track.audio_features?.acousticness?.toFixed(3) ?? '-'}</td>
                <td className="p-3 text-right text-gray-300">{track.audio_features?.tempo?.toFixed(1) ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderArtistsTable = () => {
    const artists = data.top_artists[timeRange] || [];

    if (artists.length === 0) {
        return <div className="p-4 text-gray-500 italic">No artist data available for this range.</div>;
    }

    return (
      <div className="overflow-auto h-full pb-20 custom-scrollbar">
        <table className="w-full text-left border-collapse text-xs font-mono">
          <thead className="sticky top-0 bg-black border-b border-gray-800 z-10">
            <tr>
              <th className="p-3 text-gray-500">#</th>
              <th className="p-3 text-gray-500">ARTIST</th>
              <th className="p-3 text-gray-500">GENRES</th>
            </tr>
          </thead>
          <tbody>
            {artists.map((artist, idx) => (
              <tr key={artist.id} className="border-b border-gray-900 hover:bg-gray-900 transition-colors">
                <td className="p-3 text-gray-500">{idx + 1}</td>
                <td className="p-3 text-white font-bold">{artist.name}</td>
                <td className="p-3 text-gray-400">{artist.genres.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black text-white font-mono flex flex-col p-6 animate-fade-in">
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 10px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #000; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border: 1px solid #000; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #555; }
      `}</style>
      
      {/* Header */}
      <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
        <div>
           <h2 className="text-xl font-bold text-green-500 tracking-tight">ADMIN DATA INSPECTOR // RAW_MEMORY_DUMP</h2>
           <p className="text-xs text-gray-600 mt-1">SHIFT+CLICK π TO TOGGLE</p>
        </div>
        <button 
            onClick={onClose} 
            className="text-gray-500 hover:text-white px-3 py-1 border border-transparent hover:border-white/20"
        >
            [CLOSE ESC]
        </button>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-6 mb-4">
        <div className="flex gap-0 border border-gray-800">
            <button
            onClick={() => setActiveTab('tracks')}
            className={`px-6 py-2 text-sm font-bold transition-colors ${
                activeTab === 'tracks' 
                ? 'bg-green-900/20 text-green-400 border-b-2 border-green-500' 
                : 'text-gray-500 hover:text-gray-300'
            }`}
            >
            TOP TRACKS (VIBE METRICS)
            </button>
            <button
            onClick={() => setActiveTab('artists')}
            className={`px-6 py-2 text-sm font-bold transition-colors ${
                activeTab === 'artists' 
                ? 'bg-green-900/20 text-green-400 border-b-2 border-green-500' 
                : 'text-gray-500 hover:text-gray-300'
            }`}
            >
            TOP ARTISTS
            </button>
        </div>
        
        <div className="h-6 w-px bg-gray-800 mx-2"></div>
        
        {renderTimeRangeSelector()}
      </div>

      {/* Main Data View */}
      <div className="flex-grow border border-gray-800 bg-black/50 relative">
         {activeTab === 'tracks' ? renderTracksTable() : renderArtistsTable()}
      </div>
    </div>
  );
};

export default AdminDataInspector;
