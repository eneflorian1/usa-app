'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';

interface Escalation {
    _id: string;
    reason: string;
    context: string;
    agentType: string;
    status: 'pending' | 'handled';
    priority: string;
    createdAt: string;
}

const priorityDot: Record<string, string> = {
    critical: 'bg-red-500',
    high: 'bg-orange-500',
    medium: 'bg-yellow-400',
    low: 'bg-blue-400',
};

const priorityBadge: Record<string, string> = {
    critical: 'bg-red-500/20 text-red-400 border-red-500/30',
    high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

export default function AlertsFAB() {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const [escalations, setEscalations] = useState<Escalation[]>([]);
    const [loading, setLoading] = useState(true);
    const panelRef = useRef<HTMLDivElement>(null);

    const fetchEscalations = useCallback(async () => {
        try {
            const data = await api.get<Escalation[]>('/api/escalations');
            if (Array.isArray(data)) setEscalations(data);
        } catch { }
        setLoading(false);
    }, []);

    // Poll every 15s
    useEffect(() => {
        fetchEscalations();
        const interval = setInterval(fetchEscalations, 15000);
        return () => clearInterval(interval);
    }, [fetchEscalations]);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const handleMarkHandled = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await api.patch(`/api/escalations/${id}`, { status: 'handled' });
            setEscalations(prev => prev.map(es => es._id === id ? { ...es, status: 'handled' } : es));
        } catch { }
    };

    const pending = escalations.filter(e => e.status === 'pending');
    const pendingCount = pending.length;

    // On the notifications page, hide FAB to avoid duplication
    const isNotificationsPage = pathname === '/notifications';

    return (
        <div ref={panelRef} className={isNotificationsPage ? 'hidden' : ''}>
            {/* FAB — fixed top right */}
            <div className="fixed z-50 top-4 right-4 md:right-6">
                <button
                    onClick={() => setOpen(prev => !prev)}
                    className={`relative w-11 h-11 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 ${
                        open
                            ? 'bg-amber-500 scale-110'
                            : pendingCount > 0
                                ? 'bg-gradient-to-br from-amber-500 to-orange-600 hover:scale-110 hover:shadow-amber-500/40'
                                : 'bg-zinc-800 hover:bg-zinc-700 hover:scale-110'
                    }`}
                    aria-label="Agent alerts"
                    title="Agent alerts"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                    </svg>

                    {pendingCount > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold border-2 border-black">
                            {pendingCount > 99 ? '99+' : pendingCount}
                        </span>
                    )}

                    {pendingCount > 0 && !open && (
                        <span className="absolute inset-0 rounded-full bg-amber-400/20 animate-ping" style={{ animationDuration: '2s' }} />
                    )}
                </button>

                {/* Dropdown — opens downward from button */}
                {open && (
                    <div className="pointer-events-auto absolute top-14 right-0 w-80 bg-zinc-950/95 border border-amber-500/30 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                            <div className="flex items-center gap-2">
                                <span className="text-amber-400 text-sm">🔔</span>
                                <span className="text-white text-sm font-semibold">Agent Alerts</span>
                                {pendingCount > 0 && (
                                    <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-black text-[10px] font-bold">
                                        {pendingCount}
                                    </span>
                                )}
                            </div>
                            <button
                                onClick={() => setOpen(false)}
                                className="text-white/40 hover:text-white text-[10px] font-bold uppercase tracking-wider"
                            >
                                Hide
                            </button>
                        </div>

                        {/* List */}
                        <div className="max-h-72 overflow-y-auto">
                            {loading ? (
                                <div className="flex justify-center py-6">
                                    <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                                </div>
                            ) : escalations.length === 0 ? (
                                <div className="py-8 text-center">
                                    <div className="text-2xl mb-2">✅</div>
                                    <p className="text-xs text-white/40">No alerts from agents.</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-white/5">
                                    {escalations.map(esc => (
                                        <div
                                            key={esc._id}
                                            className={`px-4 py-3 flex items-start gap-3 transition-opacity ${esc.status === 'handled' ? 'opacity-40' : ''}`}
                                        >
                                            <div className="mt-1 flex-shrink-0">
                                                <div className={`w-2 h-2 rounded-full ${priorityDot[esc.priority] || 'bg-gray-400'}`} />
                                            </div>

                                            <div className="flex-1 min-w-0 space-y-1">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${priorityBadge[esc.priority] || priorityBadge.medium}`}>
                                                        {esc.priority.toUpperCase()}
                                                    </span>
                                                    {esc.agentType && (
                                                        <span className="text-[10px] text-white/40">{esc.agentType}</span>
                                                    )}
                                                    <span className="text-[10px] text-white/30 ml-auto">
                                                        {new Date(esc.createdAt).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-white/80 leading-snug">{esc.reason}</p>
                                                {esc.status === 'handled' && (
                                                    <span className="text-[10px] text-emerald-400">✓ Handled</span>
                                                )}
                                            </div>

                                            {esc.status === 'pending' && (
                                                <button
                                                    onClick={(e) => handleMarkHandled(esc._id, e)}
                                                    className="flex-shrink-0 px-2 py-1 text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/30 transition-colors"
                                                >
                                                    Done
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-4 py-2.5 border-t border-white/10">
                            <a
                                href="/notifications"
                                className="text-[11px] text-amber-400/70 hover:text-amber-400 transition-colors font-medium"
                                onClick={() => setOpen(false)}
                            >
                                View all alerts →
                            </a>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
