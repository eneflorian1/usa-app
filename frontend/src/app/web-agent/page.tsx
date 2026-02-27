'use client';

import { useState, useEffect, useRef } from 'react';

interface WebAgentStep {
    stepNumber: number;
    action: string;
    details: string;
    reasoning: string;
    timestamp: string;
}

interface WebAgentSession {
    _id: string;
    task: string;
    status: 'running' | 'completed' | 'failed';
    startUrl: string;
    steps: WebAgentStep[];
    finalResult: string;
    error: string;
    createdAt: string;
    completedAt: string | null;
}

const statusConfig: Record<string, { label: string; color: string; icon: string }> = {
    running: { label: 'Running', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800', icon: '⚡' },
    completed: { label: 'Completed', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800', icon: '✅' },
    failed: { label: 'Failed', color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800', icon: '❌' },
};

const actionIcons: Record<string, string> = {
    navigate: '🌐',
    click: '👆',
    type: '⌨️',
    press: '⏎',
    scroll: '📜',
    wait: '⏳',
    done: '✅',
    fail: '❌',
};

export default function WebAgentPage() {
    const [sessions, setSessions] = useState<WebAgentSession[]>([]);
    const [selectedSession, setSelectedSession] = useState<WebAgentSession | null>(null);
    const [taskInput, setTaskInput] = useState('');
    const [urlInput, setUrlInput] = useState('');
    const [launching, setLaunching] = useState(false);
    const [loading, setLoading] = useState(true);
    const pollRef = useRef<NodeJS.Timeout | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { loadSessions(); return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

    const loadSessions = async () => {
        try {
            const res = await fetch('/api/web-agent/sessions');
            const data = await res.json();
            if (Array.isArray(data)) setSessions(data);
        } catch { }
        setLoading(false);
    };

    const startTask = async () => {
        if (!taskInput.trim() || launching) return;
        setLaunching(true);
        try {
            const res = await fetch('/api/web-agent/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task: taskInput.trim(), startUrl: urlInput.trim() || undefined }),
            });
            const data = await res.json();
            if (data.sessionId) {
                setTaskInput('');
                setUrlInput('');
                // Start polling this session
                pollSession(data.sessionId);
                loadSessions();
            }
        } catch { }
        setLaunching(false);
    };

    const pollSession = (sessionId: string) => {
        // Poll every 3 seconds
        if (pollRef.current) clearInterval(pollRef.current);
        const fetchSession = async () => {
            try {
                const res = await fetch(`/api/web-agent/sessions/${sessionId}`);
                const data = await res.json();
                setSelectedSession(data);
                if (data.status !== 'running') {
                    if (pollRef.current) clearInterval(pollRef.current);
                    loadSessions();
                }
            } catch { }
        };
        fetchSession();
        pollRef.current = setInterval(fetchSession, 3000);
    };

    const stopSession = async (id: string) => {
        try {
            await fetch(`/api/web-agent/sessions/${id}/stop`, { method: 'POST' });
            loadSessions();
            if (selectedSession?._id === id) {
                setSelectedSession(prev => prev ? { ...prev, status: 'failed', error: 'Stopped by user' } : null);
            }
        } catch { }
    };

    const viewSession = (session: WebAgentSession) => {
        setSelectedSession(session);
        if (session.status === 'running') {
            pollSession(session._id);
        }
    };

    const quickTasks = [
        { label: '🔍 Search Google', task: 'Search Google for the latest tech news', url: 'https://google.com' },
        { label: '📋 Example.com', task: 'Go to example.com and tell me what the page says', url: 'https://example.com' },
        { label: '🌤️ Weather', task: 'Find the current weather in Bucharest', url: 'https://google.com' },
    ];

    return (
        <div className="h-[calc(100vh-7rem)] md:h-[calc(100vh-4rem)] flex flex-col max-w-4xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 md:pb-4 border-b border-gray-200 dark:border-zinc-800">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" />
                        </svg>
                    </div>
                    <div>
                        <h1 className="text-lg md:text-xl font-bold tracking-tight">Web Agent</h1>
                        <p className="text-xs text-cyan-500 font-medium flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
                            LAM — Browser Automation
                        </p>
                    </div>
                </div>
                {selectedSession && (
                    <button onClick={() => { setSelectedSession(null); if (pollRef.current) clearInterval(pollRef.current); }}
                        className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors">
                        ← Back
                    </button>
                )}
            </div>

            {selectedSession ? (
                /* ===== Session Detail View ===== */
                <div className="flex-1 overflow-y-auto py-4 space-y-3">
                    {/* Task info */}
                    <div className="p-4 rounded-2xl bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{selectedSession.task}</p>
                                {selectedSession.startUrl && (
                                    <p className="text-xs text-gray-400 mt-1 truncate">🌐 {selectedSession.startUrl}</p>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${statusConfig[selectedSession.status]?.color}`}>
                                    {statusConfig[selectedSession.status]?.icon} {statusConfig[selectedSession.status]?.label}
                                </span>
                                {selectedSession.status === 'running' && (
                                    <button onClick={() => stopSession(selectedSession._id)}
                                        className="text-xs px-3 py-1 rounded-lg bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors">
                                        Stop
                                    </button>
                                )}
                            </div>
                        </div>
                        {selectedSession.finalResult && (
                            <div className="mt-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">{selectedSession.finalResult}</p>
                            </div>
                        )}
                        {selectedSession.error && (
                            <div className="mt-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                                <p className="text-xs font-medium text-red-700 dark:text-red-300">{selectedSession.error}</p>
                            </div>
                        )}
                    </div>

                    {/* Steps timeline */}
                    <div className="space-y-2">
                        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1">
                            Steps ({selectedSession.steps?.length || 0})
                        </h3>
                        {selectedSession.steps?.map((step, idx) => (
                            <div key={idx} className="flex gap-3 items-start">
                                <div className="flex flex-col items-center">
                                    <div className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-zinc-800 flex items-center justify-center text-sm flex-shrink-0 border border-gray-200 dark:border-zinc-700">
                                        {actionIcons[step.action] || '🔧'}
                                    </div>
                                    {idx < (selectedSession.steps?.length || 0) - 1 && (
                                        <div className="w-0.5 h-full min-h-[16px] bg-gray-200 dark:bg-zinc-700 mt-1" />
                                    )}
                                </div>
                                <div className="flex-1 pb-3">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold text-gray-500 dark:text-gray-400">#{step.stepNumber}</span>
                                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">{step.action}</span>
                                        <span className="text-[10px] text-gray-400">
                                            {new Date(step.timestamp).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                        </span>
                                    </div>
                                    {step.details && (
                                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 break-all">{step.details}</p>
                                    )}
                                    {step.reasoning && (
                                        <p className="text-[11px] text-cyan-600 dark:text-cyan-400 mt-1 italic">💡 {step.reasoning}</p>
                                    )}
                                </div>
                            </div>
                        ))}
                        {selectedSession.status === 'running' && (
                            <div className="flex gap-3 items-center">
                                <div className="w-8 h-8 rounded-xl bg-cyan-50 dark:bg-cyan-900/30 border border-cyan-200 dark:border-cyan-800 flex items-center justify-center flex-shrink-0">
                                    <div className="w-3 h-3 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                                </div>
                                <span className="text-xs text-cyan-600 dark:text-cyan-400 animate-pulse">Processing next step...</span>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                /* ===== Main View — New Task + Session List ===== */
                <div className="flex-1 overflow-y-auto py-4 space-y-4">
                    {/* New Task Form */}
                    <div className="p-4 rounded-2xl bg-gradient-to-br from-cyan-50 to-blue-50 dark:from-cyan-950/30 dark:to-blue-950/30 border border-cyan-200 dark:border-cyan-900">
                        <h3 className="text-sm font-semibold mb-3 text-gray-800 dark:text-gray-200">🤖 New Web Task</h3>
                        <div className="space-y-2">
                            <input
                                ref={inputRef}
                                type="text"
                                value={taskInput}
                                onChange={e => setTaskInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); startTask(); } }}
                                placeholder="Describe what you want the agent to do..."
                                className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none"
                            />
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={urlInput}
                                    onChange={e => setUrlInput(e.target.value)}
                                    placeholder="Start URL (optional) — e.g. https://wolt.com"
                                    className="flex-1 px-4 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none"
                                />
                                <button
                                    onClick={startTask}
                                    disabled={!taskInput.trim() || launching}
                                    className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-700 disabled:opacity-40 text-white text-sm font-medium transition-colors flex items-center gap-2 flex-shrink-0"
                                >
                                    {launching ? (
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <polygon points="6 3 20 12 6 21 6 3" />
                                        </svg>
                                    )}
                                    Run
                                </button>
                            </div>
                        </div>

                        {/* Quick tasks */}
                        <div className="mt-3 flex flex-wrap gap-2">
                            {quickTasks.map(qt => (
                                <button key={qt.label}
                                    onClick={() => { setTaskInput(qt.task); setUrlInput(qt.url); inputRef.current?.focus(); }}
                                    className="text-[11px] px-3 py-1.5 rounded-full border border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-gray-400 hover:border-cyan-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors"
                                >
                                    {qt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Sessions List */}
                    <div>
                        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1 mb-2">
                            Sessions ({sessions.length})
                        </h3>
                        {loading ? (
                            <div className="flex justify-center py-8">
                                <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                            </div>
                        ) : sessions.length === 0 ? (
                            <div className="text-center py-12">
                                <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-cyan-500/10 to-blue-500/10 flex items-center justify-center mx-auto mb-4">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-cyan-500">
                                        <circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" />
                                    </svg>
                                </div>
                                <p className="text-sm text-gray-500 dark:text-gray-400">No sessions yet</p>
                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Start a task to see it here</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {sessions.map(session => (
                                    <button
                                        key={session._id}
                                        onClick={() => viewSession(session)}
                                        className="w-full text-left p-3.5 rounded-xl border border-gray-200 dark:border-zinc-800 hover:border-cyan-300 dark:hover:border-cyan-700 bg-white dark:bg-zinc-900 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-all group"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors">
                                                    {session.task}
                                                </p>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-[10px] text-gray-400">
                                                        {new Date(session.createdAt).toLocaleString('ro-RO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                    {session.startUrl && (
                                                        <span className="text-[10px] text-gray-400 truncate max-w-[150px]">🌐 {session.startUrl}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${statusConfig[session.status]?.color}`}>
                                                {statusConfig[session.status]?.icon} {statusConfig[session.status]?.label}
                                            </span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
