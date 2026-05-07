'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useGeminiLive } from '@/hooks/useGeminiLive';
import { useWakeWord } from '@/hooks/useWakeWord';

export default function VoiceFAB() {
    const pathname = usePathname();
    const [isWakeWordEnabled, setIsWakeWordEnabled] = useState(false);
    const [showStatus, setShowStatus] = useState(false);
    const statusTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const {
        sessionState,
        isModelSpeaking,
        userTranscript,
        aiTranscript,
        toolCall,
        errorMessage,
        startSession,
        stopSession,
    } = useGeminiLive();

    const isSessionActive = sessionState === 'ready';
    const isConnecting = sessionState === 'connecting' || sessionState === 'settingUp';
    const isError = sessionState === 'error';

    // Wake word detection
    const handleWakeWord = useCallback(() => {
        if (sessionState === 'disconnected') {
            startSession();
        }
    }, [sessionState, startSession]);

    const { isListening: isWakeWordListening } = useWakeWord({
        onWake: handleWakeWord,
        enabled: isWakeWordEnabled && sessionState === 'disconnected',
        wakeWord: 'ilie'
    });

    // Auto-show status when something happens
    useEffect(() => {
        if (userTranscript || aiTranscript || toolCall || isConnecting || isError) {
            setShowStatus(true);
            if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
            
            // Auto-hide after 10 seconds of inactivity if not speaking and no tool call
            if (!isModelSpeaking && !toolCall && !isConnecting) {
                statusTimeoutRef.current = setTimeout(() => {
                    setShowStatus(false);
                }, 10000);
            }
        }
    }, [userTranscript, aiTranscript, toolCall, isConnecting, isError, isModelSpeaking]);

    // Hide on orchestrator page — it has its own voice controls
    // But we don't return null because we want the session to persist if it's already active
    const isOrchestrator = pathname === '/orchestrator';

    const handleFABClick = () => {
        if (isSessionActive || isConnecting || isError) {
            stopSession();
            setShowStatus(false);
        } else {
            startSession();
            setShowStatus(true);
        }
    };

    const toggleWakeWordMode = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsWakeWordEnabled(!isWakeWordEnabled);
    };

    return (
        <div className={isOrchestrator ? 'hidden' : ''}>
            {/* ===== FLOATING ACTION BUTTON & STATUS ===== */}
            <div className="fixed z-50 bottom-20 md:bottom-6 right-4 md:right-6 flex flex-col items-end gap-3 pointer-events-none">
                
                {/* Status Indicator Bubble */}
                {showStatus && (isSessionActive || isConnecting || isError) && (
                    <div className="pointer-events-auto bg-indigo-950/95 border border-indigo-500/50 rounded-2xl shadow-2xl p-4 w-72 mb-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <div className="flex items-start gap-3">
                            {/* Small pulse indicator */}
                            <div className="mt-1 relative flex-shrink-0">
                                <div className={`w-2.5 h-2.5 rounded-full ${
                                    isConnecting ? 'bg-amber-500 animate-pulse' :
                                    isError ? 'bg-red-500' :
                                    isModelSpeaking ? 'bg-pink-500' : 'bg-emerald-500'
                                }`} />
                                {isModelSpeaking && <span className="absolute inset-0 rounded-full bg-pink-500/50 animate-ping" />}
                            </div>

                            <div className="flex-1 space-y-2 overflow-hidden">
                                {isConnecting && (
                                    <p className="text-xs font-semibold text-amber-400">Connecting to Gemini...</p>
                                )}
                                {isError && (
                                    <p className="text-xs font-semibold text-red-400">{errorMessage || 'Connection failed'}</p>
                                )}
                                
                                {isSessionActive && (
                                    <>
                                        {/* User transcript */}
                                        {userTranscript && (
                                            <div className="text-right">
                                                <div className="inline-block bg-indigo-600/40 text-white/90 rounded-xl px-3 py-1.5 text-[11px] max-w-full break-words border border-white/5">
                                                    {userTranscript}
                                                </div>
                                            </div>
                                        )}

                                        {/* AI transcript */}
                                        {aiTranscript && (
                                            <div className="text-left">
                                                <div className="inline-block bg-white/10 text-white/90 rounded-xl px-3 py-1.5 text-[11px] max-w-full break-words border border-white/10">
                                                    {aiTranscript}
                                                </div>
                                            </div>
                                        )}

                                        {/* Tool call status */}
                                        {toolCall && (
                                            <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-[10px] font-bold ${
                                                toolCall.status === 'executing'
                                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                                    : toolCall.status === 'completed'
                                                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                                        : 'bg-white/10 text-white/50 border border-white/10'
                                            }`}>
                                                {toolCall.status === 'executing' && (
                                                    <div className="w-2.5 h-2.5 border-1.5 border-amber-400 border-t-transparent rounded-full animate-spin" />
                                                )}
                                                <span>{toolCall.status === 'executing' ? `Working: ${toolCall.name}...` : `Done: ${toolCall.name}`}</span>
                                            </div>
                                        )}

                                        {!userTranscript && !aiTranscript && !toolCall && !isModelSpeaking && (
                                            <p className="text-[10px] text-indigo-300/60 font-medium italic">Listening for voice...</p>
                                        )}

                                        {/* Voice bars when model is speaking */}
                                        {isModelSpeaking && (
                                            <div className="flex items-center gap-1 h-3 pt-1">
                                                {[...Array(6)].map((_, i) => (
                                                    <span
                                                        key={i}
                                                        className="w-0.5 bg-indigo-400 rounded-full"
                                                        style={{
                                                            height: '100%',
                                                            animation: `voice-fab-bar-mini 0.5s ease-in-out infinite ${i * 0.1}s`
                                                        }}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            {/* Close button for status bubble - Using a text label to distinguish from old X */}
                            <button 
                                onClick={() => setShowStatus(false)}
                                className="flex-shrink-0 text-white/40 hover:text-white text-[10px] font-bold uppercase tracking-wider"
                            >
                                Hide
                            </button>
                        </div>
                    </div>
                )}
                
                <div className="flex items-center gap-3 pointer-events-auto">
                    {/* Wake Word Toggle Button (only when not active) */}
                    {!isSessionActive && !isConnecting && (
                        <button
                            onClick={toggleWakeWordMode}
                            className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 ${
                                isWakeWordEnabled 
                                    ? 'bg-amber-500 text-white scale-110' 
                                    : 'bg-white/10 text-white/40 backdrop-blur-md hover:bg-white/20'
                            }`}
                            title={isWakeWordEnabled ? "Disable Wake Word" : "Enable Wake Word (Hey Ilie)"}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            </svg>
                            {isWakeWordEnabled && (
                                <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-black animate-pulse" />
                            )}
                        </button>
                    )}

                    <button
                        onClick={handleFABClick}
                        className={`relative w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 ${
                            isSessionActive
                                ? 'bg-red-500 hover:bg-red-600'
                                : isConnecting
                                    ? 'bg-amber-500 animate-pulse'
                                    : 'bg-gradient-to-br from-violet-500 to-pink-600 hover:scale-110 hover:shadow-violet-500/40'
                        }`}
                        title={isSessionActive ? "Stop Conversation" : "Start Voice Assistant"}
                        aria-label={isSessionActive ? "Stop voice conversation" : "Start voice conversation"}
                    >
                        {isSessionActive || isConnecting ? (
                            // Stop icon
                            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="white" stroke="none">
                                <rect x="6" y="6" width="12" height="12" rx="2" />
                            </svg>
                        ) : (
                            // Microphone icon
                            <>
                                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                    <line x1="12" x2="12" y1="19" y2="22" />
                                </svg>
                                {/* Subtle pulse ring when idle */}
                                <span className="absolute inset-0 rounded-full bg-violet-400/20 animate-ping" style={{ animationDuration: '3s' }} />
                            </>
                        )}

                        {/* Visual feedback for speaking */}
                        {isModelSpeaking && (
                            <span className="absolute inset-[-4px] rounded-full border-2 border-pink-400/50 animate-pulse" />
                        )}
                    </button>
                </div>
            </div>

            <style jsx>{`
                @keyframes voice-fab-bar-mini {
                    0%, 100% { transform: scaleY(0.4); }
                    50% { transform: scaleY(1.2); }
                }
            `}</style>
        </div>
    );
}
