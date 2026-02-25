'use client';

import { useState, useEffect, useRef } from 'react';

interface Message {
    role: 'user' | 'model';
    content: string;
    agent?: string;
}

interface OrchestratorResponse {
    agent: string;
    reasoning: string;
    reply: string;
    booking: { success: boolean; error?: string; booking?: { _id: string; guestName: string; checkIn: string; checkOut: string } } | null;
    tasks: Array<{ _id: string; title: string; priority: string; dueDate: string }> | null;
}

const agentLabels: Record<string, { label: string; color: string; icon: string }> = {
    booking: { label: 'Booking Agent', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', icon: '🏨' },
    planner: { label: 'Planner Agent', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300', icon: '📋' },
    info: { label: 'Knowledge Base', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', icon: '📚' },
    escalate: { label: 'Escalated', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', icon: '🚨' },
    general: { label: 'General', color: 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-300', icon: '💬' },
};

export default function OrchestratorPage() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [loading, setLoading] = useState(true);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { loadHistory(); }, []);
    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

    const loadHistory = async () => {
        try {
            const res = await fetch('/api/orchestrator/chat/history');
            const data = await res.json();
            if (Array.isArray(data)) setMessages(data);
        } catch { }
        setLoading(false);
    };

    const handleSend = async () => {
        if (!input.trim() || sending) return;
        const userMsg = input.trim();
        setInput('');
        setSending(true);
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);

        try {
            const res = await fetch('/api/orchestrator/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userMsg }),
            });
            const data: OrchestratorResponse = await res.json();
            const agentInfo = agentLabels[data.agent] || agentLabels.general;

            // Add agent reply with routing info
            setMessages(prev => [...prev, {
                role: 'model',
                content: data.reply,
                agent: data.agent
            }]);

            // Booking confirmation
            if (data.booking?.success && data.booking.booking) {
                const b = data.booking.booking;
                setMessages(prev => [...prev, {
                    role: 'model',
                    agent: 'booking',
                    content: `✅ BOOKING CONFIRMED\n📋 Guest: ${b.guestName}\n📥 Check-in: ${new Date(b.checkIn).toLocaleDateString('ro-RO')} ${new Date(b.checkIn).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}\n📤 Check-out: ${new Date(b.checkOut).toLocaleDateString('ro-RO')} ${new Date(b.checkOut).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}`
                }]);
            } else if (data.booking && !data.booking.success) {
                setMessages(prev => [...prev, { role: 'model', agent: 'booking', content: `❌ BOOKING FAILED\n${data.booking?.error}` }]);
            }

            // Task confirmations
            if (data.tasks && data.tasks.length > 0) {
                for (const t of data.tasks) {
                    setMessages(prev => [...prev, {
                        role: 'model',
                        agent: 'planner',
                        content: `✅ TASK CREATED\n📝 ${t.title}\n⚡ Priority: ${t.priority}\n📅 Due: ${t.dueDate ? new Date(t.dueDate).toLocaleDateString('ro-RO') : 'No deadline'}`
                    }]);
                }
            }
        } catch {
            setMessages(prev => [...prev, { role: 'model', content: '⚠️ Connection error. Please try again.' }]);
        }
        setSending(false);
        inputRef.current?.focus();
    };

    const handleClear = async () => {
        if (!confirm('Clear all orchestrator history?')) return;
        await fetch('/api/orchestrator/chat/history', { method: 'DELETE' });
        setMessages([]);
    };

    const isStatusMsg = (c: string) => c.startsWith('✅') || c.startsWith('❌');

    return (
        <div className="h-[calc(100vh-7rem)] md:h-[calc(100vh-4rem)] flex flex-col max-w-3xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 md:pb-4 border-b border-gray-200 dark:border-zinc-800">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-pink-600 flex items-center justify-center shadow-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" /><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" /><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" /><path d="M17.599 6.5a3 3 0 0 0 .399-1.375" /><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" /><path d="M3.477 10.896a4 4 0 0 1 .585-.396" /><path d="M19.938 10.5a4 4 0 0 1 .585.396" /><path d="M6 18a4 4 0 0 1-1.967-.516" /><path d="M19.967 17.484A4 4 0 0 1 18 18" /></svg>
                    </div>
                    <div>
                        <h1 className="text-lg md:text-xl font-bold tracking-tight">Command Center</h1>
                        <p className="text-xs text-violet-500 font-medium flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
                            Orchestrator AI
                        </p>
                    </div>
                </div>
                <button onClick={handleClear} className="text-xs text-gray-400 hover:text-red-500 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800">Clear</button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto py-4 space-y-3">
                {loading ? (
                    <div className="flex justify-center items-center h-full"><div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" /></div>
                ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center px-4">
                        <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-violet-500/10 to-pink-500/10 flex items-center justify-center mb-4">
                            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-violet-500"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" /><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" /></svg>
                        </div>
                        <h3 className="text-base font-semibold mb-1">AI Command Center</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs">
                            I automatically route your requests to the right agent — bookings, planning tasks, or general questions.
                        </p>
                        <div className="mt-4 flex flex-wrap justify-center gap-2">
                            {['Rezervă o cameră pe 5 martie', 'Creează un task pentru mâine', 'Ce poți face?'].map(s => (
                                <button key={s} onClick={() => { setInput(s); inputRef.current?.focus(); }}
                                    className="text-xs px-3 py-1.5 rounded-full border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-gray-400 hover:border-violet-400 hover:text-violet-600 transition-colors"
                                >{s}</button>
                            ))}
                        </div>
                    </div>
                ) : (
                    messages.map((msg, idx) => {
                        const agentInfo = msg.agent ? agentLabels[msg.agent] : null;
                        return (
                            <div key={idx}>
                                {msg.role === 'model' && agentInfo && !isStatusMsg(msg.content) && (
                                    <div className="flex justify-start mb-1 ml-1">
                                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${agentInfo.color}`}>
                                            {agentInfo.icon} {agentInfo.label}
                                        </span>
                                    </div>
                                )}
                                <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`
                    max-w-[85%] md:max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed
                    ${isStatusMsg(msg.content)
                                            ? msg.content.startsWith('✅')
                                                ? 'bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                                                : 'bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                                            : msg.role === 'user'
                                                ? 'bg-violet-600 text-white rounded-br-md'
                                                : 'bg-gray-100 dark:bg-zinc-800 text-gray-800 dark:text-gray-200 rounded-bl-md'
                                        }
                  `}>
                                        <div className="whitespace-pre-wrap">{msg.content}</div>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
                {sending && (
                    <div className="flex justify-start">
                        <div className="bg-gray-100 dark:bg-zinc-800 rounded-2xl rounded-bl-md px-4 py-3">
                            <div className="flex gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                                <span className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                                <span className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="pt-3 border-t border-gray-200 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                    <input ref={inputRef} type="text" value={input} onChange={e => setInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                        placeholder="Ask anything..." disabled={sending}
                        className="flex-1 px-4 py-2.5 md:py-3 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition-all disabled:opacity-50"
                    />
                    <button onClick={handleSend} disabled={!input.trim() || sending}
                        className="p-2.5 md:p-3 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white transition-colors flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
                    </button>
                </div>
            </div>
        </div>
    );
}
