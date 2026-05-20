'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState, useEffect, useCallback, useRef } from 'react';
import api from '@/lib/api';
import {
    Navigation2, Search, X, MapPin, Bell, Brain, ChevronDown, ChevronUp,
    Layers, Building2, PenTool, Save, RotateCcw, GitCompare,
    TrendingUp, Home, Users, GraduationCap, Volume2, Trees,
    Flame, ArrowRight, Loader2, Check,
} from 'lucide-react';

const SibiuMapGL = dynamic(() => import('@/components/SibiuMapGL'), {
    ssr: false,
    loading: () => (
        <div className="w-full h-full bg-gray-200 dark:bg-zinc-800 animate-pulse flex items-center justify-center">
            <MapPin size={32} className="text-gray-400 animate-bounce" />
        </div>
    ),
});

interface Zone {
    id: string; name: string; lat: number; lng: number; radius_km: number;
    tags: string[]; price_index: number; student_friendly: boolean;
    family_friendly: boolean; noise_level: string; poi: string[];
}
interface GeoPreference {
    _id: string; resolved_area: string; city: string; price_max?: number;
    rooms?: number[]; monitor?: { active: boolean; whatsapp_chatId?: string };
    geo?: { lat: number; lng: number };
}
interface Listing {
    id: string; lat: number; lng: number; zone_id: string; title: string;
    price: number; price_m2: number; rooms: number; area_sqm: number;
    deal_score: number; negotiation_score: number; verdict: 'hot' | 'warm' | 'cold';
    is_new: boolean; price_drop: boolean; url: string; published_ago: string;
    source?: 'nego' | 'market'; nego_status?: string;
}
interface MarketData {
    [zoneId: string]: {
        avg_price_m2: number; med_price_m2: number; market_score: number;
        trend: string; deal_count: number; avg_days: number; liquidity: string;
        investment_score: number; family_score: number; student_score: number;
        noise: string; green_space: number;
    };
}
interface ZoneInsights {
    zone_id: string; zone_name: string; avg_price_m2: number; med_price_m2: number;
    market_score: number; trend: string; deal_count: number; avg_days: number;
    liquidity: string; scores: { investment: number; family: number; student: number };
    noise: string; green_space: number; tags: string[]; pois: string[];
    ai_summary: string | null;
}
interface CompareResult {
    zones: Array<{
        id: string; name: string; avg_price_m2: number; trend: string;
        liquidity: string; investment_score: number; family_score: number;
        student_score: number; noise: string; green_space: number; tags: string[];
    }>;
    ai_verdict: string | null;
}

function ScoreBar({ label, value, icon: Icon, color }: { label: string; value: number; icon: React.ElementType; color: string }) {
    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
                    <Icon size={10} />{label}
                </span>
                <span className="text-[10px] font-bold" style={{ color }}>{value}</span>
            </div>
            <div className="h-1.5 bg-gray-100 dark:bg-zinc-700 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${value}%`, background: color }} />
            </div>
        </div>
    );
}

export default function MapsPage() {
    const [zones, setZones] = useState<Zone[]>([]);
    const [preferences, setPreferences] = useState<GeoPreference[]>([]);
    const [listings, setListings] = useState<Listing[]>([]);
    const [marketData, setMarketData] = useState<MarketData>({});
    const [loading, setLoading] = useState(true);

    // Map state
    const [highlightZoneId, setHighlightZoneId] = useState<string | null>(null);
    const [searchMarker, setSearchMarker] = useState<{ lat: number; lng: number; label: string } | null>(null);
    const [layers, setLayers] = useState({ zones: false, listings: true });

    // Search
    const [searchText, setSearchText] = useState('');
    const [searching, setSearching] = useState(false);

    // Draw polygon
    const [drawMode, setDrawMode] = useState(false);
    const [drawnPolygon, setDrawnPolygon] = useState<[number, number][] | null>(null);
    const [savingPolygon, setSavingPolygon] = useState(false);

    // Insights panel
    const [insightsZone, setInsightsZone] = useState<ZoneInsights | null>(null);
    const [insightsLoading, setInsightsLoading] = useState(false);

    // Compare mode
    const [compareMode, setCompareMode] = useState(false);
    const [compareZones, setCompareZones] = useState<string[]>([]);
    const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
    const [compareLoading, setCompareLoading] = useState(false);

    // Selected listing
    const [selectedListing, setSelectedListing] = useState<Listing | null>(null);

    // Bottom panel
    const [panelOpen, setPanelOpen] = useState(false);
    const [panelTab, setPanelTab] = useState<'zones' | 'listings' | 'monitor'>('zones');

    const loadData = useCallback(async () => {
        try {
            const [z, prefs, mkt] = await Promise.all([
                api.get<Zone[]>('/api/geo/zones'),
                api.get<GeoPreference[]>('/api/geo/preferences'),
                api.get<MarketData>('/api/geo/market-data'),
            ]);
            setZones(Array.isArray(z) ? z : []);
            setPreferences(Array.isArray(prefs) ? prefs : []);
            setMarketData(mkt && typeof mkt === 'object' ? mkt : {});

            const listingsGeoJSON = await api.get<{ features: Array<{ properties: Listing }> }>('/api/geo/listings');
            setListings(listingsGeoJSON?.features?.map((f) => f.properties) ?? []);
        } catch { }
        setLoading(false);
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    const handleSearch = async () => {
        if (!searchText.trim()) return;
        setSearching(true);
        try {
            const result = await api.post<{ zones: Zone[]; center?: { lat: number; lng: number }; resolved_text: string }>('/api/geo/resolve', { text: searchText });
            const zone = result.zones?.[0];
            if (zone) setHighlightZoneId(zone.id);
            if (result.center) setSearchMarker({ lat: result.center.lat, lng: result.center.lng, label: result.resolved_text });
            else if (zone) setSearchMarker({ lat: zone.lat, lng: zone.lng, label: zone.name });
        } catch { }
        setSearching(false);
    };

    const handleZoneClick = useCallback(async (zone: Zone, insights: unknown) => {
        if (compareMode) {
            setCompareZones(prev => {
                if (prev.includes(zone.id)) return prev.filter(id => id !== zone.id);
                if (prev.length >= 3) return prev;
                return [...prev, zone.id];
            });
            return;
        }

        setHighlightZoneId(zone.id);
        if (insights && typeof insights === 'object' && 'zone_id' in (insights as object)) {
            setInsightsZone(insights as ZoneInsights);
        } else {
            setInsightsLoading(true);
            try {
                const data = await api.post<ZoneInsights>(`/api/geo/insights/${zone.id}`, {});
                setInsightsZone(data);
            } catch { setInsightsZone(null); }
            setInsightsLoading(false);
        }
        setSelectedListing(null);
    }, [compareMode]);

    const handleCompare = async () => {
        if (compareZones.length < 2) return;
        setCompareLoading(true);
        try {
            const result = await api.post<CompareResult>('/api/geo/compare', { zone_ids: compareZones });
            setCompareResult(result);
        } catch { }
        setCompareLoading(false);
    };

    const handlePolygonComplete = (coordinates: [number, number][]) => {
        setDrawnPolygon(coordinates);
        setDrawMode(false);
    };

    const savePolygon = async () => {
        if (!drawnPolygon) return;
        setSavingPolygon(true);
        try {
            await api.post('/api/geo/polygon/save', { coordinates: drawnPolygon, label: 'Zonă desenată' });
            setDrawnPolygon(null);
            loadData();
        } catch { }
        setSavingPolygon(false);
    };

    const toggleLayer = (key: keyof typeof layers) => setLayers(l => ({ ...l, [key]: !l[key] }));

    const priceColor = (idx: number) => {
        if (idx >= 1.3) return 'text-red-500';
        if (idx >= 1.1) return 'text-amber-500';
        if (idx <= 0.88) return 'text-emerald-500';
        return 'text-violet-500';
    };

    const liquidityColor = (l: string) => l === 'high' ? 'text-emerald-500' : l === 'low' ? 'text-red-500' : 'text-amber-500';

    const verdictConfig = {
        hot: { color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20', icon: '🔥' },
        warm: { color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', icon: '☀️' },
        cold: { color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20', icon: '❄️' },
    };

    return (
        <div className="-m-4 md:m-0 relative h-[calc(100vh-4rem)] md:h-screen flex flex-col overflow-hidden">

            {/* ── Map fills everything ─── */}
            <div className="absolute inset-0">
                {!loading && (
                    <SibiuMapGL
                        zones={zones}
                        listings={listings}
                        marketData={marketData}
                        layers={layers}
                        drawMode={drawMode}
                        highlightZoneId={highlightZoneId}
                        onZoneClick={handleZoneClick}
                        onListingClick={setSelectedListing}
                        onPolygonComplete={handlePolygonComplete}
                        searchMarker={searchMarker}
                        compareZones={compareZones}
                    />
                )}
            </div>

            {/* ── TOP BAR ─── */}
            <div className="absolute top-3 left-0 right-0 z-[500] flex items-start gap-2 px-3 pointer-events-none">

                {/* Left: Geo Brain button */}
                <div className="pointer-events-auto flex-shrink-0">
                    <Link href="/geo"
                        className="flex items-center gap-1.5 px-2 py-2 md:px-3 bg-white/95 dark:bg-zinc-900/95 backdrop-blur border border-gray-200 dark:border-zinc-700 rounded-xl shadow-sm hover:border-violet-400 hover:text-violet-600 transition-all text-gray-700 dark:text-gray-300 text-xs font-semibold"
                    >
                        <Navigation2 size={14} className="text-violet-500" />
                        <span className="hidden md:inline">Geo Brain</span>
                    </Link>
                </div>

                {/* Center: Search */}
                <div className="pointer-events-auto flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 bg-white/95 dark:bg-zinc-900/95 backdrop-blur border border-gray-200 dark:border-zinc-700 rounded-xl shadow-md px-3 py-2">
                        <Search size={13} className="text-gray-400 flex-shrink-0" />
                        <input
                            value={searchText}
                            onChange={e => setSearchText(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSearch()}
                            placeholder="Caută zonă..."
                            className="flex-1 min-w-0 text-xs bg-transparent outline-none placeholder:text-gray-400"
                        />
                        {searching ? <Loader2 size={13} className="animate-spin text-violet-500 flex-shrink-0" />
                            : searchText ? <button onClick={() => { setSearchText(''); setSearchMarker(null); setHighlightZoneId(null); }} className="text-gray-400 hover:text-gray-600 flex-shrink-0"><X size={13} /></button>
                            : null}
                        {!searching && (
                            <button onClick={handleSearch} disabled={!searchText.trim()} className="text-xs font-semibold text-violet-600 disabled:opacity-30 flex-shrink-0">Go</button>
                        )}
                    </div>
                </div>

                {/* Right: Layer toggles */}
                <div className="pointer-events-auto flex-shrink-0">
                    <div className="bg-white/95 dark:bg-zinc-900/95 backdrop-blur border border-gray-200 dark:border-zinc-700 rounded-xl shadow p-1.5 md:p-2 flex flex-col gap-1 md:gap-1.5">
                        {([
                            { key: 'zones', icon: Building2, label: 'Zone' },
                            { key: 'listings', icon: Home, label: 'Anunțuri' },
                        ] as const).map(({ key, icon: Icon, label }) => (
                            <button
                                key={key}
                                onClick={() => toggleLayer(key)}
                                title={label}
                                className={`flex items-center justify-center md:justify-start gap-1 md:gap-1.5 px-1.5 md:px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${layers[key] ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300' : 'text-gray-400 hover:text-gray-600'}`}
                            >
                                <Icon size={12} />
                                <span className="hidden md:inline">{label}</span>
                                {layers[key] && <Check size={9} className="hidden md:block ml-auto" />}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── LEFT TOOLBAR ─── */}
            <div className="absolute left-3 top-1/2 -translate-y-1/2 z-[500] flex flex-col gap-2">
                {/* Draw polygon */}
                <button
                    onClick={() => { setDrawMode(!drawMode); setDrawnPolygon(null); setCompareMode(false); }}
                    className={`p-2.5 rounded-xl shadow-md border transition-all text-xs ${drawMode ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white/95 dark:bg-zinc-900/95 border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-gray-400 hover:border-violet-400'}`}
                    title={drawMode ? 'Anulează desenul' : 'Desenează zonă de căutare'}
                >
                    <PenTool size={16} />
                </button>

                {/* Compare mode */}
                <button
                    onClick={() => { setCompareMode(!compareMode); setCompareZones([]); setCompareResult(null); setDrawMode(false); }}
                    className={`p-2.5 rounded-xl shadow-md border transition-all text-xs ${compareMode ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white/95 dark:bg-zinc-900/95 border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-gray-400 hover:border-amber-400'}`}
                    title={compareMode ? 'Ieși din mod comparare' : 'Compară zone'}
                >
                    <GitCompare size={16} />
                </button>

                {/* Reset */}
                <button
                    onClick={() => { setHighlightZoneId(null); setInsightsZone(null); setSelectedListing(null); setSearchMarker(null); setSearchText(''); setCompareZones([]); setCompareResult(null); setDrawMode(false); setDrawnPolygon(null); }}
                    className="p-2.5 rounded-xl shadow-md border bg-white/95 dark:bg-zinc-900/95 border-gray-200 dark:border-zinc-700 text-gray-400 hover:text-gray-700 hover:border-gray-400 transition-all"
                    title="Reset"
                >
                    <RotateCcw size={16} />
                </button>
            </div>

            {/* ── DRAW MODE BANNER ─── */}
            {drawMode && (
                <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[500] pointer-events-auto">
                    <div className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-full shadow-lg text-xs font-semibold">
                        <PenTool size={12} />
                        Click pe hartă pentru a adăuga puncte · Dublu-click pentru a finaliza
                    </div>
                </div>
            )}

            {/* ── SAVE POLYGON BANNER ─── */}
            {drawnPolygon && (
                <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[500] pointer-events-auto">
                    <div className="flex items-center gap-2 bg-white dark:bg-zinc-900 border border-violet-200 dark:border-violet-700 px-4 py-2 rounded-xl shadow-lg text-xs">
                        <Check size={12} className="text-emerald-500" />
                        <span className="font-medium">{drawnPolygon.length} puncte desenate</span>
                        <button onClick={savePolygon} disabled={savingPolygon}
                            className="flex items-center gap-1 px-2.5 py-1 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50">
                            <Save size={10} />{savingPolygon ? 'Salvez...' : 'Salvează'}
                        </button>
                        <button onClick={() => setDrawnPolygon(null)} className="text-gray-400 hover:text-gray-600"><X size={12} /></button>
                    </div>
                </div>
            )}

            {/* ── COMPARE MODE PANEL ─── */}
            {compareMode && (
                <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[500] pointer-events-auto w-[min(500px,calc(100vw-24px))]">
                    <div className="bg-white/97 dark:bg-zinc-900/97 backdrop-blur border border-amber-200 dark:border-amber-700 rounded-xl shadow-xl p-3">
                        <div className="flex items-center gap-2 mb-2">
                            <GitCompare size={13} className="text-amber-500" />
                            <span className="text-xs font-semibold text-amber-600">Mod comparare — selectează 2-3 zone pe hartă</span>
                        </div>
                        {compareZones.length === 0 ? (
                            <p className="text-xs text-gray-400 text-center py-2">Click pe zone pentru a le adăuga</p>
                        ) : (
                            <div className="space-y-2">
                                <div className="flex flex-wrap gap-1.5">
                                    {compareZones.map(id => {
                                        const z = zones.find(z => z.id === id);
                                        return z ? (
                                            <span key={id} className="flex items-center gap-1 text-xs px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full">
                                                {z.name}
                                                <button onClick={() => setCompareZones(prev => prev.filter(i => i !== id))}><X size={10} /></button>
                                            </span>
                                        ) : null;
                                    })}
                                </div>
                                {compareZones.length >= 2 && !compareResult && (
                                    <button onClick={handleCompare} disabled={compareLoading}
                                        className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50">
                                        {compareLoading ? <Loader2 size={11} className="animate-spin" /> : <GitCompare size={11} />}
                                        {compareLoading ? 'Analizez...' : 'Compară zonele'}
                                    </button>
                                )}
                                {compareResult && (
                                    <div className="space-y-2 max-h-48 overflow-y-auto">
                                        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${compareResult.zones.length}, 1fr)` }}>
                                            {compareResult.zones.map(z => (
                                                <div key={z.id} className="bg-gray-50 dark:bg-zinc-800 rounded-lg p-2 text-center">
                                                    <p className="text-[10px] font-bold text-gray-700 dark:text-gray-300">{z.name}</p>
                                                    <p className="text-xs font-bold text-violet-600">{z.avg_price_m2.toLocaleString()}€</p>
                                                    <p className="text-[9px] text-gray-400">/mp · {z.trend}</p>
                                                    <p className="text-[9px] mt-0.5">inv:{z.investment_score} · fam:{z.family_score}</p>
                                                </div>
                                            ))}
                                        </div>
                                        {compareResult.ai_verdict && (
                                            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2 text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">
                                                {compareResult.ai_verdict}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── RIGHT: INSIGHTS PANEL ─── */}
            {(insightsZone || insightsLoading) && !compareMode && (
                <div className="absolute top-16 right-2 bottom-12 z-[500] w-[min(17rem,calc(100vw-1rem))] pointer-events-auto overflow-y-auto">
                    <div className="bg-white/97 dark:bg-zinc-900/97 backdrop-blur border border-gray-200 dark:border-zinc-700 rounded-2xl shadow-xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="font-bold text-sm text-gray-800 dark:text-gray-100">
                                {insightsZone?.zone_name ?? 'Se încarcă...'}
                            </h3>
                            <button onClick={() => { setInsightsZone(null); setHighlightZoneId(null); }} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                        </div>

                        {insightsLoading && (
                            <div className="flex items-center gap-2 py-4">
                                <Loader2 size={16} className="animate-spin text-violet-500" />
                                <span className="text-xs text-gray-400">Generez insights...</span>
                            </div>
                        )}

                        {insightsZone && (
                            <>
                                {/* Price */}
                                <div className="bg-gray-50 dark:bg-zinc-800 rounded-xl p-3">
                                    <div className="flex items-baseline gap-1">
                                        <span className="text-xl font-bold text-violet-600">{insightsZone.avg_price_m2.toLocaleString()}</span>
                                        <span className="text-xs text-gray-400">€/mp</span>
                                        <span className="ml-auto text-xs font-semibold text-emerald-500">{insightsZone.trend}</span>
                                    </div>
                                    <div className="flex gap-3 mt-1 text-[10px] text-gray-500">
                                        <span>Medie: {insightsZone.med_price_m2.toLocaleString()}€</span>
                                        <span>Deals: {insightsZone.deal_count}</span>
                                        <span>~{insightsZone.avg_days}z</span>
                                    </div>
                                    <div className="flex items-center gap-1 mt-1.5">
                                        <span className="text-[10px] text-gray-400">Lichiditate:</span>
                                        <span className={`text-[10px] font-semibold ${liquidityColor(insightsZone.liquidity)}`}>{insightsZone.liquidity}</span>
                                    </div>
                                </div>

                                {/* Scores */}
                                <div className="space-y-2">
                                    <ScoreBar label="Investiție" value={insightsZone.scores.investment} icon={TrendingUp} color="#7c3aed" />
                                    <ScoreBar label="Familie" value={insightsZone.scores.family} icon={Users} color="#0891b2" />
                                    <ScoreBar label="Studenți" value={insightsZone.scores.student} icon={GraduationCap} color="#059669" />
                                </div>

                                {/* Environment */}
                                <div className="grid grid-cols-2 gap-2 text-[10px]">
                                    <div className="flex items-center gap-1.5 bg-gray-50 dark:bg-zinc-800 rounded-lg px-2 py-1.5">
                                        <Volume2 size={11} className="text-amber-500" />
                                        <span className="text-gray-500">Zgomot:</span>
                                        <span className="font-semibold text-gray-700 dark:text-gray-300">{insightsZone.noise}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 bg-gray-50 dark:bg-zinc-800 rounded-lg px-2 py-1.5">
                                        <Trees size={11} className="text-emerald-500" />
                                        <span className="text-gray-500">Verde:</span>
                                        <span className="font-semibold text-gray-700 dark:text-gray-300">{insightsZone.green_space}%</span>
                                    </div>
                                </div>

                                {/* Tags */}
                                {insightsZone.tags?.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                        {insightsZone.tags.map(t => (
                                            <span key={t} className="text-[9px] px-1.5 py-0.5 bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 rounded">{t}</span>
                                        ))}
                                    </div>
                                )}

                                {/* AI Summary */}
                                {insightsZone.ai_summary && (
                                    <div className="bg-violet-50 dark:bg-violet-900/20 rounded-xl p-3">
                                        <div className="flex items-center gap-1 mb-1.5">
                                            <Brain size={11} className="text-violet-500" />
                                            <span className="text-[10px] font-semibold text-violet-600">AI Insight</span>
                                        </div>
                                        <p className="text-[11px] text-violet-700 dark:text-violet-300 leading-relaxed">{insightsZone.ai_summary}</p>
                                    </div>
                                )}

                                {/* CTA */}
                                <button
                                    onClick={() => { setCompareMode(true); setCompareZones([insightsZone.zone_id]); setInsightsZone(null); }}
                                    className="w-full flex items-center justify-center gap-1.5 py-2 border border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400 text-xs font-semibold rounded-xl hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                                >
                                    <GitCompare size={12} /> Compară cu altă zonă
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* ── LISTING DETAIL PANEL ─── */}
            {selectedListing && !compareMode && !insightsZone && (
                <div className="absolute top-16 right-2 z-[500] w-[min(17rem,calc(100vw-1rem))] pointer-events-auto">
                    <div className="bg-white/97 dark:bg-zinc-900/97 backdrop-blur border border-gray-200 dark:border-zinc-700 rounded-2xl shadow-xl p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                            <h3 className="font-bold text-sm text-gray-800 dark:text-gray-100 leading-tight">{selectedListing.title}</h3>
                            <button onClick={() => setSelectedListing(null)} className="text-gray-400 hover:text-gray-600 flex-shrink-0 mt-0.5"><X size={14} /></button>
                        </div>

                        {/* Badges */}
                        <div className="flex gap-1.5 flex-wrap">
                            {selectedListing.source === 'nego' && <span className="text-[9px] px-1.5 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-600 font-bold rounded">NEGO</span>}
                            {selectedListing.is_new && <span className="text-[9px] px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 font-bold rounded">NOU</span>}
                            {selectedListing.price_drop && <span className="text-[9px] px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 font-bold rounded">↓ PREȚ</span>}
                            <span className={`text-[9px] px-1.5 py-0.5 font-bold rounded ${verdictConfig[selectedListing.verdict].bg} ${verdictConfig[selectedListing.verdict].color}`}>
                                {verdictConfig[selectedListing.verdict].icon} {selectedListing.verdict.toUpperCase()}
                            </span>
                            {selectedListing.published_ago && <span className="text-[9px] px-1.5 py-0.5 bg-gray-100 dark:bg-zinc-800 text-gray-500 rounded">{selectedListing.published_ago}</span>}
                        </div>

                        {/* Price */}
                        <div className="bg-gray-50 dark:bg-zinc-800 rounded-xl p-3">
                            <div className="flex items-baseline gap-1">
                                <span className="text-xl font-bold text-gray-800 dark:text-gray-100">{selectedListing.price > 0 ? selectedListing.price.toLocaleString() : '—'}</span>
                                <span className="text-xs text-gray-400">EUR</span>
                            </div>
                            {(selectedListing.price_m2 > 0 || selectedListing.rooms > 0 || selectedListing.area_sqm > 0) && (
                                <div className="text-xs text-gray-500 mt-0.5">
                                    {selectedListing.price_m2 > 0 && `${selectedListing.price_m2.toLocaleString()}€/mp`}
                                    {selectedListing.rooms > 0 && ` · ${selectedListing.rooms} cam`}
                                    {selectedListing.area_sqm > 0 && ` · ${selectedListing.area_sqm}mp`}
                                </div>
                            )}
                            {selectedListing.nego_status && (
                                <div className="text-[10px] text-violet-600 dark:text-violet-400 mt-1 font-medium">
                                    Status: {selectedListing.nego_status}
                                </div>
                            )}
                        </div>

                        {/* Deal score */}
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] font-semibold text-gray-500 flex items-center gap-1">
                                    <Flame size={10} className="text-orange-400" /> Deal Score
                                </span>
                                <span className="text-sm font-bold" style={{ color: selectedListing.deal_score >= 85 ? '#16a34a' : selectedListing.deal_score >= 70 ? '#ca8a04' : '#dc2626' }}>
                                    {selectedListing.deal_score}/100
                                </span>
                            </div>
                            <div className="h-2 bg-gray-100 dark:bg-zinc-700 rounded-full overflow-hidden">
                                <div className="h-full rounded-full" style={{
                                    width: `${selectedListing.deal_score}%`,
                                    background: selectedListing.deal_score >= 85 ? '#16a34a' : selectedListing.deal_score >= 70 ? '#ca8a04' : '#dc2626',
                                }} />
                            </div>
                            <p className="text-[10px] text-gray-400">Potențial negociere: {Math.round(selectedListing.negotiation_score * 100)}%</p>
                        </div>

                        <a href={selectedListing.url} target="_blank" rel="noopener noreferrer"
                            className="w-full flex items-center justify-center gap-1.5 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-xl transition-colors">
                            Vezi anunțul <ArrowRight size={12} />
                        </a>
                    </div>
                </div>
            )}

            {/* ── BOTTOM PANEL ─── */}
            <div className="absolute bottom-0 left-0 right-0 z-40 pointer-events-auto">

                {/* Expandable content — slides up from behind handle */}
                <div className={`bg-white dark:bg-zinc-900 border-t border-gray-200 dark:border-zinc-800 shadow-2xl overflow-hidden transition-[max-height] duration-300 ease-in-out ${panelOpen ? 'max-h-56' : 'max-h-0'}`}>
                    <div className="flex gap-0 border-b border-gray-100 dark:border-zinc-800 px-4">
                        {([
                            { id: 'zones', label: 'Zone', icon: Building2 },
                            { id: 'listings', label: 'Anunțuri', icon: Home },
                            { id: 'monitor', label: 'Monitoare', icon: Bell },
                        ] as const).map(({ id, label, icon: Icon }) => (
                            <button
                                key={id}
                                onClick={() => setPanelTab(id)}
                                className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${panelTab === id ? 'border-violet-500 text-violet-600 dark:text-violet-400' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                            >
                                <Icon size={12} />{label}
                            </button>
                        ))}
                    </div>

                    <div className="p-3 max-h-44 overflow-y-auto">

                        {/* Zones tab */}
                        {panelTab === 'zones' && (
                            <div className="flex gap-1.5 flex-wrap">
                                {zones.filter(z => z.id !== 'sibiu_general').sort((a, b) => a.price_index - b.price_index).map(zone => {
                                    const m = marketData[zone.id];
                                    return (
                                        <button
                                            key={zone.id}
                                            onClick={() => { setHighlightZoneId(zone.id); setPanelOpen(false); if (compareMode) { setCompareZones(prev => prev.includes(zone.id) ? prev.filter(i => i !== zone.id) : prev.length < 3 ? [...prev, zone.id] : prev); } }}
                                            className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${compareZones.includes(zone.id) ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-700' : highlightZoneId === zone.id ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20 text-violet-700' : 'border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-gray-400 hover:border-violet-400 hover:text-violet-600'}`}
                                        >
                                            <span className="font-medium">{zone.name}</span>
                                            {m && <span className={`ml-1 font-bold ${priceColor(zone.price_index)}`}>{m.avg_price_m2.toLocaleString()}€</span>}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {/* Listings tab */}
                        {panelTab === 'listings' && (
                            <div className="space-y-1.5">
                                {listings.sort((a, b) => b.deal_score - a.deal_score).map(l => (
                                    <button
                                        key={l.id}
                                        onClick={() => { setSelectedListing(l); setPanelOpen(false); }}
                                        className={`w-full flex items-center gap-2.5 p-2 rounded-lg text-left transition-colors ${selectedListing?.id === l.id ? 'bg-violet-50 dark:bg-violet-900/20' : 'hover:bg-gray-50 dark:hover:bg-zinc-800'}`}
                                    >
                                        <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white" style={{
                                            background: l.deal_score >= 85 ? '#16a34a' : l.deal_score >= 70 ? '#ca8a04' : '#dc2626',
                                        }}>{l.deal_score}</div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{l.title}</p>
                                            <p className="text-[10px] text-gray-400">{l.price.toLocaleString()}€ · {l.price_m2.toLocaleString()}€/mp · {l.published_ago}</p>
                                        </div>
                                        <div className="flex-shrink-0 flex flex-col gap-0.5 items-end">
                                            {l.source === 'nego' && <span className="text-[8px] px-1 bg-violet-100 text-violet-600 rounded font-bold">NEGO</span>}
                                            {l.is_new && <span className="text-[8px] px-1 bg-blue-100 text-blue-600 rounded font-bold">NOU</span>}
                                            {l.price_drop && <span className="text-[8px] px-1 bg-emerald-100 text-emerald-600 rounded font-bold">↓</span>}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Monitor tab */}
                        {panelTab === 'monitor' && (
                            <div>
                                {preferences.length === 0 ? (
                                    <div className="text-center py-4 text-gray-400">
                                        <Bell size={18} className="mx-auto mb-1 opacity-30" />
                                        <p className="text-xs">Niciun monitor. <Link href="/geo" className="text-violet-500 underline">Configurează din Geo Brain</Link>.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-1.5">
                                        {preferences.map(pref => (
                                            <div key={pref._id} className="flex items-center gap-2.5 py-1">
                                                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${pref.monitor?.active ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-medium truncate">{pref.resolved_area}</p>
                                                    <p className="text-[10px] text-gray-400">
                                                        {pref.price_max ? `≤${pref.price_max.toLocaleString()} EUR` : ''}
                                                        {(pref.rooms?.length ?? 0) > 0 ? ` · ${pref.rooms?.join('/')} cam` : ''}
                                                    </p>
                                                </div>
                                                {pref.monitor?.active && <span className="text-[10px] text-emerald-500 font-medium">activ</span>}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Handle — always at the very bottom, right above mobile nav */}
                <button
                    onClick={() => setPanelOpen(!panelOpen)}
                    className="mx-auto flex items-center gap-2 px-4 py-1.5 bg-white dark:bg-zinc-900 border border-b-0 border-gray-200 dark:border-zinc-700 rounded-t-xl shadow-lg text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors"
                >
                    {panelOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    <Layers size={12} />
                    {listings.filter(l => l.verdict === 'hot').length} hot · {zones.filter(z => z.id !== 'sibiu_general').length} zone
                </button>
            </div>
        </div>
    );
}
