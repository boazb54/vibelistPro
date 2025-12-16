import React from 'react';

const HowItWorks: React.FC = () => {
  return (
    <div className="w-full max-w-4xl mx-auto mt-12 mb-10 animate-fade-in">
      <h2 className="text-center text-white/60 text-xs uppercase tracking-widest mb-8 font-medium">
        How VibeList Pro Works
      </h2>
      
      {/* Mobile: Horizontal Scroll Strip | Desktop: Grid */}
      <div className="flex md:grid md:grid-cols-3 gap-4 overflow-x-auto md:overflow-visible pb-4 md:pb-0 snap-x snap-mandatory scrollbar-hide">
        
        {/* Step 1: Describe */}
        <div className="min-w-[85%] md:min-w-0 snap-center flex-none bg-slate-900/50 border border-white/5 rounded-2xl p-6 backdrop-blur-sm relative group hover:bg-slate-800/50 transition-colors min-h-[130px]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-purple-500 to-blue-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-white">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              </svg>
            </div>
            <h3 className="text-white font-bold text-lg">Describe</h3>
          </div>
          <p className="text-slate-400 text-sm leading-relaxed">
            Type or speak how you feel, what you're doing, or what you need.
          </p>
        </div>

        {/* Step 2: We Analyze */}
        <div className="min-w-[85%] md:min-w-0 snap-center flex-none bg-slate-900/50 border border-white/5 rounded-2xl p-6 backdrop-blur-sm relative group hover:bg-slate-800/50 transition-colors min-h-[130px]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-cyan-500 to-teal-400 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-white">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
              </svg>
            </div>
            <h3 className="text-white font-bold text-lg">We Analyze</h3>
          </div>
          <p className="text-slate-400 text-sm leading-relaxed">
            Mood, energy, tempo, texture — moving beyond basic genres.
          </p>
        </div>

        {/* Step 3: Press Play */}
        <div className="min-w-[85%] md:min-w-0 snap-center flex-none bg-slate-900/50 border border-white/5 rounded-2xl p-6 backdrop-blur-sm relative group hover:bg-slate-800/50 transition-colors min-h-[130px]">
          <div className="flex items-center gap-3 mb-3">
             <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-green-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-green-500/20">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-white">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141 4.2-1.32 9.6-0.66 13.38 1.68.42.18.6.72.36 1.14zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.2-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
              </svg>
            </div>
            <h3 className="text-white font-bold text-lg">Press Play</h3>
          </div>
          <p className="text-slate-400 text-sm leading-relaxed">
            Your perfect playlist opens instantly inside your Spotify app.
          </p>
        </div>

      </div>
    </div>
  );
};

export default HowItWorks;
