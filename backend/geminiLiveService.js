const WebSocket = require('ws');
const mongoose = require('mongoose');
const { getApiKey } = require('./configService');
const cassandraMem = require('./services/cassandra');

/**
 * Gemini Live Service
 * Port of VisionClaw's GeminiLiveService.swift to Node.js
 * Real-time bidirectional audio streaming via Gemini Live API WebSocket
 */

const GEMINI_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const GEMINI_MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';

// System prompt adapted from VisionClaw for orchestrator capabilities
const VOICE_SYSTEM_PROMPT = `You are an AI assistant having a real-time voice conversation. Keep responses concise, natural, and conversational. You speak the same language as the user (Romanian or English).

MEMORY: You have persistent memory across sessions. Relevant facts, preferences, and recent conversation turns are injected into your context inside blocks like [MEMORY_RELEVANT], [PRIOR_TURNS_RELEVANT], and [RECENT_TURNS]. Use them naturally — do NOT recite them verbatim, do NOT mention the blocks themselves. Treat them as things you already know about the user.

When the user tells you a new durable fact about themselves, their preferences, goals, or projects, acknowledge briefly and continue — a background consolidator will persist it automatically. Do not call execute just to save memory.

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
    constructor(socketClient, onToolCall, options = {}) {
        this.socketClient = socketClient;
        this.onToolCall = onToolCall;
        this.ws = null;
        this.state = 'disconnected'; // disconnected, connecting, settingUp, ready
        this.isModelSpeaking = false;
        this.sessionId = options.sessionId || `voice-${Date.now()}`;
        this.bootstrapContext = '';
        this.lastUserTranscript = '';
    }

    async buildBootstrapMemory() {
        try {
            if (!cassandraMem.isReady()) return '';
            return await cassandraMem.buildContextBlock(this.sessionId, '', {
                memoryK: 10,
                turnK: 0,
                recentTurns: 6,
            });
        } catch (err) {
            console.warn('[GeminiLive] Bootstrap memory failed:', err.message);
            return '';
        }
    }

    // Mid-session recall is available but not auto-injected — it would show in user
    // transcripts and confuse the model. If needed, the orchestrator reaches memory
    // via the `execute` tool path, which already calls buildContextBlock.

    async persistTurn(role, text) {
        try {
            if (!cassandraMem.isReady() || !text) return;
            await cassandraMem.saveConversation(this.sessionId, role, text, 'voice', []);
        } catch (err) {
            console.warn('[GeminiLive] persistTurn failed:', err.message);
        }
    }

    async connect() {
        let apiKey;
        try {
            apiKey = await getApiKey('gemini_api_key');
        } catch {
            this.emitStatus('error', 'Gemini API key not configured');
            return false;
        }

        this.bootstrapContext = await this.buildBootstrapMemory();

        const url = `${GEMINI_WS_URL}?key=${apiKey}`;
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
        const systemText = this.bootstrapContext
            ? `${VOICE_SYSTEM_PROMPT}\n\n--- SESSION CONTEXT (persistent memory) ---\n${this.bootstrapContext}`
            : VOICE_SYSTEM_PROMPT;

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
                    parts: [{ text: systemText }]
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

            // Turn complete — state + emit (persistence handled after transcripts below)
            const turnJustCompleted = !!sc.turnComplete;
            if (turnJustCompleted) {
                this.isModelSpeaking = false;
                this.socketClient.emit('voice:speaking', false);
                this.socketClient.emit('voice:turnComplete');
            }

            // Input transcription (what user said)
            if (sc.inputTranscription && sc.inputTranscription.text) {
                const userText = sc.inputTranscription.text;
                this.socketClient.emit('voice:transcript', {
                    type: 'user',
                    text: userText
                });
                this.lastUserTranscript = (this.lastUserTranscript + ' ' + userText).slice(-800).trim();
            }

            // Output transcription (what AI said)
            if (sc.outputTranscription && sc.outputTranscription.text) {
                this.socketClient.emit('voice:transcript', {
                    type: 'ai',
                    text: sc.outputTranscription.text
                });
                this._pendingAiText = (this._pendingAiText || '') + sc.outputTranscription.text;
            }

            if (turnJustCompleted) {
                if (this.lastUserTranscript) {
                    this.persistTurn('user', this.lastUserTranscript).catch(() => {});
                    this.lastUserTranscript = '';
                }
                if (this._pendingAiText) {
                    this.persistTurn('assistant', this._pendingAiText).catch(() => {});
                    this._pendingAiText = '';
                }
            }
        }
    }

    emitStatus(state, message) {
        this.socketClient.emit('voice:status', { state, message });
    }
}

module.exports = { GeminiLiveSession };
