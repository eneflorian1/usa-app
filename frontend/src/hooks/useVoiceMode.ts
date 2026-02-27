'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface UseVoiceModeReturn {
    // State
    isListening: boolean;
    isSpeaking: boolean;
    isSupported: boolean;
    transcript: string;
    interimTranscript: string;

    // Actions
    startListening: () => void;
    stopListening: () => string;
    speak: (text: string) => void;
    cancelSpeech: () => void;
}

export function useVoiceMode(lang: string = 'ro-RO'): UseVoiceModeReturn {
    const [isListening, setIsListening] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [interimTranscript, setInterimTranscript] = useState('');
    const [isSupported, setIsSupported] = useState(false);

    const recognitionRef = useRef<any>(null);
    const synthRef = useRef<SpeechSynthesis | null>(null);
    const finalTranscriptRef = useRef('');
    const onEndResolveRef = useRef<((text: string) => void) | null>(null);

    // Check browser support on mount
    useEffect(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        const hasRecognition = !!SpeechRecognition;
        const hasSynthesis = 'speechSynthesis' in window;
        setIsSupported(hasRecognition && hasSynthesis);

        if (hasSynthesis) {
            synthRef.current = window.speechSynthesis;
        }

        return () => {
            // Cleanup on unmount
            if (recognitionRef.current) {
                try { recognitionRef.current.abort(); } catch { }
            }
            if (synthRef.current) {
                synthRef.current.cancel();
            }
        };
    }, []);

    const startListening = useCallback(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) return;

        // Cancel any ongoing speech
        if (synthRef.current) {
            synthRef.current.cancel();
            setIsSpeaking(false);
        }

        const recognition = new SpeechRecognition();
        recognition.lang = lang;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        finalTranscriptRef.current = '';
        setTranscript('');
        setInterimTranscript('');

        recognition.onresult = (event: any) => {
            let interim = '';
            let final = '';

            for (let i = 0; i < event.results.length; i++) {
                const result = event.results[i];
                if (result.isFinal) {
                    final += result[0].transcript;
                } else {
                    interim += result[0].transcript;
                }
            }

            if (final) {
                finalTranscriptRef.current = final;
                setTranscript(final);
            }
            setInterimTranscript(interim);
        };

        recognition.onerror = (event: any) => {
            console.error('[VoiceMode] Recognition error:', event.error);
            if (event.error !== 'aborted') {
                setIsListening(false);
            }
        };

        recognition.onend = () => {
            setIsListening(false);
            setInterimTranscript('');
            // Resolve any pending promise
            if (onEndResolveRef.current) {
                onEndResolveRef.current(finalTranscriptRef.current);
                onEndResolveRef.current = null;
            }
        };

        recognitionRef.current = recognition;

        try {
            recognition.start();
            setIsListening(true);
        } catch (err) {
            console.error('[VoiceMode] Failed to start recognition:', err);
        }
    }, [lang]);

    const stopListening = useCallback((): string => {
        if (recognitionRef.current) {
            try {
                recognitionRef.current.stop();
            } catch { }
        }
        setIsListening(false);
        return finalTranscriptRef.current;
    }, []);

    const speak = useCallback((text: string) => {
        if (!synthRef.current) return;

        // Cancel any previous speech
        synthRef.current.cancel();

        // Clean text for speech (remove emojis, special chars)
        const cleanText = text
            .replace(/[✅❌📋📥📤📝⚡📅⚠️🏨📚🚨💬]/g, '')
            .replace(/\n+/g, '. ')
            .trim();

        if (!cleanText) return;

        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = lang;
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        // Try to find a Romanian voice, fallback to default
        const voices = synthRef.current.getVoices();
        const roVoice = voices.find(v => v.lang.startsWith('ro'));
        if (roVoice) utterance.voice = roVoice;

        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);

        synthRef.current.speak(utterance);
    }, [lang]);

    const cancelSpeech = useCallback(() => {
        if (synthRef.current) {
            synthRef.current.cancel();
            setIsSpeaking(false);
        }
    }, []);

    return {
        isListening,
        isSpeaking,
        isSupported,
        transcript,
        interimTranscript,
        startListening,
        stopListening,
        speak,
        cancelSpeech,
    };
}
