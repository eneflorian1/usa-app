'use client';
/* eslint-disable @next/next/no-img-element -- UGC product images use dynamic blob/base64 sources without known dimensions */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Package, Camera, Info, Settings2, Trash2, Plus, RefreshCw, Download, Image as ImageIcon, Zap, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { api } from '@/lib/api';

interface ProductImage {
    _id: string;
    name: string;
    imageData: string;
    mimeType: string;
}

interface ReferenceImage {
    _id: string;
    name: string;
    imageData: string;
    mimeType: string;
    label: string;
}

interface Generation {
    _id: string;
    prompt: string;
    resultFilename: string;
    description: string;
    aspectRatio: string;
    status: 'pending' | 'completed' | 'failed';
    error: string;
    createdAt: string;
}

interface Product {
    _id: string;
    name: string;
    description: string;
    productImages: ProductImage[];
    referenceImages: ReferenceImage[];
    systemPrompt: string;
    visualBible: string;
    visualBibleGeneratedAt: string | null;
    avatarImages: ReferenceImage[];
    generations: Generation[];
}

const ASPECT_RATIOS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];

export default function UgcProductPage() {
    // Top-level state
    const [products, setProducts] = useState<{ _id: string, name: string }[]>([]);
    const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
    const [product, setProduct] = useState<Product | null>(null);
    const [loading, setLoading] = useState(true);

    // Product creation state
    const [isCreatingProduct, setIsCreatingProduct] = useState(false);
    const [newProductName, setNewProductName] = useState('');
    const [newProductDesc, setNewProductDesc] = useState('');

    // Upload & Generation states
    const [uploadingObj, setUploadingObj] = useState<'product' | 'reference' | 'avatar' | null>(null);
    const [generatingVB, setGeneratingVB] = useState(false);
    const [generatingUGC, setGeneratingUGC] = useState(false);
    const [viewImage, setViewImage] = useState<string | null>(null);

    // Editing state
    const [isEditingPrompt, setIsEditingPrompt] = useState(false);
    const [tempSystemPrompt, setTempSystemPrompt] = useState('');

    // UGC Generation state
    const [aspectRatio, setAspectRatio] = useState('1:1');
    const [avatarSelection, setAvatarSelection] = useState('uploaded'); // 'random', 'preset1', 'preset2', 'custom', 'uploaded'
    const [customAvatar, setCustomAvatar] = useState('');

    const productFileInputRef = useRef<HTMLInputElement>(null);
    const referenceFileInputRef = useRef<HTMLInputElement>(null);
    const avatarFileInputRef = useRef<HTMLInputElement>(null);

    // Active tab: 'product' | 'bible' | 'generations'
    const [activeTab, setActiveTab] = useState<'product' | 'bible' | 'generations'>('product');

    const loadProducts = useCallback(async () => {
        try {
            const data = await api.get<{ _id: string; name: string }[]>('/api/ugc-product');
            if (Array.isArray(data)) setProducts(data);
        } catch { }
        setLoading(false);
    }, []);

    const loadProductData = useCallback(async (id: string, showLoader = true) => {
        if (showLoader) setLoading(true);
        try {
            const data = await api.get<Product>(`/api/ugc-product/${id}`);
            if (data._id) {
                setProduct(data);
                if (showLoader) setTempSystemPrompt(data.systemPrompt);
            }
        } catch { }
        if (showLoader) setLoading(false);
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadProducts();
    }, [loadProducts]);

    useEffect(() => {
        if (selectedProductId) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            loadProductData(selectedProductId);
        } else {
            setProduct(null);
        }
    }, [selectedProductId, loadProductData]);

    // Periodically poll for generation updates if there are pending generations
    useEffect(() => {
        if (!product) return;
        const hasPending = product.generations.some(g => g.status === 'pending');
        if (hasPending) {
            const interval = setInterval(() => {
                loadProductData(product._id, false);
            }, 5000);
            return () => clearInterval(interval);
        }
    }, [product, loadProductData]);

    const handleCreateProduct = async () => {
        if (!newProductName.trim()) return;
        try {
            const data = await api.post<Product>('/api/ugc-product', { name: newProductName, description: newProductDesc });
            if (data._id) {
                await loadProducts();
                setSelectedProductId(data._id);
                setIsCreatingProduct(false);
                setNewProductName('');
                setNewProductDesc('');
            }
        } catch { }
    };

    const deleteProduct = async (id: string) => {
        if (!confirm('Sunteți sigur că doriți să ștergeți acest produs și toate imaginile/generările asociate?')) return;
        try {
            await api.delete(`/api/ugc-product/${id}`);
            if (selectedProductId === id) setSelectedProductId(null);
            loadProducts();
        } catch { }
    };

    const fileToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                resolve(result.split(',')[1]); // Remove prefix
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    const handleUploadImages = async (files: FileList | File[], type: 'product' | 'reference' | 'avatar') => {
        if (!product) return;
        const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
        if (imageFiles.length === 0) return;

        setUploadingObj(type);

        try {
            const imagesPayload = [];
            for (let i = 0; i < imageFiles.length; i++) {
                const file = imageFiles[i];
                const base64 = await fileToBase64(file);

                let labelInfo = {};
                if (type === 'reference') labelInfo = { label: `Style Image ${product.referenceImages.length + i + 1}` };
                else if (type === 'avatar') labelInfo = { label: `Avatar Photo ${(product.avatarImages || []).length + i + 1}` };

                imagesPayload.push({
                    name: file.name,
                    mimeType: file.type || 'image/jpeg',
                    imageData: base64,
                    ...labelInfo
                });
            }

            let endpoint = 'product-images';
            if (type === 'reference') endpoint = 'reference-images';
            else if (type === 'avatar') endpoint = 'avatar-images';

            await api.post(`/api/ugc-product/upload`, {
                productId: product._id,
                endpoint: endpoint,
                images: imagesPayload
            });

            await loadProductData(product._id, false);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error('Upload failed details', err);
            alert(`Eroare la încărcare: ${errorMessage}`);
        }

        setUploadingObj(null);
        if (type === 'product' && productFileInputRef.current) productFileInputRef.current.value = '';
        if (type === 'reference' && referenceFileInputRef.current) referenceFileInputRef.current.value = '';
        if (type === 'avatar' && avatarFileInputRef.current) avatarFileInputRef.current.value = '';
    };

    const deleteImage = async (imgIdx: number, type: 'product' | 'reference' | 'avatar') => {
        if (!product) return;
        let endpoint = 'product-images';
        if (type === 'reference') endpoint = 'reference-images';
        else if (type === 'avatar') endpoint = 'avatar-images';

        await api.delete(`/api/ugc-product/${product._id}/${endpoint}/${imgIdx}`);
        loadProductData(product._id, false);
    };

    const saveSystemPrompt = async () => {
        if (!product) return;
        await api.put(`/api/ugc-product/${product._id}/system-prompt`, { systemPrompt: tempSystemPrompt });
        setIsEditingPrompt(false);
        loadProductData(product._id, false);
    };

    const generateVisualBible = async () => {
        if (!product || product.referenceImages.length === 0) return;
        setGeneratingVB(true);
        try {
            await api.post(`/api/ugc-product/${product._id}/visual-bible`);
            await loadProductData(product._id, false);
            setActiveTab('bible');
        } catch (err) {
            console.error(err);
        }
        setGeneratingVB(false);
    };

    const generateCollection = async () => {
        if (!product || generatingUGC) return;
        setGeneratingUGC(true);

        let finalAvatarDesc = '';
        if (avatarSelection === 'preset1') finalAvatarDesc = 'a young trendy Caucasian female, early 20s, natural makeup';
        else if (avatarSelection === 'preset2') finalAvatarDesc = 'an athletic young African American male, short hair, sharp jawline';
        else if (avatarSelection === 'preset3') finalAvatarDesc = 'an elegant Asian female, 30s, sophisticated look';
        else if (avatarSelection === 'custom' && customAvatar.trim()) finalAvatarDesc = customAvatar.trim();
        else if (avatarSelection === 'uploaded') finalAvatarDesc = 'the exact same person as in the uploaded reference identity photos';

        try {
            await api.post(`/api/ugc-product/${product._id}/generate-collection`, { count: 10, aspectRatio, avatarDesc: finalAvatarDesc });
            await loadProductData(product._id, false);
            setActiveTab('generations');
        } catch { }
        setGeneratingUGC(false);
    };

    const cancelGeneration = async () => {
        if (!product) return;
        await api.post(`/api/ugc-product/${product._id}/cancel-generation`);
        await loadProductData(product._id, false);
        setGeneratingUGC(false);
    };

    const deleteGeneration = async (genId: string) => {
        if (!product) return;
        await api.delete(`/api/ugc-product/${product._id}/generations/${genId}`);
        loadProductData(product._id, false);
    };

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
            <div className="flex items-center justify-between pb-4 border-b border-gray-200 dark:border-zinc-800 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
                        <Package className="text-white" size={24} />
                    </div>
                    <div>
                        <h1 className="text-lg md:text-xl font-bold tracking-tight">UGC Product</h1>
                        <p className="text-xs text-indigo-500 font-medium flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                            Visual Bible & Auto UGC Generation
                        </p>
                    </div>
                </div>

                {/* Product Selector */}
                {!isCreatingProduct && (
                    <div className="flex items-center gap-2">
                        <select
                            value={selectedProductId || ''}
                            onChange={(e) => setSelectedProductId(e.target.value || null)}
                            className="bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">-- Selectează Produs --</option>
                            {products.map(p => (
                                <option key={p._id} value={p._id}>{p.name}</option>
                            ))}
                        </select>
                        <button
                            onClick={() => setIsCreatingProduct(true)}
                            className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-200 transition-colors"
                            title="Produs Nou"
                        >
                            <Plus size={18} />
                        </button>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto py-4">
                {isCreatingProduct ? (
                    <div className="max-w-md mx-auto mt-10 p-6 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-sm">
                        <h2 className="text-lg font-bold mb-4">Adaugă Produs Nou</h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1">Nume Produs</label>
                                <input
                                    type="text"
                                    value={newProductName}
                                    onChange={e => setNewProductName(e.target.value)}
                                    placeholder="Ex: Cadence Core 500"
                                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-transparent text-sm"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1">Descriere (opțional)</label>
                                <input
                                    type="text"
                                    value={newProductDesc}
                                    onChange={e => setNewProductDesc(e.target.value)}
                                    placeholder="Detalii produs..."
                                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-transparent text-sm"
                                />
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    onClick={() => setIsCreatingProduct(false)}
                                    className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
                                >
                                    Anulează
                                </button>
                                <button
                                    onClick={handleCreateProduct}
                                    disabled={!newProductName.trim()}
                                    className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
                                >
                                    Creează Produs
                                </button>
                            </div>
                        </div>
                    </div>
                ) : loading ? (
                    <div className="flex justify-center py-20">
                        <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : !product ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="w-16 h-16 rounded-full bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center mb-4">
                            <Package className="text-indigo-400" size={32} />
                        </div>
                        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-200">Niciun Produs Selectat</h2>
                        <p className="text-sm text-gray-500 mt-2 max-w-sm">Selectați un produs existent din listă sau creați unul nou pentru a genera conținut UGC.</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {/* Product Meta Header */}
                        <div className="flex flex-wrap gap-4 items-center justify-between pb-2 border-b border-gray-100 dark:border-zinc-800/50">
                            <div>
                                <h2 className="text-xl font-bold flex items-center gap-2">
                                    {product.name}
                                </h2>
                                {product.description && <p className="text-sm text-gray-500 mt-1">{product.description}</p>}
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="flex bg-gray-100 dark:bg-zinc-800 p-1 rounded-lg">
                                    <button onClick={() => setActiveTab('product')} className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${activeTab === 'product' ? 'bg-white dark:bg-zinc-700 text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'}`}>Setup Materiale</button>
                                    <button onClick={() => setActiveTab('bible')} className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1 ${activeTab === 'bible' ? 'bg-white dark:bg-zinc-700 text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'}`}>
                                        <FileText size={12} />
                                        Visual Bible
                                    </button>
                                    <button onClick={() => setActiveTab('generations')} className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1 ${activeTab === 'generations' ? 'bg-white dark:bg-zinc-700 text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'}`}>
                                        <ImageIcon size={12} />
                                        Rezultate ({product.generations.length})
                                    </button>
                                </div>
                                <button
                                    onClick={() => deleteProduct(product._id)}
                                    className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-colors ml-2"
                                    title="Șterge produs"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>

                        {/* TAB 1: Materiale */}
                        {activeTab === 'product' && (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Left Column: Imagini Produs & Referințe */}
                                <div className="space-y-6">
                                    {/* Product Images Box */}
                                    <div className="border border-gra-200 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-900 overflow-hidden">
                                        <div className="px-4 py-3 border-b border-gray-100 dark:border-zinc-800/50 flex justify-between items-center bg-gray-50/50 dark:bg-zinc-900/50">
                                            <h3 className="text-sm font-semibold flex items-center gap-2">
                                                <Package size={16} className="text-indigo-500" /> Imaginile Produsului
                                                <span className="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 px-2 py-0.5 rounded-full text-[10px]">{product.productImages.length}</span>
                                            </h3>
                                        </div>
                                        <div className="p-4">
                                            {product.productImages.length === 0 ? (
                                                <div className="text-center py-6 text-gray-400">
                                                    <p className="text-sm mb-3">Nicio poză cu produsul.</p>
                                                    <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-600 text-xs font-semibold hover:bg-indigo-100 transition-colors">
                                                        <Plus size={14} /> Adaugă Poze Produs
                                                        <input type="file" multiple accept="image/*" className="hidden" onChange={e => e.target.files && handleUploadImages(e.target.files, 'product')} ref={productFileInputRef} />
                                                    </label>
                                                </div>
                                            ) : (
                                                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                                    {product.productImages.map((img, idx) => (
                                                        <div key={idx} className="aspect-square relative group rounded-lg overflow-hidden border border-gray-200 dark:border-zinc-800 bg-zinc-900 cursor-pointer" onClick={() => setViewImage(`data:${img.mimeType};base64,${img.imageData}`)}>
                                                            <img src={`data:${img.mimeType};base64,${img.imageData}`} alt={img.name} className="w-full h-full object-cover" />
                                                            <button onClick={(e) => { e.stopPropagation(); deleteImage(idx, 'product') }} className="absolute top-1 right-1 lg:opacity-0 group-hover:opacity-100 p-1 bg-red-500/80 text-white rounded hover:bg-red-600 transition-all">
                                                                <Trash2 size={12} />
                                                            </button>
                                                        </div>
                                                    ))}
                                                    <label className="aspect-square cursor-pointer flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 dark:border-zinc-700 hover:border-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 transition-colors">
                                                        {uploadingObj === 'product' ? <RefreshCw className="animate-spin text-indigo-500" size={20} /> : <Plus className="text-gray-400" size={20} />}
                                                        <span className="text-[10px] text-gray-500 font-medium mt-1">Upload</span>
                                                        <input type="file" multiple accept="image/*" className="hidden" onChange={e => e.target.files && handleUploadImages(e.target.files, 'product')} ref={productFileInputRef} />
                                                    </label>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Reference Images Box */}
                                    <div className="border border-gra-200 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-900 overflow-hidden">
                                        <div className="px-4 py-3 border-b border-gray-100 dark:border-zinc-800/50 flex justify-between items-center bg-gray-50/50 dark:bg-zinc-900/50">
                                            <h3 className="text-sm font-semibold flex items-center gap-2">
                                                <Camera size={16} className="text-rose-500" /> Imagini de Referință Brand (Stil/Mood)
                                                <span className="bg-rose-100 dark:bg-rose-900/30 text-rose-700 px-2 py-0.5 rounded-full text-[10px]">{product.referenceImages.length}</span>
                                            </h3>
                                        </div>
                                        <div className="p-4">
                                            <p className="text-[11px] text-gray-500 mb-3">Încarcă 5-15 poze (UGC / shootinguri) care definesc estetica, lumina și compoziția dorită.</p>
                                            {product.referenceImages.length === 0 ? (
                                                <div className="text-center py-6 text-gray-400">
                                                    <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-50 text-rose-600 text-xs font-semibold hover:bg-rose-100 transition-colors">
                                                        <Plus size={14} /> Adaugă Referințe
                                                        <input type="file" multiple accept="image/*" className="hidden" onChange={e => e.target.files && handleUploadImages(e.target.files, 'reference')} ref={referenceFileInputRef} />
                                                    </label>
                                                </div>
                                            ) : (
                                                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2">
                                                    {product.referenceImages.map((img, idx) => (
                                                        <div key={idx} className="aspect-square relative group rounded-lg overflow-hidden border border-gray-200 dark:border-zinc-800 bg-zinc-900 cursor-pointer" onClick={() => setViewImage(`data:${img.mimeType};base64,${img.imageData}`)}>
                                                            <img src={`data:${img.mimeType};base64,${img.imageData}`} alt={img.name} className="w-full h-full object-cover" />
                                                            <div className="absolute top-0 left-0 w-full p-1 bg-gradient-to-b from-black/60 to-transparent">
                                                                <p className="text-[9px] text-white font-medium truncate">{img.label}</p>
                                                            </div>
                                                            <button onClick={(e) => { e.stopPropagation(); deleteImage(idx, 'reference') }} className="absolute bottom-1 right-1 lg:opacity-0 group-hover:opacity-100 p-1 bg-red-500/80 text-white rounded hover:bg-red-600 transition-all">
                                                                <Trash2 size={12} />
                                                            </button>
                                                        </div>
                                                    ))}
                                                    <label className="aspect-square cursor-pointer flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 dark:border-zinc-700 hover:border-rose-400 hover:bg-rose-50/50 dark:hover:bg-rose-900/10 transition-colors">
                                                        {uploadingObj === 'reference' ? <RefreshCw className="animate-spin text-rose-500" size={20} /> : <Plus className="text-gray-400" size={20} />}
                                                        <span className="text-[10px] text-gray-500 font-medium mt-1">Upload</span>
                                                        <input type="file" multiple accept="image/*" className="hidden" onChange={e => e.target.files && handleUploadImages(e.target.files, 'reference')} ref={referenceFileInputRef} />
                                                    </label>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Avatar Images Box */}
                                    <div className="border border-gra-200 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-900 overflow-hidden">
                                        <div className="px-4 py-3 border-b border-gray-100 dark:border-zinc-800/50 flex justify-between items-center bg-gray-50/50 dark:bg-zinc-900/50">
                                            <h3 className="text-sm font-semibold flex items-center gap-2">
                                                <Settings2 size={16} className="text-amber-500" /> Poze Identitate Avatar
                                                <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 px-2 py-0.5 rounded-full text-[10px]">{product.avatarImages?.length || 0}</span>
                                            </h3>
                                        </div>
                                        <div className="p-4">
                                            <p className="text-[11px] text-gray-500 mb-3">Încarcă 3-5 poze cu o persoană (față, corp) dacă vrei ca generarea să folosească exact persoana respectivă. Ignoră acest pas pentru a folosi modele AI random.</p>
                                            {(!product.avatarImages || product.avatarImages.length === 0) ? (
                                                <div className="text-center py-6 text-gray-400">
                                                    <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 text-amber-600 text-xs font-semibold hover:bg-amber-100 transition-colors">
                                                        <Plus size={14} /> Adaugă Poze Avatar
                                                        <input type="file" multiple accept="image/*" className="hidden" onChange={e => e.target.files && handleUploadImages(e.target.files, 'avatar')} ref={avatarFileInputRef} />
                                                    </label>
                                                </div>
                                            ) : (
                                                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2">
                                                    {product.avatarImages.map((img, idx) => (
                                                        <div key={idx} className="aspect-square relative group rounded-lg overflow-hidden border border-gray-200 dark:border-zinc-800 bg-zinc-900 cursor-pointer" onClick={() => setViewImage(`data:${img.mimeType};base64,${img.imageData}`)}>
                                                            <img src={`data:${img.mimeType};base64,${img.imageData}`} alt={img.name} className="w-full h-full object-cover" />
                                                            <button onClick={(e) => { e.stopPropagation(); deleteImage(idx, 'avatar') }} className="absolute bottom-1 right-1 lg:opacity-0 group-hover:opacity-100 p-1 bg-red-500/80 text-white rounded hover:bg-red-600 transition-all">
                                                                <Trash2 size={12} />
                                                            </button>
                                                        </div>
                                                    ))}
                                                    <label className="aspect-square cursor-pointer flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 dark:border-zinc-700 hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-900/10 transition-colors">
                                                        {uploadingObj === 'avatar' ? <RefreshCw className="animate-spin text-amber-500" size={20} /> : <Plus className="text-gray-400" size={20} />}
                                                        <span className="text-[10px] text-gray-500 font-medium mt-1">Upload</span>
                                                        <input type="file" multiple accept="image/*" className="hidden" onChange={e => e.target.files && handleUploadImages(e.target.files, 'avatar')} ref={avatarFileInputRef} />
                                                    </label>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Right Column: Generare / Prompts */}
                                <div className="space-y-6">
                                    {/* System Prompt (Visual Bible setup) */}
                                    <div className="border border-gray-200 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-900 overflow-hidden flex flex-col h-full">
                                        <div className="px-4 py-3 border-b border-gray-100 dark:border-zinc-800/50 flex justify-between items-center bg-gray-50/50 dark:bg-zinc-900/50">
                                            <h3 className="text-sm font-semibold flex items-center gap-2">
                                                <Settings2 size={16} className="text-gray-500" /> System Prompt (Visual Bible Config)
                                            </h3>
                                            <button onClick={() => setIsEditingPrompt(!isEditingPrompt)} className="text-xs text-indigo-600 hover:underline">
                                                {isEditingPrompt ? 'Cancel' : 'Edit'}
                                            </button>
                                        </div>
                                        <div className="p-4 flex-1 flex flex-col min-h-[250px]">
                                            {isEditingPrompt ? (
                                                <div className="flex-1 flex flex-col gap-3">
                                                    <textarea
                                                        value={tempSystemPrompt}
                                                        onChange={e => setTempSystemPrompt(e.target.value)}
                                                        className="flex-1 w-full px-3 py-2 text-xs font-mono rounded-lg border border-gray-300 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-900 resize-none outline-none focus:ring-2 focus:ring-indigo-500"
                                                    />
                                                    <div className="flex justify-end">
                                                        <button onClick={saveSystemPrompt} className="px-4 py-1.5 bg-black text-white dark:bg-white dark:text-black rounded-lg text-xs font-semibold hover:opacity-80 transition-opacity">Save Prompt</button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex-1 flex flex-col justify-between">
                                                    <div className="text-[11px] text-gray-600 dark:text-gray-400 font-mono whitespace-pre-wrap overflow-y-auto max-h-[200px] bg-gray-50 dark:bg-zinc-800/50 p-3 rounded-lg border border-gray-100 dark:border-zinc-800/50 mb-4">
                                                        {product.systemPrompt}
                                                    </div>

                                                    <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-950/20 dark:to-purple-950/20 border border-indigo-100 dark:border-indigo-900/40">
                                                        <div className="flex justify-between items-center">
                                                            <div>
                                                                <h4 className="text-sm font-bold text-indigo-900 dark:text-indigo-400">Generează Visual Bible</h4>
                                                                <p className="text-xs text-indigo-700/80 dark:text-indigo-400/80 mt-1 max-w-[250px]">
                                                                    Trimite pozele de referință și prompt-ul la <span className="font-semibold">Gemini 2.5 Pro</span> pentru a extrage ADN-ul vizual al brandului.
                                                                </p>
                                                            </div>
                                                            <button
                                                                onClick={generateVisualBible}
                                                                disabled={generatingVB || product.referenceImages.length === 0}
                                                                className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 transition-colors shadow-lg shadow-indigo-500/20 flex items-center gap-2 font-semibold text-sm"
                                                            >
                                                                {generatingVB ? (
                                                                    <><RefreshCw className="animate-spin" size={16} /> Procesare...</>
                                                                ) : (
                                                                    <><Zap size={16} /> {product.visualBible ? 'Regenerează' : 'Run Model'}</>
                                                                )}
                                                            </button>
                                                        </div>
                                                        {product.visualBibleGeneratedAt && (
                                                            <div className="mt-3 text-[10px] text-indigo-600/70 dark:text-indigo-400/70 font-medium">
                                                                Ultima generare: {new Date(product.visualBibleGeneratedAt).toLocaleString('ro-RO')}
                                                                <button onClick={() => setActiveTab('bible')} className="ml-2 underline font-semibold cursor-pointer text-indigo-700 dark:text-indigo-300">Vezi Visual Bible &rarr;</button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* TAB 2: Visual Bible */}
                        {activeTab === 'bible' && (
                            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
                                <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800/50 bg-gradient-to-r from-gray-50 to-transparent dark:from-zinc-800/50">
                                    <h3 className="text-lg font-bold flex items-center gap-2">
                                        <FileText className="text-indigo-500" />
                                        Visual Bible / Brand Style Guide
                                    </h3>
                                    <p className="text-xs text-gray-500 mt-1">Acest document este folosit de model pentru a reproduce exact stilul brandului tău în fotografiile cu produsul.</p>
                                </div>
                                <div className="p-6">
                                    {!product.visualBible ? (
                                        <div className="text-center py-20 flex flex-col items-center">
                                            <div className="w-16 h-16 bg-gray-50 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-4 text-gray-400">
                                                <Info size={28} />
                                            </div>
                                            <p className="text-gray-500 font-medium">Visual Bible nu a fost generat încă.</p>
                                            <button onClick={() => setActiveTab('product')} className="mt-4 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-sm font-semibold hover:bg-indigo-100 transition-colors">
                                                Go to Setup
                                            </button>
                                        </div>
                                    ) : (
                                        <article className="prose prose-sm md:prose-base prose-indigo dark:prose-invert max-w-none">
                                            <ReactMarkdown>{product.visualBible}</ReactMarkdown>
                                        </article>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* TAB 3: Generations (The Playground / Creator) */}
                        {activeTab === 'generations' && (
                            <div className="space-y-6">
                                {/* Creator Input Box */}
                                <div className="bg-gradient-to-br from-indigo-900 to-black rounded-2xl p-6 text-white shadow-xl shadow-indigo-900/20 relative overflow-hidden">
                                    {/* Background decorative blob */}
                                    <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />

                                    <div className="relative z-10">
                                        <div className="flex flex-col gap-4">
                                            <div className="w-full flex flex-col md:flex-row gap-4 items-center justify-between bg-white/5 p-5 rounded-xl border border-white/10">
                                                <div className="flex-1">
                                                    <h4 className="font-bold text-white text-base">Colecție Auto-UGC (10 Ipostaze)</h4>
                                                    <p className="text-white/60 text-xs mt-1 max-w-sm mb-3">Sistemul va deduce și genera automat 10 scene unice pentru produsul tău, respectând 100% stilul din Visual Bible.</p>

                                                    {/* Avatar Selector */}
                                                    <div className="flex flex-col gap-2 max-w-sm">
                                                        <label className="text-xs font-semibold text-white/80">Selectează Avatar (Opțional)</label>
                                                        <select
                                                            value={avatarSelection}
                                                            onChange={e => setAvatarSelection(e.target.value)}
                                                            className="w-full bg-white/10 border border-white/20 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
                                                        >
                                                            <option value="random" className="bg-zinc-800">Sistem Random / Artistic</option>
                                                            <option value="preset1" className="bg-zinc-800">Femeie, 20s (Trendy)</option>
                                                            <option value="preset2" className="bg-zinc-800">Bărbat, Atletic (Sport/Grooming)</option>
                                                            <option value="preset3" className="bg-zinc-800">Femeie, 30s (Elegant/Beauty)</option>
                                                            <option value="uploaded" className="bg-zinc-800">Folosește Pozele Avatarului (Identitate)</option>
                                                            <option value="custom" className="bg-zinc-800">Custom Prompt...</option>
                                                        </select>
                                                        {avatarSelection === 'custom' && (
                                                            <input
                                                                type="text"
                                                                value={customAvatar}
                                                                onChange={e => setCustomAvatar(e.target.value)}
                                                                placeholder="Ex: Femeie asiatică de 25 de ani, păr roșcat scurt..."
                                                                className="w-full mt-1 bg-white/5 border border-white/20 text-white placeholder-white/40 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
                                                            />
                                                        )}
                                                        {avatarSelection !== 'random' && (
                                                            <p className="text-[10px] text-indigo-300">
                                                                * Când folosești un avatar, se vor genera 10 unghiuri vizuale FIXE pentru a evidenția produsul și persoana din mai multe perspective (ex: Luma/Higgsfield style).
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="flex flex-col sm:flex-row items-center gap-3 shrink-0 w-full md:w-auto mt-4 md:mt-0">
                                                    <div className="w-full sm:w-auto">
                                                        <select
                                                            value={aspectRatio}
                                                            onChange={e => setAspectRatio(e.target.value)}
                                                            className="w-full bg-white/10 border border-white/20 text-white rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
                                                        >
                                                            {ASPECT_RATIOS.map(ar => <option key={ar} value={ar} className="bg-zinc-800 text-white">{ar}</option>)}
                                                        </select>
                                                    </div>
                                                    {generatingUGC || product.generations.some(g => g.status === 'pending') ? (
                                                        <button
                                                            onClick={cancelGeneration}
                                                            className="w-full sm:w-auto px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors shadow-lg"
                                                        >
                                                            <RefreshCw className="animate-spin text-white" size={18} /> Stop Generare
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={generateCollection}
                                                            disabled={!product.visualBible || product.productImages.length === 0}
                                                            className="w-full sm:w-auto px-6 py-3 bg-white text-black hover:bg-gray-100 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors shadow-lg"
                                                        >
                                                            🚀 Generează 10 Poze
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Status messages */}
                                        <div className="mt-3 text-xs flex gap-4">
                                            <span className={`flex items-center gap-1 ${product.productImages.length > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {product.productImages.length > 0 ? '✓' : '✗'} 1+ Poze Produs
                                            </span>
                                            <span className={`flex items-center gap-1 ${product.visualBible ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {product.visualBible ? '✓' : '✗'} Visual Bible Activat
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Results Grid */}
                                <div>
                                    <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
                                        <ImageIcon size={16} /> Rezultate Generează ({product.generations.length})
                                    </h3>
                                    {product.generations.length === 0 ? (
                                        <div className="text-center py-12 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl">
                                            <p className="text-gray-500">Nu ai nicio generare pentru acest produs.</p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {[...product.generations].reverse().map(gen => (
                                                <div key={gen._id} className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl overflow-hidden group">
                                                    {/* Image area */}
                                                    <div className="aspect-[4/3] bg-gray-100 dark:bg-zinc-800 relative">
                                                        {gen.status === 'completed' && gen.resultFilename ? (
                                                            <>
                                                                <img
                                                                    src={`/api/ugc/images/${gen.resultFilename}`}
                                                                    alt={gen.prompt}
                                                                    className="w-full h-full object-cover cursor-pointer"
                                                                    onClick={() => setViewImage(`/api/ugc/images/${gen.resultFilename}`)}
                                                                />
                                                                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                    <button
                                                                        onClick={() => downloadImage(`/api/ugc/images/${gen.resultFilename}`, gen.resultFilename)}
                                                                        className="p-1.5 bg-black/50 hover:bg-black text-white rounded-lg backdrop-blur-sm transition-colors"
                                                                        title="Download"
                                                                    >
                                                                        <Download size={14} />
                                                                    </button>
                                                                    <button
                                                                        onClick={() => deleteGeneration(gen._id)}
                                                                        className="p-1.5 bg-red-500/80 hover:bg-red-600 text-white rounded-lg backdrop-blur-sm transition-colors"
                                                                        title="Delete"
                                                                    >
                                                                        <Trash2 size={14} />
                                                                    </button>
                                                                </div>
                                                            </>
                                                        ) : gen.status === 'pending' ? (
                                                            <div className="w-full h-full flex flex-col items-center justify-center text-indigo-500">
                                                                <RefreshCw className="animate-spin mb-2" size={24} />
                                                                <span className="text-xs font-semibold">Generare în curs...</span>
                                                            </div>
                                                        ) : (
                                                            <div className="w-full h-full flex flex-col items-center justify-center text-red-500 p-4 text-center">
                                                                <span className="text-2xl mb-1">❌</span>
                                                                <span className="text-[10px] font-medium">{gen.error || 'Eroare la generare'}</span>
                                                                <button
                                                                    onClick={() => deleteGeneration(gen._id)}
                                                                    className="mt-2 text-xs text-red-700 underline"
                                                                >
                                                                    Dă Delete
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Details area */}
                                                    <div className="p-3">
                                                        <p className="text-xs font-medium text-gray-800 dark:text-gray-200 line-clamp-2" title={gen.prompt}>{gen.prompt}</p>
                                                        <div className="flex justify-between items-center mt-2">
                                                            <span className="text-[10px] text-gray-500 bg-gray-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded font-mono">{gen.aspectRatio}</span>
                                                            <span className="text-[9px] text-gray-400">
                                                                {new Date(gen.createdAt).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })} • {new Date(gen.createdAt).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' })}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Fullscreen Image Viewer */}
            {viewImage && (
                <div
                    className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-4 backdrop-blur-sm"
                    onClick={() => setViewImage(null)}
                >
                    <div className="absolute top-4 right-4 flex items-center gap-4 text-white z-50">
                        {viewImage.startsWith('/api') && (
                            <button
                                className="text-white hover:text-indigo-400 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors backdrop-blur-md"
                                title="Descarcă imaginea"
                                onClick={(e) => { e.stopPropagation(); const fn = viewImage.split('/').pop() || 'download.png'; downloadImage(viewImage, fn); }}
                            >
                                <Download size={24} />
                            </button>
                        )}
                        <button className="text-white hover:text-red-400 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors backdrop-blur-md" onClick={() => setViewImage(null)}>
                            <Plus size={24} className="rotate-45" />
                        </button>
                    </div>
                    <img src={viewImage} alt="Fullscreen preview" className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl" onClick={e => e.stopPropagation()} />
                </div>
            )}
        </div>
    );
}
