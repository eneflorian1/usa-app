'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';

interface CodingStep {
    step: number;
    type: 'think' | 'act' | 'observe';
    tool: string;
    args: Record<string, unknown>;
    result: string;
    timestamp: string;
}

interface CodingSession {
    _id: string;
    task: string;
    projectPath: string;
    projectName: string;
    status: 'running' | 'done' | 'error';
    steps: CodingStep[];
    summary: string;
    filesChanged: string[];
    createdAt: string;
    completedAt: string | null;
}

const stepIcons: Record<string, string> = { think: '💭', act: '⚡', observe: '👁' };
const stepColors: Record<string, string> = {
    think: 'border-l-blue-400',
    act: 'border-l-amber-400',
    observe: 'border-l-green-400',
};

export default function CodingPage() {
    const [sessions, setSessions] = useState<CodingSession[]>([]);
    const [activeSession, setActiveSession] = useState<CodingSession | null>(null);
    const [loading, setLoading] = useState(true);
    const [task, setTask] = useState('');
    const [project, setProject] = useState('usa-app');
    const [starting, setStarting] = useState(false);
    const stepsEndRef = useRef<HTMLDivElement>(null);
    const pollRef = useRef<NodeJS.Timeout | null>(null);

    const loadSessions = useCallback(async () => {
        try {
            const data = await api.get<CodingSession[]>('/api/coding/sessions');
            if (Array.isArray(data)) setSessions(data);
        } catch { }
        setLoading(false);
    }, []);

    const refreshSession = useCallback(async (id: string) => {
        try {
            const data = await api.get<CodingSession>(`/api/coding/sessions/${id}`);
            if (data._id) {
                setActiveSession(data);
                if (data.status !== 'running' && pollRef.current) {
                    clearInterval(pollRef.current);
                    loadSessions();
                }
            }
        } catch { }
    }, [loadSessions]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { loadSessions(); }, [loadSessions]);

    useEffect(() => {
        if (activeSession?.status === 'running') {
            pollRef.current = setInterval(() => refreshSession(activeSession._id), 3000);
            return () => { if (pollRef.current) clearInterval(pollRef.current); };
        }
    }, [activeSession?._id, activeSession?.status, refreshSession]);

    useEffect(() => {
        stepsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [activeSession?.steps?.length]);

    const startSession = async () => {
        if (!task.trim() || starting) return;
        setStarting(true);
        try {
            const data = await api.post<CodingSession>('/api/coding/start', {
                task: task.trim(),
                projectPath: `C:\\Users\\Admin\\Documents\\GitHub\\${project}`,
                projectName: project
            });
            if (data._id) {
                setActiveSession(data);
                setTask('');
                loadSessions();
            }
        } catch { }
        setStarting(false);
    };

    const formatTime = (iso: string) => new Date(iso).toLocaleString('ro-RO', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });

    const statusBadge = (status: string) => {
        const cfg: Record<string, { bg: string; text: string }> = {
            running: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400' },
            done: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400' },
            error: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400' },
        };
        const c = cfg[status] || cfg.running;
        return <span className={`px-2 py-0.5 rounded-lg text-xs font-medium ${c.bg} ${c.text}`}>
            {status === 'running' ? '⚡ Running' : status === 'done' ? '✓ Done' : '✗ Error'}
        </span>;
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-lg font-mono">
                    {'</>'}
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Coding Agent</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Autonomous coding on your local PC</p>
                </div>
            </div>

            {/* New Task Input */}
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 p-4">
                <div className="flex items-center space-x-3 mb-3">
                    <select
                        value={project}
                        onChange={e => setProject(e.target.value)}
                        className="bg-gray-100 dark:bg-zinc-800 text-sm rounded-lg px-3 py-2 border-0 text-gray-700 dark:text-gray-300"
                    >
                        <option value="usa-app">usa-app</option>
                        <option value="de-vanzare.ro">de-vanzare.ro</option>
                        <option value="casa">casa</option>
                        <option value="CallAgent">CallAgent</option>
                        <option value="PlatformAgent">PlatformAgent</option>
                        <option value="adktrip">adktrip</option>
                        <option value="Code">Code</option>
                        <option value="TESTY">TESTY</option>
                    </select>
                    <input
                        type="text"
                        value={task}
                        onChange={e => setTask(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && startSession()}
                        placeholder="Describe the coding task..."
                        className="flex-1 bg-gray-100 dark:bg-zinc-800 text-sm rounded-lg px-3 py-2 border-0 text-gray-900 dark:text-white placeholder-gray-400 outline-none"
                    />
                    <button
                        onClick={startSession}
                        disabled={!task.trim() || starting}
                        className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-300 dark:disabled:bg-zinc-700 text-white text-sm rounded-lg font-medium transition-colors"
                    >
                        {starting ? '...' : 'Start'}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Sessions List */}
                <div className="md:col-span-1 space-y-2">
                    <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Sessions</h2>
                    {loading ? (
                        <p className="text-gray-400 text-sm">Loading...</p>
                    ) : sessions.length === 0 ? (
                        <p className="text-gray-400 text-sm">No sessions yet</p>
                    ) : (
                        sessions.map(s => (
                            <div
                                key={s._id}
                                onClick={() => { setActiveSession(null); setTimeout(() => refreshSession(s._id), 100); }}
                                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                                    activeSession?._id === s._id
                                        ? 'border-violet-400 bg-violet-50 dark:bg-violet-900/20 dark:border-violet-600'
                                        : 'border-gray-200 dark:border-zinc-800 hover:border-gray-300 dark:hover:border-zinc-700 bg-white dark:bg-zinc-900'
                                }`}
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{s.projectName}</span>
                                    {statusBadge(s.status)}
                                </div>
                                <p className="text-sm text-gray-800 dark:text-gray-200 line-clamp-2">{s.task}</p>
                                <p className="text-xs text-gray-400 mt-1">{formatTime(s.createdAt)}</p>
                            </div>
                        ))
                    )}
                </div>

                {/* Active Session Detail */}
                <div className="md:col-span-2">
                    {!activeSession ? (
                        <div className="text-center py-20">
                            <p className="text-gray-400">Select a session or start a new task</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{activeSession.task}</h2>
                                    <p className="text-sm text-gray-500">{activeSession.projectName} · {activeSession.steps?.length || 0} steps</p>
                                </div>
                                {statusBadge(activeSession.status)}
                            </div>

                            {activeSession.summary && (
                                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-3">
                                    <p className="text-sm text-green-800 dark:text-green-300">{activeSession.summary}</p>
                                    {activeSession.filesChanged?.length > 0 && (
                                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                                            Files: {activeSession.filesChanged.join(', ')}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Steps feed */}
                            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
                                {activeSession.steps?.map((step, i) => (
                                    <div
                                        key={i}
                                        className={`border-l-4 ${stepColors[step.type] || 'border-l-gray-400'} bg-white dark:bg-zinc-900 rounded-r-xl p-3`}
                                    >
                                        <div className="flex items-center space-x-2 mb-1">
                                            <span>{stepIcons[step.type] || '•'}</span>
                                            <span className="text-xs font-medium text-gray-500 uppercase">{step.type}</span>
                                            {step.tool && (
                                                <code className="text-xs bg-gray-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-violet-600 dark:text-violet-400">
                                                    {step.tool}
                                                </code>
                                            )}
                                        </div>
                                        <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
                                            {step.result?.substring(0, 3000) || '...'}
                                        </pre>
                                    </div>
                                ))}
                                {activeSession.status === 'running' && (
                                    <div className="flex items-center space-x-2 p-3 text-blue-500">
                                        <span className="animate-pulse">●</span>
                                        <span className="text-sm">Agent is working...</span>
                                    </div>
                                )}
                                <div ref={stepsEndRef} />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
