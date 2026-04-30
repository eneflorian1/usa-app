'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface UseWakeWordOptions {
    onWake: () => void;
    wakeWord?: string;
    enabled?: boolean;
}

export function useWakeWord({ onWake, wakeWord = 'ilie', enabled = false }: UseWakeWordOptions) {
    const recognitionRef = useRef<any>(null);
    const [isListening, setIsListening] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const startListening = useCallback(() => {
        if (typeof window === 'undefined') return;

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setError('Speech Recognition not supported in this browser.');
            return;
        }

        if (recognitionRef.current) {
            try {
                recognitionRef.current.stop();
            } catch (e) {}
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'ro-RO';

        recognition.onresult = (event: any) => {
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    const transcript = event.results[i][0].transcript.toLowerCase();
                    console.log('[WakeWord] Final transcript:', transcript);
                    
                    if (transcript.includes(wakeWord.toLowerCase()) || 
                        transcript.includes('hei ' + wakeWord.toLowerCase()) ||
                        transcript.includes('hey ' + wakeWord.toLowerCase()) ||
                        transcript.includes('ok ' + wakeWord.toLowerCase())) {
                        
                        console.log('[WakeWord] Wake word detected!');
                        onWake();
                        recognition.stop();
                        return;
                    }
                } else {
                    const transcript = event.results[i][0].transcript.toLowerCase();
                    // Optional: trigger on interim results for faster response
                    if (transcript.includes(wakeWord.toLowerCase())) {
                         console.log('[WakeWord] Wake word detected (interim)!');
                         onWake();
                         recognition.stop();
                         return;
                    }
                }
            }
        };

        recognition.onerror = (event: any) => {
            console.error('[WakeWord] Error:', event.error);
            if (event.error === 'not-allowed') {
                setError('Microphone access denied');
                setIsListening(false);
            }
        };

        recognition.onend = () => {
            console.log('[WakeWord] Recognition ended');
            setIsListening(false);
            // Auto-restart if still enabled and not stopped by detection
            if (enabled) {
                setTimeout(() => {
                    if (enabled && !recognitionRef.current?.isActive) {
                        try {
                            recognition.start();
                            setIsListening(true);
                        } catch (e) {
                            console.error('[WakeWord] Restart failed:', e);
                        }
                    }
                }, 1000);
            }
        };

        try {
            recognition.start();
            setIsListening(true);
            recognitionRef.current = recognition;
        } catch (e) {
            console.error('[WakeWord] Failed to start:', e);
            setIsListening(false);
        }
    }, [enabled, onWake, wakeWord]);

    const stopListening = useCallback(() => {
        if (recognitionRef.current) {
            try {
                recognitionRef.current.stop();
            } catch (e) {}
            recognitionRef.current = null;
        }
        setIsListening(false);
    }, []);

    useEffect(() => {
        if (enabled) {
            startListening();
        } else {
            stopListening();
        }

        return () => {
            stopListening();
        };
    }, [enabled, startListening, stopListening]);

    return { isListening, error };
}
