import React, { useState, useRef } from 'react';
import { MOODS } from '../constants';
import { MicIcon } from './Icons';
import { transcribeAudio } from '../services/geminiService';
import HowItWorks from './HowItWorks';

interface MoodSelectorProps {
  onSelectMood: (mood: string, modality: 'text' | 'voice') => void;
  isLoading: boolean;
}

const MoodSelector: React.FC<MoodSelectorProps> = ({ onSelectMood, isLoading }) => {
  const [customMood, setCustomMood] = useState('');
  
  // STRATEGY P: Manual Toggle State
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  // NEW: Track which input method was used last
  const [inputModality, setInputModality] = useState<'text' | 'voice'>('text');
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const CHAR_LIMIT = 500;

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customMood.trim()) {
      // Pass the tracked modality
      onSelectMood(customMood.trim(), inputModality);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (e.target.value.length <= CHAR_LIMIT) {
      setCustomMood(e.target.value);
      // If user types, switch modality to text
      setInputModality('text');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleCustomSubmit(e as any);
    }
  };

  // Helper: Convert Blob to Base64
  const blobToBase64 = (blob: Blob): Promise<string> => {
      return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
      });
  };

  // STRATEGY P: Manual Toggle Voice Input using Gemini AI
  const handleVoiceToggle = async () => {
    // STOP RECORDING
    if (isRecording) {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
            // State update happens in onstop event
        }
        return;
    }

    // START RECORDING
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunksRef.current.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            setIsRecording(false);
            
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' }); // Chrome/Firefox use webm
            // Clean up stream tracks
            stream.getTracks().forEach(track => track.stop());

            if (audioBlob.size === 0) return;

            setIsProcessingAudio(true);
            try {
                // Prepare for Gemini
                const base64Full = await blobToBase64(audioBlob);
                const base64Data = base64Full.split(',')[1]; // Remove "data:audio/webm;base64," prefix
                
                const transcript = await transcribeAudio(base64Data, audioBlob.type);
                
                if (transcript) {
                    const cleanTranscript = transcript.trim();
                    const newValue = customMood ? `${customMood} ${cleanTranscript}` : cleanTranscript;
                    if (newValue.length <= CHAR_LIMIT) {
                        setCustomMood(newValue);
                        // Mark as Voice input
                        setInputModality('voice');
                    }
                }
            } catch (error: any) {
                console.error("Audio transcription failed", error);
                alert(`Voice processing failed: ${error.message}`);
            } finally {
                setIsProcessingAudio(false);
            }
        };

        mediaRecorder.start();
        setIsRecording(true);

    } catch (err) {
        console.error("Microphone Error:", err);
        // Handle explicit denial vs tech error
        if (err instanceof DOMException && err.name === "NotAllowedError") {
             alert("Microphone access denied. Please allow microphone permissions in your browser settings.");
        } else {
             alert("Could not access microphone.");
        }
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-4 animate-fade-in-up">
      <div className="text-center mb-8">
        <h2 className="text-3xl md:text-5xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-500">
          How are you feeling?
        </h2>
        <p className="text-slate-400 text-lg max-w-2xl mx-auto">
          Talk to the AI. Describe a moment, a memory, or a dream.
        </p>
      </div>

      {/* HERO INPUT SECTION - Updated to max-w-4xl and py-12 as requested */}
      <form onSubmit={handleCustomSubmit} className="relative max-w-4xl mx-auto mb-12">
        <div className="relative group">
            <div className={`absolute -inset-0.5 bg-gradient-to-r from-purple-600 to-blue-600 rounded-3xl opacity-60 group-focus-within:opacity-100 transition duration-500 blur ${isRecording ? 'animate-pulse opacity-100 duration-1000' : ''}`}></div>
            <div className="relative bg-slate-900 rounded-3xl p-1.5">
                <div className="relative">
                    <textarea
                      value={customMood}
                      onChange={handleChange}
                      onKeyDown={handleKeyDown}
                      placeholder={isRecording ? "Listening... (Tap mic to stop)" : (isProcessingAudio ? "AI is processing your voice..." : "E.g., 'I just finished a marathon' or 'Driving at 2AM'...")}
                      disabled={isLoading || isProcessingAudio}
                      rows={3}
                      className={`w-full bg-slate-800/80 text-white placeholder-slate-400 rounded-2xl py-12 pl-5 pr-12 focus:outline-none resize-none align-top text-lg leading-relaxed transition-colors ${isRecording ? 'placeholder-red-400/70 text-red-200' : ''}`}
                    />
                    {/* Voice Input Button */}
                    <button 
                        type="button"
                        onClick={handleVoiceToggle}
                        disabled={isLoading || isProcessingAudio}
                        className={`absolute top-3 right-3 p-2 rounded-full transition-all 
                            ${isRecording 
                                ? 'bg-red-500 text-white animate-pulse scale-110 shadow-[0_0_15px_rgba(239,68,68,0.7)]' 
                                : (isProcessingAudio 
                                    ? 'bg-purple-500/50 text-white animate-bounce' 
                                    : 'text-slate-400 hover:text-white hover:bg-slate-700')}`}
                        title={isRecording ? "Stop Recording" : "Use Voice Input"}
                    >
                        <MicIcon className="w-6 h-6" />
                    </button>
                </div>
                
                <div className="flex justify-between items-center px-3 py-2">
                    <span className={`text-xs ${customMood.length > 400 ? 'text-yellow-400' : 'text-slate-500'}`}>
                        {customMood.length}/{CHAR_LIMIT}
                    </span>
                    <button
                      type="submit"
                      disabled={!customMood.trim() || isLoading || isRecording || isProcessingAudio}
                      className="bg-white text-black hover:bg-gray-200 font-bold rounded-xl px-8 py-3 text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-white/20 transform hover:-translate-y-0.5 active:translate-y-0"
                    >
                      {isLoading ? 'Creating...' : (isProcessingAudio ? 'Thinking...' : 'Generate Vibe')}
                    </button>
                </div>
            </div>
        </div>
      </form>

      {/* PROCESS BRIDGE - V.1.1.3 Placement */}
      <HowItWorks />

      {/* DIVIDER */}
      <div className="flex items-center justify-center gap-4 mb-8 opacity-50">
          <div className="h-px bg-slate-600 w-24"></div>
          <span className="text-slate-400 text-sm uppercase tracking-widest font-medium">Or choose a quick vibe</span>
          <div className="h-px bg-slate-600 w-24"></div>
      </div>

      {/* QUICK MOOD GRID */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        {MOODS.map((m) => (
          <button
            key={m.id}
            disabled={isLoading || isRecording || isProcessingAudio}
            onClick={() => onSelectMood(m.id, 'text')}
            className={`group relative overflow-hidden rounded-2xl p-6 transition-all duration-300 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
              bg-gradient-to-br ${m.color} bg-opacity-10 border border-white/5 hover:border-white/20`}
          >
            <div className="absolute inset-0 bg-black opacity-40 group-hover:opacity-20 transition-opacity"></div>
            <div className="relative z-10 flex flex-col items-center">
              <span className="text-4xl mb-2 drop-shadow-lg transform group-hover:scale-110 transition-transform">{m.emoji}</span>
              <span className="font-semibold text-white tracking-wide">{m.label}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default MoodSelector;