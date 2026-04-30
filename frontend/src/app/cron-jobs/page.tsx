'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

interface CronJob {
    _id: string;
    name: string;
    cronExpression: string;
    actionType: 'notification' | 'task' | 'whatsapp' | 'http';
    actionPayload: Record<string, unknown>;
    status: 'active' | 'paused';
    lastRun: string | null;
    nextRun: string | null;
    runCount: number;
    createdAt: string;
    humanSchedule?: string;
    isRunning?: boolean;
}

interface CronLog {
    _id: string;
    cronJobId: string;
    jobName: string;
    actionType: string;
    result: 'success' | 'error';
    output: string;
    executedAt: string;
}

const actionIcons: Record<string, string> = {
    notification: '🔔',
    task: '📋',
    whatsapp: '📱',
    http: '🌐',
};

const actionColors: Record<string, string> = {
    notification: 'from-amber-500 to-orange-500',
    task: 'from-teal-500 to-cyan-500',
    whatsapp: 'from-green-500 to-emerald-500',
    http: 'from-blue-500 to-indigo-500',
};

const cronPresets = [
    { label: 'Every minute', value: '* * * * *' },
    { label: 'Every 5 minutes', value: '*/5 * * * *' },
    { label: 'Every 15 minutes', value: '*/15 * * * *' },
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Every day at 8:00', value: '0 8 * * *' },
    { label: 'Every day at 9:00', value: '0 9 * * *' },
    { label: 'Every day at 12:00', value: '0 12 * * *' },
    { label: 'Every day at 20:00', value: '0 20 * * *' },
    { label: 'Weekdays at 8:00', value: '0 8 * * 1-5' },
    { label: 'Every Monday', value: '0 0 * * 1' },
    { label: 'First of month', value: '0 0 1 * *' },
];

export default function CronJobsPage() {
    const [jobs, setJobs] = useState<CronJob[]>([]);
    const [logs, setLogs] = useState<CronLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'jobs' | 'logs'>('jobs');
    const [showCreate, setShowCreate] = useState(false);
    const [selectedJobLogs, setSelectedJobLogs] = useState<string | null>(null);

    // Create form state
    const [formName, setFormName] = useState('');
    const [formCron, setFormCron] = useState('0 8 * * *');
    const [formAction, setFormAction] = useState<string>('notification');
    const [formPayload, setFormPayload] = useState('{"message": "Hello!"}');
    const [creating, setCreating] = useState(false);

    const loadJobs = useCallback(async () => {
        try {
            const data = await api.get<CronJob[]>('/api/cron-jobs');
            if (Array.isArray(data)) setJobs(data);
        } catch { }
        setLoading(false);
    }, []);

    const loadLogs = useCallback(async (jobId?: string) => {
        try {
            const url = jobId ? `/api/cron-jobs/${jobId}/logs` : '/api/cron-jobs/logs/recent';
            const data = await api.get<CronLog[]>(url);
            if (Array.isArray(data)) setLogs(data);
        } catch { }
    }, []);

    useEffect(() => { loadJobs(); loadLogs(); }, [loadJobs, loadLogs]);

    const handleCreate = async () => {
        if (!formName.trim() || !formCron.trim()) return;
        setCreating(true);
        try {
            let payload = {};
            try { payload = JSON.parse(formPayload); } catch { payload = { message: formPayload }; }

            await api.post('/api/cron-jobs', {
                name: formName,
                cronExpression: formCron,
                actionType: formAction,
                actionPayload: payload,
            });
            setShowCreate(false);
            setFormName('');
            setFormCron('0 8 * * *');
            setFormAction('notification');
            setFormPayload('{"message": "Hello!"}');
            loadJobs();
        } catch { }
        setCreating(false);
    };

    const toggleJob = async (id: string, currentStatus: string) => {
        const endpoint = currentStatus === 'active' ? 'pause' : 'resume';
        try {
            await api.post(`/api/cron-jobs/${id}/${endpoint}`);
            loadJobs();
        } catch { }
    };

    const deleteJob = async (id: string) => {
        if (!confirm('Delete this cron job?')) return;
        try {
            await api.delete(`/api/cron-jobs/${id}`);
            loadJobs();
            loadLogs();
        } catch { }
    };

    const viewJobLogs = (jobId: string) => {
        setSelectedJobLogs(jobId);
        setActiveTab('logs');
        loadLogs(jobId);
    };

    const formatDate = (d: string | null) => {
        if (!d) return '—';
        return new Date(d).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    };

    const formatTimeAgo = (d: string) => {
        // eslint-disable-next-line react-hooks/purity
        const diff = Date.now() - new Date(d).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.floor(hrs / 24)}d ago`;
    };

    return (
        <div className="h-[calc(100dvh-6rem)] md:h-[calc(100vh-4rem)] flex flex-col max-w-5xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-2 border-b border-gray-200 dark:border-zinc-800 sticky top-0 bg-white dark:bg-[#0a0a0a] z-10">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                    </div>
                    <div>
                        <h1 className="text-base md:text-xl font-bold tracking-tight">Cron Jobs</h1>
                        <p className="text-[10px] md:text-xs text-amber-500 font-medium">
                            {jobs.filter(j => j.status === 'active').length} active · {jobs.length} total
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {/* Tab switcher */}
                    <div className="flex gap-1 bg-gray-100 dark:bg-zinc-800 rounded-lg p-0.5">
                        <button onClick={() => { setActiveTab('jobs'); setSelectedJobLogs(null); }}
                            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${activeTab === 'jobs' ? 'bg-white dark:bg-zinc-700 shadow-sm' : 'text-gray-500'}`}>
                            Jobs
                        </button>
                        <button onClick={() => { setActiveTab('logs'); setSelectedJobLogs(null); loadLogs(); }}
                            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${activeTab === 'logs' ? 'bg-white dark:bg-zinc-700 shadow-sm' : 'text-gray-500'}`}>
                            Logs
                        </button>
                    </div>
                    <button onClick={() => setShowCreate(!showCreate)}
                        className="p-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg hover:shadow-amber-500/25 transition-all">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                    </button>
                </div>
            </div>

            {/* Create Form */}
            {showCreate && (
                <div className="mt-3 p-4 rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 space-y-3 animate-in slide-in-from-top-2">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                        <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white text-xs">⏰</span>
                        New Cron Job
                    </h3>

                    <input
                        type="text" value={formName} onChange={e => setFormName(e.target.value)}
                        placeholder="Job name (e.g. Morning reminder)"
                        className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                    />

                    <div className="flex gap-2 flex-wrap">
                        <select value={formCron} onChange={e => setFormCron(e.target.value)}
                            className="flex-1 min-w-[180px] px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-amber-500 outline-none">
                            {cronPresets.map(p => (
                                <option key={p.value} value={p.value}>{p.label} ({p.value})</option>
                            ))}
                        </select>
                        <input
                            type="text" value={formCron} onChange={e => setFormCron(e.target.value)}
                            placeholder="Custom cron expression"
                            className="flex-1 min-w-[140px] px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-amber-500 outline-none font-mono"
                        />
                    </div>

                    <div className="flex gap-2">
                        {(['notification', 'task', 'whatsapp', 'http'] as const).map(type => (
                            <button key={type} onClick={() => {
                                setFormAction(type);
                                if (type === 'notification') setFormPayload('{"message": "Hello!"}');
                                else if (type === 'task') setFormPayload('{"title": "Auto task", "priority": "medium"}');
                                else if (type === 'whatsapp') setFormPayload('{"to": "Contact Name", "message": "Hello!"}');
                                else if (type === 'http') setFormPayload('{"url": "https://example.com", "method": "GET"}');
                            }}
                                className={`flex-1 py-2 rounded-xl text-xs font-medium transition-all border
                                    ${formAction === type
                                        ? 'bg-gradient-to-r ' + actionColors[type] + ' text-white border-transparent shadow-md'
                                        : 'border-gray-200 dark:border-zinc-700 text-gray-500 hover:border-amber-300'}`}>
                                {actionIcons[type]} {type}
                            </button>
                        ))}
                    </div>

                    <textarea
                        value={formPayload} onChange={e => setFormPayload(e.target.value)} rows={2}
                        placeholder="Action payload (JSON)"
                        className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-amber-500 outline-none font-mono resize-none"
                    />

                    <div className="flex justify-end gap-2">
                        <button onClick={() => setShowCreate(false)}
                            className="px-4 py-2 rounded-xl text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors">
                            Cancel
                        </button>
                        <button onClick={handleCreate} disabled={!formName.trim() || creating}
                            className="px-4 py-2 rounded-xl text-sm font-medium bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md hover:shadow-lg disabled:opacity-40 transition-all">
                            {creating ? 'Creating...' : 'Create Job'}
                        </button>
                    </div>
                </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto mt-3 space-y-2 pb-4">
                {activeTab === 'jobs' ? (
                    <>
                        {loading ? (
                            <div className="flex justify-center items-center h-48">
                                <div className="animate-spin w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full" />
                            </div>
                        ) : jobs.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-48 text-center px-4">
                                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 flex items-center justify-center mb-3">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-amber-500" strokeWidth="1.5"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                                </div>
                                <h3 className="text-sm font-semibold mb-1">No cron jobs yet</h3>
                                <p className="text-xs text-gray-500 max-w-xs">Schedule recurring tasks, notifications, or API calls. Click the + button to get started.</p>
                            </div>
                        ) : (
                            jobs.map(job => (
                                <div key={job._id}
                                    className={`p-3 md:p-4 rounded-2xl border transition-all hover:shadow-md ${job.status === 'active'
                                        ? 'border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80'
                                        : 'border-gray-100 dark:border-zinc-800/50 bg-gray-50/50 dark:bg-zinc-950/30 opacity-60'
                                        }`}>
                                    <div className="flex items-start gap-3">
                                        {/* Icon */}
                                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${actionColors[job.actionType]} flex items-center justify-center text-white text-lg flex-shrink-0 shadow-md`}>
                                            {actionIcons[job.actionType]}
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <h4 className="text-sm font-semibold truncate">{job.name}</h4>
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${job.status === 'active'
                                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                                    : 'bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-gray-400'
                                                    }`}>
                                                    {job.status === 'active' ? '● Active' : '⏸ Paused'}
                                                </span>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-0.5 font-mono">{job.cronExpression}</p>
                                            {job.humanSchedule && job.humanSchedule !== job.cronExpression && (
                                                <p className="text-[10px] text-amber-500 dark:text-amber-400 mt-0.5">{job.humanSchedule}</p>
                                            )}
                                            <div className="flex flex-wrap items-center gap-3 mt-2 text-[10px] text-gray-400">
                                                <span>🔄 {job.runCount} runs</span>
                                                <span>⏱️ Last: {formatDate(job.lastRun)}</span>
                                                {job.status === 'active' && <span>⏭️ Next: {formatDate(job.nextRun)}</span>}
                                            </div>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                            <button onClick={() => viewJobLogs(job._id)}
                                                className="p-2 rounded-lg text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors" title="View logs">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" /></svg>
                                            </button>
                                            <button onClick={() => toggleJob(job._id, job.status)}
                                                className={`p-2 rounded-lg transition-colors ${job.status === 'active'
                                                    ? 'text-gray-400 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20'
                                                    : 'text-gray-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20'
                                                    }`} title={job.status === 'active' ? 'Pause' : 'Resume'}>
                                                {job.status === 'active' ? (
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                                                ) : (
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                                                )}
                                            </button>
                                            <button onClick={() => deleteJob(job._id)}
                                                className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" title="Delete">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </>
                ) : (
                    /* Logs Tab */
                    <>
                        {selectedJobLogs && (
                            <button onClick={() => { setSelectedJobLogs(null); loadLogs(); }}
                                className="text-xs text-amber-500 hover:text-amber-600 flex items-center gap-1 mb-2 transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
                                Show all logs
                            </button>
                        )}
                        {logs.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-48 text-center px-4">
                                <p className="text-xs text-gray-400">No execution logs yet.</p>
                            </div>
                        ) : (
                            logs.map(log => (
                                <div key={log._id}
                                    className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${log.result === 'success'
                                        ? 'border-gray-100 dark:border-zinc-800 bg-white dark:bg-zinc-900/50'
                                        : 'border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20'
                                        }`}>
                                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${log.result === 'success' ? 'bg-green-400' : 'bg-red-400'}`} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-medium truncate">{log.jobName}</span>
                                            <span className="text-[10px] text-gray-400">{actionIcons[log.actionType]}</span>
                                        </div>
                                        <p className="text-[10px] text-gray-500 truncate mt-0.5">{log.output}</p>
                                    </div>
                                    <span className="text-[10px] text-gray-400 flex-shrink-0">{formatTimeAgo(log.executedAt)}</span>
                                </div>
                            ))
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
