'use client';

import { useState, useEffect } from 'react';

interface Escalation {
  _id: string;
  reason: string;
  context: string;
  sessionId: string;
  agentType: string;
  status: 'pending' | 'handled';
  priority: string;
  chatHistory: Array<{ role: string; content: string }>;
  createdAt: string;
}

const priorityColors: Record<string, string> = {
  critical: 'bg-red-500 text-white',
  high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

export default function NotificationsPage() {
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => { loadEscalations(); }, []);

  const loadEscalations = async () => {
    try {
      const res = await fetch('/api/escalations');
      const data = await res.json();
      if (Array.isArray(data)) setEscalations(data);
    } catch { }
    setLoading(false);
  };

  const handleMarkHandled = async (id: string) => {
    await fetch(`/api/escalations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'handled' }),
    });
    loadEscalations();
  };

  const pendingCount = escalations.filter(e => e.status === 'pending').length;

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight bg-gradient-to-r from-amber-500 to-orange-600 bg-clip-text text-transparent">
            Alerts
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {pendingCount > 0 ? `${pendingCount} pending escalation${pendingCount > 1 ? 's' : ''}` : 'No pending alerts'}
          </p>
        </div>
        {pendingCount > 0 && (
          <span className="px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-sm font-semibold animate-pulse">
            {pendingCount} new
          </span>
        )}
      </div>

      {/* Escalations List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full" />
        </div>
      ) : escalations.length === 0 ? (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 p-8 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 flex items-center justify-center mb-3">🔔</div>
          <h3 className="font-semibold text-sm mb-1">No Alerts</h3>
          <p className="text-xs text-gray-500">Escalations from the AI agent will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {escalations.map(esc => (
            <div key={esc._id}
              className={`bg-white dark:bg-zinc-900 rounded-2xl border overflow-hidden transition-all
                ${esc.status === 'pending'
                  ? 'border-amber-300 dark:border-amber-700 shadow-md'
                  : 'border-gray-200 dark:border-zinc-800 opacity-60'}`}
            >
              <div className="px-4 md:px-6 py-3 md:py-4 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${priorityColors[esc.priority] || priorityColors.medium}`}>
                      {esc.priority.toUpperCase()}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {new Date(esc.createdAt).toLocaleString('ro-RO')}
                    </span>
                    {esc.status === 'handled' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">✓ Handled</span>
                    )}
                  </div>
                  <p className="text-sm font-medium">{esc.reason}</p>
                  {esc.context && (
                    <button
                      onClick={() => setExpandedId(expandedId === esc._id ? null : esc._id)}
                      className="text-xs text-blue-500 hover:text-blue-600 mt-1"
                    >
                      {expandedId === esc._id ? 'Hide context ↑' : 'Show context ↓'}
                    </button>
                  )}
                </div>
                {esc.status === 'pending' && (
                  <button
                    onClick={() => handleMarkHandled(esc._id)}
                    className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors flex-shrink-0"
                  >
                    Handle
                  </button>
                )}
              </div>

              {/* Expanded Context */}
              {expandedId === esc._id && esc.context && (
                <div className="px-4 md:px-6 pb-4 border-t border-gray-100 dark:border-zinc-800 pt-3">
                  <p className="text-xs font-semibold text-gray-500 mb-2">Conversation Context:</p>
                  <div className="bg-gray-50 dark:bg-zinc-800/50 rounded-lg p-3 text-xs space-y-1.5 max-h-48 overflow-y-auto">
                    {esc.context.split('\n').map((line, idx) => (
                      <div key={idx} className={`${line.startsWith('user:') ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'}`}>
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}