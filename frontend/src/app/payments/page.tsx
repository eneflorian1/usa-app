'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface PaymentTransaction {
    _id: string;
    url: string;
    task: string;
    network: string;
    amountUSDC: string;
    txHash: string;
    status: 'success' | 'failed' | 'skipped';
    error: string;
    responseData: string;
    createdAt: string;
}

interface WalletBalance {
    configured: boolean;
    balance: string;
    address: string | null;
    network: string;
    error?: string;
}

const statusMeta = {
    success: { icon: '✅', label: 'Success', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
    failed: { icon: '❌', label: 'Failed', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
    skipped: { icon: '⏭️', label: 'Skipped', color: 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-400' },
};

function timeSince(dateStr: string) {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return 'acum';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}z`;
}

export default function PaymentsPage() {
    const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
    const [wallet, setWallet] = useState<WalletBalance | null>(null);
    const [loading, setLoading] = useState(true);
    const [showConfig, setShowConfig] = useState(false);
    const [privateKey, setPrivateKey] = useState('');
    const [network, setNetwork] = useState('base-sepolia');
    const [saving, setSaving] = useState(false);
    const [saveMsg, setSaveMsg] = useState('');
    const [expanded, setExpanded] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [hist, bal] = await Promise.all([
                api.get<PaymentTransaction[]>('/api/payments/history'),
                api.get<WalletBalance>('/api/payments/balance')
            ]);
            if (Array.isArray(hist)) setTransactions(hist);
            setWallet(bal);
            setNetwork(bal.network || 'base-sepolia');
        } catch { }
        setLoading(false);
    }, []);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { load(); }, [load]);

    const handleSaveWallet = async () => {
        setSaving(true);
        setSaveMsg('');
        try {
            await api.post('/api/settings/wallet', { privateKey: privateKey || undefined, network });
            setSaveMsg('✅ Salvat!');
            setPrivateKey('');
            await load();
            setTimeout(() => { setSaveMsg(''); setShowConfig(false); }, 2000);
        } catch {
            setSaveMsg('❌ Eroare la salvare');
        }
        setSaving(false);
    };

    const successTxs = transactions.filter(t => t.status === 'success');
    const totalSpent = successTxs.reduce((sum, t) => sum + parseFloat(t.amountUSDC || '0'), 0);

    return (
        <div className="space-y-6 max-w-4xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight bg-gradient-to-r from-emerald-500 to-teal-600 bg-clip-text text-transparent">
                        💳 x402 Payments
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Plăți autonome AI via protocolul x402 (HTTP 402 · Coinbase CDP)
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={load}
                        className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
                        title="Refresh"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 21h5v-5" /></svg>
                    </button>
                    <button
                        onClick={() => setShowConfig(v => !v)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-colors"
                    >
                        ⚙️ Configurare Wallet
                    </button>
                </div>
            </div>

            {/* Wallet Config Panel */}
            {showConfig && (
                <div className="bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-800/50 rounded-2xl p-5 space-y-4 shadow-sm">
                    <h3 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
                        🔐 Configurare Wallet x402
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1.5">
                                Private Key (Ethereum)
                            </label>
                            <input
                                type="password"
                                value={privateKey}
                                onChange={e => setPrivateKey(e.target.value)}
                                placeholder={wallet?.configured ? '••••••• (deja configurat)' : '0x...'}
                                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none font-mono"
                            />
                            <p className="text-[10px] text-gray-400 mt-1">Cheia privată a wallet-ului Ethereum (Base network)</p>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1.5">
                                Network
                            </label>
                            <select
                                value={network}
                                onChange={e => setNetwork(e.target.value)}
                                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                            >
                                <option value="base-sepolia">Base Sepolia (Testnet — recomandat)</option>
                                <option value="base">Base Mainnet (USDC reali)</option>
                            </select>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleSaveWallet}
                            disabled={saving}
                            className="text-xs px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-medium transition-colors"
                        >
                            {saving ? 'Se salvează...' : 'Salvează'}
                        </button>
                        <button
                            onClick={() => { setShowConfig(false); setPrivateKey(''); }}
                            className="text-xs px-3 py-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
                        >
                            Anulează
                        </button>
                        {saveMsg && <span className="text-xs font-medium">{saveMsg}</span>}
                    </div>
                </div>
            )}

            {/* Wallet Balance Card */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-5 text-white shadow-lg">
                    <p className="text-xs font-medium opacity-80 mb-1">💰 Balanță USDC</p>
                    <p className="text-3xl font-bold">
                        {wallet ? (wallet.configured ? `$${parseFloat(wallet.balance || '0').toFixed(4)}` : '—') : '…'}
                    </p>
                    <p className="text-xs opacity-70 mt-1">
                        {wallet?.address
                            ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)} · ${wallet.network}`
                            : wallet?.configured === false ? 'Wallet neconfigurat' : 'Se încarcă...'}
                    </p>
                </div>

                <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 p-5">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">📊 Tranzacții</p>
                    <p className="text-3xl font-bold">{transactions.length}</p>
                    <p className="text-xs text-gray-400 mt-1">Total plăți efectuate</p>
                </div>

                <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 p-5">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">💸 Total Cheltuit</p>
                    <p className="text-3xl font-bold">${totalSpent.toFixed(4)}</p>
                    <p className="text-xs text-gray-400 mt-1">USDC plătit (succes)</p>
                </div>
            </div>

            {/* Info Banner if not configured */}
            {wallet && !wallet.configured && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-2xl p-4 flex items-start gap-3">
                    <span className="text-xl">⚠️</span>
                    <div>
                        <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">Wallet neconfigurat</p>
                        <p className="text-xs text-amber-700 dark:text-amber-500 mt-0.5">
                            Configurează o cheie privată Ethereum pentru a permite orchestratorului să efectueze plăți x402 autonome.
                            Folosește <strong>Base Sepolia</strong> pentru testare fără fonduri reale.
                        </p>
                        <button
                            onClick={() => setShowConfig(true)}
                            className="text-xs mt-2 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-medium"
                        >
                            Configurează acum →
                        </button>
                    </div>
                </div>
            )}

            {/* How to use */}
            <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/30 rounded-2xl p-4">
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-2">💡 Cum folosești x402 în orchestrator</p>
                <p className="text-xs text-blue-600 dark:text-blue-500">
                    Scrie în <Link href="/orchestrator" className="underline font-medium">Command Center</Link>:
                    <br />
                    <code className="bg-blue-100 dark:bg-blue-900/30 px-1.5 py-0.5 rounded mt-1 inline-block">
                        „plătește pentru a accesa https://api.example.com/data”
                    </code>
                    <br />
                    Orchestratorul va genera automat o comandă PAYMENT_JSON și va efectua plata via protocolul x402.
                </p>
            </div>

            {/* Transaction History */}
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 overflow-hidden">
                <div className="px-4 md:px-6 py-3 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
                    <h2 className="font-semibold text-sm">Istoric Tranzacții ({transactions.length})</h2>
                    {transactions.length > 0 && (
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                            <span className="text-emerald-600">{successTxs.length} success</span>
                            <span>·</span>
                            <span className="text-red-500">{transactions.filter(t => t.status === 'failed').length} failed</span>
                        </div>
                    )}
                </div>

                {loading ? (
                    <div className="flex justify-center py-12">
                        <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
                    </div>
                ) : transactions.length === 0 ? (
                    <div className="text-center py-16 px-4">
                        <span className="text-5xl block mb-3">💳</span>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Nicio tranzacție. Spune orchestratorului să plătească pentru un serviciu!
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-100 dark:divide-zinc-800">
                        {transactions.map(tx => {
                            const sm = statusMeta[tx.status];
                            const isExpanded = expanded === tx._id;
                            return (
                                <div key={tx._id} className="px-4 md:px-6 py-4">
                                    <div
                                        className="flex items-start gap-3 cursor-pointer"
                                        onClick={() => setExpanded(isExpanded ? null : tx._id)}
                                    >
                                        <span className="text-xl flex-shrink-0 mt-0.5">{sm.icon}</span>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{tx.url}</p>
                                            {tx.task && (
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{tx.task}</p>
                                            )}
                                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${sm.color}`}>
                                                    {sm.label}
                                                </span>
                                                {parseFloat(tx.amountUSDC) > 0 && (
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-medium">
                                                        ${tx.amountUSDC} USDC
                                                    </span>
                                                )}
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-zinc-700 text-gray-500 font-mono">
                                                    {tx.network}
                                                </span>
                                                <span className="text-[10px] text-gray-400">·</span>
                                                <span className="text-[10px] text-gray-400" title={new Date(tx.createdAt).toLocaleString('ro-RO')}>
                                                    {timeSince(tx.createdAt)}
                                                </span>
                                            </div>
                                        </div>
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            width="14" height="14"
                                            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                            className={`flex-shrink-0 text-gray-400 mt-1 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                        >
                                            <path d="m6 9 6 6 6-6" />
                                        </svg>
                                    </div>

                                    {isExpanded && (
                                        <div className="mt-3 ml-8 space-y-2 text-xs text-gray-600 dark:text-gray-400">
                                            {tx.txHash && (
                                                <div>
                                                    <span className="font-medium text-gray-500">Tx Hash: </span>
                                                    <code className="font-mono text-[10px] bg-gray-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded break-all">
                                                        {tx.txHash}
                                                    </code>
                                                </div>
                                            )}
                                            {tx.error && (
                                                <div>
                                                    <span className="font-medium text-red-500">Error: </span>
                                                    <span className="text-red-400">{tx.error}</span>
                                                </div>
                                            )}
                                            {tx.responseData && (
                                                <div>
                                                    <span className="font-medium text-gray-500 block mb-1">Response:</span>
                                                    <pre className="bg-gray-50 dark:bg-zinc-800 rounded-lg p-3 text-[10px] overflow-auto max-h-32 font-mono whitespace-pre-wrap">
                                                        {tx.responseData}
                                                    </pre>
                                                </div>
                                            )}
                                            <div className="text-[10px] text-gray-400">
                                                {new Date(tx.createdAt).toLocaleString('ro-RO')}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
