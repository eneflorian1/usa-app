'use client';

import { useState, useEffect, useCallback } from 'react';
import { Package, MapPin, AlertTriangle, CheckCircle, XCircle, Plus, Trash2, Eye, Clock } from 'lucide-react';
import { api } from '@/lib/api';

interface HouseObject {
    _id: string;
    name: string;
    description: string;
    expectedLocation: string;
    lastSeen: string;
    lastSeenLocation: string;
    timesDisplaced: number;
    createdAt: string;
}

interface DisplacedObject {
    _id: string;
    objectName: string;
    expectedLocation: string;
    foundLocation: string;
    status: string;
    detectedAt: string;
}

interface CleanupBatch {
    _id: string;
    displacedObjects: DisplacedObject[];
    status: string;
    notifiedAt: string;
}

export default function HouseObjectsPage() {
    const [objects, setObjects] = useState<HouseObject[]>([]);
    const [displaced, setDisplaced] = useState<DisplacedObject[]>([]);
    const [pendingBatch, setPendingBatch] = useState<CleanupBatch | null>(null);
    const [trackingEnabled, setTrackingEnabled] = useState(false);
    const [loading, setLoading] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);
    const [form, setForm] = useState({ name: '', description: '', expectedLocation: '' });
    const [formStatus, setFormStatus] = useState('');
    const [tab, setTab] = useState<'objects' | 'displaced'>('objects');

    const loadData = useCallback(async () => {
        try {
            const [objData, dispData, batchData, toggleData] = await Promise.all([
                api.get<HouseObject[]>('/api/house-objects'),
                api.get<DisplacedObject[]>('/api/displaced-objects'),
                api.get<CleanupBatch | null>('/api/cleanup-batches/pending'),
                api.get<{ enabled: boolean }>('/api/settings/object-tracking')
            ]);

            if (Array.isArray(objData)) setObjects(objData);
            if (Array.isArray(dispData)) setDisplaced(dispData);
            if (batchData && batchData._id) setPendingBatch(batchData);
            setTrackingEnabled(toggleData.enabled || false);
        } catch (err) {
            console.error('Load error:', err);
        }
        setLoading(false);
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    const handleToggle = async () => {
        const newValue = !trackingEnabled;
        setTrackingEnabled(newValue);
        await api.post('/api/settings/object-tracking', { enabled: newValue });
    };

    const handleAddObject = async () => {
        if (!form.name || !form.expectedLocation) {
            setFormStatus('Numele și locația sunt obligatorii');
            return;
        }
        setFormStatus('Se salvează...');
        try {
            await api.post('/api/house-objects', form);
            setForm({ name: '', description: '', expectedLocation: '' });
            setShowAddForm(false);
            setFormStatus('');
            loadData();
        } catch {
            setFormStatus('Eroare la salvare');
        }
    };

    const handleDeleteObject = async (id: string) => {
        if (!confirm('Ștergi acest obiect?')) return;
        await api.delete(`/api/house-objects/${id}`);
        loadData();
    };

    const handleApproveBatch = async (batchId: string) => {
        try {
            await api.post(`/api/cleanup-batches/${batchId}/approve`);
            setPendingBatch(null);
            loadData();
        } catch (err) {
            console.error('Approve error:', err);
        }
    };

    const handleDismissBatch = async (batchId: string) => {
        try {
            await api.post(`/api/cleanup-batches/${batchId}/dismiss`);
            setPendingBatch(null);
            loadData();
        } catch (err) {
            console.error('Dismiss error:', err);
        }
    };

    const handleResolveDisplaced = async (id: string) => {
        await api.patch(`/api/displaced-objects/${id}/resolve`);
        loadData();
    };

    const timeAgo = (dateStr: string) => {
        // eslint-disable-next-line react-hooks/purity
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        return `${Math.floor(hours / 24)}d ago`;
    };

    return (
        <div className="h-full flex flex-col space-y-4 max-w-2xl mx-auto pb-24">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight">🏠 House Objects</h1>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {objects.length} obiecte tracked · {displaced.length} deplasate
                    </p>
                </div>

                {/* Tracking Toggle */}
                <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-gray-500">
                        {trackingEnabled ? 'ON' : 'OFF'}
                    </span>
                    <button
                        onClick={handleToggle}
                        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${trackingEnabled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                    >
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform shadow ${trackingEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>
            </div>

            {/* Cleanup Batch Notification Banner */}
            {pendingBatch && (
                <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 animate-pulse-soft">
                    <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
                            <AlertTriangle className="text-amber-600 dark:text-amber-400" size={20} />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-bold text-amber-900 dark:text-amber-200">
                                {pendingBatch.displacedObjects.length} obiecte sunt deplasate!
                            </h3>
                            <p className="text-sm text-amber-700 dark:text-amber-300 mt-0.5">
                                Vrei să adaugi task-uri de curățenie în calendar?
                            </p>
                            <div className="mt-2 space-y-1">
                                {pendingBatch.displacedObjects.slice(0, 3).map(d => (
                                    <p key={d._id} className="text-xs text-amber-600 dark:text-amber-400">
                                        • {d.objectName}: {d.foundLocation} → {d.expectedLocation}
                                    </p>
                                ))}
                                {pendingBatch.displacedObjects.length > 3 && (
                                    <p className="text-xs text-amber-500">...și încă {pendingBatch.displacedObjects.length - 3}</p>
                                )}
                            </div>
                            <div className="flex gap-2 mt-3">
                                <button
                                    onClick={() => handleApproveBatch(pendingBatch._id)}
                                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-colors"
                                >
                                    <CheckCircle size={16} />
                                    Approve — Adaugă în Calendar
                                </button>
                                <button
                                    onClick={() => handleDismissBatch(pendingBatch._id)}
                                    className="flex items-center gap-1.5 px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-xl transition-colors"
                                >
                                    <XCircle size={16} />
                                    Dismiss
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 bg-gray-100 dark:bg-zinc-800 rounded-xl p-1">
                <button
                    onClick={() => setTab('objects')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${tab === 'objects' ? 'bg-white dark:bg-zinc-900 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                >
                    <Package size={16} />
                    Obiecte ({objects.length})
                </button>
                <button
                    onClick={() => setTab('displaced')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${tab === 'displaced' ? 'bg-white dark:bg-zinc-900 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                >
                    <AlertTriangle size={16} />
                    Deplasate ({displaced.length})
                </button>
            </div>

            {/* Content */}
            {loading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
                </div>
            ) : tab === 'objects' ? (
                <div className="space-y-3">
                    {/* Add Object Button */}
                    <button
                        onClick={() => setShowAddForm(!showAddForm)}
                        className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-gray-200 dark:border-zinc-700 rounded-2xl text-sm font-medium text-gray-500 hover:text-blue-600 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                    >
                        <Plus size={18} />
                        {showAddForm ? 'Anulează' : 'Adaugă obiect nou'}
                    </button>

                    {/* Add Form */}
                    {showAddForm && (
                        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 space-y-3">
                            <input
                                placeholder="Nume obiect (ex: Telecomandă TV)"
                                value={form.name}
                                onChange={e => setForm({ ...form, name: e.target.value })}
                                className="w-full px-3 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-transparent text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <input
                                placeholder="Descriere (ex: Telecomandă neagră Samsung)"
                                value={form.description}
                                onChange={e => setForm({ ...form, description: e.target.value })}
                                className="w-full px-3 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-transparent text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <input
                                placeholder="Locație așteptată (ex: Pe masă lângă TV)"
                                value={form.expectedLocation}
                                onChange={e => setForm({ ...form, expectedLocation: e.target.value })}
                                className="w-full px-3 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-transparent text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <div className="flex items-center justify-between">
                                {formStatus && <span className="text-xs text-red-500">{formStatus}</span>}
                                <button
                                    onClick={handleAddObject}
                                    className="ml-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
                                >
                                    Salvează
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Objects List */}
                    {objects.length === 0 ? (
                        <div className="text-center py-12">
                            <Package className="mx-auto text-gray-300 dark:text-zinc-600 mb-3" size={48} />
                            <p className="text-gray-500 dark:text-gray-400 font-medium">Niciun obiect tracked</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                Adaugă obiecte manual sau spune-i ochelarilor &ldquo;ține minte că X stă pe Y&rdquo;
                            </p>
                        </div>
                    ) : (
                        objects.map(obj => (
                            <div key={obj._id} className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 group hover:border-blue-200 dark:hover:border-blue-800 transition-colors">
                                <div className="flex items-start justify-between">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-semibold text-gray-900 dark:text-white">{obj.name}</h3>
                                            {obj.timesDisplaced > 0 && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                                                    {obj.timesDisplaced}× mutat
                                                </span>
                                            )}
                                        </div>
                                        {obj.description && (
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{obj.description}</p>
                                        )}
                                        <div className="flex items-center gap-3 mt-2">
                                            <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                                                <MapPin size={12} />
                                                <span>{obj.expectedLocation}</span>
                                            </div>
                                            {obj.lastSeenLocation && obj.lastSeenLocation !== obj.expectedLocation && (
                                                <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                                                    <Eye size={12} />
                                                    <span>Văzut la: {obj.lastSeenLocation}</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1 text-[10px] text-gray-400 mt-1.5">
                                            <Clock size={10} />
                                            <span>Ultima scanare: {timeAgo(obj.lastSeen)}</span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleDeleteObject(obj._id)}
                                        className="opacity-0 group-hover:opacity-100 p-2 text-gray-400 hover:text-red-500 transition-all"
                                        title="Șterge"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            ) : (
                /* Displaced Objects Tab */
                <div className="space-y-3">
                    {displaced.length === 0 ? (
                        <div className="text-center py-12">
                            <CheckCircle className="mx-auto text-emerald-300 dark:text-emerald-800 mb-3" size={48} />
                            <p className="text-gray-500 dark:text-gray-400 font-medium">Totul e la locul lui! ✨</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                Niciun obiect deplasate detectat
                            </p>
                        </div>
                    ) : (
                        displaced.map(d => (
                            <div key={d._id} className="bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-800/50 rounded-2xl p-4">
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <h3 className="font-semibold text-gray-900 dark:text-white">{d.objectName}</h3>
                                        <div className="flex items-center gap-2 mt-2">
                                            <span className="text-xs px-2 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 font-medium">
                                                📍 {d.foundLocation}
                                            </span>
                                            <span className="text-gray-400">→</span>
                                            <span className="text-xs px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 font-medium">
                                                ✅ {d.expectedLocation}
                                            </span>
                                        </div>
                                        <p className="text-[10px] text-gray-400 mt-1.5">Detectat {timeAgo(d.detectedAt)}</p>
                                    </div>
                                    <button
                                        onClick={() => handleResolveDisplaced(d._id)}
                                        className="px-3 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"
                                    >
                                        Rezolvat ✓
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
