
import React, { useState, useRef, useEffect } from 'react';
import { MOODS } from '../constants';
import { MicIcon } from './Icons';
import { transcribeAudio } from '../services/geminiService';
import HowItWorks from './HowItWorks';
import { isRtl } from '../utils/textUtils';

interface MoodSelectorProps {
  onSelectMood: (mood: string, modality: 'text' | 'voice') => void;
  isLoading: boolean;
  validationError: { message: string; key: number } | null;
  autoFocus?: boolean; // V.2.1.2 NEW
}

const MoodSelector: React.FC<MoodSelectorProps> = ({ onSelectMood, isLoading, validationError, autoFocus }) => {
  const [customMood, setCustomMood] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const [inputModality, setInputModality] = useState<'text' | 'voice'>('text');
  const [visibleError, setVisibleError] = useState<{ message: string; key: number } | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const CHAR_LIMIT = 500;

  useEffect(() => {
    if (validationError) setVisibleError(validationError);
  }, [validationError]);

  // V.2.1.2: Handle auto-focus and glow effect
  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 500);
    }
  }, [autoFocus]);

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customMood.trim()) onSelectMood(customMood.trim(), inputModality);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (e.target.value.length <= CHAR_LIMIT) {
      setCustomMood(e.target.value);
      setInputModality('text');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleCustomSubmit(e as any);
    }
  };

  const handleVoiceToggle = async () => {
    if (isRecording) {
        mediaRecorderRef.current?.stop();
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];
        mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) audioChunksRef.current.push(event.data); };
        mediaRecorder.onstop = async () => {
            setIsRecording(false);
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            stream.getTracks().forEach(track => track.stop());
            if (audioBlob.size === 0) return;
            setIsProcessingAudio(true);
            try {
                const base64Full = await new Promise<string>((res) => {
                    const reader = new FileReader();
                    reader.onloadend = () => res(reader.result as string);
                    reader.readAsDataURL(audioBlob);
                });
                const transcript = await transcribeAudio(base64Full.split(',')[1], audioBlob.type);
                const newValue = customMood ? `${customMood} ${transcript}` : transcript;
                if (newValue.length <= CHAR_LIMIT) {
                    setCustomMood(newValue);
                    setInputModality('voice');
                }
            } catch (error) { console.error(error); } finally { setIsProcessingAudio(false); }
        };
        mediaRecorder.start();
        setIsRecording(true);
    } catch (err) { setVisibleError({ message: "Mic access denied.", key: Date.now() }); }
  };

  const isRightToLeft = visibleError ? isRtl(visibleError.message) : false;

  return (
    <div className="flex flex-col w-full max-w-5xl mx-auto px-4 animate-fade-in-up pb-24">
      {visibleError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setVisibleError(null)}>
          <div className="bg-indigo-950/80 border border-cyan-500/30 rounded-2xl p-6 text-center animate-fade-in-up" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-purple-200 mb-2">Wait a second...</h3>
            <div className={`text-lg text-cyan-300 mb-6 ${isRightToLeft ? 'font-["Heebo"]' : ''}`} dir={isRightToLeft ? 'rtl' : 'ltr'}>
              {visibleError.message}
            </div>
            <button onClick={() => setVisibleError(null)} className="bg-blue-600/90 text-white font-bold px-8 py-3 rounded-xl uppercase tracking-widest">Try Again</button>
          </div>
        </div>
      )}

      <div className="flex-none pt-2 md:pt-4">
          <div className="text-center mb-2 md:mb-4">
              <h2 className="text-3xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-500 leading-tight">
                How are you feeling today?
              </h2>
          </div>

          <div className="flex flex-col gap-y-3 md:gap-y-4 max-w-4xl mx-auto w-full">
              <HowItWorks />
              
              <form onSubmit={handleCustomSubmit} className="relative w-full">
                <div className="relative group">
                    {/* V.2.1.2: Glow Effect logic */}
                    <div className={`absolute -inset-1 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-3xl blur-lg transition-all duration-700 
                      ${autoFocus ? 'opacity-80 animate-pulse' : 'opacity-20 group-focus-within:opacity-70'}
                      ${isRecording ? 'opacity-90 animate-pulse' : ''}`}>
                    </div>
                    
                    <div className="relative bg-slate-900 border border-white/10 rounded-3xl p-1.5 shadow-2xl">
                        <div className="relative">
                            <textarea
                                ref={textareaRef}
                                value={customMood}
                                onChange={handleChange}
                                onKeyDown={handleKeyDown}
                                placeholder={isRecording ? "Listening..." : "Describe a moment, a memory, or a dream..."}
                                disabled={isLoading || isProcessingAudio}
                                rows={3}
                                className={`w-full bg-slate-800/60 text-white placeholder-slate-400/70 rounded-2xl py-8 md:py-12 pl-6 pr-14 focus:outline-none resize-none text-base md:text-lg leading-relaxed ${isRecording ? 'text-red-200' : ''}`}
                            />
                            <button 
                                type="button"
                                onClick={handleVoiceToggle}
                                disabled={isLoading || isProcessingAudio}
                                className={`absolute top-4 right-4 p-2 rounded-full transition-all ${isRecording ? 'bg-red-500 animate-pulse' : 'text-slate-500 hover:text-white'}`}
                            >
                                <MicIcon className="w-5 h-5" />
                            </button>
                        </div>
                        
                        <div className="flex justify-between items-center px-4 pb-2 pt-1">
                            <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">
                                {customMood.length} / {CHAR_LIMIT}
                            </span>
                            <button
                                type="submit"
                                disabled={!customMood.trim() || isLoading || isRecording || isProcessingAudio}
                                className="bg-white/90 text-black font-extrabold rounded-xl px-6 py-2 md:px-8 md:py-3 text-[11px] uppercase tracking-[0.2em] transition-all hover:scale-105 active:scale-95 disabled:opacity-20"
                            >
                                {isLoading ? 'Creating' : 'Generate'}
                            </button>
                        </div>
                    </div>
                </div>
              </form>
          </div>
      </div>

      <div className="mt-6">
          <div className="flex items-center justify-center gap-4 mb-6 opacity-60">
              <div className="h-px bg-slate-800 flex-grow max-w-[60px]"></div>
              <span className="text-slate-500 text-[10px] uppercase tracking-[0.4em] font-bold">Quick Vibes</span>
              <div className="h-px bg-slate-800 flex-grow max-w-[60px]"></div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {MOODS.map((m) => (
                <button
                    key={m.id}
                    disabled={isLoading || isRecording || isProcessingAudio}
                    onClick={() => onSelectMood(m.id, 'text')}
                    className={`group relative overflow-hidden rounded-xl p-3 md:p-5 transition-all bg-gradient-to-br ${m.color} bg-opacity-5 border border-white/5`}
                >
                    <div className="absolute inset-0 bg-slate-900/60 group-hover:bg-slate-900/40"></div>
                    <div className="relative z-10 flex flex-col items-center">
                        <span className="text-xl md:text-2xl mb-1">{m.emoji}</span>
                        <span className="font-bold text-white tracking-wider text-[10px] uppercase">{m.label}</span>
                    </div>
                </button>
              ))}
          </div>
      </div>
    </div>
  );
};

export default MoodSelector;
