'use client';

import { useState, useEffect } from 'react';

export default function SettingsPage() {
  // API Key state
  const [apiKey, setApiKey] = useState('');
  const [displayKey, setDisplayKey] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState('');
  const [isApiLoading, setIsApiLoading] = useState(true);

  // Agent Settings state
  const [isActive, setIsActive] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [agentStatus, setAgentStatus] = useState('');
  const [isAgentLoading, setIsAgentLoading] = useState(true);

  useEffect(() => {
    // Fetch API Key
    fetch('/api/settings/gemini')
      .then(res => res.json())
      .then(data => {
        if (data.apiKey) {
          setDisplayKey(data.apiKey);
        }
        setIsApiLoading(false);
      })
      .catch(err => {
        console.error(err);
        setIsApiLoading(false);
      });

    // Fetch Agent Config
    fetch('/api/agent/config')
      .then(res => res.json())
      .then(data => {
        setIsActive(data.isActive ?? true);
        setSystemPrompt(data.systemPrompt || '');
        setIsAgentLoading(false);
      })
      .catch(err => {
        console.error('Failed to load agent config:', err);
        setIsAgentLoading(false);
      });
  }, []);

  const handleApiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey) return;

    setApiStatus('Saving...');
    try {
      const res = await fetch('/api/settings/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });

      if (res.ok) {
        setApiStatus('Saved successfully!');
        setApiKey('');
        // Refresh display key
        const refreshRes = await fetch('/api/settings/gemini');
        const refreshData = await refreshRes.json();
        if (refreshData.apiKey) {
          setDisplayKey(refreshData.apiKey);
        }
        setTimeout(() => setApiStatus(''), 3000);
      } else {
        setApiStatus('Error saving API Key');
      }
    } catch (err) {
      console.error(err);
      setApiStatus('Error saving API Key');
    }
  };

  const handleAgentSave = async () => {
    setAgentStatus('Saving...');
    try {
      const res = await fetch('/api/agent/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive, systemPrompt })
      });
      if (res.ok) {
        setAgentStatus('Saved successfully!');
        setTimeout(() => setAgentStatus(''), 3000);
      } else {
        setAgentStatus('Error saving config.');
      }
    } catch (err) {
      console.error(err);
      setAgentStatus('Error saving config.');
    }
  };

  return (
    <div className="h-full flex flex-col space-y-6 max-w-2xl mx-auto pb-10">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Settings</h1>

      {/* API Key Configuration */}
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
            <input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIzaSy..."
              className="w-full p-3 rounded-xl border border-gray-300 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={!apiKey || apiStatus === 'Saving...'}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition-colors"
          >
            {apiStatus === 'Saving...' ? 'Saving...' : 'Save API Key'}
          </button>

          {apiStatus && apiStatus !== 'Saving...' && (
            <p className={`text-sm text-center font-medium ${apiStatus.includes('Error') ? 'text-red-500' : 'text-green-500'}`}>
              {apiStatus}
            </p>
          )}
        </form>
      </div>

      {/* AI Agent Settings */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm space-y-6">
        <h2 className="text-lg font-semibold border-b border-gray-100 dark:border-zinc-800 pb-3">AI Agent Settings</h2>

        {/* Status Toggle */}
        <div className="flex flex-col text-gray-700 dark:text-gray-300">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-4">
              <div className="relative">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${isActive ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-gray-100 dark:bg-zinc-800 text-gray-400'}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                </div>
                <div className={`absolute bottom-0 right-0 w-4 h-4 border-2 border-white dark:border-zinc-900 rounded-full transition-colors ${isActive ? 'bg-green-500' : 'bg-gray-400'}`}></div>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Auto-Reply Agent</h3>
                <p className={`font-medium text-sm transition-colors ${isActive ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}`}>
                  {isActive ? 'Active & Listening' : 'Paused'}
                </p>
              </div>
            </div>

            <button
              onClick={() => setIsActive(!isActive)}
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${isActive ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${isActive ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>

        {/* Persona Configuration */}
        <div className="flex flex-col">
          <h3 className="font-semibold text-md mb-2">Agent Persona & Memory (System Prompt)</h3>

          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Instruct the AI on how to behave, what tone to use, and give it "thinking capabilities".
            The agent automatically remembers the last 20 messages with each contact to maintain context.
          </p>

          {isAgentLoading ? (
            <div className="animate-pulse bg-gray-200 dark:bg-zinc-800 h-32 rounded-xl mb-4" />
          ) : (
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full p-4 rounded-xl border border-gray-300 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none transition-all min-h-[160px] text-sm mb-4"
              placeholder="e.g., You are Alex's personal assistant. Be highly analytical, think step-by-step before answering, and always be polite."
            />
          )}

          <div className="flex items-center justify-between mt-4">
            <button
              onClick={async () => {
                if (window.confirm('Are you sure you want to clear the agent memory? This will delete all conversation context.')) {
                  setAgentStatus('Clearing memory...');
                  try {
                    const res = await fetch('/api/agent/memory/clear', { method: 'POST' });
                    if (res.ok) {
                      setAgentStatus('Memory cleared successfully!');
                    } else {
                      setAgentStatus('Failed to clear memory.');
                    }
                  } catch (e) {
                    setAgentStatus('Failed to clear memory.');
                  }
                  setTimeout(() => setAgentStatus(''), 3000);
                }
              }}
              className="text-red-500 hover:text-red-600 font-medium text-sm transition-colors px-2 py-1"
            >
              Clear Agent Memory
            </button>

            <div className="flex items-center space-x-4">
              <span className={`text-sm font-medium ${agentStatus.includes('Error') || agentStatus.includes('Failed') ? 'text-red-500' : 'text-green-500'}`}>
                {agentStatus}
              </span>
              <button
                onClick={handleAgentSave}
                disabled={isAgentLoading || agentStatus === 'Saving...' || agentStatus === 'Clearing memory...'}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2 px-6 rounded-lg transition-colors"
              >
                Save Configuration
              </button>
            </div>
          </div>
        </div>

        {/* Knowledge Base Section */}
        <KnowledgeBaseSection />
      </div>
    </div>
  );
}

function KnowledgeBaseSection() {
  interface KBEntry {
    _id: string;
    category: string;
    key: string;
    value: string;
    tags: string[];
    availableTo: string;
    source: string;
  }

  const [entries, setEntries] = useState<KBEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ category: '', key: '', value: '', availableTo: 'all', tags: '' });
  const [status, setStatus] = useState('');

  useEffect(() => { loadEntries(); }, []);

  const loadEntries = async () => {
    try {
      const res = await fetch('/api/knowledge');
      const data = await res.json();
      if (Array.isArray(data)) setEntries(data);
    } catch { }
    setLoading(false);
  };

  const handleSave = async () => {
    if (!form.category || !form.key || !form.value) {
      setStatus('Category, key, and value are required');
      return;
    }
    setStatus('Saving...');
    const body = {
      ...form,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean)
    };
    try {
      if (editId) {
        await fetch(`/api/knowledge/${editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        await fetch('/api/knowledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      setForm({ category: '', key: '', value: '', availableTo: 'all', tags: '' });
      setEditId(null);
      setShowForm(false);
      setStatus('Saved!');
      loadEntries();
    } catch {
      setStatus('Error saving');
    }
  };

  const handleEdit = (entry: KBEntry) => {
    setForm({
      category: entry.category,
      key: entry.key,
      value: entry.value,
      availableTo: entry.availableTo,
      tags: entry.tags.join(', ')
    });
    setEditId(entry._id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this entry?')) return;
    await fetch(`/api/knowledge/${id}`, { method: 'DELETE' });
    loadEntries();
  };

  const grouped = entries.reduce<Record<string, KBEntry[]>>((acc, e) => {
    (acc[e.category] = acc[e.category] || []).push(e);
    return acc;
  }, {});

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-lg border border-gray-200 dark:border-zinc-800 overflow-hidden">
      <div className="px-4 md:px-6 py-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">📚 Knowledge Base</h2>
          <p className="text-xs text-gray-500 mt-0.5">{entries.length} entries — RAG for all agents</p>
        </div>
        <button onClick={() => { setShowForm(!showForm); setEditId(null); setForm({ category: '', key: '', value: '', availableTo: 'all', tags: '' }); }}
          className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors">
          {showForm ? 'Cancel' : '+ Add Entry'}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="px-4 md:px-6 py-4 border-b border-gray-100 dark:border-zinc-800 space-y-3 bg-gray-50 dark:bg-zinc-800/30">
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Category (e.g. Prețuri, Servicii)" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            <input placeholder="Key (e.g. Cameră Single)" value={form.key} onChange={e => setForm({ ...form, key: e.target.value })}
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <textarea placeholder="Value (e.g. 250 RON/noapte, mic dejun inclus)" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} rows={2}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Tags (comma separated)" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })}
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            <select value={form.availableTo} onChange={e => setForm({ ...form, availableTo: e.target.value })}
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm outline-none focus:ring-2 focus:ring-blue-500">
              <option value="all">All agents</option>
              <option value="orchestrator">Orchestrator only</option>
              <option value="booking">Booking only</option>
              <option value="planner">Planner only</option>
            </select>
          </div>
          <div className="flex items-center justify-between">
            {status && <p className="text-xs text-gray-500">{status}</p>}
            <button onClick={handleSave} className="ml-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors">
              {editId ? 'Update' : 'Save Entry'}
            </button>
          </div>
        </div>
      )}

      {/* Entries */}
      <div className="px-4 md:px-6 py-4">
        {loading ? (
          <div className="flex justify-center py-4"><div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" /></div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">No entries yet. Add knowledge for your AI agents.</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([category, items]) => (
              <div key={category}>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{category}</h3>
                <div className="space-y-1.5">
                  {items.map(entry => (
                    <div key={entry._id} className="flex items-start justify-between bg-gray-50 dark:bg-zinc-800/50 rounded-lg p-2.5 group">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{entry.key}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{entry.value}</p>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button onClick={() => handleEdit(entry)} className="text-gray-400 hover:text-blue-500 p-1" title="Edit">
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                        </button>
                        <button onClick={() => handleDelete(entry._id)} className="text-gray-400 hover:text-red-500 p-1" title="Delete">
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
