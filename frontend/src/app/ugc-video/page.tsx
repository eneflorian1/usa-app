'use client';
/* eslint-disable @next/next/no-img-element -- UGC video reference images use dynamic blob/base64 sources without known dimensions */

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';

interface ReferenceImage {
    _id: string;
    name: string;
    imageData: string;
    mimeType: string;
    createdAt: string;
}

interface VideoGeneration {
    _id: string;
    prompt: string;
    referenceImageIds: string[];
    analysis: string;
    videoPrompt: string;
    videoFilename: string;
    description: string;
    aspectRatio: string;
    duration: string;
    status: 'pending' | 'analyzing' | 'generating' | 'completed' | 'failed';
    error: string;
    createdAt: string;
}

interface ChatMessage {
    id: string;
    role: 'user' | 'agent';
    content: string;
    type: 'text' | 'video' | 'analysis' | 'error' | 'status';
    videoUrl?: string;
    generationId?: string;
    timestamp: Date;
}

export default function UgcVideoPage() {
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [generating, setGenerating] = useState(false);
    const [loading, setLoading] = useState(true);
    const [showRefs, setShowRefs] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
    const [dragOver, setDragOver] = useState(false);
    const [aspectRatio, setAspectRatio] = useState('16:9');
    const [duration, setDuration] = useState('8');
    const [generations, setGenerations] = useState<VideoGeneration[]>([]);
    const [activeTab, setActiveTab] = useState<'chat' | 'history'>('chat');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const pollingRef = useRef<NodeJS.Timeout | null>(null);

    const loadReferences = useCallback(async () => {
        try {
            const data = await api.get<ReferenceImage[]>('/api/ugc/references');
            if (Array.isArray(data)) setReferences(data);
        } catch { }
        setLoading(false);
    }, []);

    const loadGenerations = useCallback(async () => {
        try {
            const data = await api.get<VideoGeneration[]>('/api/ugc-video/generations');
            if (Array.isArray(data)) setGenerations(data);
        } catch { }
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadReferences();
        loadGenerations();
        // Add welcome message
        setMessages([{
            id: 'welcome',
            role: 'agent',
            content: 'Bună! Sunt agentul UGC Video. 🎬\n\nÎncarcă imagini de referință cu persoana pe care vrei să o includ în video, selectează-le, apoi descrie-mi scena dorită:\n\n• **Poziția corpului** — stând, mergând, dansând\n• **Background** — plajă, studio, oraș\n• **Acțiunea** — vorbind la cameră, alergând\n• **Îmbrăcăminte & Stil** — casual, elegant\n• **Lumina & Atmosfera** — golden hour, neon',
            type: 'text',
            timestamp: new Date(),
        }]);
        return () => {
            if (pollingRef.current) clearInterval(pollingRef.current);
        };
    }, [loadReferences, loadGenerations]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

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
                await api.post('/api/ugc/references', { name, imageData: base64, mimeType: file.type || 'image/jpeg' });
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
                resolve(result.split(',')[1]);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) uploadFiles(e.target.files);
    };

    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
    const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); };
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault(); setDragOver(false);
        if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
    };

    const deleteReference = async (id: string) => {
        await api.delete(`/api/ugc/references/${id}`);
        setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        loadReferences();
    };

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const n = new Set(prev);
            if (n.has(id)) n.delete(id); else n.add(id);
            return n;
        });
    };

    const selectAll = () => setSelectedIds(new Set(references.map(r => r._id)));
    const deselectAll = () => setSelectedIds(new Set());

    const addMessage = (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => {
        const newMsg = { ...msg, id: `msg_${Date.now()}_${Math.random()}`, timestamp: new Date() };
        setMessages(prev => [...prev, newMsg]);
        return newMsg.id;
    };

    const updateMessage = (id: string, updates: Partial<ChatMessage>) => {
        setMessages(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
    };

    const pollGeneration = (genId: string, statusMsgId: string) => {
        if (pollingRef.current) clearInterval(pollingRef.current);

        pollingRef.current = setInterval(async () => {
            try {
                const gen = await api.get<VideoGeneration>(`/api/ugc-video/generations/${genId}`);

                if (gen.status === 'analyzing') {
                    updateMessage(statusMsgId, { content: '🔍 Analizez imaginile de referință... Studiez trăsăturile faciale, tipul corpului și stilul persoanei.' });
                } else if (gen.status === 'generating') {
                    updateMessage(statusMsgId, { content: '🎬 Generez video cu Veo 3.1... Acest proces poate dura 1-6 minute.' });
                } else if (gen.status === 'completed') {
                    if (pollingRef.current) clearInterval(pollingRef.current);
                    pollingRef.current = null;

                    updateMessage(statusMsgId, { content: '✅ Video generat cu succes!', type: 'text' });

                    if (gen.analysis) {
                        addMessage({
                            role: 'agent',
                            content: gen.analysis,
                            type: 'analysis',
                        });
                    }

                    addMessage({
                        role: 'agent',
                        content: gen.videoPrompt || 'Video generat',
                        type: 'video',
                        videoUrl: `/api/ugc-video/files/${gen.videoFilename}`,
                        generationId: gen._id,
                    });

                    setGenerating(false);
                    loadGenerations();
                } else if (gen.status === 'failed') {
                    if (pollingRef.current) clearInterval(pollingRef.current);
                    pollingRef.current = null;

                    updateMessage(statusMsgId, {
                        content: `❌ Generarea a eșuat: ${gen.error || 'Eroare necunoscută'}`,
                        type: 'error',
                    });

                    setGenerating(false);
                    loadGenerations();
                }
            } catch {
                // Silently retry
            }
        }, 5000);
    };

    const handleSend = async () => {
        if (!input.trim() || generating) return;

        if (selectedIds.size === 0) {
            addMessage({
                role: 'agent',
                content: '⚠️ Selectează cel puțin o imagine de referință înainte de a genera un video.',
                type: 'error',
            });
            return;
        }

        const userPrompt = input.trim();
        setInput('');
        setGenerating(true);

        // Add user message
        addMessage({ role: 'user', content: userPrompt, type: 'text' });

        // Add status message
        const statusId = addMessage({
            role: 'agent',
            content: '⏳ Inițializez generarea video...',
            type: 'status',
        });

        try {
            const data = await api.post<{ _id?: string; error?: string }>('/api/ugc-video/generate', {
                prompt: userPrompt,
                referenceImageIds: Array.from(selectedIds),
                aspectRatio,
                duration,
            });

            if (data._id) {
                pollGeneration(data._id, statusId);
            } else {
                updateMessage(statusId, {
                    content: `❌ Eroare: ${data.error || 'Nu s-a putut iniția generarea'}`,
                    type: 'error',
                });
                setGenerating(false);
            }
        } catch (err) {
            updateMessage(statusId, {
                content: `❌ ${(err as Error).message || 'Eroare de conexiune cu serverul.'}`,
                type: 'error',
            });
            setGenerating(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const deleteGeneration = async (id: string) => {
        await api.delete(`/api/ugc-video/generations/${id}`);
        loadGenerations();
    };

    const statusColor = (status: string) => {
        switch (status) {
            case 'completed': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
            case 'failed': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
            case 'analyzing': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
            case 'generating': return 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400';
            default: return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
        }
    };

    return (
        <div className="h-[calc(100vh-7rem)] md:h-[calc(100vh-4rem)] flex flex-col max-w-5xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 md:pb-4 border-b border-gray-200 dark:border-zinc-800">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
                            <rect x="2" y="6" width="14" height="12" rx="2" />
                        </svg>
                    </div>
                    <div>
                        <h1 className="text-lg md:text-xl font-bold tracking-tight">UGC Video Agent</h1>
                        <p className="text-xs text-violet-500 font-medium flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
                            Veo 3.1 • AI Video Generation
                        </p>
                    </div>
                </div>
                {/* Tab switcher */}
                <div className="flex rounded-xl bg-gray-100 dark:bg-zinc-800 p-0.5">
                    <button
                        onClick={() => setActiveTab('chat')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${activeTab === 'chat' ? 'bg-white dark:bg-zinc-700 shadow-sm text-violet-600 dark:text-violet-400' : 'text-gray-500'}`}
                    >💬 Chat</button>
                    <button
                        onClick={() => setActiveTab('history')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${activeTab === 'history' ? 'bg-white dark:bg-zinc-700 shadow-sm text-violet-600 dark:text-violet-400' : 'text-gray-500'}`}
                    >📂 Istoric ({generations.length})</button>
                </div>
            </div>

            {activeTab === 'chat' ? (
                <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Reference Images Dropdown */}
                    <div className="rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden mt-3">
                        <button
                            onClick={() => setShowRefs(!showRefs)}
                            className="w-full px-4 md:px-5 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors"
                        >
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-lg">🖼️</span>
                                <h2 className="text-sm font-semibold">Imagini de Referință</h2>
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 font-medium">
                                    {references.length}
                                </span>
                                {selectedIds.size > 0 && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-medium">
                                        {selectedIds.size} selectate
                                    </span>
                                )}
                            </div>
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                className={`text-gray-400 transition-transform duration-200 flex-shrink-0 ${showRefs ? 'rotate-180' : ''}`}>
                                <polyline points="6 9 12 15 18 9" />
                            </svg>
                        </button>

                        {showRefs && (
                            <div className="px-4 md:px-5 pb-4 space-y-3">
                                {/* Upload Area */}
                                <div
                                    onDragOver={handleDragOver}
                                    onDragLeave={handleDragLeave}
                                    onDrop={handleDrop}
                                    className={`relative rounded-xl border-2 border-dashed transition-all ${dragOver
                                        ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 scale-[1.01]'
                                        : 'border-gray-300 dark:border-zinc-700 hover:border-violet-400 dark:hover:border-violet-600'
                                        } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
                                >
                                    {uploading ? (
                                        <div className="py-5 text-center">
                                            <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                                            <p className="text-xs font-medium text-violet-600 dark:text-violet-400">
                                                Se încarcă {uploadProgress.current} / {uploadProgress.total}...
                                            </p>
                                        </div>
                                    ) : (
                                        <label className="cursor-pointer flex items-center justify-center py-4 gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-violet-500">
                                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" x2="12" y1="3" y2="15" />
                                                </svg>
                                            </div>
                                            <div>
                                                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                                    Trage pozele aici sau <span className="text-violet-600 dark:text-violet-400 underline">alege fișiere</span>
                                                </p>
                                                <p className="text-[10px] text-gray-400 mt-0.5">Recomandat 3-10 poze diverse ale persoanei</p>
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
                                    <div className="flex items-center gap-2">
                                        <button onClick={selectAll} className="text-[10px] px-2.5 py-1 rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-500 hover:border-violet-400 hover:text-violet-600 transition-colors">
                                            ✅ Toate
                                        </button>
                                        <button onClick={deselectAll} className="text-[10px] px-2.5 py-1 rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-500 hover:text-gray-600 transition-colors">
                                            ⬜ Niciuna
                                        </button>
                                    </div>
                                )}

                                {/* Images Grid */}
                                {loading ? (
                                    <div className="flex justify-center py-4">
                                        <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                                    </div>
                                ) : references.length === 0 ? (
                                    <p className="text-xs text-gray-400 text-center py-3">Nicio imagine încărcată.</p>
                                ) : (
                                    <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-1">
                                        {references.map(ref => {
                                            const isSelected = selectedIds.has(ref._id);
                                            return (
                                                <div
                                                    key={ref._id}
                                                    className={`relative group rounded-lg overflow-hidden border-2 transition-all cursor-pointer aspect-square ${isSelected
                                                        ? 'border-violet-500 dark:border-violet-400 shadow-md shadow-violet-500/20'
                                                        : 'border-transparent hover:border-gray-300 dark:hover:border-zinc-600'
                                                        }`}
                                                    onClick={() => toggleSelect(ref._id)}
                                                >
                                                    <img
                                                        src={`data:${ref.mimeType};base64,${ref.imageData}`}
                                                        alt={ref.name}
                                                        className="w-full h-full object-cover"
                                                    />
                                                    <div className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center text-[7px] ${isSelected
                                                        ? 'bg-violet-500 border-violet-500 text-white'
                                                        : 'border-white/80 bg-black/20'
                                                        }`}>
                                                        {isSelected && (
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                                                <polyline points="20 6 9 17 4 12" />
                                                            </svg>
                                                        )}
                                                    </div>
                                                    <button
                                                        onClick={e => { e.stopPropagation(); deleteReference(ref._id); }}
                                                        className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-red-600"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Chat Messages */}
                    <div className="flex-1 overflow-y-auto py-3 space-y-3 min-h-0">
                        {messages.map(msg => (
                            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-4 py-3 ${msg.role === 'user'
                                    ? 'bg-violet-600 text-white rounded-br-md'
                                    : msg.type === 'error'
                                        ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-bl-md'
                                        : msg.type === 'status'
                                            ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-800 rounded-bl-md'
                                            : msg.type === 'analysis'
                                                ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-bl-md'
                                                : 'bg-gray-100 dark:bg-zinc-800 text-gray-800 dark:text-gray-200 rounded-bl-md'
                                    }`}>
                                    {msg.type === 'video' && msg.videoUrl ? (
                                        <div className="space-y-2">
                                            <video
                                                src={msg.videoUrl}
                                                controls
                                                className="w-full rounded-xl max-h-80 bg-black"
                                                preload="metadata"
                                            />
                                            <p className="text-[10px] text-gray-500 dark:text-gray-400 italic line-clamp-2">{msg.content}</p>
                                        </div>
                                    ) : msg.type === 'analysis' ? (
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-wider text-blue-500 dark:text-blue-400 mb-1">📋 Analiză Persoană</p>
                                            <p className="text-xs whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                                        </div>
                                    ) : msg.type === 'status' ? (
                                        <div className="flex items-center gap-2">
                                            <div className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                                            <p className="text-xs">{msg.content}</p>
                                        </div>
                                    ) : (
                                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                                    )}
                                    <p className={`text-[9px] mt-1.5 ${msg.role === 'user' ? 'text-white/60' : 'text-gray-400'}`}>
                                        {msg.timestamp.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                </div>
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input Area */}
                    <div className="border-t border-gray-200 dark:border-zinc-800 pt-3 pb-1">
                        {/* Config row */}
                        <div className="flex items-center gap-3 mb-2">
                            <div className="flex items-center gap-1.5">
                                <label className="text-[9px] font-bold text-gray-400 uppercase">Ratio</label>
                                <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)}
                                    className="text-[11px] px-2 py-1 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 outline-none focus:ring-1 focus:ring-violet-500">
                                    <option value="16:9">16:9</option>
                                    <option value="9:16">9:16</option>
                                </select>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <label className="text-[9px] font-bold text-gray-400 uppercase">Durată</label>
                                <select value={duration} onChange={e => setDuration(e.target.value)}
                                    className="text-[11px] px-2 py-1 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 outline-none focus:ring-1 focus:ring-violet-500">
                                    <option value="5">5s</option>
                                    <option value="6">6s</option>
                                    <option value="8">8s</option>
                                </select>
                            </div>
                            {selectedIds.size === 0 && (
                                <p className="text-[10px] text-amber-500 flex items-center gap-1">
                                    <span>⚠️</span> Selectează imagini de referință
                                </p>
                            )}
                        </div>

                        {/* Text input */}
                        <div className="flex gap-2">
                            <textarea
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Descrie scena video: poziția corpului, background, acțiunea, îmbrăcămintea, lumina..."
                                rows={2}
                                disabled={generating}
                                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none resize-none disabled:opacity-50"
                            />
                            <button
                                onClick={handleSend}
                                disabled={!input.trim() || selectedIds.size === 0 || generating}
                                className="px-4 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-all flex items-center justify-center shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 self-end h-[42px]"
                            >
                                {generating ? (
                                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="m5 12 7-7 7 7" /><path d="M12 19V5" />
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                /* History Tab */
                <div className="flex-1 overflow-y-auto py-4">
                    {generations.length === 0 ? (
                        <div className="text-center py-16">
                            <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-violet-500/10 to-purple-500/10 flex items-center justify-center mx-auto mb-4">
                                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-violet-500">
                                    <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
                                    <rect x="2" y="6" width="14" height="12" rx="2" />
                                </svg>
                            </div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Niciun video generat încă</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Folosește chat-ul pentru a genera primul video</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {generations.map(gen => (
                                <div key={gen._id} className="rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden group">
                                    <div className="flex gap-3 p-4">
                                        {/* Video thumbnail / status */}
                                        <div className="w-32 h-20 md:w-40 md:h-24 rounded-xl overflow-hidden flex-shrink-0 bg-gray-100 dark:bg-zinc-800 flex items-center justify-center">
                                            {gen.status === 'completed' && gen.videoFilename ? (
                                                <video
                                                    src={`/api/ugc-video/files/${gen.videoFilename}`}
                                                    className="w-full h-full object-cover"
                                                    preload="metadata"
                                                    muted
                                                />
                                            ) : gen.status === 'failed' ? (
                                                <span className="text-2xl">❌</span>
                                            ) : (
                                                <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                                            )}
                                        </div>

                                        {/* Details */}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs text-gray-700 dark:text-gray-300 line-clamp-2 font-medium">{gen.prompt}</p>
                                            {gen.error && <p className="text-[10px] text-red-500 mt-1 line-clamp-1">{gen.error}</p>}
                                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${statusColor(gen.status)}`}>{gen.status}</span>
                                                <span className="text-[10px] text-gray-400">{gen.aspectRatio} • {gen.duration}s</span>
                                                <span className="text-[10px] text-gray-400">
                                                    {new Date(gen.createdAt).toLocaleString('ro-RO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex flex-col gap-1">
                                            {gen.status === 'completed' && gen.videoFilename && (
                                                <a
                                                    href={`/api/ugc-video/files/${gen.videoFilename}`}
                                                    download
                                                    className="text-[10px] px-2 py-1 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 hover:bg-violet-200 transition-colors text-center"
                                                >
                                                    ⬇️ Download
                                                </a>
                                            )}
                                            <button
                                                onClick={() => deleteGeneration(gen._id)}
                                                className="text-[10px] px-2 py-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all opacity-0 group-hover:opacity-100"
                                            >
                                                🗑️ Șterge
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
