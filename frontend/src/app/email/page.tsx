'use client';

import { useState, useEffect, useCallback } from 'react';
import { Mail, Plus, Send, Inbox, RefreshCw, Trash2, ArrowLeft, ChevronRight, Key, AlertCircle } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API || 'http://localhost:5000';

interface EmailInbox {
  inboxId: string;
  email: string;
  displayName: string;
  createdAt: string;
}

interface EmailMessage {
  messageId: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  date: string;
  labels: string[];
}

type View = 'inboxes' | 'messages' | 'compose' | 'read' | 'setup';

export default function EmailPage() {
  const [view, setView] = useState<View>('inboxes');
  const [inboxes, setInboxes] = useState<EmailInbox[]>([]);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [selectedInbox, setSelectedInbox] = useState<EmailInbox | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [apiKeySet, setApiKeySet] = useState(false);

  // Compose form
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');

  // API key form
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyMasked, setApiKeyMasked] = useState('');

  // Create inbox form
  const [newInboxName, setNewInboxName] = useState('');
  const [showCreateInbox, setShowCreateInbox] = useState(false);

  const checkApiKey = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/settings/agentmail`);
      const data = await res.json();
      setApiKeySet(!!data.apiKey);
      setApiKeyMasked(data.apiKey || '');
      if (!data.apiKey) setView('setup');
    } catch { setApiKeySet(false); setView('setup'); }
  }, []);

  const loadInboxes = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/email/inboxes`);
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to load inboxes');
      const data = await res.json();
      setInboxes(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load';
      setError(message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { checkApiKey(); }, [checkApiKey]);
  useEffect(() => { if (apiKeySet && view === 'inboxes') loadInboxes(); }, [apiKeySet, view, loadInboxes]);

  const saveApiKey = async () => {
    if (!apiKeyInput.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/settings/agentmail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKeyInput.trim() })
      });
      if (!res.ok) throw new Error('Failed to save');
      setApiKeySet(true);
      setApiKeyInput('');
      setView('inboxes');
      await checkApiKey();
    } catch { setError('Failed to save API key'); }
    finally { setLoading(false); }
  };

  const createInbox = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/email/inboxes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: newInboxName || 'AI Agent' })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      setNewInboxName('');
      setShowCreateInbox(false);
      await loadInboxes();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed';
      setError(message);
    } finally { setLoading(false); }
  };

  const deleteInbox = async (inboxId: string) => {
    if (!confirm('Delete this inbox permanently?')) return;
    try {
      await fetch(`${API}/api/email/inboxes/${inboxId}`, { method: 'DELETE' });
      await loadInboxes();
      if (selectedInbox?.inboxId === inboxId) { setSelectedInbox(null); setView('inboxes'); }
    } catch { setError('Failed to delete inbox'); }
  };

  const openInbox = async (inbox: EmailInbox) => {
    setSelectedInbox(inbox);
    setView('messages');
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/email/inboxes/${inbox.inboxId}/messages`);
      if (!res.ok) throw new Error('Failed to load messages');
      const data = await res.json();
      setMessages(data.messages || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed';
      setError(message);
    } finally { setLoading(false); }
  };

  const sendEmail = async () => {
    if (!selectedInbox || !composeTo.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/email/inboxes/${selectedInbox.inboxId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: composeTo, subject: composeSubject, text: composeBody })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to send');
      setComposeTo('');
      setComposeSubject('');
      setComposeBody('');
      setView('messages');
      await openInbox(selectedInbox);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed';
      setError(message);
    } finally { setLoading(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 md:ml-64 pb-24 md:pb-8">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border-b border-gray-200 dark:border-zinc-800">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {view !== 'inboxes' && view !== 'setup' && (
              <button onClick={() => {
                if (view === 'read') { setView('messages'); setSelectedMessage(null); }
                else if (view === 'compose') setView('messages');
                else { setView('inboxes'); setSelectedInbox(null); }
              }} className="p-2 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl transition-colors">
                <ArrowLeft size={20} />
              </button>
            )}
            <Mail className="text-indigo-500" size={24} />
            <h1 className="text-xl font-bold">
              {view === 'setup' ? 'Email Setup' :
               view === 'inboxes' ? 'Email Inboxes' :
               view === 'compose' ? 'New Email' :
               view === 'read' ? selectedMessage?.subject || 'Email' :
               selectedInbox?.email || 'Messages'}
            </h1>
          </div>
          <div className="flex gap-2">
            {view === 'inboxes' && apiKeySet && (
              <>
                <button onClick={() => setShowCreateInbox(true)} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors text-sm font-medium">
                  <Plus size={16} /> New Inbox
                </button>
                <button onClick={loadInboxes} className="p-2 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl transition-colors" title="Refresh">
                  <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                </button>
              </>
            )}
            {view === 'messages' && (
              <button onClick={() => setView('compose')} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors text-sm font-medium">
                <Send size={16} /> Compose
              </button>
            )}
            <button onClick={() => setView('setup')} className="p-2 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl transition-colors" title="API Key Settings">
              <Key size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 text-sm">
            <AlertCircle size={16} /> {error}
            <button onClick={() => setError('')} className="ml-auto text-red-500 hover:text-red-700">✕</button>
          </div>
        )}

        {/* Setup View */}
        {view === 'setup' && (
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 p-8 max-w-lg mx-auto">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Mail className="text-indigo-500" size={32} />
              </div>
              <h2 className="text-2xl font-bold mb-2">AgentMail Setup</h2>
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                Get your API key from <a href="https://console.agentmail.to/" target="_blank" rel="noopener noreferrer" className="text-indigo-500 underline">console.agentmail.to</a>
              </p>
            </div>
            {apiKeyMasked && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 p-3 bg-gray-50 dark:bg-zinc-800 rounded-xl">
                Current key: <code className="font-mono">{apiKeyMasked}</code>
              </p>
            )}
            <input
              type="password"
              value={apiKeyInput}
              onChange={e => setApiKeyInput(e.target.value)}
              placeholder="am_..."
              className="w-full px-4 py-3 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button onClick={saveApiKey} disabled={loading || !apiKeyInput.trim()} className="w-full px-4 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
              {loading ? 'Saving...' : 'Save API Key'}
            </button>
            {apiKeySet && (
              <button onClick={() => setView('inboxes')} className="w-full mt-3 px-4 py-3 bg-gray-100 dark:bg-zinc-800 rounded-xl hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors text-sm">
                ← Back to Inboxes
              </button>
            )}
          </div>
        )}

        {/* Create Inbox Modal */}
        {showCreateInbox && (
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 p-6">
            <h3 className="font-semibold mb-3">Create New Inbox</h3>
            <input
              type="text"
              value={newInboxName}
              onChange={e => setNewInboxName(e.target.value)}
              placeholder="Display name (e.g. AI Secretary)"
              className="w-full px-4 py-3 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex gap-2">
              <button onClick={createInbox} disabled={loading} className="px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium">
                {loading ? 'Creating...' : 'Create'}
              </button>
              <button onClick={() => setShowCreateInbox(false)} className="px-4 py-2 bg-gray-100 dark:bg-zinc-800 rounded-xl hover:bg-gray-200 dark:hover:bg-zinc-700 text-sm">Cancel</button>
            </div>
          </div>
        )}

        {/* Inboxes List */}
        {view === 'inboxes' && apiKeySet && (
          <div className="space-y-2">
            {loading && inboxes.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <RefreshCw className="animate-spin mx-auto mb-3" size={24} />
                Loading inboxes...
              </div>
            )}
            {!loading && inboxes.length === 0 && (
              <div className="text-center py-16">
                <Inbox className="mx-auto mb-4 text-gray-300 dark:text-gray-600" size={48} />
                <p className="text-gray-500 dark:text-gray-400 mb-4">No inboxes yet</p>
                <button onClick={() => setShowCreateInbox(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 text-sm font-medium">
                  Create your first inbox
                </button>
              </div>
            )}
            {inboxes.map(inbox => (
              <div key={inbox.inboxId} className="flex items-center justify-between bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-4 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors cursor-pointer group"
                onClick={() => openInbox(inbox)}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center">
                    <Mail className="text-indigo-500" size={18} />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{inbox.displayName || 'Agent Inbox'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">{inbox.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={(e) => { e.stopPropagation(); deleteInbox(inbox.inboxId); }} className="p-2 opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all text-red-500" title="Delete">
                    <Trash2 size={16} />
                  </button>
                  <ChevronRight size={18} className="text-gray-400" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Messages List */}
        {view === 'messages' && (
          <div className="space-y-2">
            {loading && messages.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <RefreshCw className="animate-spin mx-auto mb-3" size={24} />
                Loading messages...
              </div>
            )}
            {!loading && messages.length === 0 && (
              <div className="text-center py-16">
                <Mail className="mx-auto mb-4 text-gray-300 dark:text-gray-600" size={48} />
                <p className="text-gray-500 dark:text-gray-400">No messages yet</p>
              </div>
            )}
            {messages.map(msg => (
              <div key={msg.messageId} onClick={() => { setSelectedMessage(msg); setView('read'); }}
                className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-4 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors cursor-pointer">
                <div className="flex justify-between items-start mb-1">
                  <p className="font-medium text-sm truncate flex-1">{msg.subject}</p>
                  <span className="text-xs text-gray-400 ml-2 whitespace-nowrap">{msg.date ? new Date(msg.date).toLocaleDateString() : ''}</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">From: {msg.from}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{msg.text?.substring(0, 120)}</p>
              </div>
            ))}
          </div>
        )}

        {/* Read Message */}
        {view === 'read' && selectedMessage && (
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6">
            <h2 className="text-lg font-bold mb-3">{selectedMessage.subject}</h2>
            <div className="space-y-1 mb-4 text-sm text-gray-500 dark:text-gray-400">
              <p><span className="font-medium text-gray-700 dark:text-gray-300">From:</span> {selectedMessage.from}</p>
              <p><span className="font-medium text-gray-700 dark:text-gray-300">To:</span> {selectedMessage.to}</p>
              <p><span className="font-medium text-gray-700 dark:text-gray-300">Date:</span> {selectedMessage.date ? new Date(selectedMessage.date).toLocaleString() : 'N/A'}</p>
            </div>
            <hr className="border-gray-200 dark:border-zinc-700 mb-4" />
            {selectedMessage.html ? (
              <div className="prose dark:prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: selectedMessage.html }} />
            ) : (
              <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 font-sans">{selectedMessage.text}</pre>
            )}
          </div>
        )}

        {/* Compose */}
        {view === 'compose' && (
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 space-y-4">
            <div className="text-xs text-gray-400 mb-2">
              From: <span className="font-mono">{selectedInbox?.email}</span>
            </div>
            <input
              type="email"
              value={composeTo}
              onChange={e => setComposeTo(e.target.value)}
              placeholder="To: recipient@example.com"
              className="w-full px-4 py-3 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="text"
              value={composeSubject}
              onChange={e => setComposeSubject(e.target.value)}
              placeholder="Subject"
              className="w-full px-4 py-3 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <textarea
              value={composeBody}
              onChange={e => setComposeBody(e.target.value)}
              placeholder="Write your email..."
              rows={10}
              className="w-full px-4 py-3 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
            <button onClick={sendEmail} disabled={loading || !composeTo.trim()} className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
              <Send size={16} /> {loading ? 'Sending...' : 'Send Email'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
