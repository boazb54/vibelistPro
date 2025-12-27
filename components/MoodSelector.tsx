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
}

const MoodSelector: React.FC<MoodSelectorProps> = ({ onSelectMood, isLoading, validationError }) => {
  const [customMood, setCustomMood] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const [inputModality, setInputModality] = useState<'text' | 'voice'>('text');
  const [visibleError, setVisibleError] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const CHAR_LIMIT = 500;

  useEffect(() => {
    if (validationError) {
      setVisibleError(validationError.message);
    }
  }, [validationError]);


  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customMood.trim()) {
      onSelectMood(customMood.trim(), inputModality);
    }
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

  const blobToBase64 = (blob: Blob): Promise<string> => {
      return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
      });
  };

  // --- START: Enhanced Voice Input Validation (v1.2.0) ---
  const performClientSideTranscriptValidation = (transcript: string): { isValid: boolean, reason?: string } => {
    const cleanTranscript = transcript ? transcript.trim() : "";
    const words = cleanTranscript.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);

    // Basic length check (similar to text input's minimum length)
    if (words.length < 3 || cleanTranscript.length < 10) {
      return { isValid: false, reason: "Please describe the vibe in a bit more detail. It sounds too short." };
    }

    // Existing artifact/noise word filter
    const hasArtifacts = /^\*.*\*/.test(cleanTranscript) || /^\[.*\]/.test(cleanTranscript) || /^\d{2}:\d{2}/.test(cleanTranscript);
    const noiseWords = new Set(['thwack', 'thump', 'tap', 'shh', 'shhhhh', 'shhhhhh', 'click', 'clack', 'whack', 'knock']);
    const isOnlyNoiseWords = words.length > 0 && words.every(word => noiseWords.has(word));
    if (hasArtifacts || isOnlyNoiseWords) {
      return { isValid: false, reason: "I hear you, but that doesn't sound like a vibe. Please try again with clearer speech." };
    }

    // Heuristic check for gibberish patterns
    // Example: repeated characters, very few unique characters in a long string, too many non-alphanumeric
    const uniqueChars = new Set(cleanTranscript.replace(/\s/g, '')).size;
    if (cleanTranscript.length > 20 && uniqueChars < (cleanTranscript.length / 5)) { // If fewer than 1/5 unique chars for long string
        return { isValid: false, reason: "That sounds like gibberish. Can you please describe your mood clearly?" };
    }

    // Simple check for common non-vibe topics (off-topic)
    const offTopicKeywords = ['what is the weather', 'tell me a joke', 'what time is it', 'how are you', 'do you exist', 'who made you', 'what is your name', 'recipe for', 'tell me a story', 'who won the game'];
    if (offTopicKeywords.some(keyword => cleanTranscript.toLowerCase().includes(keyword))) {
      return { isValid: false, reason: "I'm designed to create music playlists, not answer general questions. Please describe your desired vibe." };
    }

    return { isValid: true };
  };
  // --- END: Enhanced Voice Input Validation (v1.2.0) ---

  const handleVoiceToggle = async () => {
    if (isRecording) {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        return;
    }

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
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            stream.getTracks().forEach(track => track.stop());

            if (audioBlob.size === 0) {
                setVisibleError("No audio detected. Please ensure your microphone is working and try speaking again.");
                setIsProcessingAudio(false);
                return;
            }

            setIsProcessingAudio(true);
            try {
                const base64Full = await blobToBase64(audioBlob);
                const base64Data = base64Full.split(',')[1];
                const transcript = await transcribeAudio(base64Data, audioBlob.type);
                
                // --- START: Client-side Enhanced Transcript Validation (v1.2.0) ---
                if ((window as any).addLog) (window as any).addLog(`Raw transcript received: "${transcript}"`);
                const validationResult = performClientSideTranscriptValidation(transcript);

                if (!validationResult.isValid) {
                    if ((window as any).addLog) (window as any).addLog(`Client-side voice validation failed: "${validationResult.reason}". Original transcript: "${transcript}"`);
                    setVisibleError(validationResult.reason || "I couldn't quite understand that as a music vibe. Please try again.");
                    setIsProcessingAudio(false);
                    return; // STOP here, do NOT call onSelectMood
                }
                // --- END: Client-side Enhanced Transcript Validation ---

                // If passes client-side enhanced validation, proceed to App.tsx's onSelectMood
                if ((window as any).addLog) (window as any).addLog(`Client-side voice validation passed. Transcript: "${transcript}"`);
                const newValue = customMood ? `${customMood} ${transcript}` : transcript;
                if (newValue.length <= CHAR_LIMIT) {
                    setCustomMood(newValue);
                    setInputModality('voice');
                    onSelectMood(newValue, 'voice'); // Immediately trigger mood selection with voice input
                } else {
                    setVisibleError(`Your voice input made the total mood description too long (max ${CHAR_LIMIT} chars). Please keep it concise.`);
                }

            } catch (error: any) {
                console.error("Audio transcription failed", error);
                if ((window as any).addLog) (window as any).addLog(`Audio transcription failed: ${error.message}`);
                alert(`Voice processing failed: ${error.message}`);
            } finally {
                setIsProcessingAudio(false);
            }
        };

        mediaRecorder.start();
        setIsRecording(true);

    } catch (err) {
        console.error("Microphone Error:", err);
        if (err instanceof DOMException && err.name === "NotAllowedError") {
             alert("Microphone access denied. Please allow microphone permissions in your browser settings.");
        } else {
             alert("Could not access microphone.");
        }
    }
  };

  const handleCloseErrorModal = () => {
    setVisibleError(null);
  };

  const isRightToLeft = visibleError ? isRtl(visibleError) : false;
  const textAlign = isRightToLeft ? 'text-right' : 'text-left';
  const contentDir = isRightToLeft ? 'rtl' : 'ltr';
  const fontClass = isRightToLeft ? "font-['Heebo']" : "";

  return (
    <div className="flex flex-col w-full max-w-5xl mx-auto px-4 animate-fade-in-up pb-40">
      
      {/* V1.3.1: MODAL ERROR DISPLAY */}
      {visibleError && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4"
          onClick={handleCloseErrorModal}
          aria-modal="true"
          role="dialog"
        >
          <div
            className="relative bg-rose-950/80 border border-rose-500/30 rounded-2xl shadow-2xl w-full max-w-md p-6 text-center animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-rose-200 mb-2">Hold on a sec...</h3>
            <div className={`text-lg text-rose-300 mb-6 ${textAlign} ${fontClass}`} dir={contentDir}>
              <span className="font-bold">AI Curator:</span> {visibleError}
            </div>
            <button
              onClick={handleCloseErrorModal}
              className="bg-white/90 text-black font-extrabold rounded-xl px-8 py-3 text-sm uppercase tracking-widest transition-all hover:bg-white hover:scale-105 active:scale-95"
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      <div className="flex-none pt-4 md:pt-6 pb-2">
          <div className="text-center mb-4 md:mb-6">
              <h2 className="text-3xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-500 pb-1 leading-tight">
                How are you feeling today?
              </h2>
          </div>

          <div className="flex flex-col gap-y-3 md:gap-y-4 max-w-4xl mx-auto w-full">
              <HowItWorks />
              
              <form onSubmit={handleCustomSubmit} className="relative w-full">
                <div className="relative group">
                    <div className={`absolute -inset-0.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-3xl opacity-30 group-focus-within:opacity-70 transition duration-500 blur-lg ${isRecording ? 'animate-pulse opacity-90' : ''}`}></div>
                    
                    <div className="relative bg-slate-900 border border-white/10 rounded-3xl p-1.5 shadow-2xl">
                        <div className="relative">
                            <textarea
                                value={customMood}
                                onChange={handleChange}
                                onKeyDown={handleKeyDown}
                                placeholder={
                                    isRecording 
                                    ? "Listening... (Tap mic to stop)" 
                                    : (isProcessingAudio 
                                        ? "AI is processing your voice..." 
                                        : "Talk to the AI. Describe a moment, a memory, or a dream. E.g., 'I just finished a marathon' or 'Driving at 2AM'...")
                                }
                                disabled={isLoading || isProcessingAudio}
                                rows={3}
                                className={`w-full bg-slate-800/60 text-white placeholder-slate-400/70 rounded-2xl py-6 md:py-10 pl-6 pr-14 focus:outline-none resize-none align-top text-base md:text-lg leading-relaxed transition-colors ${isRecording ? 'placeholder-red-400/70 text-red-200' : ''}`}
                            />
                            <button 
                                type="button"
                                onClick={handleVoiceToggle}
                                disabled={isLoading || isProcessingAudio}
                                className={`absolute top-4 right-4 p-2 rounded-full transition-all 
                                    ${isRecording 
                                        ? 'bg-red-500 text-white animate-pulse scale-110 shadow-lg' 
                                        : (isProcessingAudio 
                                            ? 'bg-purple-500/50 text-white animate-bounce' 
                                            : 'text-slate-500 hover:text-white hover:bg-slate-700/50')}`}
                            >
                                <MicIcon className="w-5 h-5" />
                            </button>
                        </div>
                        
                        <div className="flex justify-between items-center px-4 pb-2 pt-1">
                            <div className="bg-slate-700/50 px-2.5 py-1 rounded-md">
                                <span className={`text-[10px] font-bold tracking-widest uppercase ${customMood.length > 400 ? 'text-yellow-400' : 'text-slate-400'}`}>
                                    {customMood.length} / {CHAR_LIMIT}
                                </span>
                            </div>
                            
                            <button
                                type="submit"
                                disabled={!customMood.trim() || isLoading || isRecording || isProcessingAudio}
                                className="bg-white/90 text-black font-extrabold rounded-xl px-6 py-2 md:px-8 md:py-3 text-[11px] md:text-xs uppercase tracking-[0.2em] transition-all hover:bg-white hover:scale-105 active:scale-95 disabled:opacity-20 disabled:scale-100"
                            >
                                {isLoading ? 'Creating' : isProcessingAudio ? 'Thinking' : 'Generate'}
                            </button>
                        </div>
                    </div>
                </div>
              </form>
          </div>
      </div>

      <div className="mt-4 md:mt-6">
          <div className="flex items-center justify-center gap-4 mb-6 opacity-40">
              <div className="h-px bg-slate-800 flex-grow max-w-[60px]"></div>
              <span className="text-slate-500 text-[10px] uppercase tracking-[0.4em] font-bold">Quick Vibe</span>
              <div className="h-px bg-slate-800 flex-grow max-w-[60px]"></div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 md:gap-4">
              {MOODS.map((m) => (
                <button
                    key={m.id}
                    disabled={isLoading || isRecording || isProcessingAudio}
                    onClick={() => onSelectMood(m.id, 'text')}
                    className={`group relative overflow-hidden rounded-xl p-2.5 md:p-5 transition-all duration-300 hover:scale-[1.03] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
                    bg-gradient-to-br ${m.color} bg-opacity-5 border border-white/5 hover:border-white/20`}
                >
                    <div className="absolute inset-0 bg-slate-900/80 group-hover:bg-slate-900/60 transition-colors"></div>
                    <div className="relative z-10 flex flex-col items-center text-center">
                        <span className="text-base md:text-2xl mb-1 transform group-hover:scale-110 transition-transform duration-300">{m.emoji}</span>
                        <span className="font-bold text-white tracking-wider text-[9px] md:text-xs uppercase opacity-90">{m.label}</span>
                    </div>
                </button>
              ))}
          </div>
      </div>
    </div>
  );
};

export default MoodSelector;
