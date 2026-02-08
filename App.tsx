
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { SYSTEM_INSTRUCTION } from './constants';
import { TranscriptionItem } from './types';
import { Visualizer } from './components/Visualizer';
import { encode, decode, decodeAudioData, float32ToInt16 } from './services/audioUtils';

const App: React.FC = () => {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcriptions, setTranscriptions] = useState<TranscriptionItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const transcriptListRef = useRef<HTMLDivElement>(null);

  const stopSession = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close().catch(() => {});
      outputAudioContextRef.current = null;
    }
    activeSourcesRef.current.forEach(source => {
      try { source.stop(); } catch(e) {}
    });
    activeSourcesRef.current.clear();
    setIsSessionActive(false);
    setIsSpeaking(false);
    nextStartTimeRef.current = 0;
  }, []);

  const startSession = async () => {
    try {
      setError(null);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      if (inputCtx.state === 'suspended') await inputCtx.resume();
      if (outputCtx.state === 'suspended') await outputCtx.resume();

      audioContextRef.current = inputCtx;
      outputAudioContextRef.current = outputCtx;

      const analyzer = outputCtx.createAnalyser();
      analyzer.fftSize = 256;
      analyzerRef.current = analyzer;

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      streamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } }
          },
          outputAudioTranscription: {},
          inputAudioTranscription: {}
        },
        callbacks: {
          onopen: () => {
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16Data = float32ToInt16(inputData);
              const pcmBase64 = encode(new Uint8Array(int16Data.buffer));
              
              sessionPromise.then(session => {
                session.sendRealtimeInput({
                  media: { data: pcmBase64, mimeType: 'audio/pcm;rate=16000' }
                });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData) {
              setIsSpeaking(true);
              const decoded = decode(audioData);
              const audioBuffer = await decodeAudioData(decoded, outputCtx, 24000, 1);
              
              const source = outputCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(analyzer);
              analyzer.connect(outputCtx.destination);
              
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;

              source.onended = () => {
                activeSourcesRef.current.delete(source);
                if (activeSourcesRef.current.size === 0) {
                  setIsSpeaking(false);
                }
              };
              activeSourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              activeSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              activeSourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsSpeaking(false);
            }

            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              if (text) setTranscriptions(prev => [...prev, { role: 'user', text }]);
            }
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              if (text) setTranscriptions(prev => [...prev, { role: 'model', text }]);
            }
          },
          onerror: (e) => {
            console.error(e);
            setError('Something went wrong. Let\'s try again.');
            stopSession();
          },
          onclose: () => setIsSessionActive(false)
        }
      });

      sessionRef.current = await sessionPromise;
      setIsSessionActive(true);
    } catch (err: any) {
      setError(err.message || 'I couldn\'t access your microphone.');
      stopSession();
    }
  };

  useEffect(() => {
    if (transcriptListRef.current) {
      transcriptListRef.current.scrollTop = transcriptListRef.current.scrollHeight;
    }
  }, [transcriptions]);

  return (
    <div className="flex flex-col h-screen h-[100svh] bg-[#09090b] text-zinc-100 overflow-hidden relative">
      
      {/* BACKGROUND UI (Disabled visually during session) */}
      <div className={`flex flex-col h-full transition-all duration-700 ${isSessionActive ? 'blur-2xl scale-95 opacity-30 pointer-events-none' : 'opacity-100 scale-100'}`}>
        <header className="px-6 py-6 flex items-center justify-between safe-top">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center">
              <span className="text-2xl font-bold tracking-tighter">L</span>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Lumina</h1>
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Your Human AI Companion</p>
            </div>
          </div>

          <button 
            onClick={() => setIsTranscriptOpen(!isTranscriptOpen)}
            className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </button>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md space-y-6">
            <h2 className="text-4xl font-light text-white leading-tight">Ready to talk?</h2>
            <p className="text-zinc-500 text-lg font-light">Lumina is waiting for your voice. Tap the button in the center to begin your session.</p>
          </div>
        </main>
      </div>

      {/* CENTRAL INTERACTION LAYER (Always centered) */}
      <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
        <div className="flex flex-col items-center justify-center w-full max-w-lg gap-12 pointer-events-auto">
          
          {/* Visualizer stays consistent */}
          <div className="relative flex items-center justify-center w-full aspect-square max-w-[320px] sm:max-w-[420px]">
            <Visualizer 
              isListening={isSessionActive && !isSpeaking} 
              isSpeaking={isSpeaking}
              analyzer={analyzerRef.current || undefined}
            />
          </div>

          {/* THE MIDDLE BUTTON - DYNAMIC STATE */}
          <div className="relative h-32 flex items-center justify-center">
            {!isSessionActive ? (
              <div className="flex flex-col items-center gap-4">
                <button
                  onClick={startSession}
                  className="group relative w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-white text-black flex items-center justify-center shadow-[0_0_60px_rgba(255,255,255,0.15)] hover:scale-110 active:scale-95 transition-all duration-300"
                >
                  <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-indigo-500 to-pink-500 opacity-0 group-hover:opacity-30 transition-opacity animate-pulse" />
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 sm:h-12 sm:w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </button>
                <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-[0.4em] animate-pulse">Start Session</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-8 animate-in fade-in zoom-in duration-700">
                <div className="space-y-2 text-center">
                   <p className={`text-2xl sm:text-3xl font-medium tracking-tight transition-all duration-500 ${isSpeaking ? 'text-indigo-400 scale-105' : 'text-green-400 scale-100'}`}>
                    {isSpeaking ? "Lumina is speaking" : "I'm listening..."}
                  </p>
                </div>
                
                {/* LARGE LAUNCH-STYLE STOP BUTTON (Disables use of background app) */}
                <button
                  onClick={stopSession}
                  className="group relative w-32 sm:w-40 py-4 rounded-3xl bg-red-600 text-white flex items-center justify-center gap-3 shadow-[0_0_40px_rgba(220,38,38,0.3)] hover:bg-red-500 active:scale-95 transition-all font-bold uppercase tracking-widest text-xs"
                >
                  <div className="w-2.5 h-2.5 bg-white rounded-full animate-pulse" />
                  End Call
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Transcript Side Panel (Non-interactive during session) */}
      <div className={`fixed inset-y-0 right-0 w-full sm:w-80 md:w-96 bg-zinc-950/95 backdrop-blur-3xl border-l border-zinc-800 transition-transform duration-500 z-40 shadow-2xl ${isTranscriptOpen && !isSessionActive ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex flex-col h-full safe-top safe-bottom">
          <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
            <h3 className="font-bold text-zinc-500 uppercase tracking-widest text-[10px]">Session History</h3>
            <button 
              onClick={() => setIsTranscriptOpen(false)}
              className="p-2 hover:bg-zinc-900 rounded-lg text-zinc-500"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div 
            ref={transcriptListRef}
            className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar"
          >
            {transcriptions.length === 0 ? (
              <div className="h-full flex items-center justify-center text-zinc-800 text-xs text-center px-10">
                Transcriptions of your chats will appear here after you finish a session.
              </div>
            ) : (
              transcriptions.map((t, i) => (
                <div key={i} className={`flex flex-col ${t.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    t.role === 'user' 
                      ? 'bg-indigo-600/10 text-indigo-100 border border-indigo-500/10' 
                      : 'bg-zinc-900/50 text-zinc-300 border border-zinc-800'
                  }`}>
                    {t.text}
                  </div>
                </div>
              ))
            )}
          </div>
          
          <div className="p-6 bg-zinc-950/80">
            <button 
              onClick={() => setTranscriptions([])}
              className="w-full py-3 text-[10px] font-bold text-zinc-600 hover:text-white uppercase tracking-[0.3em] transition-colors"
            >
              Clear Records
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 px-8 py-4 bg-zinc-900 border border-red-500/50 text-red-400 text-sm font-medium rounded-2xl shadow-2xl z-50 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
          {error}
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #27272a; border-radius: 10px; }
        .safe-top { padding-top: env(safe-area-inset-top, 0); }
        .safe-bottom { padding-bottom: env(safe-area-inset-bottom, 0); }
      `}</style>
    </div>
  );
};

export default App;
