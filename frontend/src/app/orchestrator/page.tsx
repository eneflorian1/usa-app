'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useGeminiLive } from '@/hooks/useGeminiLive';
import api from '@/lib/api';
import { Menu, Plus, Trash2, MessageSquare, X } from 'lucide-react';

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
}

interface Session {
    sessionId: string;
    title: string;
    messageCount: number;
    createdAt: string;
    updatedAt: string;
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
    email: { label: 'Email', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300', icon: '📧' },
    memory: { label: 'Memory', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', icon: '🧠' },
    'tasks-query': { label: 'Tasks', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300', icon: '📋' },
    nego: { label: 'Nego Agent', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', icon: '🏠' },
};

function formatExecOutput(output: string | undefined): string {
    if (!output) return '(no output)';
    if (output.includes('[IMAGE:')) return output;
    if (output.length > 2000) return output.substring(0, 2000) + '\n... (truncated)';
    return output;
}

function renderContentWithImages(content: string) {
    return content.split('\n').map((line, i) => {
        const imgMatch = line.match(/\[IMAGE:(.*?)\](.*)/);
        if (imgMatch) {
            // eslint-disable-next-line @next/next/no-img-element
            return <img key={i} src={`data:${imgMatch[1]};base64,${imgMatch[2]}`} alt="Screenshot" className="max-w-full rounded-lg mt-2" />;
        }
        return line ? <div key={i} className="whitespace-pre-wrap">{line}</div> : <br key={i} />;
    });
}

export default function OrchestratorPage() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [voiceMode, setVoiceMode] = useState(false);
    const [sending, setSending] = useState(false);
    const [loading, setLoading] = useState(true);

    // Session / Sidebar state
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string>('orchestrator-default');
    const [sessionsLoading, setSessionsLoading] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const pendingExecRef = useRef<Set<string>>(new Set());
    const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const {
        sessionState,
        isModelSpeaking,
        userTranscript,
        aiTranscript,
        toolCall,
        errorMessage,
        voiceSessionId,
        exchangeCount,
        startSession,
        stopSession,
    } = useGeminiLive({ sessionId: currentSessionId });

    // ── Session helpers ──────────────────────────────────────────────────────

    const loadSessions = useCallback(async () => {
        setSessionsLoading(true);
        try {
            const data = await api.get<Session[]>('/api/orchestrator/sessions');
            setSessions(Array.isArray(data) ? data : []);
        } catch { }
        setSessionsLoading(false);
    }, []);

    const createNewSession = async () => {
        try {
            const data = await api.post<{ sessionId: string; title: string }>('/api/orchestrator/sessions', {});
            setCurrentSessionId(data.sessionId);
            setMessages([]);
            setSidebarOpen(false);
            await loadSessions();
        } catch { }
    };

    const switchSession = async (sessionId: string) => {
        if (sessionId === currentSessionId) { setSidebarOpen(false); return; }
        setCurrentSessionId(sessionId);
        setSidebarOpen(false);
        setLoading(true);
        try {
            const data = await api.get<Message[]>(`/api/orchestrator/chat/history?sessionId=${sessionId}`);
            setMessages(Array.isArray(data) ? data : []);
        } catch { setMessages([]); }
        setLoading(false);
    };

    const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm('Ștergi conversația?')) return;
        await api.delete(`/api/orchestrator/sessions/${sessionId}`);
        if (sessionId === currentSessionId) {
            setCurrentSessionId('orchestrator-default');
            setMessages([]);
        }
        await loadSessions();
    };

    // ── Load initial history ──────────────────────────────────────────────────

    const loadHistory = useCallback(async () => {
        try {
            const data = await api.get<Message[]>(`/api/orchestrator/chat/history?sessionId=${currentSessionId}`);
            if (Array.isArray(data)) setMessages(data);
        } catch { }
        setLoading(false);
    }, [currentSessionId]);

    useEffect(() => {
        setLoading(true);
        loadHistory();
    }, [loadHistory]);

    useEffect(() => {
        loadSessions();
    }, [loadSessions]);

    // When a new voice session starts, switch commander to show it
    useEffect(() => {
        if (!voiceSessionId || voiceSessionId === currentSessionId) return;
        setCurrentSessionId(voiceSessionId);
        setSidebarOpen(false);
    }, [voiceSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

    // After each voice exchange, reload messages so conversation appears live
    useEffect(() => {
        if (exchangeCount === 0) return;
        loadHistory();
        loadSessions();
    }, [exchangeCount, loadHistory, loadSessions]);

    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

    // ── Poll pending execs ────────────────────────────────────────────────────

    const pollPendingExecs = useCallback(async () => {
        const ids = Array.from(pendingExecRef.current);
        if (ids.length === 0) return;
        for (const id of ids) {
            try {
                const cmd = await api.get<{ status: 'pending' | 'running' | 'done' | 'error'; output?: string; exitCode?: number }>(`/api/local-exec/${id}`);
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

    // ── Send message ──────────────────────────────────────────────────────────

    const handleSend = async () => {
        if (!input.trim() || sending) return;
        const userMsg = input.trim();
        setInput('');
        setSending(true);
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);

        try {
            const data = await api.post<OrchestratorResponse>('/api/orchestrator/chat', {
                message: userMsg,
                sessionId: currentSessionId,
            });

            setMessages(prev => [...prev, { role: 'model', content: data.reply, agent: data.agent }]);

            if (data.booking?.success && data.booking.booking) {
                const b = data.booking.booking;
                setMessages(prev => [...prev, {
                    role: 'model', agent: 'booking',
                    content: `✅ BOOKING CONFIRMED\n📋 Guest: ${b.guestName}\n📥 Check-in: ${new Date(b.checkIn).toLocaleDateString('ro-RO')}\n📤 Check-out: ${new Date(b.checkOut).toLocaleDateString('ro-RO')}`
                }]);
            } else if (data.booking && !data.booking.success && data.booking.error) {
                setMessages(prev => [...prev, { role: 'model', agent: 'booking', content: `❌ BOOKING FAILED\n${data.booking?.error}` }]);
            }

            if (data.tasks && data.tasks.length > 0) {
                for (const t of data.tasks) {
                    setMessages(prev => [...prev, {
                        role: 'model', agent: 'planner',
                        content: `✅ TASK CREATED\n📝 ${t.title}\n⚡ Priority: ${t.priority}\n📅 Due: ${t.dueDate ? new Date(t.dueDate).toLocaleDateString('ro-RO') : 'No deadline'}`
                    }]);
                }
            }

            if (data.localExec) {
                if (data.localExec.success && data.localExec.id) {
                    const label = data.localExec.label || data.localExec.command || 'Command';
                    pendingExecRef.current.add(data.localExec.id);
                    setMessages(prev => [...prev, {
                        role: 'model', agent: data.agent || 'local-exec',
                        content: `⏳ Pending: ${label}\n🖥️ Queued on local PC — waiting for agent...`,
                        execId: data.localExec?.id, execStatus: 'pending'
                    }]);
                } else if (!data.localExec.success) {
                    setMessages(prev => [...prev, {
                        role: 'model', agent: data.agent || 'local-exec',
                        content: `❌ LOCAL EXEC FAILED\n${data.localExec?.error || 'Unknown error'}`
                    }]);
                }
            }

            if (data.coding) {
                if (data.coding.success) {
                    setMessages(prev => [...prev, {
                        role: 'model', agent: 'coding',
                        content: `✅ CODING SESSION STARTED\n${data.coding?.message || `Session: ${data.coding?.sessionId}`}`
                    }]);
                } else if (!data.coding.success && data.coding?.error) {
                    setMessages(prev => [...prev, { role: 'model', agent: 'coding', content: `❌ CODING ERROR\n${data.coding?.error}` }]);
                }
            }

            // Refresh sessions list (title may have been set)
            loadSessions();
        } catch {
            setMessages(prev => [...prev, { role: 'model', content: '⚠️ Connection error. Please try again.' }]);
        }
        setSending(false);
        inputRef.current?.focus();
    };

    const handleClear = async () => {
        if (!confirm('Clear this conversation?')) return;
        await api.delete(`/api/orchestrator/chat/history?sessionId=${currentSessionId}`);
        setMessages([]);
        pendingExecRef.current.clear();
        await loadSessions();
    };

    const toggleVoiceMode = () => {
        if (voiceMode) { stopSession(); setVoiceMode(false); }
        else { setVoiceMode(true); }
    };

    const handleVoiceButton = () => {
        if (sessionState === 'ready') stopSession();
        else if (sessionState === 'disconnected' || sessionState === 'error') startSession();
    };

    const isStatusMsg = (c: string) => c && (c.startsWith('✅') || c.startsWith('❌') || c.startsWith('⏳') || c.startsWith('⚡'));
    const isSessionActive = sessionState === 'ready';

    const currentSession = sessions.find(s => s.sessionId === currentSessionId);

    return (
        <div className="relative h-[calc(100vh-7rem)] md:h-[calc(100vh-4rem)] flex flex-col max-w-3xl mx-auto">

            {/* ── Sidebar overlay ──────────────────────────────────────────── */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            <div className={`
                fixed top-0 left-0 h-full w-72 z-50
                bg-white dark:bg-zinc-900 border-r border-gray-200 dark:border-zinc-800
                shadow-2xl flex flex-col
                transition-transform duration-300 ease-in-out
                ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
                md:left-64
            `}>
                {/* Sidebar header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-zinc-800">
                    <span className="font-semibold text-sm">Conversații</span>
                    <button onClick={() => setSidebarOpen(false)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors">
                        <X size={16} />
                    </button>
                </div>

                {/* New conversation button */}
                <div className="p-3">
                    <button
                        onClick={createNewSession}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors"
                    >
                        <Plus size={16} />
                        Conversație nouă
                    </button>
                </div>

                {/* Sessions list */}
                <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
                    {sessionsLoading ? (
                        <div className="flex justify-center py-8">
                            <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                    ) : sessions.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-8">Nicio conversație salvată</p>
                    ) : (
                        sessions.map(s => (
                            <div
                                key={s.sessionId}
                                onClick={() => switchSession(s.sessionId)}
                                className={`
                                    group flex items-start gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-colors
                                    ${s.sessionId === currentSessionId
                                        ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300'
                                        : 'hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-700 dark:text-gray-300'
                                    }
                                `}
                            >
                                <MessageSquare size={14} className="mt-0.5 flex-shrink-0 opacity-60" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium truncate">{s.title || 'Conversație nouă'}</p>
                                    <p className="text-[10px] opacity-50 mt-0.5">
                                        {s.messageCount} mesaje · {new Date(s.updatedAt).toLocaleDateString('ro-RO')}
                                    </p>
                                </div>
                                <button
                                    onClick={e => deleteSession(s.sessionId, e)}
                                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-red-500 transition-all flex-shrink-0"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        ))
                    )}
                </div>

                {/* Sidebar footer — memory shortcut */}
                <div className="p-3 border-t border-gray-100 dark:border-zinc-800">
                    <a
                        href="/memory"
                        className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                    >
                        <span>🧠</span>
                        <span>Memory & Preferințe</span>
                    </a>
                </div>
            </div>

            {/* ── Header ──────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between pb-3 md:pb-4 border-b border-gray-200 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                    {/* Hamburger */}
                    <button
                        onClick={() => { setSidebarOpen(true); loadSessions(); }}
                        className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors flex-shrink-0"
                        aria-label="Deschide conversații"
                    >
                        <Menu size={20} />
                    </button>

                    <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-gradient-to-br from-violet-500 to-pink-600 flex items-center justify-center shadow-md flex-shrink-0">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" /><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" /></svg>
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-base md:text-lg font-bold tracking-tight truncate max-w-[180px] md:max-w-xs">
                                {currentSession?.title || 'Command Center'}
                            </h1>
                            <p className="text-xs text-violet-500 font-medium flex items-center gap-1">
                                <span className={`w-1.5 h-1.5 rounded-full ${isSessionActive ? 'bg-pink-500' : 'bg-violet-500'} animate-pulse`} />
                                {isSessionActive ? 'Voice Active' : 'Orchestrator AI'}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-1">
                    <a
                        href="/downloads/ilie-assistant.apk"
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 rounded-lg transition-all text-[11px] font-bold border border-amber-500/20"
                        download
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
                        APK
                    </a>
                    <button onClick={handleClear} className="text-xs text-gray-400 hover:text-red-500 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800">Clear</button>
                </div>
            </div>

            {/* ── Voice mode panel ─────────────────────────────────────────── */}
            {voiceMode && (
                <div className="py-3 border-b border-gray-200 dark:border-zinc-800">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleVoiceButton}
                            disabled={sessionState === 'connecting' || sessionState === 'settingUp'}
                            className={`
                                relative flex items-center justify-center w-12 h-12 rounded-full transition-all
                                ${isSessionActive
                                    ? 'bg-pink-500 shadow-lg shadow-pink-500/40 hover:bg-pink-600'
                                    : sessionState === 'connecting' || sessionState === 'settingUp'
                                        ? 'bg-violet-400 animate-pulse'
                                        : 'bg-violet-600 hover:bg-violet-700'
                                }
                            `}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                <line x1="12" x2="12" y1="19" y2="22" />
                            </svg>
                        </button>

                        <div className="flex-1 min-w-0">
                            {userTranscript && <p className="text-xs text-gray-500 truncate">Tu: {userTranscript}</p>}
                            {aiTranscript && <p className="text-xs text-violet-500 truncate">AI: {aiTranscript}</p>}
                            {toolCall && <p className="text-xs text-amber-500 truncate">🔧 {toolCall.name || JSON.stringify(toolCall).substring(0, 60)}</p>}
                            {errorMessage && <p className="text-xs text-red-500 truncate">{errorMessage}</p>}
                            {!userTranscript && !aiTranscript && !toolCall && !errorMessage && (
                                <p className="text-xs text-gray-400">
                                    {isSessionActive ? 'Ascult...' : sessionState === 'connecting' || sessionState === 'settingUp' ? 'Se conectează...' : 'Apasă pentru a vorbi'}
                                </p>
                            )}
                        </div>

                        {isModelSpeaking && (
                            <div className="flex items-end gap-0.5 h-6">
                                {[...Array(4)].map((_, i) => (
                                    <div key={i} className="w-1 bg-pink-500 rounded-full animate-pulse"
                                        style={{ height: `${Math.random() * 16 + 8}px`, animationDelay: `${i * 100}ms` }} />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Messages ─────────────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto py-4 space-y-3">
                {loading ? (
                    <div className="flex justify-center items-center h-full">
                        <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" />
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center px-4">
                        <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-violet-500/10 to-pink-500/10 flex items-center justify-center mb-4">
                            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-violet-500"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" /><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" /></svg>
                        </div>
                        <h3 className="text-base font-semibold mb-1">AI Command Center</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs">
                            Rutez automat cererea ta către agentul potrivit — rezervări, tasks, imobiliare, sau general.
                        </p>
                        <p className="text-xs text-pink-500 dark:text-pink-400 mt-2 flex items-center gap-1">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                <line x1="12" x2="12" y1="19" y2="22" />
                            </svg>
                            Voice mode disponibil — Gemini Live
                        </p>
                        <div className="mt-4 flex flex-wrap justify-center gap-2">
                            {['Caută apartamente noi în zona mea', 'Creează un task pentru mâine', 'Ce poți face?'].map(s => (
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
                                        {msg.execId && (msg.execStatus === 'pending' || msg.execStatus === 'running') && (
                                            <div className="flex items-center gap-2 mb-1">
                                                <div className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                                                <span className="text-xs font-medium">{msg.execStatus === 'pending' ? 'Waiting for agent...' : 'Executing...'}</span>
                                            </div>
                                        )}
                                        {hasImage ? (
                                            <div>{renderContentWithImages(msg.content)}</div>
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
                                {[0, 150, 300].map(d => (
                                    <span key={d} className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />
                                ))}
                            </div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* ── Input ────────────────────────────────────────────────────── */}
            <div className="pt-3 border-t border-gray-200 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                    {/* Voice toggle */}
                    <button
                        onClick={toggleVoiceMode}
                        className={`p-2.5 rounded-xl transition-colors flex-shrink-0 ${voiceMode ? 'bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400' : 'bg-gray-100 dark:bg-zinc-800 text-gray-500 hover:text-gray-700'}`}
                        title="Toggle voice mode"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" x2="12" y1="19" y2="22" />
                        </svg>
                    </button>

                    <input
                        ref={inputRef} type="text" value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                        placeholder="Comandă sau întrebare..." disabled={sending}
                        className="flex-1 px-4 py-2.5 md:py-3 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition-all disabled:opacity-50"
                    />
                    <button
                        onClick={handleSend} disabled={!input.trim() || sending}
                        className="p-2.5 md:p-3 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white transition-colors flex-shrink-0"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
                    </button>
                </div>
            </div>
        </div>
    );
}
