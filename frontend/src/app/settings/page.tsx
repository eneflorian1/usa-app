'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { MessageCircle, BarChart2, Bell, Timer, Box, Brain, Layers, Eye, CalendarCheck, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';

interface Profile {
    firstName?: string;
    lastName?: string;
    address?: string;
    phone?: string;
    email?: string;
    birthDate?: string;
    cardNumber?: string;
    cardExpiry?: string;
    cardCvv?: string;
    cardHolder?: string;
    billingAddress?: string;
    paymentAddress?: string;
    language?: string;
    theme?: string;
    accounts?: Array<{ platform: string; username: string }>;
}

export default function SettingsPage() {
    const [profileOpen, setProfileOpen] = useState(false);
    const [profile, setProfile] = useState<Profile>({});
    const [profileStatus, setProfileStatus] = useState('');

    const [apiKey, setApiKey] = useState('');
    const [displayKey, setDisplayKey] = useState<string | null>(null);
    const [apiStatus, setApiStatus] = useState('');
    const [isApiLoading, setIsApiLoading] = useState(true);

    const [isActive, setIsActive] = useState(true);
    const [systemPrompt, setSystemPrompt] = useState('');
    const [agentStatus, setAgentStatus] = useState('');
    const [isAgentLoading, setIsAgentLoading] = useState(true);

    const [searxngUrl, setSearxngUrl] = useState('');
    const [currentSearxngUrl, setCurrentSearxngUrl] = useState('');
    const [searxngIsDefault, setSearxngIsDefault] = useState(true);
    const [searxngStatus, setSearxngStatus] = useState('');

    useEffect(() => {
        api.get<Profile>('/api/profile').then(data => setProfile(data || {})).catch(() => {});
        api.get<{ apiKey?: string }>('/api/settings/gemini')
            .then(data => { if (data.apiKey) setDisplayKey(data.apiKey); })
            .catch(() => {}).finally(() => setIsApiLoading(false));
        api.get<{ isActive?: boolean; systemPrompt?: string }>('/api/agent/config')
            .then(data => { setIsActive(data.isActive ?? true); setSystemPrompt(data.systemPrompt || ''); })
            .catch(() => {}).finally(() => setIsAgentLoading(false));
        api.get<{ url: string; isDefault: boolean }>('/api/settings/searxng')
            .then(data => { setCurrentSearxngUrl(data.url); setSearxngIsDefault(data.isDefault); })
            .catch(() => {});
    }, []);

    const saveProfile = async () => {
        setProfileStatus('Saving...');
        try {
            await api.post('/api/profile', profile);
            setProfileStatus('Saved!');
        } catch { setProfileStatus('Error saving.'); }
        setTimeout(() => setProfileStatus(''), 3000);
    };

    const handleApiSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!apiKey) return;
        setApiStatus('Saving...');
        try {
            await api.post('/api/settings/gemini', { apiKey });
            setApiStatus('Saved successfully!');
            setApiKey('');
            const refreshData = await api.get<{ apiKey?: string }>('/api/settings/gemini');
            if (refreshData.apiKey) setDisplayKey(refreshData.apiKey);
            setTimeout(() => setApiStatus(''), 3000);
        } catch { setApiStatus('Error saving API Key'); }
    };

    const handleAgentSave = async () => {
        setAgentStatus('Saving...');
        try {
            await api.post('/api/agent/config', { isActive, systemPrompt });
            setAgentStatus('Saved successfully!');
            setTimeout(() => setAgentStatus(''), 3000);
        } catch { setAgentStatus('Error saving config.'); }
    };

    const handleSearxngSave = async () => {
        setSearxngStatus('Saving...');
        try {
            await api.post('/api/settings/searxng', { url: searxngUrl.trim() });
            const data = await api.get<{ url: string; isDefault: boolean }>('/api/settings/searxng');
            setCurrentSearxngUrl(data.url);
            setSearxngIsDefault(data.isDefault);
            setSearxngUrl('');
            setSearxngStatus('Saved!');
            setTimeout(() => setSearxngStatus(''), 3000);
        } catch { setSearxngStatus('Error saving.'); }
    };

    return (
        <div className="h-full flex flex-col space-y-6 max-w-2xl mx-auto pb-10">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Settings</h1>
                <div className="flex md:hidden items-center space-x-5 text-gray-500 dark:text-gray-400 mt-1 pr-1">
                    <Link href="/orchestrator" className="hover:text-gray-900 dark:hover:text-gray-100 transition-colors p-1"><Brain size={22} /></Link>
                    <Link href="/cron-jobs" className="hover:text-gray-900 dark:hover:text-gray-100 transition-colors p-1"><Timer size={22} /></Link>
                    <Link href="/house-objects" className="hover:text-gray-900 dark:hover:text-gray-100 transition-colors p-1"><Box size={22} /></Link>
                    <Link href="/whatsapp" className="hover:text-gray-900 dark:hover:text-gray-100 transition-colors p-1"><MessageCircle size={22} /></Link>
                    <Link href="/notifications" className="hover:text-gray-900 dark:hover:text-gray-100 transition-colors p-1"><Bell size={22} /></Link>
                    <Link href="/analytics" className="hover:text-gray-900 dark:hover:text-gray-100 transition-colors p-1"><BarChart2 size={22} /></Link>
                </div>
            </div>

            {/* ── PROFILE ── */}
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
                <button onClick={() => setProfileOpen(o => !o)}
                    className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold text-lg">
                            {profile.firstName?.[0] || profile.lastName?.[0] || 'P'}
                        </div>
                        <div className="text-left">
                            <p className="font-semibold text-base">
                                {profile.firstName || profile.lastName
                                    ? `${profile.firstName || ''} ${profile.lastName || ''}`.trim()
                                    : 'Profile'}
                            </p>
                            <p className="text-xs text-gray-500">{profile.email || 'Configurează profilul pentru autocompletare formulare'}</p>
                        </div>
                    </div>
                    {profileOpen ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
                </button>

                {profileOpen && (
                    <div className="border-t border-gray-100 dark:border-zinc-800 px-6 py-5 space-y-4">
                        {/* Identitate */}
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Identitate</p>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">Prenume</label>
                                <input value={profile.firstName || ''} onChange={e => setProfile(p => ({ ...p, firstName: e.target.value }))}
                                    placeholder="Ion" className="w-full p-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-transparent text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                            </div>
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">Nume</label>
                                <input value={profile.lastName || ''} onChange={e => setProfile(p => ({ ...p, lastName: e.target.value }))}
                                    placeholder="Popescu" className="w-full p-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-transparent text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">Email</label>
                                <input type="email" value={profile.email || ''} onChange={e => setProfile(p => ({ ...p, email: e.target.value }))}
                                    placeholder="ion@exemplu.ro" className="w-full p-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-transparent text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                            </div>
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">Telefon</label>
                                <input value={profile.phone || ''} onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))}
                                    placeholder="+40 700 000 000" className="w-full p-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-transparent text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">Data nașterii</label>
                                <input type="date" value={profile.birthDate || ''} onChange={e => setProfile(p => ({ ...p, birthDate: e.target.value }))}
                                    className="w-full p-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-transparent text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                            </div>
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">Limbă preferată</label>
                                <select value={profile.language || 'ro'} onChange={e => setProfile(p => ({ ...p, language: e.target.value }))}
                                    className="w-full p-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                                    <option value="ro">Română</option>
                                    <option value="en">English</option>
                                    <option value="fr">Français</option>
                                    <option value="de">Deutsch</option>
                                </select>
                            </div>
                        </div>

                        {/* Adresă */}
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-2">Adresă</p>
                        <div>
                            <label className="text-xs text-gray-500 mb-1 block">Adresă domiciliu</label>
                            <input value={profile.address || ''} onChange={e => setProfile(p => ({ ...p, address: e.target.value }))}
                                placeholder="Str. Exemplu nr. 1, București" className="w-full p-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-transparent text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">Adresă livrare</label>
                                <input value={profile.paymentAddress || ''} onChange={e => setProfile(p => ({ ...p, paymentAddress: e.target.value }))}
                                    placeholder="Aceeași cu domiciliu" className="w-full p-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-transparent text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                            </div>
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">Adresă facturare</label>
                                <input value={profile.billingAddress || ''} onChange={e => setProfile(p => ({ ...p, billingAddress: e.target.value }))}
                                    placeholder="Aceeași cu domiciliu" className="w-full p-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-transparent text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                            </div>
                        </div>

                        {/* Plată */}
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-2">Detalii plată</p>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">Titular card</label>
                                <input value={profile.cardHolder || ''} onChange={e => setProfile(p => ({ ...p, cardHolder: e.target.value }))}
                                    placeholder="ION POPESCU" className="w-full p-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-transparent text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                            </div>
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">Număr card</label>
                                <input value={profile.cardNumber || ''} onChange={e => setProfile(p => ({ ...p, cardNumber: e.target.value }))}
                                    placeholder="•••• •••• •••• ••••" maxLength={19} className="w-full p-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-transparent text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">Expirare (MM/YY)</label>
                                <input value={profile.cardExpiry || ''} onChange={e => setProfile(p => ({ ...p, cardExpiry: e.target.value }))}
                                    placeholder="12/28" maxLength={5} className="w-full p-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-transparent text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" />
                            </div>
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">CVV</label>
                                <input type="password" value={profile.cardCvv || ''} onChange={e => setProfile(p => ({ ...p, cardCvv: e.target.value }))}
                                    placeholder="•••" maxLength={4} className="w-full p-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-transparent text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" />
                            </div>
                        </div>

                        {/* Afișare */}
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-2">Afișare</p>
                        <div className="flex gap-2">
                            {(['light', 'dark', 'system'] as const).map(t => (
                                <button key={t} onClick={() => setProfile(p => ({ ...p, theme: t }))}
                                    className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-all ${profile.theme === t ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400' : 'border-gray-200 dark:border-zinc-700 text-gray-500 hover:border-gray-300'}`}>
                                    {t === 'light' ? '☀️ Luminos' : t === 'dark' ? '🌙 Întunecat' : '⚙️ System'}
                                </button>
                            ))}
                        </div>

                        <div className="flex items-center justify-between pt-2">
                            {profileStatus && (
                                <span className={`text-sm font-medium ${profileStatus.includes('Error') ? 'text-red-500' : 'text-green-500'}`}>{profileStatus}</span>
                            )}
                            <button onClick={saveProfile} className="ml-auto bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-6 rounded-xl transition-colors text-sm">
                                Salvează Profilul
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* ── QUICK LINKS: AI Memory / Glasses / Planner ── */}
            <div className="grid grid-cols-3 gap-3">
                <Link href="/orchestrator-memory" className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 flex flex-col items-center gap-2 hover:border-blue-400 hover:shadow-md transition-all group">
                    <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center group-hover:bg-violet-200 transition-colors">
                        <Layers size={20} className="text-violet-600 dark:text-violet-400" />
                    </div>
                    <span className="text-xs font-semibold text-center">AI Memory</span>
                </Link>
                <Link href="/glasses-memory" className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 flex flex-col items-center gap-2 hover:border-blue-400 hover:shadow-md transition-all group">
                    <div className="w-10 h-10 rounded-xl bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center group-hover:bg-cyan-200 transition-colors">
                        <Eye size={20} className="text-cyan-600 dark:text-cyan-400" />
                    </div>
                    <span className="text-xs font-semibold text-center">Glasses</span>
                </Link>
                <Link href="/planner" className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 flex flex-col items-center gap-2 hover:border-blue-400 hover:shadow-md transition-all group">
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center group-hover:bg-emerald-200 transition-colors">
                        <CalendarCheck size={20} className="text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <span className="text-xs font-semibold text-center">Planner</span>
                </Link>
            </div>

            {/* ── API KEY ── */}
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm">
                <h2 className="text-lg font-semibold mb-2">Gemini API Configuration</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                    Enter your Gemini API key to enable AI agent features. Your key is stored securely in the database.
                </p>
                {isApiLoading ? (
                    <div className="animate-pulse bg-gray-200 dark:bg-zinc-800 h-10 rounded-xl mb-4" />
                ) : displayKey ? (
                    <div className="mb-6 p-4 bg-gray-50 dark:bg-zinc-950 rounded-xl border border-gray-100 dark:border-zinc-800 flex flex-col gap-1">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Current Key</span>
                        <span className="font-mono text-sm break-all">{displayKey}</span>
                    </div>
                ) : (
                    <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 rounded-xl text-sm font-medium">
                        No API key currently set.
                    </div>
                )}
                <form onSubmit={handleApiSubmit} className="space-y-4 flex flex-col">
                    <div className="flex flex-col space-y-2">
                        <label htmlFor="apiKey" className="text-sm font-medium">New API Key</label>
                        <input id="apiKey" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                            placeholder="AIzaSy..." className="w-full p-3 rounded-xl border border-gray-300 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none transition-all" />
                    </div>
                    <button type="submit" disabled={!apiKey || apiStatus === 'Saving...'}
                        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition-colors">
                        {apiStatus === 'Saving...' ? 'Saving...' : 'Save API Key'}
                    </button>
                    {apiStatus && apiStatus !== 'Saving...' && (
                        <p className={`text-sm text-center font-medium ${apiStatus.includes('Error') ? 'text-red-500' : 'text-green-500'}`}>{apiStatus}</p>
                    )}
                </form>
            </div>

            {/* ── SEARXNG ── */}
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                    <h2 className="text-lg font-semibold">🔍 SearXNG Search</h2>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${searxngIsDefault ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'}`}>
                        {searxngIsDefault ? '● Public instance' : '● Custom instance'}
                    </span>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    Orchestratorul folosește SearXNG pentru căutări. Implicit rulează pe instanța publică <code className="bg-gray-100 dark:bg-zinc-800 px-1 rounded text-xs">searx.be</code>.
                </p>
                <div className="mb-4 p-3 bg-gray-50 dark:bg-zinc-800/50 rounded-xl border border-gray-100 dark:border-zinc-700 flex flex-col gap-1">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Instanță activă</span>
                    <span className="font-mono text-sm break-all text-gray-700 dark:text-gray-300">{currentSearxngUrl || 'https://searx.be'}</span>
                </div>
                <div className="flex gap-3">
                    <input type="url" value={searxngUrl} onChange={(e) => setSearxngUrl(e.target.value)}
                        placeholder="https://searx.example.com (gol = public default)"
                        className="flex-1 p-3 rounded-xl border border-gray-300 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm" />
                    <button onClick={handleSearxngSave} disabled={searxngStatus === 'Saving...'}
                        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 px-5 rounded-xl transition-colors text-sm whitespace-nowrap">
                        {searxngStatus === 'Saving...' ? 'Saving...' : 'Save'}
                    </button>
                </div>
                {!searxngIsDefault && (
                    <button onClick={() => { setSearxngUrl(''); handleSearxngSave(); }} className="mt-2 text-xs text-gray-400 hover:text-red-500 transition-colors">
                        Resetează la instanța publică
                    </button>
                )}
                {searxngStatus && searxngStatus !== 'Saving...' && (
                    <p className={`text-sm font-medium mt-2 ${searxngStatus.includes('Error') ? 'text-red-500' : 'text-green-500'}`}>{searxngStatus}</p>
                )}
            </div>

            {/* ── AI AGENT SETTINGS ── */}
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm space-y-6">
                <h2 className="text-lg font-semibold border-b border-gray-100 dark:border-zinc-800 pb-3">AI Agent Settings</h2>
                <div className="flex flex-col text-gray-700 dark:text-gray-300">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-4">
                            <div className="relative">
                                <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${isActive ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-gray-100 dark:bg-zinc-800 text-gray-400'}`}>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                                </div>
                                <div className={`absolute bottom-0 right-0 w-4 h-4 border-2 border-white dark:border-zinc-900 rounded-full transition-colors ${isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Auto-Reply Agent</h3>
                                <p className={`font-medium text-sm transition-colors ${isActive ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}`}>
                                    {isActive ? 'Active & Listening' : 'Paused'}
                                </p>
                            </div>
                        </div>
                        <button onClick={() => setIsActive(!isActive)}
                            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${isActive ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${isActive ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>
                </div>
                <div className="flex flex-col">
                    <h3 className="font-semibold text-md mb-2">Agent Persona & Memory (System Prompt)</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                        Instruct the AI on how to behave, what tone to use, and give it &ldquo;thinking capabilities&rdquo;.
                    </p>
                    {isAgentLoading ? (
                        <div className="animate-pulse bg-gray-200 dark:bg-zinc-800 h-32 rounded-xl mb-4" />
                    ) : (
                        <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)}
                            className="w-full p-4 rounded-xl border border-gray-300 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none transition-all min-h-[160px] text-sm mb-4"
                            placeholder="e.g., You are a personal assistant. Be highly analytical and always be polite." />
                    )}
                    <div className="flex items-center justify-between mt-4">
                        <button onClick={async () => {
                            if (window.confirm('Clear all agent memory?')) {
                                setAgentStatus('Clearing memory...');
                                try { await api.post('/api/agent/memory/clear'); setAgentStatus('Memory cleared!'); }
                                catch { setAgentStatus('Failed to clear memory.'); }
                                setTimeout(() => setAgentStatus(''), 3000);
                            }
                        }} className="text-red-500 hover:text-red-600 font-medium text-sm transition-colors px-2 py-1">
                            Clear Agent Memory
                        </button>
                        <div className="flex items-center space-x-4">
                            <span className={`text-sm font-medium ${agentStatus.includes('Error') || agentStatus.includes('Failed') ? 'text-red-500' : 'text-green-500'}`}>{agentStatus}</span>
                            <button onClick={handleAgentSave} disabled={isAgentLoading || agentStatus === 'Saving...' || agentStatus === 'Clearing memory...'}
                                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2 px-6 rounded-lg transition-colors">
                                Save Configuration
                            </button>
                        </div>
                    </div>
                </div>
                <KnowledgeBaseSection />
            </div>

            <GlassesGatewaySection />
        </div>
    );
}

function KnowledgeBaseSection() {
    interface KBEntry { _id: string; category: string; key: string; value: string; tags: string[]; availableTo: string; source: string; }
    const [entries, setEntries] = useState<KBEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [form, setForm] = useState({ category: '', key: '', value: '', availableTo: 'all', tags: '' });
    const [status, setStatus] = useState('');

    const loadEntries = useCallback(async () => {
        try { const data = await api.get<KBEntry[]>('/api/knowledge'); if (Array.isArray(data)) setEntries(data); } catch { }
        setLoading(false);
    }, []);
    useEffect(() => { loadEntries(); }, [loadEntries]);

    const handleSave = async () => {
        if (!form.category || !form.key || !form.value) { setStatus('Category, key, and value are required'); return; }
        setStatus('Saving...');
        const body = { ...form, tags: form.tags.split(',').map(t => t.trim()).filter(Boolean) };
        try {
            if (editId) { await api.put(`/api/knowledge/${editId}`, body); } else { await api.post('/api/knowledge', body); }
            setForm({ category: '', key: '', value: '', availableTo: 'all', tags: '' });
            setEditId(null); setShowForm(false); setStatus('Saved!'); loadEntries();
        } catch { setStatus('Error saving'); }
    };
    const handleEdit = (entry: KBEntry) => { setForm({ category: entry.category, key: entry.key, value: entry.value, availableTo: entry.availableTo, tags: entry.tags.join(', ') }); setEditId(entry._id); setShowForm(true); };
    const handleDelete = async (id: string) => { if (!confirm('Delete this entry?')) return; await api.delete(`/api/knowledge/${id}`); loadEntries(); };
    const grouped = entries.reduce<Record<string, KBEntry[]>>((acc, e) => { (acc[e.category] = acc[e.category] || []).push(e); return acc; }, {});

    return (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-lg border border-gray-200 dark:border-zinc-800 overflow-hidden">
            <div className="px-4 md:px-6 py-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
                <div><h2 className="text-lg font-bold">📚 Knowledge Base</h2><p className="text-xs text-gray-500 mt-0.5">{entries.length} entries</p></div>
                <button onClick={() => { setShowForm(!showForm); setEditId(null); setForm({ category: '', key: '', value: '', availableTo: 'all', tags: '' }); }}
                    className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors">
                    {showForm ? 'Cancel' : '+ Add Entry'}
                </button>
            </div>
            {showForm && (
                <div className="px-4 md:px-6 py-4 border-b border-gray-100 dark:border-zinc-800 space-y-3 bg-gray-50 dark:bg-zinc-800/30">
                    <div className="grid grid-cols-2 gap-3">
                        <input placeholder="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                        <input placeholder="Key" value={form.key} onChange={e => setForm({ ...form, key: e.target.value })} className="px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <textarea placeholder="Value" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} rows={2} className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                    <div className="grid grid-cols-2 gap-3">
                        <input placeholder="Tags (comma separated)" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} className="px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                        <select value={form.availableTo} onChange={e => setForm({ ...form, availableTo: e.target.value })} className="px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm outline-none focus:ring-2 focus:ring-blue-500">
                            <option value="all">All agents</option><option value="orchestrator">Orchestrator</option><option value="booking">Booking</option><option value="planner">Planner</option>
                        </select>
                    </div>
                    <div className="flex items-center justify-between">
                        {status && <p className="text-xs text-gray-500">{status}</p>}
                        <button onClick={handleSave} className="ml-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors">{editId ? 'Update' : 'Save Entry'}</button>
                    </div>
                </div>
            )}
            <div className="px-4 md:px-6 py-4">
                {loading ? <div className="flex justify-center py-4"><div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" /></div>
                    : entries.length === 0 ? <p className="text-sm text-gray-500 text-center py-4">No entries yet.</p>
                        : <div className="space-y-4">{Object.entries(grouped).map(([category, items]) => (
                            <div key={category}>
                                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{category}</h3>
                                <div className="space-y-1.5">{items.map(entry => (
                                    <div key={entry._id} className="flex items-start justify-between bg-gray-50 dark:bg-zinc-800/50 rounded-lg p-2.5 group">
                                        <div className="flex-1 min-w-0"><p className="text-sm font-medium">{entry.key}</p><p className="text-xs text-gray-500 mt-0.5">{entry.value}</p></div>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                            <button onClick={() => handleEdit(entry)} className="text-gray-400 hover:text-blue-500 p-1"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg></button>
                                            <button onClick={() => handleDelete(entry._id)} className="text-gray-400 hover:text-red-500 p-1"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg></button>
                                        </div>
                                    </div>
                                ))}</div>
                            </div>
                        ))}</div>}
            </div>
        </div>
    );
}

function GlassesGatewaySection() {
    interface Memory { _id: string; category: string; content: string; importance: string; updatedAt: string; }
    const [tokenDisplay, setTokenDisplay] = useState<string | null>(null);
    const [hasToken, setHasToken] = useState(false);
    const [generatedToken, setGeneratedToken] = useState<string | null>(null);
    const [memories, setMemories] = useState<Memory[]>([]);
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState('');

    useEffect(() => {
        api.get<{ hasToken?: boolean; token?: string }>('/api/settings/glasses-token').then(data => { if (data.hasToken && data.token) { setTokenDisplay(data.token); setHasToken(true); } }).catch(() => {});
        api.get<Memory[]>('/api/glasses/memories?limit=20').then(data => { if (Array.isArray(data)) setMemories(data); }).catch(() => {}).finally(() => setLoading(false));
    }, []);

    const handleGenerate = async () => {
        setStatus('Generating...');
        try {
            const data = await api.post<{ token?: string }>('/api/settings/glasses-token/generate');
            if (data.token) { setGeneratedToken(data.token); setTokenDisplay(data.token.slice(0, 4) + '...' + data.token.slice(-4)); setHasToken(true); setStatus('Token generated!'); }
        } catch { setStatus('Error generating token'); }
    };

    const importanceColor = (imp: string) => imp === 'high' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : imp === 'medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    const categoryIcon = (cat: string) => ({ observation: '👁️', preference: '❤️', fact: '📌', person: '👤', conversation: '💬' }[cat] || '🧠');

    return (
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-zinc-800 pb-3">
                <div><h2 className="text-lg font-semibold">🕶️ Glasses Gateway</h2><p className="text-xs text-gray-500 mt-0.5">Ray-Ban Meta → usa-app backend</p></div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${hasToken ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-zinc-800'}`}>{hasToken ? '● Configured' : '○ Not configured'}</span>
            </div>
            <div className="bg-gray-50 dark:bg-zinc-800/50 rounded-xl p-4 space-y-2">
                <h3 className="text-sm font-semibold">Connection Details</h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-gray-400">Endpoint</span><p className="font-mono mt-0.5">http://155.117.45.192:5000</p></div>
                    <div><span className="text-gray-400">Path</span><p className="font-mono mt-0.5">/v1/chat/completions</p></div>
                </div>
            </div>
            <div className="space-y-3">
                <h3 className="text-sm font-semibold">Gateway Token</h3>
                {tokenDisplay && <div className="flex items-center gap-2"><span className="font-mono text-sm bg-gray-100 dark:bg-zinc-800 px-3 py-1.5 rounded-lg flex-1">{tokenDisplay}</span></div>}
                {generatedToken && (
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3">
                        <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 mb-1">⚠️ Copy this token — it won&apos;t be shown again:</p>
                        <p className="font-mono text-xs break-all select-all bg-white dark:bg-zinc-900 p-2 rounded-lg">{generatedToken}</p>
                    </div>
                )}
                <div className="flex items-center gap-3">
                    <button onClick={handleGenerate} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">{hasToken ? 'Regenerate Token' : 'Generate Token'}</button>
                    {status && <span className="text-xs text-gray-500">{status}</span>}
                </div>
            </div>
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">🧠 Long-Term Memory ({memories.length})</h3>
                    {memories.length > 0 && <button onClick={async () => { if (!confirm('Clear all glasses memories?')) return; await api.delete('/api/glasses/memories'); setMemories([]); }} className="text-xs text-red-500 hover:text-red-600 font-medium">Clear All</button>}
                </div>
                {loading ? <div className="flex justify-center py-4"><div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" /></div>
                    : memories.length === 0 ? <p className="text-sm text-gray-500 text-center py-4">No memories yet.</p>
                        : <div className="space-y-1.5 max-h-64 overflow-y-auto">{memories.map(m => (
                            <div key={m._id} className="flex items-start gap-2 bg-gray-50 dark:bg-zinc-800/50 rounded-lg p-2.5">
                                <span className="text-sm mt-0.5">{categoryIcon(m.category)}</span>
                                <div className="flex-1 min-w-0"><p className="text-sm">{m.content}</p>
                                    <div className="flex items-center gap-2 mt-1"><span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${importanceColor(m.importance)}`}>{m.importance}</span><span className="text-[10px] text-gray-400">{new Date(m.updatedAt).toLocaleDateString('ro-RO')}</span></div>
                                </div>
                            </div>
                        ))}</div>}
            </div>
        </div>
    );
}
