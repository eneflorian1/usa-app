'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

interface PM2Process {
    id: number;
    name: string;
    status: string;
    pid: number;
    uptime: number;
    restarts: number;
    memory: number;
    cpu: number;
    cwd: string;
}

interface CronJob {
    _id: string;
    name: string;
    cronExpression: string;
    actionType: string;
    isActive: boolean;
    lastRun?: string;
    nextRun?: string;
}

type Tab = 'processes' | 'cron' | 'screenshot';

const statusColor = (s: string) => {
    if (s === 'online') return 'bg-emerald-500';
    if (s === 'stopped') return 'bg-gray-400';
    if (s === 'errored') return 'bg-red-500';
    return 'bg-amber-400';
};

const statusLabel = (s: string) => {
    if (s === 'online') return 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20';
    if (s === 'stopped') return 'text-gray-500 bg-gray-100 dark:bg-zinc-800';
    if (s === 'errored') return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20';
    return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20';
};

function fmtMem(bytes: number) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtUptime(ms: number) {
    if (!ms) return '-';
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
}

export default function AgentsPage() {
    const [tab, setTab] = useState<Tab>('processes');
    const [processes, setProcesses] = useState<PM2Process[]>([]);
    const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
    const [loadingProcs, setLoadingProcs] = useState(true);
    const [loadingCron, setLoadingCron] = useState(true);
    const [actionInProgress, setActionInProgress] = useState<string | null>(null);
    const [logs, setLogs] = useState<{ name: string; text: string } | null>(null);

    const fetchProcesses = useCallback(async () => {
        try {
            const data = await api.get<PM2Process[]>('/api/pm2');
            setProcesses(data);
        } catch { }
        setLoadingProcs(false);
    }, []);

    const fetchCron = useCallback(async () => {
        try {
            const data = await api.get<CronJob[]>('/api/cron-jobs');
            if (Array.isArray(data)) setCronJobs(data);
        } catch { }
        setLoadingCron(false);
    }, []);

    useEffect(() => {
        fetchProcesses();
        fetchCron();
        const interval = setInterval(fetchProcesses, 8000);
        return () => clearInterval(interval);
    }, [fetchProcesses, fetchCron]);

    const pmAction = async (name: string, action: 'start' | 'stop' | 'restart') => {
        setActionInProgress(`${name}-${action}`);
        try {
            await api.post(`/api/pm2/${name}/${action}`, {});
            setTimeout(fetchProcesses, 1500);
        } catch { }
        setActionInProgress(null);
    };

    const loadLogs = async (name: string) => {
        try {
            const data = await api.get<{ logs: string }>(`/api/pm2/${name}/logs?lines=50`);
            setLogs({ name, text: data.logs });
        } catch { }
    };

    const toggleCron = async (job: CronJob) => {
        await api.patch(`/api/cron-jobs/${job._id}`, { isActive: !job.isActive });
        fetchCron();
    };

    const deleteCron = async (id: string) => {
        if (!confirm('Ștergi acest cron job?')) return;
        await api.delete(`/api/cron-jobs/${id}`);
        fetchCron();
    };

    const online = processes.filter(p => p.status === 'online').length;
    const stopped = processes.filter(p => p.status !== 'online').length;

    return (
        <div className="space-y-6 pb-10">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Agent Manager</h1>
                    <p className="text-sm text-gray-500 mt-0.5">
                        <span className="text-emerald-600 font-semibold">{online} online</span>
                        {stopped > 0 && <span className="text-gray-400"> · {stopped} stopped</span>}
                    </p>
                </div>
                <button onClick={fetchProcesses} className="p-2 rounded-xl bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors" title="Refresh">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></svg>
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-gray-100 dark:bg-zinc-900 p-1 rounded-xl w-fit">
                {(['processes', 'cron', 'screenshot'] as Tab[]).map(t => (
                    <button key={t} onClick={() => setTab(t)}
                        className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all capitalize ${tab === t ? 'bg-white dark:bg-zinc-800 shadow text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
                        {t === 'processes' ? 'Procese' : t === 'cron' ? 'Cron Jobs' : 'Screenshot Agent'}
                    </button>
                ))}
            </div>

            {/* ── PROCESSES TAB ── */}
            {tab === 'processes' && (
                <div className="space-y-3">
                    {loadingProcs ? (
                        <div className="flex justify-center py-12"><div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" /></div>
                    ) : processes.length === 0 ? (
                        <div className="text-center py-12 text-gray-400">Nu s-au găsit procese PM2.</div>
                    ) : (
                        processes.map(proc => (
                            <div key={proc.id} className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 flex flex-col md:flex-row md:items-center gap-3">
                                {/* Status + name */}
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusColor(proc.status)}`} />
                                    <div className="min-w-0">
                                        <p className="font-semibold text-sm truncate">{proc.name}</p>
                                        <p className="text-xs text-gray-400">PID {proc.pid || '-'} · restarts {proc.restarts.toLocaleString()}</p>
                                    </div>
                                </div>

                                {/* Stats */}
                                <div className="flex items-center gap-4 text-xs text-gray-500 flex-shrink-0">
                                    <span className={`px-2 py-0.5 rounded-full font-medium ${statusLabel(proc.status)}`}>{proc.status}</span>
                                    <span>⬆ {fmtUptime(proc.uptime)}</span>
                                    <span>🧠 {fmtMem(proc.memory)}</span>
                                    <span>⚡ {proc.cpu}%</span>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <button onClick={() => loadLogs(proc.name)}
                                        className="px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 rounded-lg transition-colors">
                                        Logs
                                    </button>
                                    {proc.status === 'online' ? (
                                        <button onClick={() => pmAction(proc.name, 'stop')}
                                            disabled={actionInProgress === `${proc.name}-stop`}
                                            className="px-3 py-1.5 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 rounded-lg transition-colors disabled:opacity-50">
                                            Stop
                                        </button>
                                    ) : (
                                        <button onClick={() => pmAction(proc.name, 'start')}
                                            disabled={actionInProgress === `${proc.name}-start`}
                                            className="px-3 py-1.5 text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 rounded-lg transition-colors disabled:opacity-50">
                                            Start
                                        </button>
                                    )}
                                    <button onClick={() => pmAction(proc.name, 'restart')}
                                        disabled={actionInProgress === `${proc.name}-restart`}
                                        className="px-3 py-1.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50 rounded-lg transition-colors disabled:opacity-50">
                                        {actionInProgress === `${proc.name}-restart` ? '...' : 'Restart'}
                                    </button>
                                </div>
                            </div>
                        ))
                    )}

                    {/* Logs modal */}
                    {logs && (
                        <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center p-4" onClick={() => setLogs(null)}>
                            <div className="bg-zinc-950 border border-zinc-700 rounded-2xl w-full max-w-2xl max-h-[70vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
                                    <span className="text-sm font-mono font-semibold text-green-400">{logs.name}</span>
                                    <button onClick={() => setLogs(null)} className="text-zinc-400 hover:text-white text-xs font-bold uppercase">Close</button>
                                </div>
                                <pre className="p-4 text-xs font-mono text-gray-300 overflow-auto max-h-[60vh] whitespace-pre-wrap">{logs.text}</pre>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── CRON TAB ── */}
            {tab === 'cron' && (
                <div className="space-y-3">
                    {loadingCron ? (
                        <div className="flex justify-center py-12"><div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" /></div>
                    ) : cronJobs.length === 0 ? (
                        <div className="text-center py-12 text-gray-400">
                            <p>Nu există cron jobs. Creează-le din <a href="/cron-jobs" className="text-blue-500 underline">Cron Jobs</a>.</p>
                        </div>
                    ) : (
                        cronJobs.map(job => (
                            <div key={job._id} className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 flex flex-col md:flex-row md:items-center gap-3">
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${job.isActive ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                                    <div className="min-w-0">
                                        <p className="font-semibold text-sm truncate">{job.name}</p>
                                        <p className="text-xs text-gray-400 font-mono">{job.cronExpression} · {job.actionType}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <button onClick={() => toggleCron(job)}
                                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${job.isActive ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'}`}>
                                        {job.isActive ? 'Pause' : 'Resume'}
                                    </button>
                                    <button onClick={() => deleteCron(job._id)}
                                        className="px-3 py-1.5 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg transition-colors">
                                        Delete
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* ── SCREENSHOT AGENT TAB ── */}
            {tab === 'screenshot' && (
                <div className="space-y-4">
                    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-600 dark:text-purple-400"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></svg>
                            </div>
                            <div>
                                <h2 className="font-semibold">Screenshot Agent</h2>
                                <p className="text-xs text-gray-500">Capturează ecranul și colaborează cu alți agenți</p>
                            </div>
                            <span className="ml-auto text-xs px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-medium">În dezvoltare</span>
                        </div>

                        <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
                            <div className="flex items-start gap-2">
                                <span className="text-emerald-500 mt-0.5">✓</span>
                                <span>Captură de ecran la cerere sau la interval</span>
                            </div>
                            <div className="flex items-start gap-2">
                                <span className="text-emerald-500 mt-0.5">✓</span>
                                <span>Analiză imagine cu Gemini Vision</span>
                            </div>
                            <div className="flex items-start gap-2">
                                <span className="text-emerald-500 mt-0.5">✓</span>
                                <span>Transmitere context visual către alți agenți</span>
                            </div>
                            <div className="flex items-start gap-2">
                                <span className="text-blue-500 mt-0.5">○</span>
                                <span>Agent acțiuni (click, input, scroll) — Redis + Cassandra workflow</span>
                            </div>
                            <div className="flex items-start gap-2">
                                <span className="text-blue-500 mt-0.5">○</span>
                                <span>Autocompletare formulare bazată pe profil</span>
                            </div>
                        </div>
                    </div>

                    <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-2xl p-4 text-sm text-blue-700 dark:text-blue-300">
                        Agentul va utiliza Redis pentru task queues și Cassandra pentru istoricul sesiunilor de automatizare. Infrastructura este deja configurată în backend.
                    </div>
                </div>
            )}
        </div>
    );
}
