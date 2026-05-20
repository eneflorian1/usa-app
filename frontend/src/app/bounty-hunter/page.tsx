'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BountyLog {
  ts: string;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

interface BountyPR {
  repo: string;
  issueNumber: number;
  issueTitle: string;
  prNumber: number;
  prUrl: string;
  platform: 'algora' | 'opire' | 'issuehunt' | 'other';
  bountyAmount: number;
  currency: string;
  status: 'submitted' | 'merged' | 'closed' | 'paid' | 'competing';
  competitorPRs: number;
  submittedAt: string;
  notes?: string;
}

interface BountySession {
  _id: string;
  status: 'idle' | 'running' | 'stopped' | 'error';
  skipDangerously: boolean;
  githubToken?: string;
  githubUser: string;
  logs: BountyLog[];
  prs: BountyPR[];
  currentIssue?: string;
  totalEarned: number;
  totalPending: number;
  cronEnabled: boolean;
  cronExpr: string;
  startedAt?: string;
  stoppedAt?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PLATFORM_COLORS: Record<string, string> = {
  algora: 'bg-purple-500/20 text-purple-300 border border-purple-500/30',
  opire: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  issuehunt: 'bg-orange-500/20 text-orange-300 border border-orange-500/30',
  other: 'bg-gray-500/20 text-gray-300 border border-gray-500/30',
};

const STATUS_COLORS: Record<string, string> = {
  submitted: 'bg-yellow-500/20 text-yellow-300',
  merged: 'bg-blue-500/20 text-blue-300',
  closed: 'bg-red-500/20 text-red-300',
  paid: 'bg-green-500/20 text-green-300',
  competing: 'bg-orange-500/20 text-orange-300',
};

const STATUS_ICONS: Record<string, string> = {
  submitted: '⏳',
  merged: '🔀',
  closed: '❌',
  paid: '💰',
  competing: '⚔️',
};

const LOG_LEVEL_COLORS: Record<string, string> = {
  info: 'text-gray-300',
  warn: 'text-yellow-400',
  error: 'text-red-400',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function BountyHunterPage() {
  const [session, setSession] = useState<BountySession | null>(null);
  const [prs, setPrs] = useState<BountyPR[]>([]);
  const [totalEarned, setTotalEarned] = useState(0);
  const [totalPending, setTotalPending] = useState(0);
  const [logs, setLogs] = useState<BountyLog[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Config state
  const [githubToken, setGithubToken] = useState('');
  const [githubUser, setGithubUser] = useState('eneflorian1');
  const [skipDangerously, setSkipDangerously] = useState(false);
  const [cronEnabled, setCronEnabled] = useState(false);
  const [cronExpr, setCronExpr] = useState('0 */6 * * *');
  const [showConfig, setShowConfig] = useState(false);
  const [showToken, setShowToken] = useState(false);

  // Active tab
  const [activeTab, setActiveTab] = useState<'logs' | 'prs'>('logs');

  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // ─── Load initial state ──────────────────────────────────────────────────

  const loadState = useCallback(async () => {
    try {
      const state = await api.get<{ isRunning: boolean; session: BountySession | null }>('/api/bounty-hunter/state');
      setIsRunning(state.isRunning);
      if (state.session) {
        setSession(state.session);
        setLogs(state.session.logs || []);
        setGithubUser(state.session.githubUser || 'eneflorian1');
        setSkipDangerously(state.session.skipDangerously || false);
        setCronEnabled(state.session.cronEnabled || false);
        setCronExpr(state.session.cronExpr || '0 */6 * * *');
        if (state.session.githubToken) setGithubToken(state.session.githubToken);
      }
    } catch { }
    setLoading(false);
  }, []);

  const loadPRs = useCallback(async () => {
    try {
      const data = await api.get<{ prs: BountyPR[]; totalEarned: number; totalPending: number }>('/api/bounty-hunter/prs');
      setPrs(data.prs || []);
      setTotalEarned(data.totalEarned || 0);
      setTotalPending(data.totalPending || 0);
    } catch { }
  }, []);

  useEffect(() => {
    loadState();
    loadPRs();
  }, [loadState, loadPRs]);

  // ─── SSE stream ──────────────────────────────────────────────────────────

  useEffect(() => {
    const connect = () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      const es = new EventSource('/api/bounty-hunter/stream');
      eventSourceRef.current = es;

      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'log') {
            setLogs(prev => [...prev, msg.log]);
          } else if (msg.type === 'status') {
            setIsRunning(msg.status === 'running');
            setSession(prev => prev ? { ...prev, status: msg.status, currentIssue: msg.currentIssue } : prev);
            if (msg.status !== 'running') loadPRs();
          }
        } catch { }
      };
      es.onerror = () => {
        setTimeout(connect, 5000);
      };
    };
    connect();
    return () => eventSourceRef.current?.close();
  }, [loadPRs]);

  // ─── Auto-scroll logs ────────────────────────────────────────────────────

  useEffect(() => {
    if (activeTab === 'logs') {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeTab]);

  // ─── Actions ─────────────────────────────────────────────────────────────

  const handleStart = async () => {
    setStarting(true);
    try {
      await api.post('/api/bounty-hunter/start', {
        githubToken: githubToken || undefined,
        githubUser,
        skipDangerously,
      });
      setIsRunning(true);
      setActiveTab('logs');
    } catch (err: unknown) {
      alert((err as { message?: string }).message || 'Start failed');
    }
    setStarting(false);
  };

  const handleStop = async () => {
    try {
      await api.post('/api/bounty-hunter/stop');
      setIsRunning(false);
    } catch { }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await api.post('/api/bounty-hunter/refresh');
      await loadPRs();
    } catch { }
    setRefreshing(false);
  };

  const handleSaveConfig = async () => {
    try {
      await api.patch('/api/bounty-hunter/config', {
        githubToken: githubToken || undefined,
        githubUser,
        skipDangerously,
        cronEnabled,
        cronExpr,
      });
      setShowConfig(false);
    } catch { }
  };

  const handleClearLogs = async () => {
    try {
      await api.delete('/api/bounty-hunter/logs');
      setLogs([]);
    } catch { }
  };

  const updatePRStatus = async (prNumber: number, status: string) => {
    try {
      await api.patch(`/api/bounty-hunter/prs/${prNumber}`, { status });
      await loadPRs();
    } catch { }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400 animate-pulse">Loading Bounty Hunter...</div>
      </div>
    );
  }

  const pendingPRs = prs.filter(p => p.status === 'submitted' || p.status === 'merged');
  const paidPRs = prs.filter(p => p.status === 'paid');
  const closedPRs = prs.filter(p => p.status === 'closed');

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-5">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              🏆 Bounty Hunter
            </h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Automated open-source bounty finder & PR submitter
            </p>
          </div>
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="px-3 py-1.5 text-sm rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700"
          >
            ⚙️ Config
          </button>
        </div>

        {/* ── Config Panel ── */}
        {showConfig && (
          <div className="bg-gray-900 rounded-xl border border-gray-700 p-5 space-y-4">
            <h2 className="font-semibold text-white">Configuration</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">GitHub Token</label>
                <div className="relative">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={githubToken}
                    onChange={e => setGithubToken(e.target.value)}
                    placeholder="ghp_..."
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm pr-16"
                  />
                  <button
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400"
                  >
                    {showToken ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">GitHub User</label>
                <input
                  type="text"
                  value={githubUser}
                  onChange={e => setGithubUser(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={skipDangerously}
                  onChange={e => setSkipDangerously(e.target.checked)}
                  className="accent-red-500"
                />
                <span className="text-sm text-red-400">⚡ Skip Dangerously (--dangerously-skip-permissions)</span>
              </label>
            </div>
            <div className="border-t border-gray-700 pt-4">
              <h3 className="text-sm font-medium text-gray-300 mb-3">🕒 Cron Schedule</h3>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cronEnabled}
                    onChange={e => setCronEnabled(e.target.checked)}
                    className="accent-purple-500"
                  />
                  <span className="text-sm text-gray-300">Enable automatic runs</span>
                </label>
                {cronEnabled && (
                  <input
                    type="text"
                    value={cronExpr}
                    onChange={e => setCronExpr(e.target.value)}
                    placeholder="0 */6 * * *"
                    className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm font-mono w-36"
                  />
                )}
                <span className="text-xs text-gray-500">
                  {cronEnabled ? `Runs: ${cronExpr}` : 'Disabled'}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSaveConfig}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium"
              >
                Save Config
              </button>
              <button
                onClick={() => setShowConfig(false)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Token Warning ── */}
        {!githubToken && (
          <div className="flex items-start gap-3 bg-red-950/50 border border-red-500/40 rounded-xl px-4 py-3">
            <span className="text-red-400 text-lg shrink-0">⚠️</span>
            <div>
              <p className="text-sm text-red-300 font-medium">Token GitHub lipsă</p>
              <p className="text-xs text-red-400/80 mt-0.5">
                Fără token nu poți fork/clone/push. Apasă <strong>⚙️ Config</strong>, adaugă un token <code className="bg-red-900/40 px-1 rounded">ghp_...</code> și salvează.
              </p>
            </div>
            <button
              onClick={() => setShowConfig(true)}
              className="ml-auto shrink-0 px-3 py-1 bg-red-600 hover:bg-red-500 rounded-lg text-xs font-medium text-white"
            >
              Setează token
            </button>
          </div>
        )}

        {/* ── Stats Row ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
            <div className="text-xs text-gray-400 mb-1">Total PRs</div>
            <div className="text-2xl font-bold text-white">{prs.length}</div>
          </div>
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
            <div className="text-xs text-gray-400 mb-1">⏳ Pending Reward</div>
            <div className="text-2xl font-bold text-yellow-400">${totalPending}</div>
            <div className="text-xs text-gray-500">{pendingPRs.length} PRs</div>
          </div>
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
            <div className="text-xs text-gray-400 mb-1">💰 Total Earned</div>
            <div className="text-2xl font-bold text-green-400">${totalEarned}</div>
            <div className="text-xs text-gray-500">{paidPRs.length} paid</div>
          </div>
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
            <div className="text-xs text-gray-400 mb-1">Status</div>
            <div className={`text-sm font-semibold ${isRunning ? 'text-green-400' : session?.status === 'error' ? 'text-red-400' : 'text-gray-400'}`}>
              {isRunning ? '🟢 Running' : session?.status === 'error' ? '🔴 Error' : '⚫ Idle'}
            </div>
            {session?.currentIssue && isRunning && (
              <div className="text-xs text-gray-500 mt-1 truncate" title={session.currentIssue}>
                {session.currentIssue}
              </div>
            )}
          </div>
        </div>

        {/* ── Control Bar ── */}
        <div className="flex items-center gap-3 flex-wrap">
          {!isRunning ? (
            <button
              onClick={handleStart}
              disabled={starting}
              className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-medium text-sm transition-colors"
            >
              {starting ? (
                <><span className="animate-spin">⟳</span> Starting...</>
              ) : (
                <>▶ Start Hunt</>
              )}
            </button>
          ) : (
            <button
              onClick={handleStop}
              className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-500 rounded-xl font-medium text-sm transition-colors"
            >
              ⏹ Stop
            </button>
          )}

          {skipDangerously && (
            <span className="px-3 py-1 bg-red-900/40 border border-red-500/40 text-red-400 rounded-lg text-xs font-mono">
              ⚡ --dangerously-skip-permissions
            </span>
          )}

          {cronEnabled && (
            <span className="px-3 py-1 bg-purple-900/40 border border-purple-500/40 text-purple-400 rounded-lg text-xs font-mono">
              🕒 cron: {cronExpr}
            </span>
          )}

          <div className="ml-auto flex gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-3 py-1.5 text-sm rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 disabled:opacity-50"
            >
              {refreshing ? '⟳' : '🔄'} Refresh PRs
            </button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
          {/* Tab headers */}
          <div className="flex border-b border-gray-700">
            <button
              onClick={() => setActiveTab('logs')}
              className={`px-5 py-3 text-sm font-medium transition-colors ${activeTab === 'logs' ? 'bg-gray-800 text-white border-b-2 border-purple-500' : 'text-gray-400 hover:text-gray-200'}`}
            >
              📋 Logs {isRunning && <span className="ml-1.5 text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full animate-pulse">live</span>}
            </button>
            <button
              onClick={() => setActiveTab('prs')}
              className={`px-5 py-3 text-sm font-medium transition-colors ${activeTab === 'prs' ? 'bg-gray-800 text-white border-b-2 border-purple-500' : 'text-gray-400 hover:text-gray-200'}`}
            >
              🔀 Submitted PRs
              {prs.length > 0 && (
                <span className="ml-2 text-xs bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded-full">{prs.length}</span>
              )}
            </button>
          </div>

          {/* Logs tab */}
          {activeTab === 'logs' && (
            <div className="relative">
              <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
                <span className="text-xs text-gray-500">{logs.length} entries</span>
                <button onClick={handleClearLogs} className="text-xs text-gray-500 hover:text-gray-300">
                  Clear
                </button>
              </div>
              <div className="h-96 overflow-y-auto font-mono text-xs p-4 space-y-1 bg-gray-950">
                {logs.length === 0 && (
                  <div className="text-gray-600 text-center py-8">
                    No logs yet. Press Start to begin hunting.
                  </div>
                )}
                {logs.map((log, i) => (
                  <div key={i} className={`flex gap-3 ${LOG_LEVEL_COLORS[log.level]}`}>
                    <span className="text-gray-600 shrink-0 select-none">
                      {new Date(log.ts).toLocaleTimeString()}
                    </span>
                    <span className="whitespace-pre-wrap break-all">{log.msg}</span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>
          )}

          {/* PRs tab */}
          {activeTab === 'prs' && (
            <div className="overflow-x-auto">
              {prs.length === 0 ? (
                <div className="text-gray-600 text-center py-12 text-sm">
                  No PRs submitted yet.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-800">
                      <th className="text-left px-4 py-3">Repository / Issue</th>
                      <th className="text-left px-4 py-3">PR</th>
                      <th className="text-left px-4 py-3">Platform</th>
                      <th className="text-right px-4 py-3">Bounty</th>
                      <th className="text-left px-4 py-3">Competition</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-left px-4 py-3">Date</th>
                      <th className="text-left px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prs.map((pr, i) => (
                      <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-200">{pr.repo}</div>
                          <div className="text-xs text-gray-500 truncate max-w-xs" title={pr.issueTitle}>
                            #{pr.issueNumber}: {pr.issueTitle}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <a
                            href={pr.prUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-purple-400 hover:text-purple-300 hover:underline text-xs"
                          >
                            #{pr.prNumber} ↗
                          </a>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${PLATFORM_COLORS[pr.platform]}`}>
                            {pr.platform}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-bold text-green-400">${pr.bountyAmount}</span>
                          <span className="text-gray-500 text-xs ml-1">{pr.currency}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs ${pr.competitorPRs > 5 ? 'text-red-400' : pr.competitorPRs > 2 ? 'text-yellow-400' : 'text-green-400'}`}>
                            {pr.competitorPRs} PRs
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[pr.status]}`}>
                            {STATUS_ICONS[pr.status]} {pr.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {new Date(pr.submittedAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={pr.status}
                            onChange={e => updatePRStatus(pr.prNumber, e.target.value)}
                            className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300"
                          >
                            <option value="submitted">⏳ Submitted</option>
                            <option value="merged">🔀 Merged</option>
                            <option value="paid">💰 Paid</option>
                            <option value="competing">⚔️ Competing</option>
                            <option value="closed">❌ Closed</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {/* ── Current PRs Summary at bottom ── */}
        {prs.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Pending rewards */}
            {pendingPRs.length > 0 && (
              <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4">
                <div className="text-xs text-yellow-500 font-medium mb-2">⏳ Awaiting Reward</div>
                <div className="space-y-1.5">
                  {pendingPRs.slice(0, 5).map((pr, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <a href={pr.prUrl} target="_blank" rel="noopener noreferrer"
                        className="text-gray-300 hover:text-white truncate max-w-[70%]" title={pr.issueTitle}>
                        {pr.repo.split('/')[1]}#{pr.issueNumber}
                      </a>
                      <span className="text-yellow-400 font-medium">${pr.bountyAmount}</span>
                    </div>
                  ))}
                  {pendingPRs.length > 5 && (
                    <div className="text-xs text-gray-500">+{pendingPRs.length - 5} more</div>
                  )}
                </div>
                <div className="mt-3 pt-2 border-t border-yellow-500/20 flex justify-between text-xs">
                  <span className="text-gray-400">Total pending</span>
                  <span className="text-yellow-400 font-bold">${totalPending}</span>
                </div>
              </div>
            )}

            {/* Paid */}
            {paidPRs.length > 0 && (
              <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4">
                <div className="text-xs text-green-500 font-medium mb-2">💰 Paid Out</div>
                <div className="space-y-1.5">
                  {paidPRs.slice(0, 5).map((pr, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-gray-300 truncate max-w-[70%]">{pr.repo.split('/')[1]}#{pr.issueNumber}</span>
                      <span className="text-green-400 font-medium">${pr.bountyAmount}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-2 border-t border-green-500/20 flex justify-between text-xs">
                  <span className="text-gray-400">Total earned</span>
                  <span className="text-green-400 font-bold">${totalEarned}</span>
                </div>
              </div>
            )}

            {/* Closed/Lost */}
            {closedPRs.length > 0 && (
              <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
                <div className="text-xs text-red-400 font-medium mb-2">❌ Closed / Lost</div>
                <div className="space-y-1.5">
                  {closedPRs.slice(0, 5).map((pr, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <a href={pr.prUrl} target="_blank" rel="noopener noreferrer"
                        className="text-gray-500 hover:text-gray-300 truncate max-w-[70%]">
                        {pr.repo.split('/')[1]}#{pr.issueNumber}
                      </a>
                      <span className="text-gray-500">${pr.bountyAmount}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
