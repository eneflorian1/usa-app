'use client';

import { useState, useEffect, useRef } from 'react';
import {
    GitBranch, GitCommit, Plus, Trash2, Download, RefreshCw,
    Play, Cpu, Code2, ChevronRight, Folder, Globe, Lock,
    Terminal, CheckCircle, XCircle, Clock, Send, FolderGit2
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GitRepo {
    _id: string;
    name: string;
    fullName: string;
    githubUrl: string;
    cloneUrl: string;
    description: string;
    isPrivate: boolean;
    language: string;
    localPath: string;
    status: 'remote_only' | 'cloned' | 'clone_error';
    defaultBranch: string;
    lastTask: string;
    updatedAt: string;
    createdAt: string;
}

interface RepoTask {
    _id: string;
    repoId: string;
    repoName: string;
    taskType: 'task' | 'agent' | 'llm_update' | 'commit' | 'pull';
    task: string;
    status: 'running' | 'done' | 'error';
    output: string;
    summary: string;
    createdAt: string;
    completedAt: string | null;
}

interface RepoMetadata {
    source: string;
    name: string;
    localPath?: string;
    currentBranch?: string;
    recentCommits?: string[];
    gitStatus?: string;
    description?: string;
    language?: string;
    stars?: number;
    defaultBranch?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const langColors: Record<string, string> = {
    TypeScript: 'bg-blue-500', JavaScript: 'bg-yellow-400',
    Python: 'bg-green-500', Go: 'bg-cyan-500',
    Rust: 'bg-orange-600', Java: 'bg-red-500',
    CSS: 'bg-purple-500', HTML: 'bg-orange-400',
};

function LangDot({ lang }: { lang: string }) {
    const bg = langColors[lang] || 'bg-gray-400';
    return <span className={`inline-block w-2.5 h-2.5 rounded-full ${bg} mr-1`} />;
}

function StatusBadge({ status }: { status: string }) {
    if (status === 'running') return (
        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
            <span className="animate-pulse">●</span> Running
        </span>
    );
    if (status === 'done' || status === 'cloned') return (
        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
            <CheckCircle size={10} /> Done
        </span>
    );
    if (status === 'error' || status === 'clone_error') return (
        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
            <XCircle size={10} /> Error
        </span>
    );
    return (
        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-400">
            <Globe size={10} /> Remote
        </span>
    );
}

const taskTypeLabel: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    task: { icon: <Play size={12} />, label: 'Task', color: 'text-violet-600 dark:text-violet-400' },
    agent: { icon: <Cpu size={12} />, label: 'Agent', color: 'text-blue-600 dark:text-blue-400' },
    llm_update: { icon: <Code2 size={12} />, label: 'LLM Update', color: 'text-emerald-600 dark:text-emerald-400' },
    commit: { icon: <GitCommit size={12} />, label: 'Commit', color: 'text-amber-600 dark:text-amber-400' },
    pull: { icon: <RefreshCw size={12} />, label: 'Pull', color: 'text-cyan-600 dark:text-cyan-400' },
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AplicatiiGitPage() {
    const [repos, setRepos] = useState<GitRepo[]>([]);
    const [activeRepo, setActiveRepo] = useState<GitRepo | null>(null);
    const [metadata, setMetadata] = useState<RepoMetadata | null>(null);
    const [tasks, setTasks] = useState<RepoTask[]>([]);
    const [activeTask, setActiveTask] = useState<RepoTask | null>(null);
    const [loading, setLoading] = useState(true);
    const [metaLoading, setMetaLoading] = useState(false);
    const pollRef = useRef<NodeJS.Timeout | null>(null);

    // Panels
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showCloneModal, setShowCloneModal] = useState(false);
    const [showCommitModal, setShowCommitModal] = useState(false);

    // Task input
    const [taskText, setTaskText] = useState('');
    const [taskMode, setTaskMode] = useState<'task' | 'agent' | 'llm_update'>('task');
    const [submitting, setSubmitting] = useState(false);

    // Create form
    const [newName, setNewName] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [newPrivate, setNewPrivate] = useState(false);
    const [newLocalPath, setNewLocalPath] = useState('');
    const [createMode, setCreateMode] = useState<'github' | 'local'>('github');
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState('');

    // Clone form
    const [cloneUrl, setCloneUrl] = useState('');
    const [clonePath, setClonePath] = useState('C:\\Users\\Admin\\Documents\\GitHub\\');
    const [cloning, setCloning] = useState(false);

    // Commit form
    const [commitMsg, setCommitMsg] = useState('');
    const [committing, setCommitting] = useState(false);

    useEffect(() => { loadRepos(); }, []);

    // Poll running tasks
    useEffect(() => {
        if (activeTask?.status === 'running') {
            pollRef.current = setInterval(() => pollTask(activeTask._id), 3000);
            return () => { if (pollRef.current) clearInterval(pollRef.current); };
        }
    }, [activeTask?._id, activeTask?.status]);

    async function loadRepos() {
        setLoading(true);
        try {
            const res = await fetch('/api/git-apps/repos');
            const data = await res.json();
            if (Array.isArray(data)) setRepos(data);
        } catch { }
        setLoading(false);
    }

    async function selectRepo(repo: GitRepo) {
        setActiveRepo(repo);
        setActiveTask(null);
        setMetadata(null);
        loadRepoTasks(repo._id);
        loadMetadata(repo._id);
    }

    async function loadMetadata(id: string) {
        setMetaLoading(true);
        try {
            const res = await fetch(`/api/git-apps/repos/${id}/metadata`);
            const data = await res.json();
            setMetadata(data);
        } catch { }
        setMetaLoading(false);
    }

    async function loadRepoTasks(id: string) {
        try {
            const res = await fetch(`/api/git-apps/repos/${id}/tasks`);
            const data = await res.json();
            if (Array.isArray(data)) setTasks(data);
        } catch { }
    }

    async function pollTask(taskId: string) {
        try {
            const res = await fetch(`/api/git-apps/tasks/${taskId}`);
            const data = await res.json();
            if (data._id) {
                setActiveTask(data);
                if (data.status !== 'running') {
                    if (pollRef.current) clearInterval(pollRef.current);
                    if (activeRepo) loadRepoTasks(activeRepo._id);
                }
            }
        } catch { }
    }

    async function submitTask() {
        if (!activeRepo || !taskText.trim() || submitting) return;
        setSubmitting(true);
        try {
            const endpoint = taskMode === 'llm_update'
                ? `/api/git-apps/repos/${activeRepo._id}/update-code`
                : taskMode === 'agent'
                    ? `/api/git-apps/repos/${activeRepo._id}/agent`
                    : `/api/git-apps/repos/${activeRepo._id}/task`;

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task: taskText.trim() })
            });
            const data = await res.json();
            if (data._id) {
                setActiveTask(data);
                setTaskText('');
                loadRepoTasks(activeRepo._id);
            }
        } catch { }
        setSubmitting(false);
    }

    async function handleCreate() {
        if (!newName.trim() || creating) return;
        setCreating(true);
        setCreateError('');
        try {
            const res = await fetch('/api/git-apps/repos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newName.trim(),
                    description: newDesc,
                    isPrivate: newPrivate,
                    localOnly: createMode === 'local',
                    localPath: newLocalPath.trim() || undefined
                })
            });
            const data = await res.json();
            if (data.repo) {
                setShowCreateModal(false);
                setNewName(''); setNewDesc(''); setNewPrivate(false); setNewLocalPath(''); setCreateError('');
                await loadRepos();
                selectRepo(data.repo);
            } else {
                setCreateError(data.error || 'Eroare necunoscută');
            }
        } catch (err: unknown) {
            setCreateError(err instanceof Error ? err.message : 'Eroare de rețea');
        }
        setCreating(false);
    }

    async function handleClone() {
        if (!cloneUrl.trim() || cloning) return;
        setCloning(true);
        const name = cloneUrl.split('/').pop()?.replace('.git', '') || 'repo';
        const fullPath = clonePath.endsWith('\\') || clonePath.endsWith('/')
            ? clonePath + name
            : clonePath;
        try {
            await fetch('/api/git-apps/clone', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cloneUrl: cloneUrl.trim(), localPath: fullPath })
            });
            setShowCloneModal(false);
            setCloneUrl('');
            await loadRepos();
        } catch { }
        setCloning(false);
    }

    async function handleUpdate() {
        if (!activeRepo) return;
        try {
            await fetch(`/api/git-apps/repos/${activeRepo._id}/update`, { method: 'POST' });
            loadMetadata(activeRepo._id);
        } catch { }
    }

    async function handleCommit() {
        if (!activeRepo || !commitMsg.trim() || committing) return;
        setCommitting(true);
        try {
            const res = await fetch(`/api/git-apps/repos/${activeRepo._id}/commit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: commitMsg.trim() })
            });
            const data = await res.json();
            if (data.exitCode === 0 || data.status === 'done') {
                setShowCommitModal(false);
                setCommitMsg('');
                loadMetadata(activeRepo._id);
            }
        } catch { }
        setCommitting(false);
    }

    async function handleDelete(repo: GitRepo) {
        if (!confirm(`Șterge "${repo.name}" din listă? (nu se șterge de pe GitHub)`)) return;
        try {
            await fetch(`/api/git-apps/repos/${repo._id}`, { method: 'DELETE' });
            if (activeRepo?._id === repo._id) { setActiveRepo(null); setMetadata(null); setTasks([]); }
            loadRepos();
        } catch { }
    }

    const fmt = (iso: string) => new Date(iso).toLocaleString('ro-RO', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });

    return (
        <div className="flex flex-col h-full space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white">
                        <FolderGit2 size={20} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Aplicații Git</h1>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Orchestrator de proiecte & cod AI</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowCloneModal(true)}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-700 dark:text-gray-300 rounded-xl transition-colors"
                    >
                        <Download size={14} /> Clone
                    </button>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl transition-colors"
                    >
                        <Plus size={14} /> Repo Nou
                    </button>
                </div>
            </div>

            {/* Main Grid */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 flex-1 min-h-0">

                {/* ── Left: Repo List ── */}
                <div className="md:col-span-3 space-y-2 overflow-y-auto max-h-[80vh]">
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide px-1">
                        Proiecte ({repos.length})
                    </p>
                    {loading ? (
                        <p className="text-sm text-gray-400 px-1">Se încarcă...</p>
                    ) : repos.length === 0 ? (
                        <div className="text-center py-8">
                            <Folder size={32} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                            <p className="text-sm text-gray-400">Niciun proiect</p>
                            <p className="text-xs text-gray-400 mt-1">Creează sau clonează unul</p>
                        </div>
                    ) : repos.map(repo => (
                        <div
                            key={repo._id}
                            onClick={() => selectRepo(repo)}
                            className={`p-3 rounded-xl border cursor-pointer transition-all group ${activeRepo?._id === repo._id
                                ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-600'
                                : 'border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-gray-300 dark:hover:border-zinc-700'
                                }`}
                        >
                            <div className="flex items-start justify-between gap-1">
                                <div className="flex items-center gap-1.5 min-w-0">
                                    {repo.isPrivate ? <Lock size={12} className="text-gray-400 shrink-0" /> : <Globe size={12} className="text-gray-400 shrink-0" />}
                                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{repo.name}</span>
                                </div>
                                <button
                                    onClick={e => { e.stopPropagation(); handleDelete(repo); }}
                                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-gray-400 hover:text-red-500 transition-all"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                            {repo.description && (
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{repo.description}</p>
                            )}
                            <div className="flex items-center gap-2 mt-1.5">
                                {repo.language && (
                                    <span className="flex items-center text-xs text-gray-500 dark:text-gray-400">
                                        <LangDot lang={repo.language} />{repo.language}
                                    </span>
                                )}
                                <StatusBadge status={repo.status} />
                            </div>
                        </div>
                    ))}
                </div>

                {/* ── Middle: Repo Detail + Metadata ── */}
                <div className="md:col-span-5 space-y-4 overflow-y-auto max-h-[80vh]">
                    {!activeRepo ? (
                        <div className="flex flex-col items-center justify-center h-64 text-center">
                            <FolderGit2 size={40} className="text-gray-300 dark:text-gray-600 mb-3" />
                            <p className="text-gray-400">Selectează un proiect din stânga</p>
                        </div>
                    ) : (
                        <>
                            {/* Repo Header */}
                            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 p-4">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h2 className="text-lg font-bold text-gray-900 dark:text-white">{activeRepo.name}</h2>
                                            {activeRepo.isPrivate && <Lock size={14} className="text-gray-400" />}
                                        </div>
                                        {activeRepo.fullName && (
                                            <p className="text-xs text-gray-500 dark:text-gray-400">{activeRepo.fullName}</p>
                                        )}
                                        {activeRepo.description && (
                                            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{activeRepo.description}</p>
                                        )}
                                    </div>
                                    <div className="flex gap-1">
                                        <button
                                            onClick={handleUpdate}
                                            title="Git Pull"
                                            className="p-2 rounded-lg bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-600 dark:text-gray-400 transition-colors"
                                        >
                                            <RefreshCw size={14} />
                                        </button>
                                        <button
                                            onClick={() => setShowCommitModal(true)}
                                            title="Commit"
                                            className="p-2 rounded-lg bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-600 dark:text-gray-400 transition-colors"
                                        >
                                            <GitCommit size={14} />
                                        </button>
                                        {activeRepo.githubUrl && (
                                            <a
                                                href={activeRepo.githubUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="p-2 rounded-lg bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-600 dark:text-gray-400 transition-colors"
                                            >
                                                <Globe size={14} />
                                            </a>
                                        )}
                                    </div>
                                </div>

                                {/* Status row */}
                                <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-gray-100 dark:border-zinc-800">
                                    <StatusBadge status={activeRepo.status} />
                                    {activeRepo.language && (
                                        <span className="flex items-center text-xs text-gray-500 dark:text-gray-400">
                                            <LangDot lang={activeRepo.language} />{activeRepo.language}
                                        </span>
                                    )}
                                    {activeRepo.defaultBranch && (
                                        <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                                            <GitBranch size={11} /> {activeRepo.defaultBranch}
                                        </span>
                                    )}
                                    {activeRepo.localPath && (
                                        <span className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate max-w-xs">
                                            {activeRepo.localPath}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Git Metadata */}
                            {metaLoading ? (
                                <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 p-4">
                                    <p className="text-sm text-gray-400 animate-pulse">Se încarcă metadata...</p>
                                </div>
                            ) : metadata && (
                                <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 p-4 space-y-3">
                                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                                        <Terminal size={14} /> Metadata repo
                                    </h3>

                                    {metadata.currentBranch && (
                                        <div className="flex items-center gap-2">
                                            <GitBranch size={13} className="text-emerald-500" />
                                            <span className="text-sm font-mono text-gray-800 dark:text-gray-200">{metadata.currentBranch}</span>
                                        </div>
                                    )}

                                    {metadata.gitStatus && (
                                        <div>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Git Status</p>
                                            <pre className="text-xs font-mono bg-gray-50 dark:bg-zinc-800 rounded-lg p-2 text-gray-700 dark:text-gray-300 overflow-auto max-h-24 whitespace-pre-wrap">
                                                {metadata.gitStatus || '(clean)'}
                                            </pre>
                                        </div>
                                    )}

                                    {metadata.recentCommits && metadata.recentCommits.length > 0 && (
                                        <div>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Ultimele commit-uri</p>
                                            <div className="space-y-1">
                                                {metadata.recentCommits.slice(0, 6).map((c, i) => (
                                                    <div key={i} className="flex items-start gap-2">
                                                        <GitCommit size={11} className="text-gray-400 mt-0.5 shrink-0" />
                                                        <span className="text-xs font-mono text-gray-600 dark:text-gray-400">{c}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* GitHub stats */}
                                    {metadata.source === 'github' && (
                                        <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-400">
                                            {metadata.language && <span><LangDot lang={metadata.language} />{metadata.language}</span>}
                                            {metadata.stars !== undefined && <span>⭐ {metadata.stars}</span>}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Task History */}
                            {tasks.length > 0 && (
                                <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 p-4 space-y-2">
                                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Istoric task-uri</h3>
                                    {tasks.slice(0, 10).map(t => {
                                        const meta = taskTypeLabel[t.taskType] || taskTypeLabel.task;
                                        return (
                                            <div
                                                key={t._id}
                                                onClick={() => setActiveTask(t)}
                                                className={`flex items-center gap-2 p-2 rounded-xl cursor-pointer transition-colors ${activeTask?._id === t._id
                                                    ? 'bg-emerald-50 dark:bg-emerald-900/20'
                                                    : 'hover:bg-gray-50 dark:hover:bg-zinc-800'
                                                    }`}
                                            >
                                                <span className={meta.color}>{meta.icon}</span>
                                                <span className="flex-1 text-xs text-gray-700 dark:text-gray-300 line-clamp-1">{t.task}</span>
                                                <StatusBadge status={t.status} />
                                                <span className="text-xs text-gray-400">{fmt(t.createdAt)}</span>
                                                <ChevronRight size={12} className="text-gray-400" />
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* ── Right: Task Runner ── */}
                <div className="md:col-span-4 flex flex-col space-y-4">
                    {/* Task Input */}
                    {activeRepo && (
                        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 p-4 space-y-3">
                            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                                <Cpu size={14} /> Orchestrator AI
                            </h3>

                            {/* Mode selector */}
                            <div className="flex gap-1 p-1 bg-gray-100 dark:bg-zinc-800 rounded-xl">
                                {(['task', 'agent', 'llm_update'] as const).map(mode => (
                                    <button
                                        key={mode}
                                        onClick={() => setTaskMode(mode)}
                                        className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors ${taskMode === mode
                                            ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-sm'
                                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                                            }`}
                                    >
                                        {mode === 'task' ? '⚡ Task' : mode === 'agent' ? '🤖 Agent' : '💡 LLM'}
                                    </button>
                                ))}
                            </div>

                            <p className="text-xs text-gray-400 dark:text-gray-500">
                                {taskMode === 'task' && 'Rulează Claude CLI cu task-ul dat pe proiect (commit automat).'}
                                {taskMode === 'agent' && 'Agent autonom: explorează, modifică, testează, commitează.'}
                                {taskMode === 'llm_update' && 'Anthropic API analizează și sugerează modificări de cod.'}
                            </p>

                            <div className="flex gap-2">
                                <textarea
                                    value={taskText}
                                    onChange={e => setTaskText(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) submitTask(); }}
                                    placeholder={`Descrie task-ul pentru ${activeRepo.name}...`}
                                    rows={3}
                                    className="flex-1 resize-none bg-gray-50 dark:bg-zinc-800 text-sm rounded-xl px-3 py-2 border border-gray-200 dark:border-zinc-700 text-gray-900 dark:text-white placeholder-gray-400 outline-none focus:border-emerald-400 dark:focus:border-emerald-600 transition-colors"
                                />
                            </div>
                            <button
                                onClick={submitTask}
                                disabled={!taskText.trim() || submitting}
                                className="w-full flex items-center justify-center gap-2 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-200 dark:disabled:bg-zinc-700 disabled:text-gray-400 text-white text-sm font-medium rounded-xl transition-colors"
                            >
                                <Send size={13} />
                                {submitting ? 'Se procesează...' : 'Execută Task'}
                            </button>
                        </div>
                    )}

                    {/* Active Task Result */}
                    {activeTask && (
                        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 p-4 space-y-3 flex-1 overflow-y-auto max-h-[50vh]">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    {(() => {
                                        const meta = taskTypeLabel[activeTask.taskType] || taskTypeLabel.task;
                                        return <span className={`flex items-center gap-1 text-xs font-medium ${meta.color}`}>{meta.icon}{meta.label}</span>;
                                    })()}
                                    <StatusBadge status={activeTask.status} />
                                </div>
                                <span className="text-xs text-gray-400">
                                    <Clock size={11} className="inline mr-0.5" />
                                    {fmt(activeTask.createdAt)}
                                </span>
                            </div>

                            <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">{activeTask.task}</p>

                            {activeTask.status === 'running' && (
                                <div className="flex items-center gap-2 text-blue-500 text-sm">
                                    <span className="animate-pulse">●</span> Agentul lucrează...
                                </div>
                            )}

                            {activeTask.summary && (
                                <div className={`rounded-xl p-3 text-sm ${activeTask.status === 'error'
                                    ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                                    : 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                                    }`}>
                                    {activeTask.summary}
                                </div>
                            )}

                            {activeTask.output && activeTask.output !== activeTask.summary && (
                                <div>
                                    <p className="text-xs text-gray-400 mb-1">Output complet:</p>
                                    <pre className="text-xs font-mono bg-gray-50 dark:bg-zinc-800 rounded-xl p-3 text-gray-700 dark:text-gray-300 whitespace-pre-wrap overflow-auto max-h-64">
                                        {activeTask.output.substring(0, 8000)}
                                    </pre>
                                </div>
                            )}
                        </div>
                    )}

                    {!activeRepo && (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center">
                                <GitBranch size={40} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                                <p className="text-gray-400 text-sm">Selectează un proiect pentru a rula task-uri AI</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ─── Create Repo Modal ─── */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 p-6 w-full max-w-md space-y-4">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <Plus size={18} className="text-emerald-500" /> Repo Nou
                        </h3>

                        {/* GitHub / Local tabs */}
                        <div className="flex gap-1 p-1 bg-gray-100 dark:bg-zinc-800 rounded-xl">
                            <button
                                type="button"
                                onClick={() => setCreateMode('github')}
                                className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors ${createMode === 'github' ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}
                            >
                                🌐 GitHub
                            </button>
                            <button
                                type="button"
                                onClick={() => setCreateMode('local')}
                                className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors ${createMode === 'local' ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}
                            >
                                💻 Local
                            </button>
                        </div>

                        {createMode === 'github' && (
                            <p className="text-xs text-gray-400">Creează repo pe GitHub (necesită token configurat în Settings)</p>
                        )}
                        {createMode === 'local' && (
                            <p className="text-xs text-gray-400">Înregistrează un proiect local fără GitHub API</p>
                        )}

                        <input
                            type="text"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleCreate()}
                            placeholder="Numele repo-ului"
                            className="w-full bg-gray-50 dark:bg-zinc-800 rounded-xl px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 text-gray-900 dark:text-white outline-none focus:border-emerald-400"
                        />
                        <textarea
                            value={newDesc}
                            onChange={e => setNewDesc(e.target.value)}
                            placeholder="Descriere (opțional)"
                            rows={2}
                            className="w-full resize-none bg-gray-50 dark:bg-zinc-800 rounded-xl px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 text-gray-900 dark:text-white outline-none focus:border-emerald-400"
                        />
                        {createMode === 'local' && (
                            <input
                                type="text"
                                value={newLocalPath}
                                onChange={e => setNewLocalPath(e.target.value)}
                                placeholder="Cale locală (opțional): C:\Users\..."
                                className="w-full bg-gray-50 dark:bg-zinc-800 rounded-xl px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 text-gray-900 dark:text-white outline-none focus:border-emerald-400 font-mono"
                            />
                        )}
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={newPrivate} onChange={e => setNewPrivate(e.target.checked)} className="rounded" />
                            <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1"><Lock size={13} /> Privat</span>
                        </label>

                        {createError && (
                            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2">
                                <p className="text-xs text-red-700 dark:text-red-400">{createError}</p>
                            </div>
                        )}

                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => { setShowCreateModal(false); setCreateError(''); }}
                                className="flex-1 py-2 text-sm rounded-xl border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-800"
                            >Anulează</button>
                            <button
                                type="button"
                                onClick={handleCreate}
                                disabled={!newName.trim() || creating}
                                className="flex-1 py-2 text-sm rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-200 dark:disabled:bg-zinc-700 disabled:text-gray-400 text-white font-medium transition-colors"
                            >{creating ? 'Se creează...' : 'Creează'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Clone Modal ─── */}
            {showCloneModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 p-6 w-full max-w-md space-y-4">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <Download size={18} className="text-blue-500" /> Clone Repo
                        </h3>
                        <input
                            type="text"
                            value={cloneUrl}
                            onChange={e => setCloneUrl(e.target.value)}
                            placeholder="https://github.com/user/repo.git"
                            className="w-full bg-gray-50 dark:bg-zinc-800 rounded-xl px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 text-gray-900 dark:text-white outline-none focus:border-blue-400 font-mono"
                        />
                        <input
                            type="text"
                            value={clonePath}
                            onChange={e => setClonePath(e.target.value)}
                            placeholder="C:\Users\Admin\Documents\GitHub\"
                            className="w-full bg-gray-50 dark:bg-zinc-800 rounded-xl px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 text-gray-900 dark:text-white outline-none focus:border-blue-400 font-mono"
                        />
                        <p className="text-xs text-gray-400">Calea pe PC-ul local unde se va clona repo-ul</p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowCloneModal(false)}
                                className="flex-1 py-2 text-sm rounded-xl border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-800"
                            >Anulează</button>
                            <button
                                onClick={handleClone}
                                disabled={!cloneUrl.trim() || cloning}
                                className="flex-1 py-2 text-sm rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-gray-200 dark:disabled:bg-zinc-700 text-white font-medium"
                            >{cloning ? 'Se clonează...' : 'Clone'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Commit Modal ─── */}
            {showCommitModal && activeRepo && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 p-6 w-full max-w-md space-y-4">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <GitCommit size={18} className="text-amber-500" /> Commit Changes
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{activeRepo.name}</p>
                        <input
                            type="text"
                            value={commitMsg}
                            onChange={e => setCommitMsg(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleCommit()}
                            placeholder="feat: descriere modificare"
                            className="w-full bg-gray-50 dark:bg-zinc-800 rounded-xl px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 text-gray-900 dark:text-white outline-none focus:border-amber-400 font-mono"
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowCommitModal(false)}
                                className="flex-1 py-2 text-sm rounded-xl border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-800"
                            >Anulează</button>
                            <button
                                onClick={handleCommit}
                                disabled={!commitMsg.trim() || committing}
                                className="flex-1 py-2 text-sm rounded-xl bg-amber-500 hover:bg-amber-400 disabled:bg-gray-200 dark:disabled:bg-zinc-700 text-white font-medium"
                            >{committing ? 'Se commitează...' : 'Commit'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
