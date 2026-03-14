'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useGeminiLive } from '@/hooks/useGeminiLive';

interface Message {
    role: 'user' | 'model';
    content: string;
    agent?: string;
    execId?: string;
    execStatus?: 'pending' | 'running' | 'done' | 'error';
    execOutput?: string;
    execExitCode?: number | null;
}

interface OrchestratorResponse {
    agent: string;
    reasoning: string;
    reply: string;
    booking: { success: boolean; error?: string; booking?: { _id: string; guestName: string; checkIn: string; checkOut: string } } | null;
    tasks: Array<{ _id: string; title: string; priority: string; dueDate: string }> | null;
    localExec: { success: boolean; id?: string; command?: string; label?: string; status?: string; type?: string; error?: string } | null;
    coding: { success: boolean; sessionId?: string; status?: string; message?: string; error?: string } | null;
    terminalTask: { success: boolean; status?: string; task?: string; report?: string; error?: string } | null;
}

const agentLabels: Record<string, { label: string; color: string; icon: string }> = {
    booking: { label: 'Booking Agent', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', icon: '🏨' },
    planner: { label: 'Planner Agent', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300', icon: '📋' },
    info: { label: 'Knowledge Base', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', icon: '📚' },
    escalate: { label: 'Escalated', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', icon: '🚨' },
    general: { label: 'General', color: 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-300', icon: '💬' },
    'local-exec': { label: 'Local PC', color: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300', icon: '🖥️' },
    screenshot: { label: 'Screenshot', color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300', icon: '📸' },
    sysinfo: { label: 'System Info', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300', icon: '⚙️' },
    filesystem: { label: 'Filesystem', color: 'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300', icon: '📁' },
    clipboard: { label: 'Clipboard', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300', icon: '📋' },
    launcher: { label: 'Launcher', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300', icon: '🚀' },
    coding: { label: 'Coding Agent', color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300', icon: '💻' },
    'terminal-task': { label: 'Terminal Task', color: 'bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-300', icon: '⚡' },
};

export default function OrchestratorPage() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [loading, setLoading] = useState(true);
    const [voiceMode, setVoiceMode] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const pendingExecRef = useRef<Set<string>>(new Set());
    const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

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

    useEffect(() => { loadHistory(); }, []);
    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

    // Poll pending exec commands for results
    const pollPendingExecs = useCallback(async () => {
        const ids = Array.from(pendingExecRef.current);
        if (ids.length === 0) return;

        for (const id of ids) {
            try {
                const res = await fetch(`/api/local-exec/${id}`);
                if (!res.ok) continue;
                const cmd = await res.json();
                if (cmd.status === 'done' || cmd.status === 'error') {
                    pendingExecRef.current.delete(id);
                    setMessages(prev => prev.map(msg =>
                        msg.execId === id
                            ? {
                                ...msg,
                                execStatus: cmd.status,
                                execOutput: cmd.output || '',
                                execExitCode: cmd.exitCode,
                                content: cmd.status === 'done'
                                    ? `✅ ${msg.content.replace(/^⏳ /, '').replace(/\n.*$/, '')}\n${formatExecOutput(cmd.output)}`
                                    : `❌ ${msg.content.replace(/^⏳ /, '').replace(/\n.*$/, '')}\nExit ${cmd.exitCode}: ${cmd.output || 'No output'}`
                            }
                            : msg
                    ));
                } else if (cmd.status === 'running') {
                    setMessages(prev => prev.map(msg =>
                        msg.execId === id && msg.execStatus !== 'running'
                            ? { ...msg, execStatus: 'running', content: msg.content.replace('⏳ Pending', '⚡ Running') }
                            : msg
                    ));
                }
            } catch { }
        }
    }, []);

    useEffect(() => {
        pollIntervalRef.current = setInterval(pollPendingExecs, 3000);
        return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); };
    }, [pollPendingExecs]);

    const loadHistory = async () => {
        try {
            const res = await fetch('/api/orchestrator/chat/history');
            const data = await res.json();
            if (Array.isArray(data)) setMessages(data);
        } catch { }
        setLoading(false);
    };

    const handleSend = async () => {
        if (!input.trim() || sending) return;
        const userMsg = input.trim();
        setInput('');
        setSending(true);
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);

        try {
            const res = await fetch('/api/orchestrator/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userMsg }),
            });
            const data: OrchestratorResponse = await res.json();

            setMessages(prev => [...prev, {
                role: 'model',
                content: data.reply,
                agent: data.agent
            }]);

            if (data.booking?.success && data.booking.booking) {
                const b = data.booking.booking;
                setMessages(prev => [...prev, {
                    role: 'model',
                    agent: 'booking',
                    content: `✅ BOOKING CONFIRMED\n📋 Guest: ${b.guestName}\n📥 Check-in: ${new Date(b.checkIn).toLocaleDateString('ro-RO')} ${new Date(b.checkIn).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}\n📤 Check-out: ${new Date(b.checkOut).toLocaleDateString('ro-RO')} ${new Date(b.checkOut).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}`
                }]);
            } else if (data.booking && !data.booking.success) {
                setMessages(prev => [...prev, { role: 'model', agent: 'booking', content: `❌ BOOKING FAILED\n${data.booking?.error}` }]);
            }

            if (data.tasks && data.tasks.length > 0) {
                for (const t of data.tasks) {
                    setMessages(prev => [...prev, {
                        role: 'model',
                        agent: 'planner',
                        content: `✅ TASK CREATED\n📝 ${t.title}\n⚡ Priority: ${t.priority}\n📅 Due: ${t.dueDate ? new Date(t.dueDate).toLocaleDateString('ro-RO') : 'No deadline'}`
                    }]);
                }
            }

            // Handle localExec results (shell commands, MCP tools: screenshot, sysinfo, etc.)
            if (data.localExec) {
                if (data.localExec.success && data.localExec.id) {
                    const execAgent = data.agent || 'local-exec';
                    const label = data.localExec.label || data.localExec.command || 'Command';
                    pendingExecRef.current.add(data.localExec.id);
                    setMessages(prev => [...prev, {
                        role: 'model',
                        agent: execAgent,
                        content: `⏳ Pending: ${label}\n🖥️ Queued on local PC — waiting for agent...`,
                        execId: data.localExec?.id,
                        execStatus: 'pending'
                    }]);
                } else if (!data.localExec.success) {
                    setMessages(prev => [...prev, {
                        role: 'model',
                        agent: data.agent || 'local-exec',
                        content: `❌ LOCAL EXEC FAILED\n${data.localExec?.error || 'Unknown error'}`
                    }]);
                }
            }

            // Handle coding session results
            if (data.coding) {
                if (data.coding.success) {
                    setMessages(prev => [...prev, {
                        role: 'model',
                        agent: 'coding',
                        content: `✅ CODING SESSION STARTED\n${data.coding?.message || `Session: ${data.coding?.sessionId}`}\nStatus: ${data.coding?.status || 'running'}`
                    }]);
                } else if (data.coding && !data.coding.success && data.coding.error) {
                    setMessages(prev => [...prev, {
                        role: 'model',
                        agent: 'coding',
                        content: `❌ CODING ERROR\n${data.coding?.error}`
                    }]);
                }
            }

            // Handle terminal task results
            if (data.terminalTask) {
                if (data.terminalTask.success && data.terminalTask.status === 'running') {
                    setMessages(prev => [...prev, {
                        role: 'model',
                        agent: 'terminal-task',
                        content: `⚡ Terminal Task started: ${data.terminalTask.task}\n🔄 Running in background — result will appear when done.`
                    }]);
                } else if (!data.terminalTask.success) {
                    setMessages(prev => [...prev, {
                        role: 'model',
                        agent: 'terminal-task',
                        content: `❌ TERMINAL TASK ERROR\n${data.terminalTask?.error || 'Unknown error'}`
                    }]);
                }
            }
        } catch {
            setMessages(prev => [...prev, { role: 'model', content: '⚠️ Connection error. Please try again.' }]);
        }
        setSending(false);
        inputRef.current?.focus();
    };

    const handleClear = async () => {
        if (!confirm('Clear all orchestrator history?')) return;
        await fetch('/api/orchestrator/chat/history', { method: 'DELETE' });
        setMessages([]);
        pendingExecRef.current.clear();
    };

    const toggleVoiceMode = () => {
        if (voiceMode) {
            stopSession();
            setVoiceMode(false);
        } else {
            setVoiceMode(true);
        }
    };

    const handleVoiceButton = () => {
        if (sessionState === 'ready') {
            stopSession();
        } else if (sessionState === 'disconnected' || sessionState === 'error') {
            startSession();
        }
    };

    const isStatusMsg = (c: string) => c?.startsWith('✅') || c?.startsWith('❌') || c?.startsWith('⏳') || c?.startsWith('⚡');

    const isSessionActive = sessionState === 'ready';
    const isConnecting = sessionState === 'connecting' || sessionState === 'settingUp';

    return (
        <div className="h-[calc(100vh-7rem)] md:h-[calc(100vh-4rem)] flex flex-col max-w-3xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 md:pb-4 border-b border-gray-200 dark:border-zinc-800">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-pink-600 flex items-center justify-center shadow-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" /><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" /><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" /><path d="M17.599 6.5a3 3 0 0 0 .399-1.375" /><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" /><path d="M3.477 10.896a4 4 0 0 1 .585-.396" /><path d="M19.938 10.5a4 4 0 0 1 .585.396" /><path d="M6 18a4 4 0 0 1-1.967-.516" /><path d="M19.967 17.484A4 4 0 0 1 18 18" /></svg>
                    </div>
                    <div>
                        <h1 className="text-lg md:text-xl font-bold tracking-tight">Command Center</h1>
                        <p className="text-xs text-violet-500 font-medium flex items-center gap-1">
                            <span className={`w-1.5 h-1.5 rounded-full ${isSessionActive ? 'bg-pink-500' : 'bg-violet-500'} animate-pulse`} />
                            {isSessionActive ? 'Voice Active' : 'Orchestrator AI'}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={toggleVoiceMode}
                        className={`relative p-2 rounded-lg transition-all duration-300 ${voiceMode
                            ? 'bg-pink-100 dark:bg-pink-900/40 text-pink-600 dark:text-pink-400 shadow-sm'
                            : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800'
                            }`}
                        title={voiceMode ? 'Exit voice mode' : 'Enter voice mode'}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" x2="12" y1="19" y2="22" />
                        </svg>
                        {voiceMode && (
                            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-pink-500 rounded-full animate-pulse" />
                        )}
                    </button>
                    <button onClick={handleClear} className="text-xs text-gray-400 hover:text-red-500 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800">Clear</button>
                </div>
            </div>

            {/* Voice Mode Panel */}
            {voiceMode ? (
                <div className="flex-1 flex flex-col items-center justify-center px-4">
                    {/* AI Button — start/stop session */}
                    <button
                        onClick={handleVoiceButton}
                        disabled={isConnecting}
                        className={`relative w-28 h-28 md:w-36 md:h-36 rounded-full transition-all duration-500 flex items-center justify-center ${isSessionActive
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
                            <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="white" stroke="none">
                                <rect x="6" y="6" width="12" height="12" rx="2" />
                            </svg>
                        ) : (
                            // Sparkle / start icon
                            <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                <line x1="12" x2="12" y1="19" y2="22" />
                            </svg>
                        )}
                    </button>

                    <p className="mt-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                        {isConnecting ? 'Connecting to Gemini...' :
                            isSessionActive ? 'Tap to end session' :
                                'Tap to start voice session'}
                    </p>

                    {/* Error */}
                    {sessionState === 'error' && errorMessage && (
                        <p className="mt-2 text-xs text-red-500">{errorMessage}</p>
                    )}

                    {/* Transcription display */}
                    {isSessionActive && (
                        <div className="mt-8 w-full max-w-md space-y-3">
                            {/* Voice bars */}
                            {isModelSpeaking && (
                                <div className="flex items-center justify-center gap-1 mb-4">
                                    {[...Array(7)].map((_, i) => (
                                        <span
                                            key={i}
                                            className="w-1 bg-violet-500 rounded-full"
                                            style={{
                                                height: `${12 + Math.random() * 20}px`,
                                                animation: `voice-bar 0.5s ease-in-out infinite ${i * 0.07}s`
                                            }}
                                        />
                                    ))}
                                </div>
                            )}

                            {/* User transcript */}
                            {userTranscript && (
                                <div className="text-right">
                                    <span className="text-[10px] text-gray-400 mb-1 block">You</span>
                                    <div className="inline-block bg-violet-600 text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm max-w-[85%]">
                                        {userTranscript}
                                    </div>
                                </div>
                            )}

                            {/* AI transcript */}
                            {aiTranscript && (
                                <div className="text-left">
                                    <span className="text-[10px] text-gray-400 mb-1 block">AI</span>
                                    <div className="inline-block bg-gray-100 dark:bg-zinc-800 text-gray-800 dark:text-gray-200 rounded-2xl rounded-bl-md px-4 py-2.5 text-sm max-w-[85%]">
                                        {aiTranscript}
                                    </div>
                                </div>
                            )}

                            {/* Tool call status */}
                            {toolCall && (
                                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium ${toolCall.status === 'executing'
                                    ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                                    : toolCall.status === 'completed'
                                        ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                        : 'bg-gray-50 dark:bg-zinc-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-zinc-700'
                                    }`}>
                                    {toolCall.status === 'executing' && (
                                        <div className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
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
            ) : (
                <>
                    {/* Text Chat Messages */}
                    <div className="flex-1 overflow-y-auto py-4 space-y-3">
                        {loading ? (
                            <div className="flex justify-center items-center h-full"><div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" /></div>
                        ) : messages.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center px-4">
                                <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-violet-500/10 to-pink-500/10 flex items-center justify-center mb-4">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-violet-500"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" /><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" /></svg>
                                </div>
                                <h3 className="text-base font-semibold mb-1">AI Command Center</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs">
                                    I automatically route your requests to the right agent — bookings, planning tasks, or general questions.
                                </p>
                                <p className="text-xs text-pink-500 dark:text-pink-400 mt-2 flex items-center gap-1">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                        <line x1="12" x2="12" y1="19" y2="22" />
                                    </svg>
                                    Voice mode available — Gemini Live
                                </p>
                                <div className="mt-4 flex flex-wrap justify-center gap-2">
                                    {['Rezervă o cameră pe 5 martie', 'Creează un task pentru mâine', 'Ce poți face?'].map(s => (
                                        <button key={s} onClick={() => { setInput(s); inputRef.current?.focus(); }}
                                            className="text-xs px-3 py-1.5 rounded-full border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-gray-400 hover:border-violet-400 hover:text-violet-600 transition-colors"
                                        >{s}</button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            messages.map((msg, idx) => {
                                const agentInfo = msg.agent ? agentLabels[msg.agent] : null;
                                const hasImage = msg.execOutput?.includes('[IMAGE:') || msg.content?.includes('[IMAGE:');
                                return (
                                    <div key={idx}>
                                        {msg.role === 'model' && agentInfo && !isStatusMsg(msg.content) && (
                                            <div className="flex justify-start mb-1 ml-1">
                                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${agentInfo.color}`}>
                                                    {agentInfo.icon} {agentInfo.label}
                                                </span>
                                            </div>
                                        )}
                                        <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`
                                max-w-[85%] md:max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed
                                ${isStatusMsg(msg.content)
                                                    ? msg.content.startsWith('✅')
                                                        ? 'bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                                                        : msg.content.startsWith('⏳') || msg.content.startsWith('⚡')
                                                            ? 'bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
                                                            : 'bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                                                    : msg.role === 'user'
                                                        ? 'bg-violet-600 text-white rounded-br-md'
                                                        : 'bg-gray-100 dark:bg-zinc-800 text-gray-800 dark:text-gray-200 rounded-bl-md'
                                                }
                              `}>
                                                {/* Spinning indicator for pending/running exec */}
                                                {msg.execId && (msg.execStatus === 'pending' || msg.execStatus === 'running') && (
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <div className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                                                        <span className="text-xs font-medium">{msg.execStatus === 'pending' ? 'Waiting for agent...' : 'Executing...'}</span>
                                                    </div>
                                                )}
                                                {hasImage ? (
                                                    <div>
                                                        {renderContentWithImages(msg.content)}
                                                    </div>
                                                ) : (
                                                    <div className="whitespace-pre-wrap">{msg.content}</div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                        {sending && (
                            <div className="flex justify-start">
                                <div className="bg-gray-100 dark:bg-zinc-800 rounded-2xl rounded-bl-md px-4 py-3">
                                    <div className="flex gap-1.5">
                                        <span className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                                        <span className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                                        <span className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                                    </div>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Text Input */}
                    <div className="pt-3 border-t border-gray-200 dark:border-zinc-800">
                        <div className="flex items-center gap-2">
                            <input ref={inputRef} type="text" value={input} onChange={e => setInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                                placeholder="Ask anything..." disabled={sending}
                                className="flex-1 px-4 py-2.5 md:py-3 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition-all disabled:opacity-50"
                            />
                            <button onClick={handleSend} disabled={!input.trim() || sending}
                                className="p-2.5 md:p-3 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white transition-colors flex-shrink-0">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
                            </button>
                        </div>
                    </div>
                </>
            )}

            <style jsx>{`
                @keyframes voice-bar {
                    0%, 100% { transform: scaleY(0.4); }
                    50% { transform: scaleY(1.5); }
                }
            `}</style>
        </div>
    );
}

function formatExecOutput(output: string | undefined): string {
    if (!output) return '(no output)';
    if (output.includes('[IMAGE:')) return output;
    const maxLen = 2000;
    if (output.length > maxLen) return output.substring(0, maxLen) + '\n... (truncated)';
    return output;
}

function renderContentWithImages(content: string) {
    const lines = content.split('\n');
    return lines.map((line, i) => {
        const imgMatch = line.match(/\[IMAGE:(.*?)\](.*)/);
        if (imgMatch) {
            return <img key={i} src={`data:${imgMatch[1]};base64,${imgMatch[2]}`} alt="Screenshot" className="max-w-full rounded-lg mt-2" />;
        }
        return line ? <div key={i} className="whitespace-pre-wrap">{line}</div> : <br key={i} />;
    });
}
