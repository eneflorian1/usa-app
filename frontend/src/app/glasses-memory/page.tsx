'use client';

import { useState, useEffect, useCallback } from 'react';

interface Memory {
    _id: string;
    category: string;
    content: string;
    importance: string;
    source: string;
    updatedAt: string;
}

const CATEGORIES = ['all', 'observation', 'preference', 'fact', 'person', 'conversation', 'general'];

const categoryMeta: Record<string, { icon: string; label: string; color: string }> = {
    observation: { icon: '👁️', label: 'Observație', color: 'from-cyan-500 to-blue-600' },
    preference: { icon: '❤️', label: 'Preferință', color: 'from-pink-500 to-rose-600' },
    fact: { icon: '📌', label: 'Fapt', color: 'from-amber-500 to-orange-600' },
    person: { icon: '👤', label: 'Persoană', color: 'from-violet-500 to-purple-600' },
    conversation: { icon: '💬', label: 'Conversație', color: 'from-emerald-500 to-teal-600' },
    general: { icon: '🧠', label: 'General', color: 'from-gray-500 to-slate-600' },
};

export default function GlassesMemoryPage() {
    const [memories, setMemories] = useState<Memory[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all');
    const [stats, setStats] = useState<Record<string, number>>({});
    const [syncStatus, setSyncStatus] = useState('');

    const loadMemories = useCallback(async () => {
        try {
            const res = await fetch('/api/glasses/memories?limit=100');
            const data = await res.json();
            if (Array.isArray(data)) {
                setMemories(data);
                // Calculate stats
                const s: Record<string, number> = {};
                for (const m of data) {
                    s[m.category] = (s[m.category] || 0) + 1;
                }
                setStats(s);
            }
        } catch { }
        setLoading(false);
    }, []);

    useEffect(() => { loadMemories(); }, [loadMemories]);

    const handleDelete = async (id: string) => {
        await fetch(`/api/glasses/memories/${id}`, { method: 'DELETE' });
        setMemories(prev => prev.filter(m => m._id !== id));
    };

    const handleClearAll = async () => {
        if (!confirm('Ștergi TOATE memoriile? Aceasta nu poate fi anulată.')) return;
        await fetch('/api/glasses/memories', { method: 'DELETE' });
        setMemories([]);
        setStats({});
    };

    const handleSyncFromVPS = async () => {
        setSyncStatus('Syncing...');
        try {
            const res = await fetch('/api/glasses/sync-from-vps', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vpsUrl: 'http://155.117.45.192:5000' })
            });
            const data = await res.json();
            if (res.ok) {
                setSyncStatus(`✅ ${data.synced} new, ${data.skipped} duplicates`);
                loadMemories();
            } else {
                setSyncStatus(`❌ ${data.error}`);
            }
        } catch {
            setSyncStatus('❌ Connection failed');
        }
        setTimeout(() => setSyncStatus(''), 5000);
    };

    const filtered = filter === 'all' ? memories : memories.filter(m => m.category === filter);

    const importanceBadge = (imp: string) => {
        switch (imp) {
            case 'high': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
            case 'medium': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
            default: return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
        }
    };

    const timeSince = (dateStr: string) => {
        const now = new Date();
        const date = new Date(dateStr);
        const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
        if (diff < 60) return 'acum';
        if (diff < 3600) return `${Math.floor(diff / 60)}m`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
        return `${Math.floor(diff / 86400)}d`;
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
                        🕶️ Glasses Memory
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {memories.length} memorii salvate de asistentul tău AI
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={handleSyncFromVPS} disabled={syncStatus === 'Syncing...'} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-600 dark:bg-indigo-900/20 dark:hover:bg-indigo-900/40 dark:text-indigo-400 font-medium transition-colors disabled:opacity-50" title="Sync memories from VPS">
                        {syncStatus === 'Syncing...' ? '⏳ Syncing...' : '🔄 Sync VPS'}
                    </button>
                    <button onClick={loadMemories} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors" title="Refresh">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 21h5v-5" /></svg>
                    </button>
                    {memories.length > 0 && (
                        <button onClick={handleClearAll} className="text-xs px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-900/20 dark:hover:bg-red-900/40 dark:text-red-400 font-medium transition-colors">
                            Clear All
                        </button>
                    )}
                </div>
            </div>
            {syncStatus && syncStatus !== 'Syncing...' && (
                <div className={`text-xs p-2 rounded-lg text-center font-medium ${syncStatus.startsWith('✅') ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
                    {syncStatus}
                </div>
            )}

            {/* Stats Cards */}
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                {Object.entries(categoryMeta).map(([key, meta]) => (
                    <button
                        key={key}
                        onClick={() => setFilter(filter === key ? 'all' : key)}
                        className={`rounded-xl p-3 text-center transition-all border ${filter === key
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm'
                            : 'border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:shadow-sm'
                            }`}
                    >
                        <span className="text-xl">{meta.icon}</span>
                        <p className="text-lg font-bold mt-1">{stats[key] || 0}</p>
                        <p className="text-[10px] text-gray-500">{meta.label}</p>
                    </button>
                ))}
            </div>

            {/* Active Filter */}
            {filter !== 'all' && (
                <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">Filtru activ:</span>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium bg-gradient-to-r ${categoryMeta[filter]?.color || ''} text-white`}>
                        {categoryMeta[filter]?.icon} {categoryMeta[filter]?.label}
                    </span>
                    <button onClick={() => setFilter('all')} className="text-xs text-gray-400 hover:text-gray-600 ml-1">✕ clear</button>
                </div>
            )}

            {/* Memories List */}
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 overflow-hidden">
                <div className="px-4 md:px-6 py-3 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
                    <h2 className="font-semibold text-sm">
                        {filter === 'all' ? 'Toate Memoriile' : `${categoryMeta[filter]?.label || filter}`} ({filtered.length})
                    </h2>
                </div>

                {loading ? (
                    <div className="flex justify-center py-12">
                        <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-12 px-4">
                        <span className="text-4xl mb-3 block">🕶️</span>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            {memories.length === 0
                                ? 'Nicio memorie încă. Vorbește cu ochelarii și spune „ține minte" sau „remember"!'
                                : 'Nicio memorie în această categorie.'}
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-100 dark:divide-zinc-800">
                        {filtered.map(m => {
                            const meta = categoryMeta[m.category] || categoryMeta.general;
                            return (
                                <div key={m._id} className="px-4 md:px-6 py-3 flex items-start gap-3 group hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
                                    {/* Category Icon */}
                                    <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${meta.color} flex items-center justify-center text-sm flex-shrink-0 mt-0.5`}>
                                        {meta.icon}
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm leading-relaxed">{m.content}</p>
                                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${importanceBadge(m.importance)}`}>
                                                {m.importance}
                                            </span>
                                            <span className="text-[10px] text-gray-400">{meta.label}</span>
                                            <span className="text-[10px] text-gray-400">·</span>
                                            <span className="text-[10px] text-gray-400" title={new Date(m.updatedAt).toLocaleString('ro-RO')}>
                                                {timeSince(m.updatedAt)}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Delete */}
                                    <button
                                        onClick={() => handleDelete(m._id)}
                                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-300 hover:text-red-500 transition-all flex-shrink-0"
                                        title="Șterge"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
