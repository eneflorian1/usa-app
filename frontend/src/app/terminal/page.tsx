'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';

interface ExecCommand {
    _id: string;
    command: string;
    label: string;
    cwd: string;
    execType?: 'shell' | 'mcp';
    mcpServer?: string;
    mcpArgs?: Record<string, unknown>;
    status: 'pending' | 'running' | 'done' | 'error';
    output: string;
    exitCode: number | null;
    createdAt: string;
    updatedAt: string;
}

const statusConfig: Record<string, { color: string; icon: string; label: string }> = {
    pending: { color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', icon: '⏳', label: 'Pending' },
    running: { color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: '⚡', label: 'Running' },
    done: { color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: '✓', label: 'Done' },
    error: { color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: '✗', label: 'Error' },
};

export default function TerminalPage() {
    const [commands, setCommands] = useState<ExecCommand[]>([]);
    const [loading, setLoading] = useState(true);
    const [manualCmd, setManualCmd] = useState('');
    const [manualCwd, setManualCwd] = useState('');
    const [sending, setSending] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    const loadCommands = async () => {
        try {
            const data = await api.get<ExecCommand[]>('/api/local-exec/history');
            if (Array.isArray(data)) setCommands(data);
        } catch { }
        setLoading(false);
    };

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadCommands();
        intervalRef.current = setInterval(loadCommands, 4000);
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, []);

    const sendCommand = async () => {
        if (!manualCmd.trim() || sending) return;
        setSending(true);
        try {
            await api.post('/api/local-exec/queue', { command: manualCmd.trim(), label: 'Manual', cwd: manualCwd.trim() || '' });
            setManualCmd('');
            setTimeout(loadCommands, 500);
        } catch { }
        setSending(false);
    };

    const stats = {
        total: commands.length,
        done: commands.filter(c => c.status === 'done').length,
        error: commands.filter(c => c.status === 'error').length,
        pending: commands.filter(c => c.status === 'pending' || c.status === 'running').length,
    };

    const formatTime = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white text-lg">
                        &gt;_
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Terminal</h1>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            {stats.done} done · {stats.error} errors · {stats.pending} active · {stats.total} total
                        </p>
                    </div>
                </div>
            </div>

            {/* Manual Command Input */}
            <div className="bg-gray-900 dark:bg-zinc-950 rounded-2xl p-4 border border-gray-700 dark:border-zinc-800">
                <div className="flex items-center space-x-2 mb-2">
                    <span className="text-emerald-400 font-mono text-sm">$</span>
                    <input
                        type="text"
                        value={manualCmd}
                        onChange={e => setManualCmd(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && sendCommand()}
                        placeholder="Type a command to run on local PC..."
                        className="flex-1 bg-transparent text-white font-mono text-sm outline-none placeholder-gray-500"
                    />
                    <button
                        onClick={sendCommand}
                        disabled={!manualCmd.trim() || sending}
                        className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm rounded-lg transition-colors font-medium"
                    >
                        {sending ? '...' : 'Run'}
                    </button>
                </div>
                <div className="flex items-center space-x-2">
                    <span className="text-gray-500 font-mono text-xs">cwd:</span>
                    <input
                        type="text"
                        value={manualCwd}
                        onChange={e => setManualCwd(e.target.value)}
                        placeholder="C:\Users\Admin (optional)"
                        className="flex-1 bg-transparent text-gray-400 font-mono text-xs outline-none placeholder-gray-600"
                    />
                </div>
            </div>

            {/* Commands List */}
            {loading ? (
                <div className="text-center py-12 text-gray-400">Loading...</div>
            ) : commands.length === 0 ? (
                <div className="text-center py-12">
                    <p className="text-gray-400 text-lg">No commands yet</p>
                    <p className="text-gray-500 text-sm mt-1">Send a command above or ask the orchestrator to run something on your PC</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {commands.map(cmd => {
                        const st = statusConfig[cmd.status] || statusConfig.pending;
                        const isExpanded = expandedId === cmd._id;
                        return (
                            <div
                                key={cmd._id}
                                className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 overflow-hidden cursor-pointer hover:border-gray-300 dark:hover:border-zinc-700 transition-colors"
                                onClick={() => setExpandedId(isExpanded ? null : cmd._id)}
                            >
                                <div className="flex items-center justify-between p-4">
                                    <div className="flex items-center space-x-3 min-w-0 flex-1">
                                        <span className={`inline-flex items-center px-2 py-1 rounded-lg text-xs font-medium ${st.color}`}>
                                            {st.icon} {st.label}
                                        </span>
                                        {cmd.execType === 'mcp' && (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                                                MCP:{cmd.mcpServer}
                                            </span>
                                        )}
                                        <code className="text-sm font-mono text-gray-800 dark:text-gray-200 truncate">
                                            {cmd.command}
                                        </code>
                                    </div>
                                    <div className="flex items-center space-x-3 ml-3 shrink-0">
                                        {cmd.exitCode !== null && cmd.exitCode !== 0 && (
                                            <span className="text-xs text-red-400">exit {cmd.exitCode}</span>
                                        )}
                                        <span className="text-xs text-gray-400">{formatTime(cmd.createdAt)}</span>
                                        <span className="text-gray-400 text-xs">{isExpanded ? '▲' : '▼'}</span>
                                    </div>
                                </div>
                                {isExpanded && (
                                    <div className="border-t border-gray-100 dark:border-zinc-800">
                                        {cmd.label && cmd.label !== 'Manual' && (
                                            <div className="px-4 pt-2 text-xs text-gray-500">Label: {cmd.label}</div>
                                        )}
                                        {cmd.cwd && (
                                            <div className="px-4 pt-1 text-xs text-gray-500 font-mono">cwd: {cmd.cwd}</div>
                                        )}
                                        {cmd.output && cmd.output.includes('[IMAGE:') ? (
                                            <div className="p-4 bg-gray-950 dark:bg-black">
                                                {cmd.output.split('\n').map((line, i) => {
                                                    const imgMatch = line.match(/\[IMAGE:(.*?)\](.*)/);
                                                    if (imgMatch) {
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        return <img key={i} src={`data:${imgMatch[1]};base64,${imgMatch[2]}`} alt="Screenshot" className="max-w-full rounded-lg" />;
                                                    }
                                                    return line ? <pre key={i} className="text-sm font-mono text-gray-300 whitespace-pre-wrap">{line}</pre> : null;
                                                })}
                                            </div>
                                        ) : (
                                            <pre className="p-4 text-sm font-mono text-gray-300 bg-gray-950 dark:bg-black overflow-x-auto whitespace-pre-wrap max-h-96">
                                                {cmd.output || '(no output)'}
                                            </pre>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}