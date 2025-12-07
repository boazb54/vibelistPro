import React, { useState } from 'react';
import { MOODS } from '../constants';

interface MoodSelectorProps {
  onSelectMood: (mood: string) => void;
  isLoading: boolean;
}

const MoodSelector: React.FC<MoodSelectorProps> = ({ onSelectMood, isLoading }) => {
  const [customMood, setCustomMood] = useState('');
  const CHAR_LIMIT = 500;

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customMood.trim()) {
      onSelectMood(customMood.trim());
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (e.target.value.length <= CHAR_LIMIT) {
      setCustomMood(e.target.value);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleCustomSubmit(e as any);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-4 animate-fade-in-up">
      <div className="text-center mb-8">
        <h2 className="text-3xl md:text-5xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-500">
          How are you feeling?
        </h2>
        <p className="text-slate-400 text-lg max-w-2xl mx-auto">
          Tell us about your day, a specific scenario, or just a vibe.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        {MOODS.map((m) => (
          <button
            key={m.id}
            disabled={isLoading}
            onClick={() => onSelectMood(m.id)}
            className={`group relative overflow-hidden rounded-2xl p-6 transition-all duration-300 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
              bg-gradient-to-br ${m.color} bg-opacity-10`}
          >
            <div className="absolute inset-0 bg-black opacity-40 group-hover:opacity-20 transition-opacity"></div>
            <div className="relative z-10 flex flex-col items-center">
              <span className="text-4xl mb-2 drop-shadow-lg">{m.emoji}</span>
              <span className="font-semibold text-white tracking-wide">{m.label}</span>
            </div>
          </button>
        ))}
      </div>

      <form onSubmit={handleCustomSubmit} className="relative max-w-2xl mx-auto">
        <div className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl opacity-50 group-focus-within:opacity-100 transition duration-500 blur"></div>
            <div className="relative bg-slate-900 rounded-2xl p-1">
                <textarea
                  value={customMood}
                  onChange={handleChange}
                  onKeyDown={handleKeyDown}
                  placeholder="E.g., 'I just finished a marathon and need to recover' or 'Driving through the city at 2AM in the rain'..."
                  disabled={isLoading}
                  rows={3}
                  className="w-full bg-slate-800/50 text-white placeholder-slate-400 rounded-xl py-3 px-4 focus:outline-none resize-none align-top"
                />
                <div className="flex justify-between items-center px-2 py-1">
                    <span className={`text-xs ${customMood.length > 400 ? 'text-yellow-400' : 'text-slate-500'}`}>
                        {customMood.length}/{CHAR_LIMIT}
                    </span>
                    <button
                      type="submit"
                      disabled={!customMood.trim() || isLoading}
                      className="bg-white text-black hover:bg-gray-200 font-bold rounded-lg px-6 py-2 text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isLoading ? 'Creating...' : 'Generate Vibe'}
                    </button>
                </div>
            </div>
        </div>
      </form>
    </div>
  );
};

export default MoodSelector;