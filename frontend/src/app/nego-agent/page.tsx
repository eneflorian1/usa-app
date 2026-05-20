'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

interface ListingData {
    title: string;
    price: number | string;
    currency: string;
    location: string;
    area?: number | null;
    rooms?: number | null;
    type: string;
    description?: string;
}

interface AnalysisData {
    priceAssessment: string;
    estimatedMarketPrice?: string | null;
    negotiationRoom: string;
    redFlags: string[];
    positives: string[];
    contextSummary: string;
}

interface ScoreData {
    score: number;
    verdict: 'hot' | 'warm' | 'cold';
    scoreReason: string;
    recommendedAction: string;
    suggestedOffer?: number | null;
    suggestedOfferCurrency?: string;
}

interface PipelineResult {
    listing: ListingData;
    analysis: AnalysisData;
    score: ScoreData;
    draftMessage: string;
    leadCreated: boolean;
    elapsedSeconds: string;
}

const verdictConfig = {
    hot: { label: 'HOT', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800', dot: 'bg-red-500' },
    warm: { label: 'WARM', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800', dot: 'bg-amber-400' },
    cold: { label: 'COLD', color: 'text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800', dot: 'bg-blue-400' },
};

const assessmentColor = (a: string) => {
    if (a === 'underpriced') return 'text-emerald-600 dark:text-emerald-400';
    if (a === 'fair') return 'text-blue-600 dark:text-blue-400';
    if (a === 'overpriced') return 'text-red-600 dark:text-red-400';
    return 'text-gray-500';
};

export default function NegoAgentPage() {
    const [url, setUrl] = useState('');
    const [chatId, setChatId] = useState('');
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<PipelineResult | null>(null);
    const [error, setError] = useState('');
    const [step, setStep] = useState('');
    const [copied, setCopied] = useState(false);

    const steps = ['Scraping anunț...', 'Analizând piața...', 'Calculând scor...', 'Generând mesaj...', 'Creare lead & trimitere raport...'];
    let stepIdx = 0;

    const runPipeline = async () => {
        if (!url.trim()) return;
        setRunning(true);
        setResult(null);
        setError('');
        setStep(steps[0]);

        const stepInterval = setInterval(() => {
            stepIdx = Math.min(stepIdx + 1, steps.length - 1);
            setStep(steps[stepIdx]);
        }, 8000);

        try {
            const data = await api.post<PipelineResult>('/api/lead-intelligence/analyze', {
                url: url.trim(),
                chatId: chatId.trim() || undefined,
            });
            setResult(data);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Eroare necunoscută');
        } finally {
            clearInterval(stepInterval);
            setRunning(false);
            setStep('');
        }
    };

    const copyDraft = () => {
        if (!result?.draftMessage) return;
        navigator.clipboard.writeText(result.draftMessage);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const vc = result ? (verdictConfig[result.score.verdict] || verdictConfig.cold) : null;

    return (
        <div className="space-y-6 pb-10 max-w-2xl mx-auto">
            {/* Header */}
            <div>
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Nego Agent</h1>
                <p className="text-sm text-gray-500 mt-0.5">Analizează un anunț imobiliar — scor, evaluare piață, mesaj negociere</p>
            </div>

            {/* Input */}
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 space-y-4">
                <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">URL anunț *</label>
                    <input
                        value={url}
                        onChange={e => setUrl(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && !running && runPipeline()}
                        placeholder="https://www.olx.ro/... sau https://www.imobiliare.ro/..."
                        className="w-full px-3 py-2.5 text-sm font-mono border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Chat ID WhatsApp (opțional — trimite raport)</label>
                    <input
                        value={chatId}
                        onChange={e => setChatId(e.target.value)}
                        placeholder="40712345678@c.us"
                        className="w-full px-3 py-2.5 text-sm font-mono border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                </div>
                <button
                    onClick={runPipeline}
                    disabled={running || !url.trim()}
                    className="w-full py-3 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-all"
                >
                    {running ? (
                        <span className="flex items-center justify-center gap-2">
                            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            {step}
                        </span>
                    ) : 'Analizează Lead'}
                </button>

                {error && (
                    <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-600 dark:text-red-400">
                        {error}
                    </div>
                )}
            </div>

            {/* Results */}
            {result && vc && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-400">

                    {/* Score card */}
                    <div className={`border rounded-2xl p-5 ${vc.bg}`}>
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <span className={`w-2.5 h-2.5 rounded-full ${vc.dot}`} />
                                    <span className={`text-xs font-bold tracking-widest ${vc.color}`}>{vc.label}</span>
                                    <span className="text-xs text-gray-400">· {result.elapsedSeconds}s</span>
                                </div>
                                <h2 className="text-base font-bold leading-tight">{result.listing.title}</h2>
                                <p className="text-sm text-gray-500 mt-0.5">{result.listing.price} {result.listing.currency} · {result.listing.location}</p>
                                {result.listing.area && <p className="text-xs text-gray-400 mt-0.5">{result.listing.area} mp{result.listing.rooms ? ` · ${result.listing.rooms} camere` : ''}</p>}
                            </div>
                            <div className="text-right flex-shrink-0">
                                <div className="text-3xl font-black tabular-nums">{result.score.score}<span className="text-sm font-normal text-gray-400">/10</span></div>
                                {result.leadCreated && <span className="text-[10px] text-emerald-500 font-medium">✓ Lead creat</span>}
                            </div>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-300 mt-3">{result.score.scoreReason}</p>
                    </div>

                    {/* Analysis */}
                    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 space-y-4">
                        <h3 className="text-sm font-semibold">Analiză piață</h3>

                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="space-y-0.5">
                                <p className="text-xs text-gray-400">Evaluare preț</p>
                                <p className={`font-semibold capitalize ${assessmentColor(result.analysis.priceAssessment)}`}>{result.analysis.priceAssessment}</p>
                            </div>
                            <div className="space-y-0.5">
                                <p className="text-xs text-gray-400">Spațiu negociere</p>
                                <p className="font-semibold">{result.analysis.negotiationRoom}</p>
                            </div>
                            {result.analysis.estimatedMarketPrice && (
                                <div className="space-y-0.5">
                                    <p className="text-xs text-gray-400">Preț estimat piață</p>
                                    <p className="font-semibold">{result.analysis.estimatedMarketPrice}</p>
                                </div>
                            )}
                            {result.score.suggestedOffer && (
                                <div className="space-y-0.5">
                                    <p className="text-xs text-gray-400">Ofertă sugerată</p>
                                    <p className="font-semibold text-violet-600 dark:text-violet-400">{result.score.suggestedOffer} {result.score.suggestedOfferCurrency}</p>
                                </div>
                            )}
                        </div>

                        <p className="text-sm text-gray-600 dark:text-gray-400">{result.analysis.contextSummary}</p>

                        {result.analysis.positives?.length > 0 && (
                            <div className="space-y-1">
                                {result.analysis.positives.map((p, i) => (
                                    <div key={i} className="flex items-start gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                                        <span className="mt-0.5 flex-shrink-0">✓</span><span>{p}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {result.analysis.redFlags?.length > 0 && (
                            <div className="space-y-1">
                                {result.analysis.redFlags.map((f, i) => (
                                    <div key={i} className="flex items-start gap-1.5 text-xs text-red-500 dark:text-red-400">
                                        <span className="mt-0.5 flex-shrink-0">⚠</span><span>{f}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Draft message */}
                    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-semibold">Mesaj negociere draft</h3>
                            <button onClick={copyDraft}
                                className="text-xs px-3 py-1 bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 rounded-lg transition-colors font-medium">
                                {copied ? '✓ Copiat' : 'Copiază'}
                            </button>
                        </div>
                        <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{result.draftMessage}</p>
                    </div>
                </div>
            )}
        </div>
    );
}
