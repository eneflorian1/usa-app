'use client';

import { useState, useEffect, useRef } from 'react';

interface Message {
    role: 'user' | 'model';
    content: string;
}

interface Task {
    _id: string;
    title: string;
    description: string;
    dueDate: string | null;
    priority: 'low' | 'medium' | 'high';
    completed: boolean;
}

interface ChatResponse {
    reply: string;
    tasks: Task[] | null;
}

const priorityColors: Record<string, string> = {
    high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

export default function PlannerPage() {
    const [activeTab, setActiveTab] = useState<'chat' | 'tasks'>('chat');
    const [messages, setMessages] = useState<Message[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [loadingChat, setLoadingChat] = useState(true);
    const [loadingTasks, setLoadingTasks] = useState(true);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { loadHistory(); loadTasks(); }, []);
    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

    const loadHistory = async () => {
        try {
            const res = await fetch('/api/planner/chat/history');
            const data = await res.json();
            if (Array.isArray(data)) setMessages(data);
        } catch { }
        setLoadingChat(false);
    };

    const loadTasks = async () => {
        try {
            const res = await fetch('/api/planner/tasks');
            const data = await res.json();
            if (Array.isArray(data)) setTasks(data);
        } catch { }
        setLoadingTasks(false);
    };

    const handleSend = async () => {
        if (!input.trim() || sending) return;
        const userMsg = input.trim();
        setInput('');
        setSending(true);
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);

        try {
            const res = await fetch('/api/planner/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userMsg }),
            });
            const data: ChatResponse = await res.json();
            setMessages(prev => [...prev, { role: 'model', content: data.reply }]);

            if (data.tasks && data.tasks.length > 0) {
                for (const t of data.tasks) {
                    setMessages(prev => [...prev, {
                        role: 'model',
                        content: `✅ TASK CREATED\n📝 ${t.title}\n⚡ Priority: ${t.priority}\n📅 Due: ${t.dueDate ? new Date(t.dueDate).toLocaleDateString('ro-RO') : 'No deadline'}`
                    }]);
                }
                loadTasks();
            }
        } catch {
            setMessages(prev => [...prev, { role: 'model', content: '⚠️ Connection error.' }]);
        }
        setSending(false);
        inputRef.current?.focus();
    };

    const toggleTask = async (id: string, completed: boolean) => {
        await fetch(`/api/planner/tasks/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ completed: !completed }),
        });
        loadTasks();
    };

    const deleteTask = async (id: string) => {
        if (!confirm('Delete this task?')) return;
        await fetch(`/api/planner/tasks/${id}`, { method: 'DELETE' });
        loadTasks();
    };

    const handleClear = async () => {
        if (!confirm('Clear planner chat?')) return;
        await fetch('/api/planner/chat/history', { method: 'DELETE' });
        setMessages([]);
    };

    const isStatusMsg = (c: string) => c.startsWith('✅') || c.startsWith('❌');

    return (
        <div className="h-[calc(100dvh-6rem)] md:h-[calc(100vh-4rem)] flex flex-col max-w-5xl mx-auto">
            {/* Header — sticky */}
            <div className="flex items-center justify-between pb-2 border-b border-gray-200 dark:border-zinc-800 sticky top-0 bg-white dark:bg-[#0a0a0a] z-10">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center shadow-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /><path d="m9 16 2 2 4-4" /></svg>
                    </div>
                    <div>
                        <h1 className="text-base md:text-xl font-bold tracking-tight">Planner Agent</h1>
                        <p className="text-[10px] md:text-xs text-teal-500 font-medium">{tasks.filter(t => !t.completed).length} active tasks</p>
                    </div>
                </div>
                {/* Mobile tab switching */}
                <div className="flex md:hidden gap-1 bg-gray-100 dark:bg-zinc-800 rounded-lg p-0.5">
                    <button onClick={() => setActiveTab('chat')} className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${activeTab === 'chat' ? 'bg-white dark:bg-zinc-700 shadow-sm' : 'text-gray-500'}`}>Chat</button>
                    <button onClick={() => setActiveTab('tasks')} className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${activeTab === 'tasks' ? 'bg-white dark:bg-zinc-700 shadow-sm' : 'text-gray-500'}`}>
                        Tasks {tasks.filter(t => !t.completed).length > 0 && <span className="ml-1 w-4 h-4 inline-flex items-center justify-center text-[10px] bg-teal-500 text-white rounded-full">{tasks.filter(t => !t.completed).length}</span>}
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 flex gap-4 overflow-hidden pt-1">
                {/* Chat Panel */}
                <div className={`flex-1 flex flex-col ${activeTab === 'tasks' ? 'hidden md:flex' : 'flex'}`}>
                    <div className={`flex-1 ${messages.length > 0 || sending ? 'overflow-y-auto' : 'overflow-hidden'} space-y-3 pb-2`}>
                        {loadingChat ? (
                            <div className="flex justify-center items-center h-full"><div className="animate-spin w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full" /></div>
                        ) : messages.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center px-4">
                                <div className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center mb-2">📋</div>
                                <h3 className="text-sm font-semibold mb-0.5">Planner AI</h3>
                                <p className="text-xs text-gray-500 max-w-xs">Tell me what you need to do and I&apos;ll create tasks for you.</p>
                                <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                                    {['Creează un task: cumpără flori', 'Plan for tomorrow', 'Ce am de făcut?'].map(s => (
                                        <button key={s} onClick={() => { setInput(s); inputRef.current?.focus(); }}
                                            className="text-[11px] px-2.5 py-1 rounded-full border border-gray-200 dark:border-zinc-700 text-gray-500 hover:border-teal-400 hover:text-teal-600 transition-colors"
                                        >{s}</button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            messages.map((msg, idx) => (
                                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[90%] md:max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed
                    ${isStatusMsg(msg.content) ? 'bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                                            : msg.role === 'user' ? 'bg-teal-600 text-white rounded-br-md' : 'bg-gray-100 dark:bg-zinc-800 text-gray-800 dark:text-gray-200 rounded-bl-md'}
                  `}><div className="whitespace-pre-wrap">{msg.content}</div></div>
                                </div>
                            ))
                        )}
                        {sending && (
                            <div className="flex justify-start">
                                <div className="bg-gray-100 dark:bg-zinc-800 rounded-2xl rounded-bl-md px-4 py-3">
                                    <div className="flex gap-1.5">
                                        <span className="w-2 h-2 rounded-full bg-teal-400 animate-bounce" />
                                        <span className="w-2 h-2 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                                        <span className="w-2 h-2 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                                    </div>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div className="pt-2 border-t border-gray-200 dark:border-zinc-800 flex items-center gap-2">
                        <button onClick={handleClear} className="text-gray-400 hover:text-red-500 p-2 transition-colors flex-shrink-0" title="Clear chat">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                        </button>
                        <input ref={inputRef} type="text" value={input} onChange={e => setInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSend(); } }}
                            placeholder="Describe a task..." disabled={sending}
                            className="flex-1 px-3 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-teal-500 outline-none transition-all disabled:opacity-50"
                        />
                        <button onClick={handleSend} disabled={!input.trim() || sending}
                            className="p-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white transition-colors flex-shrink-0">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
                        </button>
                    </div>
                </div>

                {/* Tasks Panel */}
                <div className={`md:w-80 lg:w-96 flex flex-col bg-gray-50 dark:bg-zinc-900/50 rounded-xl border border-gray-200 dark:border-zinc-800 overflow-hidden ${activeTab === 'chat' ? 'hidden md:flex' : 'flex flex-1'}`}>
                    <div className="px-4 py-3 border-b border-gray-200 dark:border-zinc-800 flex items-center justify-between">
                        <h3 className="font-semibold text-sm">Tasks</h3>
                        <span className="text-xs text-gray-400">{tasks.filter(t => !t.completed).length}/{tasks.length}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                        {loadingTasks ? (
                            <div className="flex justify-center py-8"><div className="animate-spin w-5 h-5 border-2 border-teal-500 border-t-transparent rounded-full" /></div>
                        ) : tasks.length === 0 ? (
                            <p className="text-xs text-gray-400 text-center py-8">No tasks yet. Ask the AI to create one!</p>
                        ) : (
                            tasks.map(task => (
                                <div key={task._id} className={`flex items-start gap-2 p-2.5 rounded-lg transition-all ${task.completed ? 'opacity-50' : 'bg-white dark:bg-zinc-800/80'}`}>
                                    <button onClick={() => toggleTask(task._id, task.completed)}
                                        className={`mt-0.5 w-4.5 h-4.5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors
                      ${task.completed ? 'bg-teal-500 border-teal-500 text-white' : 'border-gray-300 dark:border-zinc-600 hover:border-teal-500'}`}>
                                        {task.completed && <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg>}
                                    </button>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-xs font-medium ${task.completed ? 'line-through text-gray-400' : ''}`}>{task.title}</p>
                                        {task.description && <p className="text-[10px] text-gray-400 mt-0.5 truncate">{task.description}</p>}
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${priorityColors[task.priority]}`}>{task.priority}</span>
                                            {task.dueDate && <span className="text-[10px] text-gray-400">📅 {new Date(task.dueDate).toLocaleDateString('ro-RO')}</span>}
                                        </div>
                                    </div>
                                    <button onClick={() => deleteTask(task._id)}
                                        className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0 p-0.5">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
