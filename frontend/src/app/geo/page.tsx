'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { MapPin, Brain, Search, Bell, Trash2, Plus, ChevronRight, Target, ArrowLeft } from 'lucide-react';

interface Zone {
    id: string; name: string; lat: number; lng: number; radius_km: number;
    tags: string[]; price_index: number; student_friendly: boolean;
    family_friendly: boolean; noise_level: string; poi: string[]; aliases: string[];
}

interface GeoPreference {
    _id: string; type: string; city: string; resolved_area: string;
    resolved_area_id: string; price_max?: number; price_min?: number;
    rooms?: number[]; property_type: string; lifestyle_tags: string[];
    raw_input: string; monitor?: { active: boolean; interval_hours: number; whatsapp_chatId?: string; last_run?: string };
    updatedAt: string;
}

interface ResolveResult {
    zones: Zone[]; center?: { lat: number; lng: number }; radius_km: number;
    resolved_text: string; method: string;
}

interface InferResult {
    tags: string[]; lifestyles: string[]; zones: Zone[]; confidence: number; method: string;
}

const LIFESTYLE_COLORS: Record<string, string> = {
    student: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    familie: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    investitie: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    linistit: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
    central: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    ieftin: 'bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-gray-300',
};

const TAG_ICONS: Record<string, string> = {
    student: '🎓', familie: '👨‍👩‍👧', investitie: '📈', linistit: '🌿',
    central: '🏛️', ieftin: '💰', transport: '🚌', nature: '🌳',
    premium: '⭐', shopping: '🛍️', university: '🎓', historic: '🏛️',
};

export default function GeoPage() {
    const [zones, setZones] = useState<Zone[]>([]);
    const [preferences, setPreferences] = useState<GeoPreference[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<'zones' | 'test' | 'monitor'>('zones');

    // Test panel
    const [testText, setTestText] = useState('');
    const [testResult, setTestResult] = useState<{ resolve?: ResolveResult; infer?: InferResult } | null>(null);
    const [testing, setTesting] = useState(false);

    // Monitor form
    const [monitorText, setMonitorText] = useState('');
    const [monitorPrice, setMonitorPrice] = useState('');
    const [monitorRooms, setMonitorRooms] = useState('');
    const [monitorChatId, setMonitorChatId] = useState('');
    const [addingMonitor, setAddingMonitor] = useState(false);

    const [selectedZone, setSelectedZone] = useState<Zone | null>(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [z, p] = await Promise.all([
                api.get<Zone[]>('/api/geo/zones'),
                api.get<GeoPreference[]>('/api/geo/preferences'),
            ]);
            setZones(Array.isArray(z) ? z : []);
            setPreferences(Array.isArray(p) ? p : []);
        } catch { }
        setLoading(false);
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    const runTest = async () => {
        if (!testText.trim()) return;
        setTesting(true);
        setTestResult(null);
        try {
            const [resolve, infer] = await Promise.all([
                api.post<ResolveResult>('/api/geo/resolve', { text: testText }),
                api.post<InferResult>('/api/geo/infer', { text: testText }),
            ]);
            setTestResult({ resolve, infer });
        } catch { }
        setTesting(false);
    };

    const addMonitor = async () => {
        if (!monitorText.trim()) return;
        setAddingMonitor(true);
        try {
            // First resolve the zone
            const resolved = await api.post<ResolveResult>('/api/geo/resolve', { text: monitorText });
            const zone = resolved.zones?.[0];

            await api.post('/api/geo/monitor/upsert', {
                userId: 'default',
                city: 'Sibiu',
                resolved_area: zone?.name || monitorText,
                resolved_area_id: zone?.id,
                geo: zone ? { lat: zone.lat, lng: zone.lng } : null,
                price_max: monitorPrice ? parseInt(monitorPrice) : undefined,
                rooms: monitorRooms ? [parseInt(monitorRooms)] : [],
                whatsapp_chatId: monitorChatId || undefined,
                raw_input: monitorText,
                interval_hours: 6,
            });

            setMonitorText(''); setMonitorPrice(''); setMonitorRooms(''); setMonitorChatId('');
            await loadData();
        } catch { }
        setAddingMonitor(false);
    };

    const deletePreference = async (id: string) => {
        await api.delete(`/api/geo/preferences/${id}`);
        setPreferences(prev => prev.filter(p => p._id !== id));
    };

    const priceIndexColor = (idx: number) => {
        if (idx >= 1.3) return 'text-red-500';
        if (idx >= 1.1) return 'text-amber-500';
        if (idx <= 0.9) return 'text-emerald-500';
        return 'text-blue-500';
    };

    return (
        <div className="space-y-6 pb-10 max-w-2xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Link
                    href="/maps"
                    className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors flex-shrink-0"
                    aria-label="Înapoi la Maps"
                >
                    <ArrowLeft size={20} />
                </Link>
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
                        <MapPin className="text-violet-500" size={28} />
                        Geo Brain — Sibiu
                    </h1>
                    <p className="text-sm text-gray-500 mt-0.5">Zone semantice, inferențe, monitorizare imobiliară</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-gray-100 dark:bg-zinc-800 p-1 rounded-xl w-fit">
                {[
                    { id: 'zones', label: 'Zone', icon: MapPin },
                    { id: 'test', label: 'Test Geo', icon: Brain },
                    { id: 'monitor', label: 'Monitor', icon: Bell },
                ].map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        onClick={() => setTab(id as typeof tab)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${tab === id ? 'bg-white dark:bg-zinc-700 shadow-sm text-gray-900 dark:text-gray-100' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        <Icon size={13} />{label}
                    </button>
                ))}
            </div>

            {/* ── Zones Tab ─────────────────────────────────────────────── */}
            {tab === 'zones' && (
                <div className="space-y-3">
                    {loading ? (
                        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>
                    ) : (
                        <>
                            <p className="text-xs text-gray-500">{zones.length} zone cartografiate din OpenStreetMap</p>
                            <div className="grid gap-2">
                                {zones.sort((a, b) => a.price_index - b.price_index ? -1 : 1).map(zone => (
                                    <div
                                        key={zone.id}
                                        onClick={() => setSelectedZone(selectedZone?.id === zone.id ? null : zone)}
                                        className={`bg-white dark:bg-zinc-900 border rounded-xl p-4 cursor-pointer transition-all ${selectedZone?.id === zone.id ? 'border-violet-400 shadow-sm' : 'border-gray-200 dark:border-zinc-800 hover:border-gray-300'}`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0">
                                                    <MapPin size={14} className="text-violet-500" />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-semibold">{zone.name}</p>
                                                    <p className="text-[10px] text-gray-400">{zone.lat.toFixed(4)}, {zone.lng.toFixed(4)} · r={zone.radius_km}km</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className={`text-xs font-bold ${priceIndexColor(zone.price_index)}`}>{zone.price_index}x</span>
                                                <ChevronRight size={14} className={`text-gray-400 transition-transform ${selectedZone?.id === zone.id ? 'rotate-90' : ''}`} />
                                            </div>
                                        </div>

                                        {selectedZone?.id === zone.id && (
                                            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-zinc-800 space-y-2">
                                                {/* Tags */}
                                                <div className="flex flex-wrap gap-1">
                                                    {zone.tags.map(tag => (
                                                        <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-zinc-800 rounded text-gray-600 dark:text-gray-400">
                                                            {TAG_ICONS[tag] || ''} {tag}
                                                        </span>
                                                    ))}
                                                </div>
                                                {/* Caracteristici */}
                                                <div className="flex gap-3 text-xs">
                                                    {zone.student_friendly && <span className="text-blue-500">🎓 Studenți</span>}
                                                    {zone.family_friendly && <span className="text-emerald-500">👨‍👩‍👧 Familie</span>}
                                                    <span className="text-gray-400">🔊 {zone.noise_level}</span>
                                                </div>
                                                {/* POIs */}
                                                {zone.poi?.length > 0 && (
                                                    <div>
                                                        <p className="text-[10px] text-gray-400 mb-1">POI-uri:</p>
                                                        <div className="flex flex-wrap gap-1">
                                                            {zone.poi.map(p => (
                                                                <span key={p} className="text-[10px] px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded">📌 {p}</span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {/* Aliases */}
                                                <p className="text-[10px] text-gray-400">Aliases: {zone.aliases.join(', ')}</p>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* ── Test Geo Tab ───────────────────────────────────────────── */}
            {tab === 'test' && (
                <div className="space-y-4">
                    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 space-y-3">
                        <h3 className="text-sm font-semibold flex items-center gap-2"><Brain size={16} className="text-violet-500" />Test Geo Resolver & Inference</h3>
                        <div className="flex gap-2">
                            <input
                                value={testText}
                                onChange={e => setTestText(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && runTest()}
                                placeholder="ex: langa promenada, aproape de centru, bun pentru studenti..."
                                className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
                            />
                            <button
                                onClick={runTest} disabled={testing || !testText.trim()}
                                className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors flex items-center gap-1.5"
                            >
                                {testing ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Search size={14} />}
                                Test
                            </button>
                        </div>

                        {/* Quick tests */}
                        <div className="flex flex-wrap gap-1.5">
                            {['langa promenada', 'centru sibiu', 'bun pentru studenti', 'zona linistita', 'aproape de mall', 'langa aeroport'].map(s => (
                                <button key={s} onClick={() => setTestText(s)}
                                    className="text-[11px] px-2 py-1 rounded-full border border-gray-200 dark:border-zinc-700 text-gray-500 hover:text-violet-600 hover:border-violet-400 transition-colors">
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>

                    {testResult && (
                        <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
                            {/* Resolver result */}
                            {testResult.resolve && (
                                <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5">
                                    <div className="flex items-center gap-2 mb-3">
                                        <Target size={14} className="text-violet-500" />
                                        <h4 className="text-xs font-semibold">Geo Resolver</h4>
                                        <span className="ml-auto text-[10px] text-violet-500 bg-violet-50 dark:bg-violet-900/20 px-1.5 py-0.5 rounded-full">{testResult.resolve.method}</span>
                                    </div>
                                    <p className="text-sm font-medium mb-2">{testResult.resolve.resolved_text}</p>
                                    <div className="space-y-1.5">
                                        {testResult.resolve.zones.slice(0, 4).map(z => (
                                            <div key={z.id} className="flex items-center gap-2 text-xs">
                                                <MapPin size={10} className="text-gray-400 flex-shrink-0" />
                                                <span className="font-medium">{z.name}</span>
                                                <span className="text-gray-400">{z.lat?.toFixed(4)}, {z.lng?.toFixed(4)}</span>
                                                <span className="ml-auto text-gray-400">r={z.radius_km}km</span>
                                            </div>
                                        ))}
                                    </div>
                                    {testResult.resolve.center && (
                                        <p className="text-[10px] text-gray-400 mt-2">
                                            Center: {testResult.resolve.center.lat.toFixed(4)}, {testResult.resolve.center.lng.toFixed(4)} · radius {testResult.resolve.radius_km}km
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Inference result */}
                            {testResult.infer && testResult.infer.tags.length > 0 && (
                                <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5">
                                    <div className="flex items-center gap-2 mb-3">
                                        <Brain size={14} className="text-amber-500" />
                                        <h4 className="text-xs font-semibold">Inferențe semantice</h4>
                                        <span className="ml-auto text-[10px] text-amber-500 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded-full">{Math.round((testResult.infer.confidence || 0) * 100)}% conf.</span>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 mb-2">
                                        {testResult.infer.lifestyles.map(l => (
                                            <span key={l} className={`text-xs font-semibold px-2 py-0.5 rounded-full ${LIFESTYLE_COLORS[l] || 'bg-gray-100 text-gray-700'}`}>
                                                {TAG_ICONS[l] || ''} {l}
                                            </span>
                                        ))}
                                        {testResult.infer.tags.map(t => (
                                            <span key={t} className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-400 rounded-full">{t}</span>
                                        ))}
                                    </div>
                                    {testResult.infer.zones.length > 0 && (
                                        <div>
                                            <p className="text-[10px] text-gray-400 mb-1">Zone recomandate:</p>
                                            <div className="flex flex-wrap gap-1">
                                                {testResult.infer.zones.slice(0, 4).map(z => (
                                                    <span key={z.id} className="text-xs px-2 py-0.5 bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 rounded-full">
                                                        📍 {z.name}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ── Monitor Tab ────────────────────────────────────────────── */}
            {tab === 'monitor' && (
                <div className="space-y-4">
                    {/* Add monitor form */}
                    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 space-y-3">
                        <h3 className="text-sm font-semibold flex items-center gap-2"><Bell size={16} className="text-violet-500" />Adaugă monitor</h3>
                        <div>
                            <label className="text-xs text-gray-500 mb-1 block">Zonă / Cerință *</label>
                            <input value={monitorText} onChange={e => setMonitorText(e.target.value)}
                                placeholder="ex: hipodrom, langa promenada, centru sub 90k..."
                                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">Preț max (EUR)</label>
                                <input value={monitorPrice} onChange={e => setMonitorPrice(e.target.value)} type="number"
                                    placeholder="90000"
                                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                            </div>
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">Camere</label>
                                <input value={monitorRooms} onChange={e => setMonitorRooms(e.target.value)} type="number"
                                    placeholder="2"
                                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                            </div>
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">WhatsApp ID</label>
                                <input value={monitorChatId} onChange={e => setMonitorChatId(e.target.value)}
                                    placeholder="407...@c.us"
                                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                            </div>
                        </div>
                        <button onClick={addMonitor} disabled={addingMonitor || !monitorText.trim()}
                            className="w-full py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2">
                            {addingMonitor ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus size={14} />}
                            Activează Monitor
                        </button>
                    </div>

                    {/* Active preferences */}
                    {preferences.length > 0 ? (
                        <div className="space-y-2">
                            <p className="text-xs text-gray-500 font-medium">{preferences.length} preferință/preferințe active</p>
                            {preferences.map(pref => (
                                <div key={pref._id} className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-4">
                                    <div className="flex items-start gap-3">
                                        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${pref.monitor?.active ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium">{pref.resolved_area || pref.city}</p>
                                            <div className="flex flex-wrap gap-2 mt-1 text-xs text-gray-500">
                                                {pref.price_max && <span>max {pref.price_max.toLocaleString()} EUR</span>}
                                                {(pref.rooms?.length ?? 0) > 0 && <span>{pref.rooms?.join('/')} cam</span>}
                                                {pref.monitor?.interval_hours && <span>la {pref.monitor.interval_hours}h</span>}
                                                {pref.monitor?.last_run && <span>ultima rulare: {new Date(pref.monitor.last_run).toLocaleDateString('ro-RO')}</span>}
                                            </div>
                                            {pref.monitor?.whatsapp_chatId && (
                                                <p className="text-[10px] text-emerald-500 mt-0.5">📱 WhatsApp: {pref.monitor.whatsapp_chatId.substring(0, 15)}...</p>
                                            )}
                                        </div>
                                        <button onClick={() => deletePreference(pref._id)}
                                            className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0">
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-8 text-gray-400">
                            <Bell size={28} className="mx-auto mb-2 opacity-30" />
                            <p className="text-sm">Niciun monitor activ</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
