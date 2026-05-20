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
}

interface CronJob {
    _id: string;
    name: string;
    cronExpression: string;
    humanSchedule: string;
    actionType: string;
    actionPayload: Record<string, unknown>;
    status: 'active' | 'paused';
    runCount: number;
    lastRun?: string;
    nextRun?: string;
}

type Tab = 'processes' | 'cron' | 'agents';

type ActionType = 'pm2_monitor' | 'email_check_inbox' | 'email_followup' | 'mongo_backup' | 'cleanup_logs' | 'nego_scrape' | 'nego_leads_report' | 'nego_retry_leads' | 'lead_intelligence' | 'http' | 'notification' | 'task';

interface NewJobForm {
    name: string;
    cronExpression: string;
    actionType: ActionType;
    // pm2_monitor / nego whatsapp
    chatId: string;
    userId: string;
    ignoreProcesses: string;
    // http
    url: string;
    method: string;
    // notification / task
    message: string;
    // email
    inboxId: string;
    hoursWithoutReply: string;
    // nego
    categories: string;
    daysWithoutContact: string;
    // backup
    dbName: string;
    olderThanDays: string;
}

const CRON_PRESETS = [
    { label: 'Fiecare 5 min', value: '*/5 * * * *' },
    { label: 'Fiecare 15 min', value: '*/15 * * * *' },
    { label: 'Fiecare 30 min', value: '*/30 * * * *' },
    { label: 'Fiecare oră', value: '0 * * * *' },
    { label: 'Zilnic 08:00', value: '0 8 * * *' },
    { label: 'Zilnic 09:00', value: '0 9 * * *' },
    { label: 'Zilnic 20:00', value: '0 20 * * *' },
];

const ACTION_GROUPS: { label: string; types: { value: ActionType; label: string; description: string }[] }[] = [
    {
        label: 'Monitoring',
        types: [
            { value: 'pm2_monitor', label: 'PM2 Monitor', description: 'Verifică procese, alertă WhatsApp' },
            { value: 'mongo_backup', label: 'MongoDB Backup', description: 'Dump DB local, păstrează 7 zile' },
            { value: 'cleanup_logs', label: 'Cleanup Logs', description: 'Șterge logs PM2 și cron vechi' },
        ]
    },
    {
        label: 'Email Agent',
        types: [
            { value: 'email_check_inbox', label: 'Check Inbox', description: 'Procesează emailuri noi cu agentul' },
            { value: 'email_followup', label: 'Follow-up Email', description: 'Trimite follow-up la emailuri fără răspuns' },
        ]
    },
    {
        label: 'Nego / Leads',
        types: [
            { value: 'nego_scrape', label: 'Scrape OLX', description: 'Extrage leaduri din categorii OLX' },
            { value: 'lead_intelligence', label: 'Lead Intelligence', description: 'Analizează leads noi: scor + mesaj' },
            { value: 'nego_leads_report', label: 'Raport Leads', description: 'Sumară leads → WhatsApp' },
            { value: 'nego_retry_leads', label: 'Retry Leads', description: 'Alertă leads fără contact' },
        ]
    },
    {
        label: 'General',
        types: [
            { value: 'http', label: 'HTTP Request', description: 'Apelează un endpoint HTTP' },
            { value: 'notification', label: 'Notificare', description: 'Log simplu în sistem' },
            { value: 'task', label: 'Task Planner', description: 'Creează un task în Planner' },
        ]
    },
];

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

const DEFAULT_FORM: NewJobForm = {
    name: '',
    cronExpression: '*/5 * * * *',
    actionType: 'pm2_monitor',
    chatId: '',
    userId: '',
    ignoreProcesses: '',
    url: '',
    method: 'GET',
    message: '',
    inboxId: '',
    hoursWithoutReply: '48',
    categories: '',
    daysWithoutContact: '3',
    dbName: 'usa_db',
    olderThanDays: '7',
};

export default function AgentsPage() {
    const [tab, setTab] = useState<Tab>('agents');
    const [processes, setProcesses] = useState<PM2Process[]>([]);
    const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
    const [loadingProcs, setLoadingProcs] = useState(true);
    const [loadingCron, setLoadingCron] = useState(true);
    const [actionInProgress, setActionInProgress] = useState<string | null>(null);
    const [logs, setLogs] = useState<{ name: string; text: string } | null>(null);
    const [showAddCron, setShowAddCron] = useState(false);
    const [form, setForm] = useState<NewJobForm>(DEFAULT_FORM);
    const [saving, setSaving] = useState(false);

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
        const endpoint = job.status === 'active'
            ? `/api/cron-jobs/${job._id}/pause`
            : `/api/cron-jobs/${job._id}/resume`;
        await api.post(endpoint, {});
        fetchCron();
    };

    const deleteCron = async (id: string) => {
        if (!confirm('Ștergi acest cron job?')) return;
        await api.delete(`/api/cron-jobs/${id}`);
        fetchCron();
    };

    const buildPayload = (f: NewJobForm): Record<string, unknown> => {
        switch (f.actionType) {
            case 'pm2_monitor': {
                const p: Record<string, unknown> = {};
                if (f.chatId) p.chatId = f.chatId.trim();
                if (f.userId) p.userId = f.userId.trim();
                if (f.ignoreProcesses) p.ignoreProcesses = f.ignoreProcesses.split(',').map(s => s.trim()).filter(Boolean);
                return p;
            }
            case 'email_check_inbox': {
                const p: Record<string, unknown> = {};
                if (f.inboxId) p.inboxId = f.inboxId.trim();
                return p;
            }
            case 'email_followup': {
                const p: Record<string, unknown> = { hoursWithoutReply: Number(f.hoursWithoutReply) || 48 };
                if (f.inboxId) p.inboxId = f.inboxId.trim();
                return p;
            }
            case 'mongo_backup':
                return { dbName: f.dbName || 'usa_db' };
            case 'cleanup_logs':
                return { olderThanDays: Number(f.olderThanDays) || 7 };
            case 'lead_intelligence':
                return { chatId: f.chatId.trim(), userId: f.userId.trim(), limit: 10 };
            case 'nego_scrape':
                return { categories: f.categories.split('\n').map(s => s.trim()).filter(Boolean) };
            case 'nego_leads_report':
            case 'nego_retry_leads': {
                const p: Record<string, unknown> = {};
                if (f.chatId) p.chatId = f.chatId.trim();
                if (f.userId) p.userId = f.userId.trim();
                if (f.actionType === 'nego_retry_leads') p.daysWithoutContact = Number(f.daysWithoutContact) || 3;
                return p;
            }
            case 'http':
                return { url: f.url, method: f.method };
            case 'notification':
                return { message: f.message };
            case 'task':
                return { title: f.message || f.name };
            default:
                return {};
        }
    };

    const submitNewJob = async () => {
        if (!form.name || !form.cronExpression) return;
        setSaving(true);
        try {
            await api.post('/api/cron-jobs', {
                name: form.name,
                cronExpression: form.cronExpression,
                actionType: form.actionType,
                actionPayload: buildPayload(form),
            });
            setShowAddCron(false);
            setForm(DEFAULT_FORM);
            fetchCron();
        } catch { }
        setSaving(false);
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
                        {stopped > 0 && <span className="text-red-500 font-semibold"> · {stopped} down</span>}
                    </p>
                </div>
                <button onClick={fetchProcesses} className="p-2 rounded-xl bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></svg>
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-gray-100 dark:bg-zinc-900 p-1 rounded-xl w-fit">
                {(['agents', 'cron', 'processes'] as Tab[]).map(t => (
                    <button key={t} onClick={() => setTab(t)}
                        className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === t ? 'bg-white dark:bg-zinc-800 shadow text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
                        {t === 'agents' ? 'Agenți' : t === 'cron' ? 'Cron Jobs' : 'Procese PM2'}
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
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusColor(proc.status)}`} />
                                    <div className="min-w-0">
                                        <p className="font-semibold text-sm truncate">{proc.name}</p>
                                        <p className="text-xs text-gray-400">PID {proc.pid || '-'} · restarts {proc.restarts.toLocaleString()}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 text-xs text-gray-500 flex-shrink-0">
                                    <span className={`px-2 py-0.5 rounded-full font-medium ${statusLabel(proc.status)}`}>{proc.status}</span>
                                    <span>⬆ {fmtUptime(proc.uptime)}</span>
                                    <span>🧠 {fmtMem(proc.memory)}</span>
                                    <span>⚡ {proc.cpu}%</span>
                                </div>
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
                    {/* Add button */}
                    <div className="flex justify-end">
                        <button onClick={() => setShowAddCron(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                            Adaugă Cron Job
                        </button>
                    </div>

                    {loadingCron ? (
                        <div className="flex justify-center py-12"><div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" /></div>
                    ) : cronJobs.length === 0 ? (
                        <div className="text-center py-16 text-gray-400">
                            <p className="text-4xl mb-3">⏰</p>
                            <p className="font-medium">Niciun cron job configurat</p>
                            <p className="text-sm mt-1">Apasă „Adaugă Cron Job" pentru a crea primul.</p>
                        </div>
                    ) : (
                        cronJobs.map(job => (
                            <div key={job._id} className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 flex flex-col md:flex-row md:items-center gap-3">
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${job.status === 'active' ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                                    <div className="min-w-0">
                                        <p className="font-semibold text-sm truncate">{job.name}</p>
                                        <p className="text-xs text-gray-400 font-mono">{job.humanSchedule || job.cronExpression} · <span className="text-indigo-400">{job.actionType}</span></p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 text-xs text-gray-400 flex-shrink-0">
                                    {job.runCount > 0 && <span>Rulări: {job.runCount}</span>}
                                    {job.nextRun && <span>Următor: {new Date(job.nextRun).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}</span>}
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <button onClick={() => toggleCron(job)}
                                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${job.status === 'active' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'}`}>
                                        {job.status === 'active' ? 'Pause' : 'Resume'}
                                    </button>
                                    <button onClick={() => deleteCron(job._id)}
                                        className="px-3 py-1.5 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg transition-colors">
                                        Delete
                                    </button>
                                </div>
                            </div>
                        ))
                    )}

                    {/* Add Cron Modal */}
                    {showAddCron && (
                        <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center p-4" onClick={() => setShowAddCron(false)}>
                            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-800">
                                    <h2 className="font-semibold">Adaugă Cron Job</h2>
                                    <button onClick={() => setShowAddCron(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xs font-bold uppercase">Închide</button>
                                </div>
                                <div className="p-5 space-y-4">
                                    {/* Name */}
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1">Nume *</label>
                                        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                            placeholder="ex: PM2 Monitor Alert"
                                            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                    </div>

                                    {/* Cron expression */}
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1">Interval *</label>
                                        <div className="flex flex-wrap gap-2 mb-2">
                                            {CRON_PRESETS.map(p => (
                                                <button key={p.value} onClick={() => setForm(f => ({ ...f, cronExpression: p.value }))}
                                                    className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${form.cronExpression === p.value ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'border-gray-200 dark:border-zinc-700 text-gray-500 hover:border-gray-400'}`}>
                                                    {p.label}
                                                </button>
                                            ))}
                                        </div>
                                        <input value={form.cronExpression} onChange={e => setForm(f => ({ ...f, cronExpression: e.target.value }))}
                                            placeholder="*/5 * * * *"
                                            className="w-full px-3 py-2 text-sm font-mono border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                    </div>

                                    {/* Action type */}
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-2">Tip acțiune *</label>
                                        <div className="space-y-3">
                                            {ACTION_GROUPS.map(group => (
                                                <div key={group.label}>
                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">{group.label}</p>
                                                    <div className="grid grid-cols-2 gap-1.5">
                                                        {group.types.map(at => (
                                                            <button key={at.value} onClick={() => setForm(f => ({ ...f, actionType: at.value }))}
                                                                className={`p-2.5 rounded-xl border text-left transition-colors ${form.actionType === at.value ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-zinc-700 hover:border-gray-400'}`}>
                                                                <p className={`text-xs font-semibold ${form.actionType === at.value ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'}`}>{at.label}</p>
                                                                <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{at.description}</p>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Dynamic fields */}
                                    {form.actionType === 'pm2_monitor' && (
                                        <div className="space-y-3 p-3 bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-200 dark:border-indigo-800 rounded-xl">
                                            <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">PM2 Monitor — WhatsApp Alert</p>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-500 mb-1">Chat ID WhatsApp</label>
                                                <input value={form.chatId} onChange={e => setForm(f => ({ ...f, chatId: e.target.value }))}
                                                    placeholder="40712345678@c.us"
                                                    className="w-full px-3 py-2 text-sm font-mono border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                                                <p className="text-[10px] text-gray-400 mt-1">Format: număr_telefon@c.us</p>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-500 mb-1">Procese ignorate</label>
                                                <input value={form.ignoreProcesses} onChange={e => setForm(f => ({ ...f, ignoreProcesses: e.target.value }))}
                                                    placeholder="book-bridge, nego-bridge"
                                                    className="w-full px-3 py-2 text-sm font-mono border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                                                <p className="text-[10px] text-gray-400 mt-1">Separate prin virgulă</p>
                                            </div>
                                        </div>
                                    )}

                                    {(form.actionType === 'email_check_inbox' || form.actionType === 'email_followup') && (
                                        <div className="space-y-3 p-3 bg-sky-50 dark:bg-sky-900/10 border border-sky-200 dark:border-sky-800 rounded-xl">
                                            <p className="text-xs font-semibold text-sky-600 dark:text-sky-400">
                                                {form.actionType === 'email_check_inbox' ? 'Email Agent — Check Inbox' : 'Email Agent — Follow-up'}
                                            </p>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-500 mb-1">Inbox ID (opțional — toate dacă gol)</label>
                                                <input value={form.inboxId} onChange={e => setForm(f => ({ ...f, inboxId: e.target.value }))}
                                                    placeholder="Lasă gol pentru toate inbox-urile active"
                                                    className="w-full px-3 py-2 text-sm font-mono border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-sky-500" />
                                            </div>
                                            {form.actionType === 'email_followup' && (
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-500 mb-1">Ore fără răspuns</label>
                                                    <input type="number" value={form.hoursWithoutReply} onChange={e => setForm(f => ({ ...f, hoursWithoutReply: e.target.value }))}
                                                        min="1" max="168"
                                                        className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-sky-500" />
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {form.actionType === 'mongo_backup' && (
                                        <div className="space-y-3 p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl">
                                            <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">MongoDB Backup</p>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-500 mb-1">Nume bază de date</label>
                                                <input value={form.dbName} onChange={e => setForm(f => ({ ...f, dbName: e.target.value }))}
                                                    placeholder="usa_db"
                                                    className="w-full px-3 py-2 text-sm font-mono border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                                                <p className="text-[10px] text-gray-400 mt-1">Backup în /root/backups/mongo/ — păstrează ultimele 7</p>
                                            </div>
                                        </div>
                                    )}

                                    {form.actionType === 'cleanup_logs' && (
                                        <div className="p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl">
                                            <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-2">Cleanup Logs</p>
                                            <label className="block text-xs font-medium text-gray-500 mb-1">Șterge logs mai vechi de (zile)</label>
                                            <input type="number" value={form.olderThanDays} onChange={e => setForm(f => ({ ...f, olderThanDays: e.target.value }))}
                                                min="1"
                                                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                                        </div>
                                    )}

                                    {form.actionType === 'lead_intelligence' && (
                                        <div className="space-y-3 p-3 bg-violet-50 dark:bg-violet-900/10 border border-violet-200 dark:border-violet-800 rounded-xl">
                                            <p className="text-xs font-semibold text-violet-600 dark:text-violet-400">Lead Intelligence — Batch automat</p>
                                            <p className="text-[10px] text-gray-400">Analizează leadurile noi din negoapp (status: new cu URL) și trimite raport WhatsApp.</p>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-500 mb-1">Chat ID WhatsApp</label>
                                                <input value={form.chatId} onChange={e => setForm(f => ({ ...f, chatId: e.target.value }))}
                                                    placeholder="40712345678@c.us"
                                                    className="w-full px-3 py-2 text-sm font-mono border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                                            </div>
                                        </div>
                                    )}

                                    {form.actionType === 'nego_scrape' && (
                                        <div className="space-y-3 p-3 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 rounded-xl">
                                            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Scrape OLX Categorii</p>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-500 mb-1">URL-uri categorii (unul per linie)</label>
                                                <textarea value={form.categories} onChange={e => setForm(f => ({ ...f, categories: e.target.value }))}
                                                    rows={3} placeholder={"https://www.olx.ro/imobiliare/apartamente-garsoniere-de-vanzare/\nhttps://www.olx.ro/imobiliare/case-de-vanzare/"}
                                                    className="w-full px-3 py-2 text-sm font-mono border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none" />
                                            </div>
                                        </div>
                                    )}

                                    {(form.actionType === 'nego_leads_report' || form.actionType === 'nego_retry_leads') && (
                                        <div className="space-y-3 p-3 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 rounded-xl">
                                            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                                {form.actionType === 'nego_leads_report' ? 'Raport Leads — WhatsApp' : 'Retry Leads — WhatsApp'}
                                            </p>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-500 mb-1">Chat ID WhatsApp</label>
                                                <input value={form.chatId} onChange={e => setForm(f => ({ ...f, chatId: e.target.value }))}
                                                    placeholder="40712345678@c.us"
                                                    className="w-full px-3 py-2 text-sm font-mono border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                                            </div>
                                            {form.actionType === 'nego_retry_leads' && (
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-500 mb-1">Zile fără contact</label>
                                                    <input type="number" value={form.daysWithoutContact} onChange={e => setForm(f => ({ ...f, daysWithoutContact: e.target.value }))}
                                                        min="1"
                                                        className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {form.actionType === 'http' && (
                                        <div className="flex gap-2">
                                            <select value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))}
                                                className="px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none">
                                                {['GET', 'POST', 'PUT', 'PATCH'].map(m => <option key={m}>{m}</option>)}
                                            </select>
                                            <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                                                placeholder="https://..."
                                                className="flex-1 px-3 py-2 text-sm font-mono border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                        </div>
                                    )}

                                    {(form.actionType === 'notification' || form.actionType === 'task') && (
                                        <div>
                                            <label className="block text-xs font-medium text-gray-500 mb-1">
                                                {form.actionType === 'notification' ? 'Mesaj' : 'Titlu task'}
                                            </label>
                                            <input value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                                                placeholder={form.actionType === 'notification' ? 'Mesajul notificării' : 'Titlul task-ului creat'}
                                                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                        </div>
                                    )}

                                    <button onClick={submitNewJob} disabled={saving || !form.name || !form.cronExpression}
                                        className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium text-sm rounded-xl transition-colors">
                                        {saving ? 'Se salvează...' : 'Creează Cron Job'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── SCREENSHOT AGENT TAB ── */}
            {tab === 'agents' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                    {/* Messenger Agent */}
                    <div className="bg-white dark:bg-zinc-900 border border-indigo-200 dark:border-indigo-800 rounded-2xl p-5">
                        <div className="flex items-start gap-3 mb-3">
                            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center flex-shrink-0">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-600 dark:text-indigo-400"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <h3 className="font-semibold text-sm">Messenger Agent</h3>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-medium">Activ</span>
                                </div>
                                <p className="text-xs text-gray-500 mt-0.5">Trimite email sau WhatsApp cu transcript</p>
                            </div>
                        </div>
                        <div className="space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
                            <div className="flex gap-2"><span className="text-emerald-500">✓</span><span>Trimite conversația curentă pe email</span></div>
                            <div className="flex gap-2"><span className="text-emerald-500">✓</span><span>Trimite pe WhatsApp via Nego bridge</span></div>
                            <div className="flex gap-2"><span className="text-emerald-500">✓</span><span>Atașează transcript automat în body</span></div>
                            <div className="flex gap-2"><span className="text-emerald-500">✓</span><span>Text suplimentar + transcript combinat</span></div>
                        </div>
                        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-zinc-800">
                            <p className="text-[10px] text-gray-400 font-medium mb-1">COMENZI VOCALE:</p>
                            <p className="text-[10px] text-indigo-500 dark:text-indigo-400 italic">&ldquo;Trimite conversația pe email la x@y.com&rdquo;</p>
                            <p className="text-[10px] text-indigo-500 dark:text-indigo-400 italic">&ldquo;Trimite discuția asta pe WhatsApp&rdquo;</p>
                        </div>
                    </div>

                    {/* Email Agent */}
                    <div className="bg-white dark:bg-zinc-900 border border-blue-200 dark:border-blue-800 rounded-2xl p-5">
                        <div className="flex items-start gap-3 mb-3">
                            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600 dark:text-blue-400"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <h3 className="font-semibold text-sm">Email Agent</h3>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-medium">Activ</span>
                                </div>
                                <p className="text-xs text-gray-500 mt-0.5">AgentMail — inbox-uri + auto-reply</p>
                            </div>
                        </div>
                        <div className="space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
                            <div className="flex gap-2"><span className="text-emerald-500">✓</span><span>Creare și management inbox-uri</span></div>
                            <div className="flex gap-2"><span className="text-emerald-500">✓</span><span>Trimite și citește emailuri</span></div>
                            <div className="flex gap-2"><span className="text-emerald-500">✓</span><span>Auto-reply negociere (via Nego bridge)</span></div>
                            <div className="flex gap-2"><span className="text-emerald-500">✓</span><span>Follow-up automat nerespunse</span></div>
                        </div>
                        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-zinc-800">
                            <p className="text-[10px] text-gray-400 font-medium mb-1">COMENZI VOCALE:</p>
                            <p className="text-[10px] text-blue-500 dark:text-blue-400 italic">&ldquo;Trimite un email lui X despre Y&rdquo;</p>
                            <p className="text-[10px] text-blue-500 dark:text-blue-400 italic">&ldquo;Ce emailuri am în inbox?&rdquo;</p>
                        </div>
                    </div>

                    {/* WhatsApp / Nego Agent */}
                    <div className="bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-5">
                        <div className="flex items-start gap-3 mb-3">
                            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600 dark:text-emerald-400"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <h3 className="font-semibold text-sm">WhatsApp / Nego Agent</h3>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-medium">MCP Bridge</span>
                                </div>
                                <p className="text-xs text-gray-500 mt-0.5">Negociator.site via MCP Bridge</p>
                            </div>
                        </div>
                        <div className="space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
                            <div className="flex gap-2"><span className="text-emerald-500">✓</span><span>Scrape OLX categorii + extragere leaduri</span></div>
                            <div className="flex gap-2"><span className="text-emerald-500">✓</span><span>Trimite mesaje WhatsApp la contacte</span></div>
                            <div className="flex gap-2"><span className="text-emerald-500">✓</span><span>Negociere automată multi-pas</span></div>
                            <div className="flex gap-2"><span className="text-emerald-500">✓</span><span>16 tool-uri expuse via MCP Bridge</span></div>
                        </div>
                        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-zinc-800">
                            <p className="text-[10px] text-gray-400 font-medium mb-1">COMENZI VOCALE:</p>
                            <p className="text-[10px] text-emerald-500 dark:text-emerald-400 italic">&ldquo;Scanează OLX pentru apartamente 2 camere&rdquo;</p>
                            <p className="text-[10px] text-emerald-500 dark:text-emerald-400 italic">&ldquo;Arată lead-urile din negoapp&rdquo;</p>
                        </div>
                    </div>

                    {/* Orchestrator */}
                    <div className="bg-white dark:bg-zinc-900 border border-violet-200 dark:border-violet-800 rounded-2xl p-5">
                        <div className="flex items-start gap-3 mb-3">
                            <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center flex-shrink-0">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-violet-600 dark:text-violet-400"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/></svg>
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <h3 className="font-semibold text-sm">Orchestrator (Ilie)</h3>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-medium">Activ</span>
                                </div>
                                <p className="text-xs text-gray-500 mt-0.5">Gemini 2.5 Flash — AI brain central</p>
                            </div>
                        </div>
                        <div className="space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
                            <div className="flex gap-2"><span className="text-emerald-500">✓</span><span>Rutează comenzi vocale către agenți</span></div>
                            <div className="flex gap-2"><span className="text-emerald-500">✓</span><span>Memorie pe termen lung (Cassandra)</span></div>
                            <div className="flex gap-2"><span className="text-emerald-500">✓</span><span>20+ tool-uri: GitHub, Cron, Coding, Nego</span></div>
                            <div className="flex gap-2"><span className="text-emerald-500">✓</span><span>Voice via Gemini Live (buton microfon)</span></div>
                        </div>
                        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-zinc-800">
                            <p className="text-[10px] text-gray-400 font-medium mb-1">ACCES:</p>
                            <p className="text-[10px] text-violet-500 dark:text-violet-400 italic">Pagina /orchestrator sau buton microfon (FAB)</p>
                        </div>
                    </div>

                    {/* Screenshot Agent */}
                    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl p-5 opacity-75">
                        <div className="flex items-start gap-3 mb-3">
                            <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center flex-shrink-0">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-600 dark:text-purple-400"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <h3 className="font-semibold text-sm">Screenshot Agent</h3>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-medium">În dezvoltare</span>
                                </div>
                                <p className="text-xs text-gray-500 mt-0.5">Capturează ecranul + Gemini Vision</p>
                            </div>
                        </div>
                        <div className="space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
                            <div className="flex gap-2"><span className="text-gray-400">○</span><span>Captură ecran la cerere sau interval</span></div>
                            <div className="flex gap-2"><span className="text-gray-400">○</span><span>Analiză cu Gemini Vision</span></div>
                            <div className="flex gap-2"><span className="text-gray-400">○</span><span>Autocompletare formulare (profil)</span></div>
                            <div className="flex gap-2"><span className="text-gray-400">○</span><span>Agent acțiuni: click, input, scroll</span></div>
                        </div>
                    </div>

                    {/* Form Autocomplete Agent */}
                    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl p-5 opacity-75">
                        <div className="flex items-start gap-3 mb-3">
                            <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center flex-shrink-0">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-orange-600 dark:text-orange-400"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <h3 className="font-semibold text-sm">Form Autocomplete</h3>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-medium">În dezvoltare</span>
                                </div>
                                <p className="text-xs text-gray-500 mt-0.5">Completează formulare din Profil</p>
                            </div>
                        </div>
                        <div className="space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
                            <div className="flex gap-2"><span className="text-gray-400">○</span><span>Citește datele din Settings → Profil</span></div>
                            <div className="flex gap-2"><span className="text-gray-400">○</span><span>Completează formulare web automat</span></div>
                            <div className="flex gap-2"><span className="text-gray-400">○</span><span>Extensie Chrome / browser mobil</span></div>
                            <div className="flex gap-2"><span className="text-gray-400">○</span><span>Integrare cu Screenshot Agent</span></div>
                        </div>
                    </div>

                </div>
            )}
        </div>
    );
}
