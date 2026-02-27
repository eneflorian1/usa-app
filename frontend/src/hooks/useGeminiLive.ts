'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

type SessionState = 'disconnected' | 'connecting' | 'settingUp' | 'ready' | 'error';

interface ToolCallInfo {
    status: 'executing' | 'completed' | 'cancelled';
    name: string;
    task?: string;
    result?: string;
}

interface UseGeminiLiveReturn {
    sessionState: SessionState;
    isModelSpeaking: boolean;
    userTranscript: string;
    aiTranscript: string;
    toolCall: ToolCallInfo | null;
    errorMessage: string;
    startSession: () => void;
    stopSession: () => void;
}

// PCM audio constants (matching VisionClaw)
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const MIN_SEND_BYTES = 3200; // 100ms at 16kHz mono Int16

// Backend URL — Socket.IO connects to the Express backend, not Next.js
const BACKEND_URL = 'http://localhost:5000';

export function useGeminiLive(): UseGeminiLiveReturn {
    const [sessionState, setSessionState] = useState<SessionState>('disconnected');
    const [isModelSpeaking, setIsModelSpeaking] = useState(false);
    const [userTranscript, setUserTranscript] = useState('');
    const [aiTranscript, setAiTranscript] = useState('');
    const [toolCall, setToolCall] = useState<ToolCallInfo | null>(null);
    const [errorMessage, setErrorMessage] = useState('');

    const socketRef = useRef<Socket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const workletNodeRef = useRef<AudioWorkletNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const accumulatedRef = useRef<Int16Array>(new Int16Array(0));

    // Playback
    const playbackContextRef = useRef<AudioContext | null>(null);
    const nextPlayTimeRef = useRef(0);

    const isActiveRef = useRef(false);

    const cleanup = useCallback(() => {
        isActiveRef.current = false;

        if (workletNodeRef.current) {
            workletNodeRef.current.disconnect();
            workletNodeRef.current = null;
        }
        if (sourceRef.current) {
            sourceRef.current.disconnect();
            sourceRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close().catch(() => { });
            audioContextRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(t => t.stop());
            mediaStreamRef.current = null;
        }
        if (playbackContextRef.current) {
            playbackContextRef.current.close().catch(() => { });
            playbackContextRef.current = null;
        }
        nextPlayTimeRef.current = 0;
        accumulatedRef.current = new Int16Array(0);
    }, []);

    // Socket connection
    useEffect(() => {
        const socket = io(BACKEND_URL, {
            transports: ['websocket'],
            autoConnect: true
        });

        socket.on('connect', () => {
            console.log('[GeminiLive] Socket connected to backend');
        });

        socket.on('connect_error', (err) => {
            console.error('[GeminiLive] Socket connect error:', err.message);
        });

        socket.on('voice:status', (data: { state: string; message?: string }) => {
            console.log('[GeminiLive] Status:', data.state, data.message || '');
            setSessionState(data.state as SessionState);
            if (data.state === 'error') {
                setErrorMessage(data.message || 'Unknown error');
            }
        });

        socket.on('voice:audio', (base64Data: string) => {
            playAudioChunk(base64Data);
        });

        socket.on('voice:speaking', (speaking: boolean) => {
            setIsModelSpeaking(speaking);
        });

        socket.on('voice:interrupted', () => {
            setIsModelSpeaking(false);
            stopPlayback();
        });

        socket.on('voice:turnComplete', () => {
            setIsModelSpeaking(false);
            setUserTranscript('');
        });

        socket.on('voice:transcript', (data: { type: 'user' | 'ai'; text: string }) => {
            if (data.type === 'user') {
                setUserTranscript(prev => prev + data.text);
                setAiTranscript('');
            } else {
                setAiTranscript(prev => prev + data.text);
            }
        });

        socket.on('voice:tool', (data: ToolCallInfo) => {
            setToolCall(data);
            if (data.status === 'completed' || data.status === 'cancelled') {
                setTimeout(() => setToolCall(null), 3000);
            }
        });

        socketRef.current = socket;

        return () => {
            socket.disconnect();
            cleanup();
        };
    }, [cleanup]);

    // Float32 to Int16 (matching VisionClaw AudioManager)
    const float32ToInt16 = useCallback((float32Array: Float32Array): Int16Array => {
        const int16 = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return int16;
    }, []);

    // Resample to 16kHz
    const resample = useCallback((inputData: Float32Array, inputRate: number, outputRate: number): Float32Array => {
        if (inputRate === outputRate) return inputData;
        const ratio = inputRate / outputRate;
        const outputLength = Math.round(inputData.length / ratio);
        const output = new Float32Array(outputLength);
        for (let i = 0; i < outputLength; i++) {
            const srcIndex = i * ratio;
            const srcIndexFloor = Math.floor(srcIndex);
            const frac = srcIndex - srcIndexFloor;
            const a = inputData[srcIndexFloor] || 0;
            const b = inputData[Math.min(srcIndexFloor + 1, inputData.length - 1)] || 0;
            output[i] = a + (b - a) * frac;
        }
        return output;
    }, []);

    // Send accumulated audio to backend
    const sendAccumulated = useCallback(() => {
        if (!socketRef.current || !isActiveRef.current) return;
        const acc = accumulatedRef.current;
        if (acc.length * 2 >= MIN_SEND_BYTES) {
            const buffer = new Uint8Array(acc.buffer, acc.byteOffset, acc.byteLength);
            let binary = '';
            for (let i = 0; i < buffer.length; i++) {
                binary += String.fromCharCode(buffer[i]);
            }
            const base64 = btoa(binary);
            socketRef.current.emit('voice:audio', base64);
            accumulatedRef.current = new Int16Array(0);
        }
    }, []);

    // Play PCM audio from Gemini (24kHz Int16 mono)
    const playAudioChunk = useCallback((base64Data: string) => {
        if (!playbackContextRef.current) {
            playbackContextRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
        }
        const ctx = playbackContextRef.current;

        const binary = atob(base64Data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        const int16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
            float32[i] = int16[i] / 32768;
        }

        const audioBuffer = ctx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
        audioBuffer.copyToChannel(float32, 0);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        const now = ctx.currentTime;
        const startTime = Math.max(now, nextPlayTimeRef.current);
        source.start(startTime);
        nextPlayTimeRef.current = startTime + audioBuffer.duration;
    }, []);

    const stopPlayback = useCallback(() => {
        if (playbackContextRef.current) {
            playbackContextRef.current.close().catch(() => { });
            playbackContextRef.current = null;
        }
        nextPlayTimeRef.current = 0;
    }, []);

    const startSession = useCallback(async () => {
        if (!socketRef.current) return;

        setErrorMessage('');
        setUserTranscript('');
        setAiTranscript('');
        setToolCall(null);
        setSessionState('connecting');
        isActiveRef.current = true;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: { ideal: INPUT_SAMPLE_RATE },
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            mediaStreamRef.current = stream;

            const audioCtx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
            audioContextRef.current = audioCtx;

            const source = audioCtx.createMediaStreamSource(stream);
            sourceRef.current = source;

            // Use AudioWorklet for mic capture (replaces deprecated ScriptProcessorNode)
            // Register inline worklet processor via Blob URL
            const workletCode = `
                class PcmCaptureProcessor extends AudioWorkletProcessor {
                    constructor() {
                        super();
                    }
                    process(inputs) {
                        const input = inputs[0];
                        if (input && input[0] && input[0].length > 0) {
                            this.port.postMessage(input[0]);
                        }
                        return true;
                    }
                }
                registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
            `;
            const blob = new Blob([workletCode], { type: 'application/javascript' });
            const workletUrl = URL.createObjectURL(blob);

            await audioCtx.audioWorklet.addModule(workletUrl);
            URL.revokeObjectURL(workletUrl);

            const workletNode = new AudioWorkletNode(audioCtx, 'pcm-capture-processor');
            workletNodeRef.current = workletNode;

            workletNode.port.onmessage = (e) => {
                if (!isActiveRef.current) return;
                const floatData: Float32Array = e.data;

                // Resample to 16kHz if needed
                const resampled = audioCtx.sampleRate !== INPUT_SAMPLE_RATE
                    ? resample(floatData, audioCtx.sampleRate, INPUT_SAMPLE_RATE)
                    : floatData;

                const int16 = float32ToInt16(resampled);

                // Accumulate into ~100ms chunks
                const prev = accumulatedRef.current;
                const merged = new Int16Array(prev.length + int16.length);
                merged.set(prev);
                merged.set(int16, prev.length);
                accumulatedRef.current = merged;

                sendAccumulated();
            };

            source.connect(workletNode);
            workletNode.connect(audioCtx.destination);

            // Setup playback context
            playbackContextRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });

            // Tell backend to start Gemini session
            socketRef.current.emit('voice:start');

        } catch (err: any) {
            console.error('[GeminiLive] Start error:', err);
            setErrorMessage(err.message || 'Microphone access denied');
            setSessionState('error');
            isActiveRef.current = false;
        }
    }, [float32ToInt16, resample, sendAccumulated]);

    const stopSession = useCallback(() => {
        if (socketRef.current) {
            socketRef.current.emit('voice:stop');
        }
        cleanup();
        setSessionState('disconnected');
        setIsModelSpeaking(false);
        setUserTranscript('');
        setAiTranscript('');
        setToolCall(null);
    }, [cleanup]);

    return {
        sessionState,
        isModelSpeaking,
        userTranscript,
        aiTranscript,
        toolCall,
        errorMessage,
        startSession,
        stopSession,
    };
}
