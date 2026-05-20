'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { Plus, Trash2, Pencil, Check, X, Brain, Search } from 'lucide-react';

interface Memory {
    _id: string;
    key: string;
    category: string;
    content: string;
    source: string;
    createdAt: string;
    updatedAt: string;
}

interface CassandraMemory {
    category: string;
    key: string;
    value: string;
    confidence: number;
    updatedAt: string;
}

const CATEGORIES = [
    { id: 'all', label: 'Toate', color: 'bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-gray-300' },
    { id: 'zona', label: 'Zona', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
    { id: 'preferinte', label: 'Preferințe', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
    { id: 'persona', label: 'Profil', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
    { id: 'context', label: 'Context', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
    { id: 'general', label: 'General', color: 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-400' },
];

const categoryColor = (cat: string) =>
    CATEGORIES.find(c => c.id === cat)?.color || 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-400';

export default function MemoryPage() {
    const [memories, setMemories] = useState<Memory[]>([]);
    const [cassandraMemories, setCassandraMemories] = useState<CassandraMemory[]>([]);
    const [cassandraReady, setCassandraReady] = useState(false);
    const [loading, setLoading] = useState(true);
    const [activeCategory, setActiveCategory] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [tab, setTab] = useState<'structured' | 'semantic'>('structured');

    // New memory form
    const [showForm, setShowForm] = useState(false);
    const [newKey, setNewKey] = useState('');
    const [newCategory, setNewCategory] = useState('general');
    const [newContent, setNewContent] = useState('');
    const [saving, setSaving] = useState(false);

    // Edit state
    const [editId, setEditId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState('');
    const [editKey, setEditKey] = useState('');

    // Cassandra search
    const [cassandraQuery, setCassandraQuery] = useState('');
    const [cassandraSearching, setCassandraSearching] = useState(false);

    const loadMemories = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.get<Memory[]>('/api/orchestrator/memory');
            setMemories(Array.isArray(data) ? data : []);
        } catch { }
        setLoading(false);
    }, []);

    const loadCassandra = useCallback(async (q?: string) => {
        try {
            const url = q
                ? `/api/orchestrator/cassandra-memory?q=${encodeURIComponent(q)}&limit=50`
                : `/api/orchestrator/cassandra-memory?limit=80`;
            const data = await api.get<{ ready: boolean; memories: CassandraMemory[] }>(url);
            setCassandraReady(data.ready);
            setCassandraMemories(Array.isArray(data.memories) ? data.memories : []);
        } catch { }
    }, []);

    useEffect(() => { loadMemories(); loadCassandra(); }, [loadMemories, loadCassandra]);

    const handleAdd = async () => {
        if (!newContent.trim()) return;
        setSaving(true);
        try {
            await api.post('/api/orchestrator/memory', {
                category: newCategory,
                key: newKey.trim(),
                content: newContent.trim(),
            });
            setNewKey(''); setNewCategory('general'); setNewContent('');
            setShowForm(false);
            await loadMemories();
        } catch { }
        setSaving(false);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Ștergi memoria?')) return;
        await api.delete(`/api/orchestrator/memory/${id}`);
        setMemories(prev => prev.filter(m => m._id !== id));
    };

    const startEdit = (m: Memory) => {
        setEditId(m._id);
        setEditContent(m.content);
        setEditKey(m.key || '');
    };

    const saveEdit = async (id: string) => {
        await api.patch(`/api/orchestrator/memory/${id}`, { content: editContent, key: editKey });
        setMemories(prev => prev.map(m => m._id === id ? { ...m, content: editContent, key: editKey } : m));
        setEditId(null);
    };

    const handleCassandraSearch = async () => {
        if (!cassandraQuery.trim()) { loadCassandra(); return; }
        setCassandraSearching(true);
        await loadCassandra(cassandraQuery.trim());
        setCassandraSearching(false);
    };

    const filtered = memories.filter(m => {
        const matchCat = activeCategory === 'all' || m.category === activeCategory;
        const matchSearch = !searchQuery || m.content.toLowerCase().includes(searchQuery.toLowerCase()) || m.key?.toLowerCase().includes(searchQuery.toLowerCase());
        return matchCat && matchSearch;
    });

    // Group by category for structured view
    const grouped = filtered.reduce<Record<string, Memory[]>>((acc, m) => {
        const cat = m.category || 'general';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(m);
        return acc;
    }, {});

    return (
        <div className="space-y-6 pb-10 max-w-2xl mx-auto">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
                        <Brain className="text-violet-500" size={28} />
                        Memory
                    </h1>
                    <p className="text-sm text-gray-500 mt-0.5">Preferințe, context și amintiri ale orchestratorului</p>
                </div>
                <button
                    onClick={() => setShowForm(!showForm)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-xl transition-colors"
                >
                    <Plus size={16} />
                    Adaugă
                </button>
            </div>

            {/* Add form */}
            {showForm && (
                <div className="bg-white dark:bg-zinc-900 border border-violet-200 dark:border-violet-800 rounded-2xl p-5 space-y-3 animate-in fade-in slide-in-from-top-2">
                    <h3 className="text-sm font-semibold">Memorie nouă</h3>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-gray-500 mb-1 block">Categorie</label>
                            <select
                                value={newCategory}
                                onChange={e => setNewCategory(e.target.value)}
                                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
                            >
                                {CATEGORIES.filter(c => c.id !== 'all').map(c => (
                                    <option key={c.id} value={c.id}>{c.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 mb-1 block">Cheie (opțional)</label>
                            <input
                                value={newKey}
                                onChange={e => setNewKey(e.target.value)}
                                placeholder="ex: zona_preferata"
                                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="text-xs text-gray-500 mb-1 block">Conținut *</label>
                        <textarea
                            value={newContent}
                            onChange={e => setNewContent(e.target.value)}
                            placeholder="ex: Zona preferată pentru imobiliare: Florești, Cluj-Napoca. Budget maxim: 120.000 EUR."
                            rows={3}
                            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                        />
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={handleAdd} disabled={saving || !newContent.trim()}
                            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors"
                        >
                            {saving ? 'Salvez...' : 'Salvează'}
                        </button>
                        <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-xl hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors">
                            Anulează
                        </button>
                    </div>
                </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 bg-gray-100 dark:bg-zinc-800 p-1 rounded-xl w-fit">
                {[{ id: 'structured', label: 'Structurat' }, { id: 'semantic', label: 'Semantic (Cassandra)' }].map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id as 'structured' | 'semantic')}
                        className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors ${tab === t.id ? 'bg-white dark:bg-zinc-700 shadow-sm text-gray-900 dark:text-gray-100' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* ── Structured tab ─────────────────────────────────────────── */}
            {tab === 'structured' && (
                <>
                    {/* Search + category filter */}
                    <div className="space-y-3">
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Caută în memorii..."
                                className="w-full pl-8 pr-4 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                            />
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {CATEGORIES.map(c => (
                                <button
                                    key={c.id}
                                    onClick={() => setActiveCategory(c.id)}
                                    className={`px-3 py-1 text-xs font-medium rounded-full transition-all ${activeCategory === c.id ? c.color + ' ring-2 ring-offset-1 ring-violet-400' : 'bg-gray-100 dark:bg-zinc-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-zinc-700'}`}
                                >
                                    {c.label}
                                    {c.id !== 'all' && (
                                        <span className="ml-1 opacity-60">
                                            ({memories.filter(m => m.category === c.id).length})
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    {loading ? (
                        <div className="flex justify-center py-12">
                            <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="text-center py-12 text-gray-400">
                            <Brain size={32} className="mx-auto mb-3 opacity-30" />
                            <p className="text-sm">Nicio memorie găsită</p>
                            <p className="text-xs mt-1">Adaugă prima memorie sau spune orchestratorului să memoreze ceva</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {Object.entries(grouped).map(([cat, mems]) => (
                                <div key={cat}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${categoryColor(cat)}`}>
                                            {CATEGORIES.find(c => c.id === cat)?.label || cat}
                                        </span>
                                        <div className="flex-1 h-px bg-gray-100 dark:bg-zinc-800" />
                                        <span className="text-xs text-gray-400">{mems.length}</span>
                                    </div>
                                    <div className="space-y-2">
                                        {mems.map(m => (
                                            <div key={m._id} className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-4 group">
                                                {editId === m._id ? (
                                                    <div className="space-y-2">
                                                        <input
                                                            value={editKey}
                                                            onChange={e => setEditKey(e.target.value)}
                                                            placeholder="Cheie"
                                                            className="w-full px-2 py-1 text-xs border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 focus:outline-none focus:ring-1 focus:ring-violet-500"
                                                        />
                                                        <textarea
                                                            value={editContent}
                                                            onChange={e => setEditContent(e.target.value)}
                                                            rows={3}
                                                            className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
                                                        />
                                                        <div className="flex gap-1.5">
                                                            <button onClick={() => saveEdit(m._id)} className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 text-white text-xs rounded-lg">
                                                                <Check size={12} /> Salvează
                                                            </button>
                                                            <button onClick={() => setEditId(null)} className="flex items-center gap-1 px-2.5 py-1 text-gray-500 text-xs rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800">
                                                                <X size={12} /> Anulează
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-start gap-3">
                                                        <div className="flex-1 min-w-0">
                                                            {m.key && (
                                                                <span className="text-[10px] font-mono text-violet-500 dark:text-violet-400 mb-1 block">{m.key}</span>
                                                            )}
                                                            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{m.content}</p>
                                                            <div className="flex items-center gap-2 mt-1.5">
                                                                <span className="text-[10px] text-gray-400">{m.source}</span>
                                                                <span className="text-[10px] text-gray-300 dark:text-gray-600">·</span>
                                                                <span className="text-[10px] text-gray-400">{new Date(m.updatedAt).toLocaleDateString('ro-RO')}</span>
                                                            </div>
                                                        </div>
                                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                                            <button onClick={() => startEdit(m)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-400 hover:text-gray-600 transition-colors">
                                                                <Pencil size={13} />
                                                            </button>
                                                            <button onClick={() => handleDelete(m._id)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors">
                                                                <Trash2 size={13} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* ── Semantic tab (Cassandra) ────────────────────────────────── */}
            {tab === 'semantic' && (
                <div className="space-y-4">
                    {!cassandraReady ? (
                        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-sm text-amber-700 dark:text-amber-300">
                            Cassandra nu este activ. Memoria semantică se construiește automat din conversații.
                        </div>
                    ) : (
                        <>
                            <div className="flex gap-2">
                                <input
                                    value={cassandraQuery}
                                    onChange={e => setCassandraQuery(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleCassandraSearch()}
                                    placeholder="Caută semantic în memorie..."
                                    className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                                />
                                <button
                                    onClick={handleCassandraSearch}
                                    disabled={cassandraSearching}
                                    className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm rounded-xl transition-colors"
                                >
                                    {cassandraSearching ? '...' : 'Caută'}
                                </button>
                            </div>

                            {cassandraMemories.length === 0 ? (
                                <div className="text-center py-12 text-gray-400">
                                    <p className="text-sm">Nicio memorie semantică găsită</p>
                                    <p className="text-xs mt-1">Cassandra se populează automat din conversațiile orchestratorului</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {cassandraMemories.map((m, i) => (
                                        <div key={i} className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-4">
                                            <div className="flex items-start gap-3">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${categoryColor(m.category)}`}>
                                                            {m.category}
                                                        </span>
                                                        {m.key && <span className="text-[10px] font-mono text-violet-500">{m.key}</span>}
                                                        {m.confidence !== undefined && (
                                                            <span className="text-[10px] text-gray-400 ml-auto">{Math.round(m.confidence * 100)}%</span>
                                                        )}
                                                    </div>
                                                    <p className="text-sm text-gray-700 dark:text-gray-300">{m.value}</p>
                                                    <p className="text-[10px] text-gray-400 mt-1">{new Date(m.updatedAt).toLocaleDateString('ro-RO')}</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
