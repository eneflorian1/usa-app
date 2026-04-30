'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';

interface OrchestratorMemory {
    _id: string;
    category: string;
    content: string;
    source: string;
    updatedAt: string;
}

const CATEGORIES = ['general', 'preference', 'fact', 'person', 'project', 'rule', 'persona', 'assistant_persona'];

const categoryMeta: Record<string, { icon: string; label: string; color: string; hex: string }> = {
    preference: { icon: '❤️', label: 'Preferință', color: 'from-pink-500 to-rose-600', hex: '#ec4899' },
    fact: { icon: '📌', label: 'Fapt', color: 'from-amber-500 to-orange-600', hex: '#f59e0b' },
    person: { icon: '👤', label: 'Persoană', color: 'from-violet-500 to-purple-600', hex: '#8b5cf6' },
    project: { icon: '💻', label: 'Proiect', color: 'from-blue-500 to-indigo-600', hex: '#3b82f6' },
    rule: { icon: '📏', label: 'Regulă', color: 'from-red-500 to-rose-600', hex: '#ef4444' },
    persona: { icon: '🪪', label: 'Tu (user)', color: 'from-emerald-500 to-teal-600', hex: '#10b981' },
    assistant_persona: { icon: '🎭', label: 'Eu (agent)', color: 'from-cyan-500 to-sky-600', hex: '#06b6d4' },
    general: { icon: '🧠', label: 'General', color: 'from-slate-500 to-gray-600', hex: '#6b7280' },
};

interface CassandraMemory {
    category: string;
    key: string;
    value: string;
    confidence?: number;
    updatedAt?: string;
    score?: number;
}

function getKeywords(text: string): string[] {
    const stopWords = new Set(['și', 'în', 'la', 'de', 'cu', 'pe', 'un', 'o', 'că', 'este', 'are', 'sau', 'the', 'is', 'a', 'an', 'in', 'of', 'to', 'and', 'or', 'for']);
    return text.toLowerCase()
        .replace(/[^a-zăâîșța-z0-9\s]/gi, '')
        .split(/\s+/)
        .filter(w => w.length > 3 && !stopWords.has(w));
}

function sharedKeywords(a: string, b: string): number {
    const ka = new Set(getKeywords(a));
    const kb = getKeywords(b);
    return kb.filter(w => ka.has(w)).length;
}

export default function OrchestratorMemoryPage() {
    const [memories, setMemories] = useState<OrchestratorMemory[]>([]);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState<'list' | 'graph'>('list');
    const [filter, setFilter] = useState('all');
    const [newContent, setNewContent] = useState('');
    const [newCategory, setNewCategory] = useState('general');
    const [showAddForm, setShowAddForm] = useState(false);
    const [adding, setAdding] = useState(false);
    const [selectedNode, setSelectedNode] = useState<OrchestratorMemory | null>(null);
    const [cassandraMems, setCassandraMems] = useState<CassandraMemory[]>([]);
    const [cassandraReady, setCassandraReady] = useState<boolean | null>(null);
    const [cassandraQuery, setCassandraQuery] = useState('');
    const [cassandraLoading, setCassandraLoading] = useState(false);
    const [showCassandra, setShowCassandra] = useState(false);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animFrameRef = useRef<number>(0);
    const nodesRef = useRef<{ mem: OrchestratorMemory; x: number; y: number; vx: number; vy: number; phase: number }[]>([]);
    const mouseRef = useRef<{ x: number; y: number }>({ x: -1, y: -1 });

    const loadMemories = useCallback(async () => {
        try {
            const data = await api.get<OrchestratorMemory[]>('/api/orchestrator/memory');
            if (Array.isArray(data)) setMemories(data);
        } catch { }
        setLoading(false);
    }, []);

    useEffect(() => { loadMemories(); }, [loadMemories]);

    const loadCassandra = useCallback(async (q?: string) => {
        setCassandraLoading(true);
        try {
            const url = q?.trim()
                ? `/api/orchestrator/cassandra-memory?q=${encodeURIComponent(q.trim())}&limit=30`
                : '/api/orchestrator/cassandra-memory?limit=60';
            const data = await api.get<{ ready: boolean; memories: CassandraMemory[] }>(url);
            setCassandraReady(!!data?.ready);
            setCassandraMems(Array.isArray(data?.memories) ? data.memories : []);
        } catch {
            setCassandraReady(false);
            setCassandraMems([]);
        }
        setCassandraLoading(false);
    }, []);

    useEffect(() => {
        if (showCassandra) loadCassandra();
    }, [showCassandra, loadCassandra]);

    const handleDelete = async (id: string) => {
        await api.delete(`/api/orchestrator/memory/${id}`);
        setMemories(prev => prev.filter(m => m._id !== id));
        if (selectedNode?._id === id) setSelectedNode(null);
    };

    const handleClearAll = async () => {
        if (!confirm('Ștergi TOATĂ memoria orchestratorului? Nu poate fi anulat.')) return;
        await api.delete('/api/orchestrator/memory');
        setMemories([]);
        setSelectedNode(null);
    };

    const handleAdd = async () => {
        if (!newContent.trim()) return;
        setAdding(true);
        try {
            const mem = await api.post<OrchestratorMemory>('/api/orchestrator/memory', { category: newCategory, content: newContent.trim() });
            setMemories(prev => [mem, ...prev]);
            setNewContent('');
            setShowAddForm(false);
        } catch { }
        setAdding(false);
    };

    const filtered = filter === 'all' ? memories : memories.filter(m => m.category === filter);

    const timeSince = (dateStr: string) => {
        // eslint-disable-next-line react-hooks/purity
        const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
        if (diff < 60) return 'acum';
        if (diff < 3600) return `${Math.floor(diff / 60)}m`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
        return `${Math.floor(diff / 86400)}z`;
    };

    // ─── Neural Graph ──────────────────────────────────────────────────────────

    const initNodes = useCallback((mems: OrchestratorMemory[], width: number, height: number) => {
        const padding = 80;
        nodesRef.current = mems.map((mem, i) => {
            // Deterministic seed positions based on index
            const seed = i * 137.508;
            const angle = seed % (Math.PI * 2);
            const r = padding + (Math.abs(Math.sin(seed)) * (Math.min(width, height) / 2 - padding * 1.5));
            return {
                mem,
                x: width / 2 + Math.cos(angle) * r,
                y: height / 2 + Math.sin(angle) * r,
                vx: 0, vy: 0,
                phase: Math.random() * Math.PI * 2
            };
        });
    }, []);

    useEffect(() => {
        if (view !== 'graph') {
            cancelAnimationFrame(animFrameRef.current);
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const resize = () => {
            canvas.width = canvas.offsetWidth * window.devicePixelRatio;
            canvas.height = canvas.offsetHeight * window.devicePixelRatio;
            ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
            initNodes(memories, canvas.offsetWidth, canvas.offsetHeight);
        };
        resize();
        window.addEventListener('resize', resize);

        const draw = (t: number) => {
            const W = canvas.offsetWidth;
            const H = canvas.offsetHeight;
            ctx.clearRect(0, 0, W, H);

            const nodes = nodesRef.current;
            if (nodes.length === 0) {
                animFrameRef.current = requestAnimationFrame(draw);
                return;
            }

            // Float animation
            nodes.forEach(n => {
                n.x += Math.sin(t * 0.0005 + n.phase) * 0.3;
                n.y += Math.cos(t * 0.0004 + n.phase * 1.3) * 0.25;
            });

            // Draw connections
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const a = nodes[i], b = nodes[j];
                    const sameCat = a.mem.category === b.mem.category;
                    const shared = sharedKeywords(a.mem.content, b.mem.content);

                    if (!sameCat && shared < 2) continue;

                    const alpha = sameCat ? 0.35 : Math.min(0.2, shared * 0.05);
                    const col = categoryMeta[a.mem.category]?.hex || '#6b7280';

                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                    ctx.strokeStyle = col + Math.round(alpha * 255).toString(16).padStart(2, '0');
                    ctx.lineWidth = sameCat ? 1.5 : 0.8;
                    if (!sameCat) ctx.setLineDash([4, 6]);
                    else ctx.setLineDash([]);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
            }

            // Determine hovered node
            const mx = mouseRef.current.x, my = mouseRef.current.y;
            let closestNode = null, closestDist = Infinity;
            for (const n of nodes) {
                const d = Math.hypot(n.x - mx, n.y - my);
                if (d < closestDist) { closestDist = d; closestNode = n; }
            }
            const hovered = closestDist < 32 ? closestNode : null;

            // Draw nodes
            for (const n of nodes) {
                const meta = categoryMeta[n.mem.category] || categoryMeta.general;
                const isHovered = hovered?.mem._id === n.mem._id;
                const isSelected = selectedNode?._id === n.mem._id;
                const r = isHovered || isSelected ? 18 : 12;

                // Glow
                if (isHovered || isSelected) {
                    const grd = ctx.createRadialGradient(n.x, n.y, r * 0.5, n.x, n.y, r * 2.5);
                    grd.addColorStop(0, meta.hex + '55');
                    grd.addColorStop(1, meta.hex + '00');
                    ctx.beginPath();
                    ctx.arc(n.x, n.y, r * 2.5, 0, Math.PI * 2);
                    ctx.fillStyle = grd;
                    ctx.fill();
                }

                // Circle
                ctx.beginPath();
                ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
                ctx.fillStyle = meta.hex;
                ctx.fill();
                ctx.strokeStyle = '#ffffff55';
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // Icon
                ctx.font = `${isHovered ? 13 : 10}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = 'white';
                ctx.fillText(meta.icon, n.x, n.y);

                // Label on hover
                if (isHovered || isSelected) {
                    const label = n.mem.content.length > 45 ? n.mem.content.slice(0, 45) + '…' : n.mem.content;
                    const labelX = n.x;
                    const labelY = n.y - r - 10;
                    const padding = 6;
                    ctx.font = '11px system-ui, sans-serif';
                    const tw = ctx.measureText(label).width;
                    ctx.fillStyle = 'rgba(0,0,0,0.75)';
                    ctx.beginPath();
                    ctx.roundRect(labelX - tw / 2 - padding, labelY - 14, tw + padding * 2, 22, 6);
                    ctx.fill();
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(label, labelX, labelY - 3);
                }
            }

            animFrameRef.current = requestAnimationFrame(draw);
        };

        animFrameRef.current = requestAnimationFrame(draw);
        return () => {
            cancelAnimationFrame(animFrameRef.current);
            window.removeEventListener('resize', resize);
        };
    }, [view, memories, selectedNode, initNodes]);

    const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        let closest = null, closestDist = Infinity;
        for (const n of nodesRef.current) {
            const d = Math.hypot(n.x - mx, n.y - my);
            if (d < closestDist) { closestDist = d; closest = n; }
        }
        if (closest && closestDist < 30) {
            setSelectedNode(prev => prev?._id === closest!.mem._id ? null : closest!.mem);
        } else {
            setSelectedNode(null);
        }
    };

    const stats: Record<string, number> = {};
    for (const m of memories) stats[m.category] = (stats[m.category] || 0) + 1;

    return (
        <div className="space-y-6 max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight bg-gradient-to-r from-violet-600 to-pink-600 bg-clip-text text-transparent">
                        🧠 Orchestrator Memory
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {memories.length} {memories.length === 1 ? 'amintire' : 'amintiri'} stocate
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={loadMemories}
                        className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
                        title="Refresh"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 21h5v-5" /></svg>
                    </button>
                    <button
                        onClick={() => setShowAddForm(v => !v)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-medium transition-colors"
                    >
                        + Adaugă
                    </button>
                    {memories.length > 0 && (
                        <button
                            onClick={handleClearAll}
                            className="text-xs px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-900/20 dark:hover:bg-red-900/40 dark:text-red-400 font-medium transition-colors"
                        >
                            Clear All
                        </button>
                    )}
                </div>
            </div>

            {/* Add Form */}
            {showAddForm && (
                <div className="bg-white dark:bg-zinc-900 border border-violet-200 dark:border-violet-800/50 rounded-2xl p-4 space-y-3 shadow-sm">
                    <h3 className="text-sm font-semibold text-violet-700 dark:text-violet-400">Adaugă memorie manuală</h3>
                    <textarea
                        value={newContent}
                        onChange={e => setNewContent(e.target.value)}
                        placeholder="Conținutul memoriei..."
                        rows={3}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none resize-none"
                    />
                    <div className="flex items-center gap-3">
                        <select
                            value={newCategory}
                            onChange={e => setNewCategory(e.target.value)}
                            className="text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 focus:ring-2 focus:ring-violet-500 outline-none"
                        >
                            {CATEGORIES.map(c => (
                                <option key={c} value={c}>{categoryMeta[c]?.icon} {categoryMeta[c]?.label || c}</option>
                            ))}
                        </select>
                        <button
                            onClick={handleAdd}
                            disabled={!newContent.trim() || adding}
                            className="text-xs px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white font-medium transition-colors"
                        >
                            {adding ? 'Se salvează...' : 'Salvează'}
                        </button>
                        <button
                            onClick={() => { setShowAddForm(false); setNewContent(''); }}
                            className="text-xs px-3 py-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
                        >
                            Anulează
                        </button>
                    </div>
                </div>
            )}

            {/* Category Stats */}
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-2">
                {CATEGORIES.map(key => {
                    const meta = categoryMeta[key];
                    return (
                        <button
                            key={key}
                            onClick={() => setFilter(filter === key ? 'all' : key)}
                            className={`rounded-xl p-3 text-center transition-all border ${filter === key
                                ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20 shadow-sm'
                                : 'border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:shadow-sm'
                                }`}
                        >
                            <span className="text-xl">{meta.icon}</span>
                            <p className="text-lg font-bold mt-1">{stats[key] || 0}</p>
                            <p className="text-[10px] text-gray-500 truncate">{meta.label}</p>
                        </button>
                    );
                })}
            </div>

            {/* Cassandra Semantic Memory Panel */}
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
                <button
                    onClick={() => setShowCassandra(v => !v)}
                    className="w-full px-4 md:px-6 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors"
                >
                    <div className="flex items-center gap-2">
                        <span className="text-lg">🌐</span>
                        <span className="font-semibold text-sm">Semantic Memory (Cassandra)</span>
                        {cassandraReady === false && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">offline</span>
                        )}
                        {cassandraReady === true && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">{cassandraMems.length} consolidate</span>
                        )}
                    </div>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: showCassandra ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}><path d="m6 9 6 6 6-6" /></svg>
                </button>

                {showCassandra && (
                    <div className="border-t border-gray-100 dark:border-zinc-800 p-4 space-y-3">
                        <p className="text-[11px] text-gray-500 leading-relaxed">
                            Memorii inferate automat de MemoryConsolidator din istoricul conversațiilor. Read-only — pentru editare folosește lista de sus (MongoDB).
                        </p>

                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={cassandraQuery}
                                onChange={e => setCassandraQuery(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') loadCassandra(cassandraQuery); }}
                                placeholder="Caută semantic (ex: preferințe, proiecte, contacte)..."
                                className="flex-1 px-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 focus:ring-2 focus:ring-violet-500 outline-none"
                            />
                            <button
                                onClick={() => loadCassandra(cassandraQuery)}
                                disabled={cassandraLoading}
                                className="text-xs px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white font-medium"
                            >
                                {cassandraLoading ? '...' : 'Caută'}
                            </button>
                            {cassandraQuery && (
                                <button
                                    onClick={() => { setCassandraQuery(''); loadCassandra(''); }}
                                    className="text-xs px-2 py-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800"
                                >
                                    ✕
                                </button>
                            )}
                        </div>

                        {cassandraReady === false ? (
                            <div className="text-xs text-gray-500 py-4 text-center">
                                Cassandra nu e pornită. Pornește serviciul și reîncearcă.
                            </div>
                        ) : cassandraMems.length === 0 ? (
                            <div className="text-xs text-gray-500 py-4 text-center">
                                {cassandraQuery ? 'Nicio memorie semantică peste prag.' : 'Consolidatorul n-a produs încă memorii. Rulează sau așteaptă consolidarea orară.'}
                            </div>
                        ) : (
                            <div className="space-y-1.5 max-h-96 overflow-y-auto">
                                {cassandraMems.map((m, i) => (
                                    <div key={`${m.category}-${m.key}-${i}`} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-zinc-800/50 border border-gray-100 dark:border-zinc-800">
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400 font-medium flex-shrink-0 mt-0.5">
                                            {m.category}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-medium text-gray-500 truncate">{m.key}</p>
                                            <p className="text-sm leading-relaxed">{m.value}</p>
                                        </div>
                                        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                                            {typeof m.confidence === 'number' && (
                                                <span className="text-[10px] text-gray-400" title="confidence">
                                                    c:{m.confidence.toFixed(2)}
                                                </span>
                                            )}
                                            {typeof m.score === 'number' && (
                                                <span className="text-[10px] text-violet-500" title="similarity score">
                                                    s:{m.score.toFixed(2)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* View Toggle */}
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-zinc-800 rounded-xl p-1 w-fit">
                <button
                    onClick={() => setView('list')}
                    className={`text-xs px-4 py-2 rounded-lg font-medium transition-all ${view === 'list'
                        ? 'bg-white dark:bg-zinc-700 shadow-sm text-violet-600 dark:text-violet-400'
                        : 'text-gray-500 hover:text-gray-700'
                        }`}
                >
                    📋 List
                </button>
                <button
                    onClick={() => setView('graph')}
                    className={`text-xs px-4 py-2 rounded-lg font-medium transition-all ${view === 'graph'
                        ? 'bg-white dark:bg-zinc-700 shadow-sm text-violet-600 dark:text-violet-400'
                        : 'text-gray-500 hover:text-gray-700'
                        }`}
                >
                    🕸️ Neural Graph
                </button>
            </div>

            {/* List View */}
            {view === 'list' && (
                <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 overflow-hidden">
                    <div className="px-4 md:px-6 py-3 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
                        <h2 className="font-semibold text-sm">
                            {filter === 'all' ? 'Toate Memoriile' : `${categoryMeta[filter]?.label || filter}`} ({filtered.length})
                        </h2>
                        {filter !== 'all' && (
                            <button onClick={() => setFilter('all')} className="text-xs text-gray-400 hover:text-gray-600">✕ resetează filtrul</button>
                        )}
                    </div>

                    {loading ? (
                        <div className="flex justify-center py-12">
                            <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" />
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="text-center py-16 px-4">
                            <span className="text-5xl block mb-3">🧠</span>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {memories.length === 0
                                    ? 'Nicio memorie salvată încă. Vorbește cu orchestratorul!'
                                    : 'Nicio memorie în această categorie.'}
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-100 dark:divide-zinc-800">
                            {filtered.map(m => {
                                const meta = categoryMeta[m.category] || categoryMeta.general;
                                return (
                                    <div key={m._id} className="px-4 md:px-6 py-3.5 flex items-start gap-3 group hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
                                        {/* Category dot */}
                                        <div
                                            className={`w-9 h-9 rounded-xl bg-gradient-to-br ${meta.color} flex items-center justify-center text-sm flex-shrink-0 mt-0.5 shadow-sm`}
                                        >
                                            {meta.icon}
                                        </div>

                                        {/* Content */}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm leading-relaxed">{m.content}</p>
                                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                                <span
                                                    className="text-[10px] px-1.5 py-0.5 rounded font-medium text-white"
                                                    style={{ backgroundColor: meta.hex }}
                                                >
                                                    {meta.label}
                                                </span>
                                                {m.source !== 'orchestrator' && (
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-zinc-700 text-gray-500 font-medium">
                                                        {m.source}
                                                    </span>
                                                )}
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
            )}

            {/* Neural Graph View */}
            {view === 'graph' && (
                <div className="space-y-3">
                    <div
                        className="relative w-full bg-gray-950 dark:bg-black rounded-2xl border border-gray-800 overflow-hidden"
                        style={{ height: '520px' }}
                    >
                        {memories.length === 0 ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
                                <span className="text-5xl mb-3">🕸️</span>
                                <p className="text-sm">Nicio memorie de vizualizat.</p>
                            </div>
                        ) : (
                            <>
                                <canvas
                                    ref={canvasRef}
                                    className="w-full h-full cursor-crosshair"
                                    onMouseMove={handleCanvasMouseMove}
                                    onMouseLeave={() => { mouseRef.current = { x: -1, y: -1 }; }}
                                    onClick={handleCanvasClick}
                                />
                                {/* Legend */}
                                <div className="absolute bottom-3 left-3 flex flex-wrap gap-1.5">
                                    {CATEGORIES.filter(c => stats[c] > 0).map(c => {
                                        const meta = categoryMeta[c];
                                        return (
                                            <span key={c} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-black/60 text-white backdrop-blur-sm">
                                                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: meta.hex }} />
                                                {meta.label} ({stats[c]})
                                            </span>
                                        );
                                    })}
                                </div>
                                <div className="absolute top-3 right-3 text-[10px] text-gray-500 bg-black/50 backdrop-blur-sm px-2 py-1 rounded-lg">
                                    Click nod pentru detalii
                                </div>
                            </>
                        )}
                    </div>

                    {/* Selected node detail */}
                    {selectedNode && (
                        <div
                            className="bg-white dark:bg-zinc-900 rounded-2xl border-2 p-4 transition-all shadow-lg animate-in fade-in slide-in-from-bottom-2"
                            style={{ borderColor: categoryMeta[selectedNode.category]?.hex || '#6b7280' }}
                        >
                            <div className="flex items-start gap-3">
                                <div
                                    className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                                    style={{ backgroundColor: categoryMeta[selectedNode.category]?.hex + '22' }}
                                >
                                    {categoryMeta[selectedNode.category]?.icon}
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm leading-relaxed font-medium">{selectedNode.content}</p>
                                    <div className="flex items-center gap-2 mt-2">
                                        <span
                                            className="text-[10px] px-2 py-0.5 rounded-full text-white font-medium"
                                            style={{ backgroundColor: categoryMeta[selectedNode.category]?.hex }}
                                        >
                                            {categoryMeta[selectedNode.category]?.label}
                                        </span>
                                        <span className="text-[10px] text-gray-400">{timeSince(selectedNode.updatedAt)}</span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleDelete(selectedNode._id)}
                                    className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-300 hover:text-red-500 transition-all"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
