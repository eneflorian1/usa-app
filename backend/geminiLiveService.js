const WebSocket = require('ws');
const mongoose = require('mongoose');

/**
 * Gemini Live Service
 * Port of VisionClaw's GeminiLiveService.swift to Node.js
 * Real-time bidirectional audio streaming via Gemini Live API WebSocket
 */

const GEMINI_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const GEMINI_MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';

// System prompt adapted from VisionClaw for orchestrator capabilities
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
- Search knowledge base

ALWAYS use execute when the user asks you to do anything beyond just answering a question. Be detailed in your task description — include all relevant context: names, dates, content, platforms, etc.

NEVER pretend to do these things yourself.

IMPORTANT: Before calling execute, ALWAYS speak a brief acknowledgment first. For example:
- "Sure, let me create that task for you." then call execute.
- "Got it, creating that booking now." then call execute.
- "On it, checking the GitHub issues." then call execute.
Never call execute silently — the user needs verbal confirmation that you heard them and are working on it. The tool may take several seconds to complete, so the acknowledgment lets them know something is happening.`;

const TOOL_DECLARATIONS = [
    {
        name: 'execute',
        description: 'Your only way to take action. You have no memory, storage, or ability to do anything on your own — use this tool for everything: creating bookings, managing tasks, GitHub operations, scheduling cron jobs, coding tasks, sending WhatsApp messages, or any request that goes beyond answering a question. When in doubt, use this tool.',
        parameters: {
            type: 'object',
            properties: {
                task: {
                    type: 'string',
                    description: 'Clear, detailed description of what to do. Include all relevant context: names, dates, content, quantities, etc.'
                }
            },
            required: ['task']
        },
        behavior: 'BLOCKING'
    }
];

class GeminiLiveSession {
    constructor(socketClient, onToolCall) {
        this.socketClient = socketClient;
        this.onToolCall = onToolCall;
        this.ws = null;
        this.state = 'disconnected'; // disconnected, connecting, settingUp, ready
        this.isModelSpeaking = false;
    }

    async connect() {
        const Setting = mongoose.model('Setting');
        const setting = await Setting.findOne({ key: 'gemini_api_key' });
        if (!setting || !setting.value) {
            this.emitStatus('error', 'Gemini API key not configured');
            return false;
        }

        const url = `${GEMINI_WS_URL}?key=${setting.value}`;
        this.state = 'connecting';
        this.emitStatus('connecting');

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                if (this.state === 'connecting' || this.state === 'settingUp') {
                    this.emitStatus('error', 'Connection timed out');
                    this.disconnect();
                    resolve(false);
                }
            }, 15000);

            this.ws = new WebSocket(url);

            this.ws.on('open', () => {
                console.log('[GeminiLive] WebSocket connected');
                this.state = 'settingUp';
                this.emitStatus('settingUp');
                this.sendSetupMessage();
            });

            this.ws.on('message', (data) => {
                try {
                    const text = data.toString('utf8');
                    const json = JSON.parse(text);
                    this.handleMessage(json, resolve, timeout);
                } catch (err) {
                    console.error('[GeminiLive] Parse error:', err.message);
                }
            });

            this.ws.on('close', (code, reason) => {
                console.log(`[GeminiLive] WebSocket closed: ${code} ${reason}`);
                clearTimeout(timeout);
                this.state = 'disconnected';
                this.isModelSpeaking = false;
                this.emitStatus('disconnected', `Connection closed (${code})`);
                resolve(false);
            });

            this.ws.on('error', (err) => {
                console.error('[GeminiLive] WebSocket error:', err.message);
                clearTimeout(timeout);
                this.state = 'disconnected';
                this.emitStatus('error', err.message);
                resolve(false);
            });
        });
    }

    disconnect() {
        if (this.ws) {
            try { this.ws.close(); } catch { }
            this.ws = null;
        }
        this.state = 'disconnected';
        this.isModelSpeaking = false;
    }

    sendAudio(base64Data) {
        if (this.state !== 'ready' || !this.ws) return;
        this.sendJSON({
            realtimeInput: {
                audio: {
                    mimeType: 'audio/pcm;rate=16000',
                    data: base64Data
                }
            }
        });
    }

    sendToolResponse(callId, name, result) {
        this.sendJSON({
            toolResponse: {
                functionResponses: [
                    {
                        id: callId,
                        name: name,
                        response: result
                    }
                ]
            }
        });
    }

    // Private methods

    sendSetupMessage() {
        const setup = {
            setup: {
                model: GEMINI_MODEL,
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    thinkingConfig: {
                        thinkingBudget: 0
                    }
                },
                systemInstruction: {
                    parts: [{ text: VOICE_SYSTEM_PROMPT }]
                },
                tools: [
                    {
                        functionDeclarations: TOOL_DECLARATIONS
                    }
                ],
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
        };
        this.sendJSON(setup);
    }

    sendJSON(json) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(json));
        }
    }

    handleMessage(json, resolveConnect, connectTimeout) {
        // Setup complete
        if (json.setupComplete !== undefined) {
            console.log('[GeminiLive] Setup complete — ready');
            clearTimeout(connectTimeout);
            this.state = 'ready';
            this.emitStatus('ready');
            resolveConnect(true);
            return;
        }

        // GoAway
        if (json.goAway) {
            const seconds = json.goAway?.timeLeft?.seconds || 0;
            console.log(`[GeminiLive] GoAway — server closing in ${seconds}s`);
            this.emitStatus('disconnected', `Server closing (${seconds}s)`);
            this.disconnect();
            return;
        }

        // Tool call
        if (json.toolCall) {
            const calls = json.toolCall.functionCalls || [];
            console.log(`[GeminiLive] Tool call: ${calls.length} function(s)`);
            for (const call of calls) {
                this.socketClient.emit('voice:tool', {
                    status: 'executing',
                    name: call.name,
                    task: call.args?.task || ''
                });

                if (this.onToolCall) {
                    this.onToolCall(call, (result) => {
                        this.sendToolResponse(call.id, call.name, result);
                        this.socketClient.emit('voice:tool', {
                            status: 'completed',
                            name: call.name,
                            result: JSON.stringify(result).substring(0, 200)
                        });
                    });
                }
            }
            return;
        }

        // Tool call cancellation
        if (json.toolCallCancellation) {
            const ids = json.toolCallCancellation.ids || [];
            console.log(`[GeminiLive] Tool call cancellation: ${ids.join(', ')}`);
            this.socketClient.emit('voice:tool', { status: 'cancelled', ids });
            return;
        }

        // Server content
        if (json.serverContent) {
            const sc = json.serverContent;

            // Interrupted
            if (sc.interrupted) {
                this.isModelSpeaking = false;
                this.socketClient.emit('voice:interrupted');
                return;
            }

            // Model turn — audio data
            if (sc.modelTurn && sc.modelTurn.parts) {
                for (const part of sc.modelTurn.parts) {
                    if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.startsWith('audio/pcm')) {
                        if (!this.isModelSpeaking) {
                            this.isModelSpeaking = true;
                            this.socketClient.emit('voice:speaking', true);
                        }
                        // Forward audio to browser
                        this.socketClient.emit('voice:audio', part.inlineData.data);
                    }
                }
            }

            // Turn complete
            if (sc.turnComplete) {
                this.isModelSpeaking = false;
                this.socketClient.emit('voice:speaking', false);
                this.socketClient.emit('voice:turnComplete');
            }

            // Input transcription (what user said)
            if (sc.inputTranscription && sc.inputTranscription.text) {
                this.socketClient.emit('voice:transcript', {
                    type: 'user',
                    text: sc.inputTranscription.text
                });
            }

            // Output transcription (what AI said)
            if (sc.outputTranscription && sc.outputTranscription.text) {
                this.socketClient.emit('voice:transcript', {
                    type: 'ai',
                    text: sc.outputTranscription.text
                });
            }
        }
    }

    emitStatus(state, message) {
        this.socketClient.emit('voice:status', { state, message });
    }
}

module.exports = { GeminiLiveSession };
