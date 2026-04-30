'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useGeminiLive } from '@/hooks/useGeminiLive';
import { useWakeWord } from '@/hooks/useWakeWord';

export default function VoiceFAB() {
    const pathname = usePathname();
    const [isOpen, setIsOpen] = useState(false);
    const [isWakeWordEnabled, setIsWakeWordEnabled] = useState(false);

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

    // Wake word detection
    const handleWakeWord = useCallback(() => {
        if (!isOpen) {
            setIsOpen(true);
            // Session starts via useEffect below
        }
    }, [isOpen]);

    const { isListening: isWakeWordListening } = useWakeWord({
        onWake: handleWakeWord,
        enabled: isWakeWordEnabled && !isOpen && sessionState === 'disconnected',
        wakeWord: 'ilie'
    });

    // Start session immediately when FAB is opened
    useEffect(() => {
        if (isOpen && sessionState === 'disconnected') {
            startSession();
        }
    }, [isOpen, sessionState, startSession]);

    // Hide on orchestrator page — it has its own voice controls
    if (pathname === '/orchestrator') return null;

    const handleFABClick = () => {
        if (isOpen) {
            stopSession();
            setIsOpen(false);
        } else {
            setIsOpen(true);
        }
    };

    const toggleWakeWordMode = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsWakeWordEnabled(!isWakeWordEnabled);
    };

    const handleClose = () => {
        stopSession();
        setIsOpen(false);
    };

    return (
        <>
            {/* ===== FLOATING ACTION BUTTON ===== */}
            <div className="fixed z-50 bottom-20 md:bottom-6 right-4 md:right-6 flex flex-col items-end gap-3">
                {/* Wake Word Toggle Tooltip/Label */}
                {!isOpen && isWakeWordEnabled && (
                    <div className="bg-black/60 backdrop-blur-md text-white text-[10px] px-2 py-1 rounded-lg border border-white/10 mb-[-8px] animate-pulse">
                        Listening for "Ilie"
                    </div>
                )}
                
                <div className="flex items-center gap-3">
                    {/* Wake Word Toggle Button (only when not open) */}
                    {!isOpen && (
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
                        className={`w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 ${
                            isOpen
                                ? 'bg-red-500 hover:bg-red-600 scale-90'
                                : 'bg-gradient-to-br from-violet-500 to-pink-600 hover:scale-110 hover:shadow-violet-500/40'
                        }`}
                        title="Voice Assistant"
                        aria-label="Start voice conversation"
                    >
                        {isOpen ? (
                            // X close icon
                            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
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
                    </button>
                </div>
            </div>

            {/* ===== FULLSCREEN VOICE OVERLAY ===== */}
            {isOpen && (
                <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-xl flex flex-col items-center justify-center px-4">
                    {/* Close button top-right */}
                    <button
                        onClick={handleClose}
                        className="absolute top-6 right-6 p-2 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>

                    {/* Main voice circle */}
                    <div className="relative">
                        <button
                            onClick={() => {
                                if (isSessionActive) {
                                    stopSession();
                                } else if (sessionState === 'disconnected' || sessionState === 'error') {
                                    startSession();
                                }
                            }}
                            disabled={isConnecting}
                            className={`relative w-32 h-32 md:w-40 md:h-40 rounded-full transition-all duration-500 flex items-center justify-center ${
                                isSessionActive
                                    ? 'bg-gradient-to-br from-pink-500 to-rose-600 shadow-2xl shadow-pink-500/40 scale-105'
                                    : isConnecting
                                        ? 'bg-gradient-to-br from-amber-400 to-orange-500 shadow-xl shadow-amber-500/30 animate-pulse'
                                        : 'bg-gradient-to-br from-violet-500 to-pink-600 shadow-xl shadow-violet-500/30 hover:shadow-2xl hover:scale-105'
                            }`}
                        >
                            {/* Pulsing rings when active */}
                            {isSessionActive && (
                                <>
                                    <span className="absolute inset-0 rounded-full bg-pink-500/20 animate-ping" />
                                    <span className="absolute inset-[-8px] rounded-full border-2 border-pink-400/30 animate-pulse" />
                                </>
                            )}
                            {isModelSpeaking && (
                                <span className="absolute inset-[-16px] rounded-full border border-violet-400/20 animate-[ping_2s_ease-in-out_infinite]" />
                            )}

                            {isConnecting ? (
                                <div className="w-8 h-8 border-3 border-white border-t-transparent rounded-full animate-spin" />
                            ) : isSessionActive ? (
                                // Stop icon
                                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="white" stroke="none">
                                    <rect x="6" y="6" width="12" height="12" rx="2" />
                                </svg>
                            ) : (
                                // Microphone icon
                                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                    <line x1="12" x2="12" y1="19" y2="22" />
                                </svg>
                            )}
                        </button>
                    </div>

                    {/* Status text */}
                    <p className="mt-6 text-sm font-medium text-white/70">
                        {isConnecting ? 'Connecting to Gemini...' :
                            isSessionActive ? 'Listening... Tap to stop' :
                                sessionState === 'error' ? 'Connection failed' :
                                    'Tap to start'}
                    </p>

                    {/* Error */}
                    {sessionState === 'error' && errorMessage && (
                        <p className="mt-2 text-xs text-red-400 max-w-xs text-center">{errorMessage}</p>
                    )}

                    {/* Transcription & tool call display */}
                    {isSessionActive && (
                        <div className="mt-8 w-full max-w-md space-y-3">
                            {/* Voice bars when speaking */}
                            {isModelSpeaking && (
                                <div className="flex items-center justify-center gap-1 mb-4">
                                    {[...Array(7)].map((_, i) => (
                                        <span
                                            key={i}
                                            className="w-1 bg-violet-400 rounded-full"
                                            style={{
                                                // eslint-disable-next-line react-hooks/purity
                                                height: `${12 + Math.random() * 20}px`,
                                                animation: `voice-fab-bar 0.5s ease-in-out infinite ${i * 0.07}s`
                                            }}
                                        />
                                    ))}
                                </div>
                            )}

                            {/* User transcript */}
                            {userTranscript && (
                                <div className="text-right">
                                    <span className="text-[10px] text-white/40 mb-1 block">You</span>
                                    <div className="inline-block bg-violet-600 text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm max-w-[85%]">
                                        {userTranscript}
                                    </div>
                                </div>
                            )}

                            {/* AI transcript */}
                            {aiTranscript && (
                                <div className="text-left">
                                    <span className="text-[10px] text-white/40 mb-1 block">AI</span>
                                    <div className="inline-block bg-white/10 text-white rounded-2xl rounded-bl-md px-4 py-2.5 text-sm max-w-[85%]">
                                        {aiTranscript}
                                    </div>
                                </div>
                            )}

                            {/* Tool call status */}
                            {toolCall && (
                                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium ${
                                    toolCall.status === 'executing'
                                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                        : toolCall.status === 'completed'
                                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                            : 'bg-white/10 text-white/60 border border-white/20'
                                }`}>
                                    {toolCall.status === 'executing' && (
                                        <div className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                                    )}
                                    {toolCall.status === 'completed' && '✅'}
                                    {toolCall.status === 'cancelled' && '⏹'}
                                    <span>
                                        {toolCall.status === 'executing' ? `Running: ${toolCall.task?.substring(0, 50) || toolCall.name}...` :
                                            toolCall.status === 'completed' ? `Done: ${toolCall.name}` :
                                                `Cancelled: ${toolCall.name}`}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            <style jsx>{`
                @keyframes voice-fab-bar {
                    0%, 100% { transform: scaleY(0.4); }
                    50% { transform: scaleY(1.5); }
                }
            `}</style>
        </>
    );
}
