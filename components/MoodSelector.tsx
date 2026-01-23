

import React, { useState, useRef, useEffect } from 'react';
import { MOODS } from '../constants';
import { MicIcon } from './Icons';
import { transcribeAudio } from '../services/geminiService';
import HowItWorks from './HowItWorks';
import { isRtl } from '../utils/textUtils';
import { TranscriptionResult } from '../types'; // NEW: Import TranscriptionResult

interface MoodSelectorProps {
  onSelectMood: (mood: string, modality: 'text' | 'voice') => void;
  isLoading: boolean;
  validationError: { message: string; key: number } | null;
}

// Constants for silence detection logic
const MIN_RECORDING_DURATION_MS = 800; // Minimum duration for a valid recording
const SPEECH_THRESHOLD = 0.02; // RMS threshold for detecting speech (adjust as needed)

const MoodSelector: React.FC<MoodSelectorProps> = ({ onSelectMood, isLoading, validationError }) => {
  const [customMood, setCustomMood] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const [inputModality, setInputModality] = useState<'text' | 'voice'>('text');
  const [visibleError, setVisibleError] = useState<{ message: string; key: number } | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Refs for audio processing (silence detection)
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const scriptProcessorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const speechDetectedRef = useRef(false);
  const recordingStartTimeRef = useRef<number>(0);

  const CHAR_LIMIT = 500;

  useEffect(() => {
    if (validationError) {
      setVisibleError(validationError);
    }
  }, [validationError]);

  // v2.2.0 - Ensure text cursor is blinking on arrival
  useEffect(() => {
    if (!isLoading && !isProcessingAudio) {
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isLoading, isProcessingAudio]);

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

        // Setup AudioContext for real-time analysis
        audioContextRef.current = new window.AudioContext();
        const source = audioContextRef.current.createMediaStreamSource(stream);
        analyserNodeRef.current = audioContextRef.current.createAnalyser();
        analyserNodeRef.current.fftSize = 2048; 

        // ScriptProcessorNode is deprecated but used here for compatibility with existing patterns
        scriptProcessorNodeRef.current = audioContextRef.current.createScriptProcessor(2048, 1, 1);

        // Connect nodes: source -> analyser -> scriptProcessor -> destination (silent output)
        source.connect(analyserNodeRef.current);
        analyserNodeRef.current.connect(scriptProcessorNodeRef.current);
        scriptProcessorNodeRef.current.connect(audioContextRef.current.destination); 
        
        // Reset speech detection flag and record start time
        speechDetectedRef.current = false;
        recordingStartTimeRef.current = Date.now();

        // Data array for time domain data (waveform)
        const bufferLength = analyserNodeRef.current.fftSize; // Same size as FFT for time domain
        const dataArray = new Float32Array(bufferLength); // Using Float32Array for getFloatTimeDomainData

        scriptProcessorNodeRef.current.onaudioprocess = (event) => {
            // Get the audio data from the input buffer
            if (analyserNodeRef.current) {
              analyserNodeRef.current.getFloatTimeDomainData(dataArray); 
            }

            // Calculate RMS (Root Mean Square) for energy detection
            let sumSquares = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sumSquares += dataArray[i] * dataArray[i];
            }
            const rms = Math.sqrt(sumSquares / dataArray.length);

            if (rms > SPEECH_THRESHOLD) {
                speechDetectedRef.current = true;
            }
        };

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunksRef.current.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            setIsRecording(false);
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            
            // Disconnect and close audio graph components to release resources
            if (scriptProcessorNodeRef.current) {
                scriptProcessorNodeRef.current.disconnect();
                scriptProcessorNodeRef.current.onaudioprocess = null; // Important to nullify handler
                scriptProcessorNodeRef.current = null;
            }
            if (analyserNodeRef.current) {
                analyserNodeRef.current.disconnect();
                analyserNodeRef.current = null;
            }
            if (audioContextRef.current) {
                audioContextRef.current.close(); 
                audioContextRef.current = null;
            }
            
            // Stop the actual microphone stream after all processing for this recording is done
            stream.getTracks().forEach(track => track.stop()); 

            const currentRecordingDuration = Date.now() - recordingStartTimeRef.current;

            // V2.2.1: Client-side Silence Detection (Remains for immediate feedback)
            if (audioBlob.size === 0) {
                setVisibleError({ message: "No audio was recorded. Please ensure your microphone is active.", key: Date.now() });
                setIsProcessingAudio(false);
                return;
            }
            
            if (currentRecordingDuration < MIN_RECORDING_DURATION_MS) {
                setVisibleError({ message: `Recording too short (${currentRecordingDuration}ms). Please speak for at least ${MIN_RECORDING_DURATION_MS / 1000} seconds.`, key: Date.now() });
                setIsProcessingAudio(false);
                return;
            }
            
            if (!speechDetectedRef.current) {
                setVisibleError({ message: "Silence detected. Please speak clearly into the microphone.", key: Date.now() });
                setIsProcessingAudio(false);
                return;
            }
            
            // If all client-side checks pass, proceed with transcription
            setIsProcessingAudio(true);
            try {
                const base64Full = await blobToBase64(audioBlob);
                const base64Data = base64Full.split(',')[1];
                const transcriptionResult: TranscriptionResult = await transcribeAudio(base64Data, audioBlob.type); // NEW: Expect TranscriptionResult
                
                // NEW: Handle structured transcription result
                if (transcriptionResult.status === 'ok') {
                    if ((window as any).addLog) (window as any).addLog(`Client-side voice input processed. Transcript: "${transcriptionResult.text}"`);
                    const newValue = customMood ? `${customMood} ${transcriptionResult.text}` : transcriptionResult.text;
                    if (newValue && newValue.length <= CHAR_LIMIT) { // Check newValue for null/undefined if text is optional
                        setCustomMood(newValue);
                        setInputModality('voice');
                    } else {
                        setVisibleError({ message: `Your voice input made the total mood description too long (max ${CHAR_LIMIT} chars). Please keep it concise.`, key: Date.now() });
                    }
                } else if (transcriptionResult.status === 'no_speech') {
                    // Treat as silence for UX - same retry modal logic
                    if ((window as any).addLog) (window as any).addLog(`Server/Preview classified as 'no_speech'. Reason: ${transcriptionResult.reason}`);
                    setVisibleError({ message: transcriptionResult.reason || "Silence detected. Please speak clearly into the microphone.", key: Date.now() });
                } else if (transcriptionResult.status === 'error') {
                    // Generic voice processing failed message for technical errors
                    if ((window as any).addLog) (window as any).addLog(`Audio transcription failed: ${transcriptionResult.reason}`);
                    setVisibleError({ message: transcriptionResult.reason || "Voice processing failed due to a technical error.", key: Date.now() });
                }

            } catch (error: any) {
                console.error("Audio transcription failed", error);
                if ((window as any).addLog) (window as any).addLog(`Audio transcription failed: ${error.message}`);
                // Fallback for unexpected errors not covered by TranscriptionResult
                setVisibleError({ message: `Voice processing failed: ${error.message}`, key: Date.now() });
            } finally {
                setIsProcessingAudio(false);
            }
        };

        mediaRecorder.start();
        setIsRecording(true);

    } catch (err) {
        console.error("Microphone Error:", err);
        if (err instanceof DOMException && err.name === "NotAllowedError") {
             setVisibleError({ message: "Microphone access denied. Please allow microphone permissions in your browser settings.", key: Date.now() });
        } else {
             setVisibleError({ message: "Could not access microphone.", key: Date.now() });
        }
        setIsRecording(false); // Ensure recording state is reset on error
        setIsProcessingAudio(false); // Ensure processing state is reset on error
        // Clean up audio graph if it was partially initialized
        if (scriptProcessorNodeRef.current) {
            scriptProcessorNodeRef.current.disconnect();
            scriptProcessorNodeRef.current.onaudioprocess = null;
            scriptProcessorNodeRef.current = null;
        }
        if (analyserNodeRef.current) {
            analyserNodeRef.current.disconnect();
            analyserNodeRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
    }
  };

  const handleCloseErrorModal = () => {
    setVisibleError(null);
  };

  const isRightToLeft = visibleError ? isRtl(visibleError.message) : false;
  const textAlign = isRightToLeft ? 'text-right' : 'text-left';
  const contentDir = isRightToLeft ? 'rtl' : 'ltr';
  const fontClass = isRightToLeft ? "font-['Heebo']" : "";

  return (
    <div className="flex flex-col w-full max-w-5xl mx-auto px-4 animate-fade-in-up pb-24">
      
      {visibleError && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4"
          onClick={handleCloseErrorModal}
          aria-modal="true"
          role="dialog"
          key={visibleError.key}
        >
          <div
            className="relative bg-indigo-950/80 border border-cyan-500/30 rounded-2xl shadow-2xl w-full max-w-md p-6 text-center animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-purple-200 mb-2">Hold on a sec...</h3>
            <div className={`text-lg text-cyan-300 mb-6 ${textAlign} ${fontClass}`} dir={contentDir}>
              <span className="font-bold">AI Curator:</span> {visibleError.message}
            </div>
            <button
              onClick={handleCloseErrorModal}
              className="bg-blue-600/90 text-white font-extrabold rounded-xl px-8 py-3 text-sm uppercase tracking-widest transition-all hover:bg-blue-700 active:scale-95"
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      <div className="flex-none pt-2 md:pt-4 pb-0">
          <div className="text-center mb-2 md:mb-4">
              <h2 className="text-3xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-500 pb-1 leading-tight">
                <span className="md:hidden">How are you feeling?</span>
                <span className="hidden md:inline">How are you feeling today?</span>
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
                                ref={textareaRef}
                                value={customMood}
                                onChange={handleChange}
                                onKeyDown={handleKeyDown}
                                placeholder={
                                    isRecording 
                                    ? "Listening... (Tap mic to stop)" 
                                    : (isProcessingAudio 
                                        ? "AI is processing your voice..." 
                                        : "Describe a moment, a memory, or a dream. E.g., 'I just finished a marathon' or 'Driving at 2AM'...")
                                }
                                disabled={isLoading || isProcessingAudio}
                                rows={3}
                                className={`w-full bg-slate-800/60 text-white placeholder-slate-400/70 rounded-2xl py-8 md:py-12 pl-6 pr-14 focus:outline-none resize-none align-top text-base md:text-lg leading-relaxed transition-colors ${isRecording ? 'placeholder-red-400/70 text-red-200' : ''}`}
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

      <div className="mt-2 md:mt-4">
          <div className="flex items-center justify-center gap-4 mb-6 opacity-100">
              <div className="h-px bg-slate-800 flex-grow max-w-[60px]"></div>
              <span className="text-slate-500 text-[10px] uppercase tracking-[0.4em] font-bold">Or Choose A Quick Vibe</span>
              <div className="h-px bg-slate-800 flex-grow max-w-[60px]"></div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 md:gap-4">
              {MOODS.map((m) => (
                <button
                    key={m.id}
                    disabled={isLoading || isRecording || isProcessingAudio}
                    onClick={() => onSelectMood(m.id, 'text')}
                    className={`group relative overflow-hidden rounded-xl p-2.5 md:p-5 transition-all duration-300 hover:scale-[1.03] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
                    bg-gradient-to-br ${m.color} bg-opacity-5 border border-white/5 hover:border-white/10`}
                >
                    <div className="absolute inset-0 bg-slate-900/60 group-hover:bg-slate-900/40 transition-colors"></div>
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
