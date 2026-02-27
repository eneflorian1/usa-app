'use client';

import { useState, useRef, useCallback } from 'react';

type SessionState = 'disconnected' | 'connecting' | 'settingUp' | 'ready' | 'error';

interface ToolCallInfo {
    status: 'executing' | 'completed' | 'cancelled';
    name: string;
    task?: string;
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

const GEMINI_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const GEMINI_MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const MIN_SEND_BYTES = 3200; // 100ms at 16kHz mono Int16

// VisionClaw system prompt adapted for orchestrator
const VOICE_SYSTEM_PROMPT = `You are an AI assistant having a real-time voice conversation. Keep responses concise, natural, and conversational. You speak the same language as the user (Romanian or English).

CRITICAL: You have NO memory, NO storage, and NO ability to take actions on your own. You cannot remember things, keep lists, set reminders, search the web, send messages, or do anything persistent. You are ONLY a voice interface.

You have exactly ONE tool: execute. This connects you to a powerful personal assistant (the orchestrator) that can do anything:
- Create bookings/reservations (specify guest name, check-in, check-out dates)
- Create and manage tasks/planner items (specify title, description, due date, priority)
- GitHub operations (list/create issues, PRs, CI status, repo info)
- Schedule cron jobs and recurring reminders
- Coding tasks (analyze code, execute fixes, review PRs)
- Auto-fix GitHub issues
- Manage background processes
- Send WhatsApp messages

ALWAYS use execute when the user asks you to do anything beyond just answering a question. Be detailed in your task description — include all relevant context: names, dates, content, platforms, etc.

NEVER pretend to do these things yourself.

IMPORTANT: Before calling execute, ALWAYS speak a brief acknowledgment first. For example:
- "Sure, let me create that task for you." then call execute.
- "Got it, creating that booking now." then call execute.
Never call execute silently — the user needs verbal confirmation.`;

const TOOL_DECLARATIONS = [{
    name: 'execute',
    description: 'Your only way to take action. Use this tool for everything: creating bookings, managing tasks, GitHub operations, scheduling cron jobs, coding tasks, sending WhatsApp messages, or any request that goes beyond answering a question.',
    parameters: {
        type: 'object',
        properties: {
            task: {
                type: 'string',
                description: 'Clear, detailed description of what to do. Include all relevant context.'
            }
        },
        required: ['task']
    },
    behavior: 'BLOCKING'
}];

export function useGeminiLive(): UseGeminiLiveReturn {
    const [sessionState, setSessionState] = useState<SessionState>('disconnected');
    const [isModelSpeaking, setIsModelSpeaking] = useState(false);
    const [userTranscript, setUserTranscript] = useState('');
    const [aiTranscript, setAiTranscript] = useState('');
    const [toolCall, setToolCall] = useState<ToolCallInfo | null>(null);
    const [errorMessage, setErrorMessage] = useState('');

    const wsRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const workletNodeRef = useRef<AudioWorkletNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const accumulatedRef = useRef<Int16Array>(new Int16Array(0));
    const playbackContextRef = useRef<AudioContext | null>(null);
    const nextPlayTimeRef = useRef(0);
    const isActiveRef = useRef(false);
    const isModelSpeakingRef = useRef(false);

    // Float32 → Int16 (VisionClaw AudioManager)
    const float32ToInt16 = useCallback((f32: Float32Array): Int16Array => {
        const i16 = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
            const s = Math.max(-1, Math.min(1, f32[i]));
            i16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return i16;
    }, []);

    // Resample to 16kHz
    const resample = useCallback((input: Float32Array, inRate: number, outRate: number): Float32Array => {
        if (inRate === outRate) return input;
        const ratio = inRate / outRate;
        const len = Math.round(input.length / ratio);
        const out = new Float32Array(len);
        for (let i = 0; i < len; i++) {
            const idx = i * ratio;
            const floor = Math.floor(idx);
            const frac = idx - floor;
            out[i] = (input[floor] || 0) * (1 - frac) + (input[Math.min(floor + 1, input.length - 1)] || 0) * frac;
        }
        return out;
    }, []);

    // Play PCM audio chunk from Gemini (24kHz Int16 mono)
    const playAudioChunk = useCallback((base64Data: string) => {
        if (!playbackContextRef.current) {
            playbackContextRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
        }
        const ctx = playbackContextRef.current;
        const binary = atob(base64Data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const int16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

        const buf = ctx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
        buf.copyToChannel(float32, 0);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        const now = ctx.currentTime;
        const startTime = Math.max(now, nextPlayTimeRef.current);
        src.start(startTime);
        nextPlayTimeRef.current = startTime + buf.duration;
    }, []);

    const stopPlayback = useCallback(() => {
        if (playbackContextRef.current) {
            playbackContextRef.current.close().catch(() => { });
            playbackContextRef.current = null;
        }
        nextPlayTimeRef.current = 0;
    }, []);

    // Send accumulated PCM to Gemini WebSocket
    const sendAccumulated = useCallback(() => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !isActiveRef.current) return;
        const acc = accumulatedRef.current;
        if (acc.length * 2 >= MIN_SEND_BYTES) {
            const buffer = new Uint8Array(acc.buffer, acc.byteOffset, acc.byteLength);
            let binary = '';
            for (let i = 0; i < buffer.length; i++) binary += String.fromCharCode(buffer[i]);
            const base64 = btoa(binary);
            wsRef.current.send(JSON.stringify({
                realtimeInput: {
                    audio: { mimeType: 'audio/pcm;rate=16000', data: base64 }
                }
            }));
            accumulatedRef.current = new Int16Array(0);
        }
    }, []);

    // Handle tool call — route through orchestrator API
    const handleToolCall = useCallback(async (callId: string, name: string, args: Record<string, unknown>) => {
        const taskDesc = (args.task as string) || JSON.stringify(args);
        setToolCall({ status: 'executing', name, task: taskDesc.substring(0, 80) });

        try {
            const res = await fetch('/api/orchestrator/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: taskDesc }),
            });
            const data = await res.json();
            const result = data.reply || 'Done';

            // Send tool response back to Gemini
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                    toolResponse: {
                        functionResponses: [{
                            id: callId,
                            name: name,
                            response: { result }
                        }]
                    }
                }));
            }
            setToolCall({ status: 'completed', name, task: taskDesc.substring(0, 80) });
            setTimeout(() => setToolCall(null), 3000);
        } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : 'Unknown error';
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                    toolResponse: {
                        functionResponses: [{
                            id: callId,
                            name: name,
                            response: { error: errMsg }
                        }]
                    }
                }));
            }
            setToolCall({ status: 'cancelled', name });
            setTimeout(() => setToolCall(null), 3000);
        }
    }, []);

    // Handle incoming WebSocket messages from Gemini
    const handleGeminiMessage = useCallback((json: Record<string, unknown>) => {
        // Setup complete
        if ('setupComplete' in json) {
            console.log('[GeminiLive] Setup complete — ready');
            setSessionState('ready');
            return;
        }

        // GoAway
        if (json.goAway) {
            const ga = json.goAway as Record<string, unknown>;
            const tl = ga.timeLeft as Record<string, unknown> | undefined;
            const seconds = tl?.seconds || 0;
            console.log(`[GeminiLive] GoAway — ${seconds}s`);
            setSessionState('disconnected');
            setIsModelSpeaking(false);
            isModelSpeakingRef.current = false;
            return;
        }

        // Tool call
        if (json.toolCall) {
            const tc = json.toolCall as Record<string, unknown>;
            const calls = (tc.functionCalls || []) as Array<Record<string, unknown>>;
            for (const call of calls) {
                handleToolCall(
                    call.id as string,
                    call.name as string,
                    (call.args || {}) as Record<string, unknown>
                );
            }
            return;
        }

        // Tool cancellation
        if (json.toolCallCancellation) {
            setToolCall(prev => prev ? { ...prev, status: 'cancelled' } : null);
            setTimeout(() => setToolCall(null), 2000);
            return;
        }

        // Server content
        if (json.serverContent) {
            const sc = json.serverContent as Record<string, unknown>;

            if (sc.interrupted) {
                setIsModelSpeaking(false);
                isModelSpeakingRef.current = false;
                stopPlayback();
                return;
            }

            if (sc.modelTurn) {
                const mt = sc.modelTurn as Record<string, unknown>;
                const parts = (mt.parts || []) as Array<Record<string, unknown>>;
                for (const part of parts) {
                    if (part.inlineData) {
                        const id = part.inlineData as Record<string, unknown>;
                        if ((id.mimeType as string)?.startsWith('audio/pcm') && id.data) {
                            if (!isModelSpeakingRef.current) {
                                isModelSpeakingRef.current = true;
                                setIsModelSpeaking(true);
                            }
                            playAudioChunk(id.data as string);
                        }
                    }
                }
            }

            if (sc.turnComplete) {
                setIsModelSpeaking(false);
                isModelSpeakingRef.current = false;
                setUserTranscript('');
            }

            if (sc.inputTranscription) {
                const it = sc.inputTranscription as Record<string, unknown>;
                if (it.text) {
                    setUserTranscript(prev => prev + (it.text as string));
                    setAiTranscript('');
                }
            }
            if (sc.outputTranscription) {
                const ot = sc.outputTranscription as Record<string, unknown>;
                if (ot.text) {
                    setAiTranscript(prev => prev + (ot.text as string));
                }
            }
        }
    }, [handleToolCall, playAudioChunk, stopPlayback]);

    const cleanup = useCallback(() => {
        isActiveRef.current = false;
        if (workletNodeRef.current) { workletNodeRef.current.disconnect(); workletNodeRef.current = null; }
        if (sourceRef.current) { sourceRef.current.disconnect(); sourceRef.current = null; }
        if (audioContextRef.current) { audioContextRef.current.close().catch(() => { }); audioContextRef.current = null; }
        if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach(t => t.stop()); mediaStreamRef.current = null; }
        if (playbackContextRef.current) { playbackContextRef.current.close().catch(() => { }); playbackContextRef.current = null; }
        if (wsRef.current) { try { wsRef.current.close(); } catch { } wsRef.current = null; }
        nextPlayTimeRef.current = 0;
        accumulatedRef.current = new Int16Array(0);
    }, []);

    const startSession = useCallback(async () => {
        setErrorMessage('');
        setUserTranscript('');
        setAiTranscript('');
        setToolCall(null);
        setSessionState('connecting');
        isActiveRef.current = true;

        try {
            // 1. Get API key from backend
            const configRes = await fetch('/api/voice/config');
            if (!configRes.ok) {
                const err = await configRes.json();
                throw new Error(err.error || 'Failed to get voice config');
            }
            const { apiKey } = await configRes.json();

            // 2. Request mic access
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

            // 3. Setup mic capture via AudioWorklet
            const audioCtx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
            audioContextRef.current = audioCtx;
            const source = audioCtx.createMediaStreamSource(stream);
            sourceRef.current = source;

            const workletCode = `
                class PcmCaptureProcessor extends AudioWorkletProcessor {
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
                const resampled = audioCtx.sampleRate !== INPUT_SAMPLE_RATE
                    ? resample(floatData, audioCtx.sampleRate, INPUT_SAMPLE_RATE)
                    : floatData;
                const int16 = float32ToInt16(resampled);
                const prev = accumulatedRef.current;
                const merged = new Int16Array(prev.length + int16.length);
                merged.set(prev);
                merged.set(int16, prev.length);
                accumulatedRef.current = merged;
                sendAccumulated();
            };

            source.connect(workletNode);
            workletNode.connect(audioCtx.destination);

            // 4. Setup playback
            playbackContextRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });

            // 5. Connect WebSocket directly to Gemini Live API
            setSessionState('settingUp');
            const wsUrl = `${GEMINI_WS_URL}?key=${apiKey}`;
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log('[GeminiLive] WebSocket connected to Gemini');
                // Send setup message (identical to VisionClaw)
                ws.send(JSON.stringify({
                    setup: {
                        model: GEMINI_MODEL,
                        generationConfig: {
                            responseModalities: ['AUDIO'],
                            thinkingConfig: { thinkingBudget: 0 }
                        },
                        systemInstruction: {
                            parts: [{ text: VOICE_SYSTEM_PROMPT }]
                        },
                        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
                        realtimeInputConfig: {
                            automaticActivityDetection: {
                                disabled: false,
                                startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
                                endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
                                silenceDurationMs: 500,
                                prefixPaddingMs: 40
                            },
                            activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
                            turnCoverage: 'TURN_INCLUDES_ALL_INPUT'
                        },
                        inputAudioTranscription: {},
                        outputAudioTranscription: {}
                    }
                }));
            };

            ws.onmessage = (event) => {
                try {
                    const json = JSON.parse(event.data as string);
                    handleGeminiMessage(json);
                } catch (err) {
                    console.error('[GeminiLive] Parse error:', err);
                }
            };

            ws.onclose = (event) => {
                console.log(`[GeminiLive] WebSocket closed: ${event.code}`);
                if (isActiveRef.current) {
                    setSessionState('disconnected');
                    setIsModelSpeaking(false);
                    isModelSpeakingRef.current = false;
                }
            };

            ws.onerror = (event) => {
                console.error('[GeminiLive] WebSocket error:', event);
                setErrorMessage('WebSocket connection failed');
                setSessionState('error');
            };

        } catch (err: unknown) {
            console.error('[GeminiLive] Start error:', err);
            setErrorMessage(err instanceof Error ? err.message : 'Failed to start voice session');
            setSessionState('error');
            isActiveRef.current = false;
            cleanup();
        }
    }, [float32ToInt16, resample, sendAccumulated, handleGeminiMessage, cleanup]);

    const stopSession = useCallback(() => {
        cleanup();
        setSessionState('disconnected');
        setIsModelSpeaking(false);
        isModelSpeakingRef.current = false;
        setUserTranscript('');
        setAiTranscript('');
        setToolCall(null);
    }, [cleanup]);

    return {
        sessionState, isModelSpeaking, userTranscript, aiTranscript,
        toolCall, errorMessage, startSession, stopSession,
    };
}
