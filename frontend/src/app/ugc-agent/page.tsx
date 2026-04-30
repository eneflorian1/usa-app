'use client';
/* eslint-disable @next/next/no-img-element -- UGC images use dynamic blob/base64 sources without known dimensions */

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';

interface ReferenceImage {
    _id: string;
    name: string;
    imageData: string;
    mimeType: string;
    createdAt: string;
}

interface Generation {
    _id: string;
    prompt: string;
    referenceImageIds: string[];
    resultFilename: string;
    resultImageData?: string;
    description: string;
    aspectRatio: string;
    resolution: string;
    status: 'pending' | 'completed' | 'failed';
    error: string;
    createdAt: string;
}

const ASPECT_RATIOS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];
const RESOLUTIONS = ['1K', '2K', '4K'];

export default function UgcAgentPage() {
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [generations, setGenerations] = useState<Generation[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [prompt, setPrompt] = useState('');
    const [aspectRatio, setAspectRatio] = useState('auto');
    const [resolution, setResolution] = useState('1K');
    const [generating, setGenerating] = useState(false);
    const [loading, setLoading] = useState(true);
    const [showRefs, setShowRefs] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
    const [dragOver, setDragOver] = useState(false);
    const [viewImage, setViewImage] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadReferences = useCallback(async () => {
        try {
            const data = await api.get<ReferenceImage[]>('/api/ugc/references');
            if (Array.isArray(data)) setReferences(data);
        } catch { }
        setLoading(false);
    }, []);

    const loadGenerations = useCallback(async () => {
        try {
            const data = await api.get<Generation[]>('/api/ugc/generations');
            if (Array.isArray(data)) setGenerations(data);
        } catch { }
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadReferences();
        loadGenerations();
    }, [loadReferences, loadGenerations]);

    // Upload multiple files
    const uploadFiles = async (files: FileList | File[]) => {
        const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
        if (imageFiles.length === 0) return;

        setUploading(true);
        setUploadProgress({ current: 0, total: imageFiles.length });

        for (let i = 0; i < imageFiles.length; i++) {
            const file = imageFiles[i];
            setUploadProgress({ current: i + 1, total: imageFiles.length });

            try {
                const base64 = await fileToBase64(file);
                const name = file.name.replace(/\.[^.]+$/, '');
                await api.post('/api/ugc/references', {
                    name,
                    imageData: base64,
                    mimeType: file.type || 'image/jpeg',
                });
            } catch (err) {
                console.error(`Failed to upload ${file.name}:`, err);
            }
        }

        setUploading(false);
        setUploadProgress({ current: 0, total: 0 });
        loadReferences();
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const fileToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                resolve(result.split(',')[1]); // Remove data:...;base64, prefix
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            uploadFiles(e.target.files);
        }
    };

    // Drag and drop handlers
    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
    const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); };
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length > 0) {
            uploadFiles(e.dataTransfer.files);
        }
    };

    const deleteReference = async (id: string) => {
        await api.delete(`/api/ugc/references/${id}`);
        setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        loadReferences();
    };

    const deleteAllReferences = async () => {
        if (!confirm(`Șterge toate cele ${references.length} imagini de referință?`)) return;
        for (const ref of references) {
            await api.delete(`/api/ugc/references/${ref._id}`);
        }
        setSelectedIds(new Set());
        loadReferences();
    };

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const n = new Set(prev);
            if (n.has(id)) n.delete(id); else n.add(id);
            return n;
        });
    };

    const selectAll = () => {
        setSelectedIds(new Set(references.map(r => r._id)));
    };

    const deselectAll = () => {
        setSelectedIds(new Set());
    };

    const generate = async () => {
        if (!prompt.trim() || selectedIds.size === 0 || generating) return;
        setGenerating(true);
        try {
            const data = await api.post<{ _id?: string; generation?: unknown }>('/api/ugc/generate', {
                prompt: prompt.trim(),
                referenceImageIds: Array.from(selectedIds),
                aspectRatio,
                resolution,
            });
            if (data._id || data.generation) {
                loadGenerations();
            }
        } catch { }
        setGenerating(false);
    };

    const deleteGeneration = async (id: string) => {
        await api.delete(`/api/ugc/generations/${id}`);
        loadGenerations();
    };

    // Get image URL — supports both new (filename) and old (base64) formats
    const getImageSrc = (gen: Generation): string | null => {
        if (gen.resultFilename) return `/api/ugc/images/${gen.resultFilename}`;
        if (gen.resultImageData) return `data:image/png;base64,${gen.resultImageData}`;
        return null;
    };

    // Download image from URL as a file
    const downloadImage = (url: string, filename: string) => {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    return (
        <div className="h-[calc(100vh-7rem)] md:h-[calc(100vh-4rem)] flex flex-col max-w-5xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 md:pb-4 border-b border-gray-200 dark:border-zinc-800">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center shadow-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                            <circle cx="12" cy="13" r="3" />
                        </svg>
                    </div>
                    <div>
                        <h1 className="text-lg md:text-xl font-bold tracking-tight">UGC Agent</h1>
                        <p className="text-xs text-pink-500 font-medium flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse" />
                            Nano Banana 2 • AI Photo Generation
                        </p>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-4">
                {/* Reference Images Section */}
                <div className="rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                    <button
                        onClick={() => setShowRefs(!showRefs)}
                        className="w-full px-4 md:px-6 py-3.5 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors"
                    >
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-lg">🖼️</span>
                            <h2 className="text-sm font-semibold">Imagini de Referință</h2>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400 font-medium">
                                {references.length}
                            </span>
                            {selectedIds.size > 0 && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-medium">
                                    {selectedIds.size} selectate
                                </span>
                            )}
                            {references.length > 0 && references.length < 15 && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-medium">
                                    recomandat: 15-25 poze
                                </span>
                            )}
                        </div>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                            className={`text-gray-400 transition-transform duration-200 flex-shrink-0 ${showRefs ? 'rotate-180' : ''}`}>
                            <polyline points="6 9 12 15 18 9" />
                        </svg>
                    </button>

                    {showRefs && (
                        <div className="px-4 md:px-6 pb-4 space-y-3">
                            {/* Upload Area — Drag & Drop + Multi-file */}
                            <div
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleDrop}
                                className={`relative rounded-xl border-2 border-dashed transition-all ${dragOver
                                    ? 'border-pink-500 bg-pink-50 dark:bg-pink-950/30 scale-[1.01]'
                                    : 'border-gray-300 dark:border-zinc-700 hover:border-pink-400 dark:hover:border-pink-600'
                                    } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
                            >
                                {uploading ? (
                                    <div className="py-6 text-center">
                                        <div className="w-8 h-8 border-3 border-pink-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                                        <p className="text-sm font-medium text-pink-600 dark:text-pink-400">
                                            Se încarcă {uploadProgress.current} / {uploadProgress.total}...
                                        </p>
                                        <div className="mt-2 mx-auto w-48 h-1.5 bg-gray-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-gradient-to-r from-pink-500 to-rose-500 rounded-full transition-all duration-300"
                                                style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <label className="cursor-pointer flex flex-col items-center py-6 gap-2">
                                        <div className="w-10 h-10 rounded-xl bg-pink-100 dark:bg-pink-900/30 flex items-center justify-center">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-pink-500">
                                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" x2="12" y1="3" y2="15" />
                                            </svg>
                                        </div>
                                        <div className="text-center">
                                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                Trage pozele aici sau <span className="text-pink-600 dark:text-pink-400 underline">alege fișiere</span>
                                            </p>
                                            <p className="text-xs text-gray-400 mt-0.5">Poți selecta mai multe fișiere odată • Recomandat 15-25 poze diverse</p>
                                        </div>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/*"
                                            multiple
                                            className="hidden"
                                            onChange={handleFileInput}
                                        />
                                    </label>
                                )}
                            </div>

                            {/* Action buttons */}
                            {references.length > 0 && (
                                <div className="flex items-center gap-2 flex-wrap">
                                    <button onClick={selectAll} className="text-[11px] px-3 py-1.5 rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-gray-400 hover:border-pink-400 hover:text-pink-600 dark:hover:text-pink-400 transition-colors">
                                        ✅ Selectează toate
                                    </button>
                                    <button onClick={deselectAll} className="text-[11px] px-3 py-1.5 rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-gray-400 hover:border-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                                        ⬜ Deselectează
                                    </button>
                                    <div className="flex-1" />
                                    <button onClick={deleteAllReferences} className="text-[11px] px-3 py-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors">
                                        🗑️ Șterge toate
                                    </button>
                                </div>
                            )}

                            {/* Images Grid */}
                            {loading ? (
                                <div className="flex justify-center py-6">
                                    <div className="w-6 h-6 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
                                </div>
                            ) : references.length === 0 ? (
                                <p className="text-sm text-gray-400 text-center py-4">Nicio imagine încărcată. Adaugă 15-25 fotografii ale persoanei din unghiuri și contexte diferite.</p>
                            ) : (
                                <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-1.5">
                                    {references.map(ref => {
                                        const isSelected = selectedIds.has(ref._id);
                                        return (
                                            <div
                                                key={ref._id}
                                                className={`relative group rounded-lg overflow-hidden border-2 transition-all cursor-pointer aspect-square ${isSelected
                                                    ? 'border-pink-500 dark:border-pink-400 shadow-md shadow-pink-500/20'
                                                    : 'border-transparent hover:border-gray-300 dark:hover:border-zinc-600'
                                                    }`}
                                                onClick={() => toggleSelect(ref._id)}
                                            >
                                                <img
                                                    src={`data:${ref.mimeType};base64,${ref.imageData}`}
                                                    alt={ref.name}
                                                    className="w-full h-full object-cover"
                                                />
                                                {/* Selection indicator */}
                                                <div className={`absolute top-1 left-1 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all text-[8px] ${isSelected
                                                    ? 'bg-pink-500 border-pink-500 text-white'
                                                    : 'border-white/80 bg-black/20'
                                                    }`}>
                                                    {isSelected && (
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                                            <polyline points="20 6 9 17 4 12" />
                                                        </svg>
                                                    )}
                                                </div>
                                                {/* Delete button */}
                                                <button
                                                    onClick={e => { e.stopPropagation(); deleteReference(ref._id); }}
                                                    className="absolute top-1 right-1 w-4 h-4 rounded-full bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-red-600"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Generation Form */}
                <div className="rounded-2xl border border-gray-200 dark:border-zinc-800 bg-gradient-to-br from-pink-50/50 to-rose-50/50 dark:from-pink-950/20 dark:to-rose-950/20 p-4 md:p-6 space-y-3">
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">✨ Generează Imagine Nouă</h3>

                    <textarea
                        value={prompt}
                        onChange={e => setPrompt(e.target.value)}
                        placeholder="Descrie scena: poziția corpului, background-ul, îmbrăcămintea, lumina, unghiul camerei... (ex: 'persoana stă pe un scaun de bar într-un club elegant, lumină caldă, poartă un costum negru, privește spre cameră')"
                        rows={3}
                        className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none resize-none"
                    />

                    <div className="flex flex-wrap items-end gap-3">
                        {/* Aspect Ratio */}
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Aspect Ratio</label>
                            <select
                                value={aspectRatio}
                                onChange={e => setAspectRatio(e.target.value)}
                                className="px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs outline-none focus:ring-2 focus:ring-pink-500"
                            >
                                {ASPECT_RATIOS.map(ar => <option key={ar} value={ar}>{ar}</option>)}
                            </select>
                        </div>

                        {/* Resolution */}
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Rezoluție</label>
                            <select
                                value={resolution}
                                onChange={e => setResolution(e.target.value)}
                                className="px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs outline-none focus:ring-2 focus:ring-pink-500"
                            >
                                {RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </div>

                        <div className="flex-1" />

                        {/* Generate Button */}
                        <button
                            onClick={generate}
                            disabled={!prompt.trim() || selectedIds.size === 0 || generating}
                            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all flex items-center gap-2 shadow-lg shadow-pink-500/25 hover:shadow-pink-500/40"
                        >
                            {generating ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    Se generează...
                                </>
                            ) : (
                                <>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" />
                                        <path d="m14 7 3 3" /><path d="M5 6v4" /><path d="M19 14v4" /><path d="M10 2v2" /><path d="M7 8H3" /><path d="M21 16h-4" /><path d="M11 3H9" />
                                    </svg>
                                    Generează ({selectedIds.size} ref.)
                                </>
                            )}
                        </button>
                    </div>

                    {selectedIds.size === 0 && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">⚠️ Selectează cel puțin o imagine de referință din secțiunea de mai sus</p>
                    )}
                </div>

                {/* Generated Results */}
                <div>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1 mb-2">
                        Rezultate ({generations.length})
                    </h3>

                    {generations.length === 0 ? (
                        <div className="text-center py-12">
                            <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-pink-500/10 to-rose-500/10 flex items-center justify-center mx-auto mb-4">
                                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-pink-500">
                                    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                                    <circle cx="12" cy="13" r="3" />
                                </svg>
                            </div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Niciun rezultat încă</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Încarcă poze de referință, selectează-le și generează prima imagine</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {generations.map(gen => (
                                <div key={gen._id} className="rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden group">
                                    {gen.status === 'completed' && getImageSrc(gen) && (
                                        <div
                                            className="cursor-pointer relative"
                                            onClick={() => setViewImage(getImageSrc(gen)!)}
                                        >
                                            <img
                                                src={getImageSrc(gen)!}
                                                alt={gen.prompt}
                                                className="w-full aspect-[4/3] object-cover"
                                            />
                                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                                                <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 dark:bg-zinc-800/90 rounded-full p-2">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /><path d="M11 8v6" /><path d="M8 11h6" />
                                                    </svg>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {gen.status === 'pending' && (
                                        <div className="aspect-[4/3] flex items-center justify-center bg-gray-50 dark:bg-zinc-800">
                                            <div className="text-center">
                                                <div className="w-8 h-8 border-3 border-pink-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                                                <p className="text-xs text-gray-400">Se generează...</p>
                                            </div>
                                        </div>
                                    )}
                                    {gen.status === 'failed' && (
                                        <div className="aspect-[4/3] flex items-center justify-center bg-red-50 dark:bg-red-950/20">
                                            <div className="text-center px-4">
                                                <p className="text-2xl mb-1">❌</p>
                                                <p className="text-xs text-red-500 dark:text-red-400">{gen.error || 'Generare eșuată'}</p>
                                            </div>
                                        </div>
                                    )}

                                    <div className="p-3">
                                        <p className="text-xs text-gray-700 dark:text-gray-300 line-clamp-2">{gen.prompt}</p>
                                        {gen.description && (
                                            <p className="text-[10px] text-gray-400 mt-1 line-clamp-1 italic">{gen.description}</p>
                                        )}
                                        <div className="flex items-center justify-between mt-2">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${gen.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                                    : gen.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                                    }`}>{gen.status}</span>
                                                <span className="text-[10px] text-gray-400">
                                                    {new Date(gen.createdAt).toLocaleString('ro-RO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                {gen.status === 'completed' && getImageSrc(gen) && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); downloadImage(getImageSrc(gen)!, gen.resultFilename || `ugc_${gen._id}.png`); }}
                                                        className="text-gray-400 hover:text-pink-500 p-1"
                                                        title="Descarcă"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => deleteGeneration(gen._id)}
                                                    className="text-gray-400 hover:text-red-500 p-1"
                                                    title="Șterge"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Fullscreen Image Viewer */}
            {viewImage && (
                <div
                    className="fixed inset-0 z-[999] bg-black/90 flex items-center justify-center p-4"
                    onClick={() => setViewImage(null)}
                >
                    <div className="absolute top-4 right-4 flex items-center gap-2">
                        <button
                            className="text-white/80 hover:text-white p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors"
                            title="Descarcă imaginea"
                            onClick={(e) => { e.stopPropagation(); const filename = viewImage!.split('/').pop() || `ugc_${Date.now()}.png`; downloadImage(viewImage!, filename); }}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
                        </button>
                        <button className="text-white/80 hover:text-white p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors" onClick={() => setViewImage(null)}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                        </button>
                    </div>
                    <img src={viewImage} alt="Preview" className="max-w-full max-h-full rounded-2xl object-contain" onClick={e => e.stopPropagation()} />
                </div>
            )}
        </div>
    );
}
