'use client';

import { useState, useEffect, useCallback } from 'react';
import { Mail, Plus, Send, RefreshCw, Trash2, ArrowLeft, Key, AlertCircle, Check, ChevronDown, Bot, Power, MessageSquare, Settings2, Link, Package, ExternalLink } from 'lucide-react';

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

interface AgentConfig {
  inboxId: string;
  enabled: boolean;
  persona: string;
  maxRepliesPerThread: number;
  pollingInterval: number;
  isPolling: boolean;
}

interface EmailThread {
  _id: string;
  threadKey: string;
  senderEmail: string;
  subject: string;
  messages: { role: string; content: string; timestamp: string }[];
  replyCount: number;
  status: string;
  lastReplyAt: string;
  createdAt: string;
}

interface ProductResume {
  _id: string;
  url: string;
  title: string;
  type: string;
  price: string | null;
  currency: string | null;
  seller: string | null;
  description: string;
  keyFeatures: string[];
  negotiationNotes: string;
  category: string;
  location: string | null;
  condition: string | null;
}

type View = 'inbox' | 'compose' | 'read' | 'thread';
type Tab = 'messages' | 'agent' | 'products';

export default function EmailPage() {
  const [view, setView] = useState<View>('inbox');
  const [tab, setTab] = useState<Tab>('messages');
  const [inboxes, setInboxes] = useState<EmailInbox[]>([]);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [selectedInbox, setSelectedInbox] = useState<EmailInbox | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null);
  const [selectedThread, setSelectedThread] = useState<EmailThread | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [apiKeySet, setApiKeySet] = useState(false);
  const [showInboxDropdown, setShowInboxDropdown] = useState(false);

  // Compose
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');

  // API key
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyMasked, setApiKeyMasked] = useState('');
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);
  const [apiKeySaved, setApiKeySaved] = useState(false);

  // New inbox
  const [newInboxName, setNewInboxName] = useState('');
  const [showCreateInbox, setShowCreateInbox] = useState(false);

  // Agent
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [agentPersona, setAgentPersona] = useState('');
  const [agentMaxReplies, setAgentMaxReplies] = useState(10);
  const [agentThreads, setAgentThreads] = useState<EmailThread[]>([]);
  const [agentSaving, setAgentSaving] = useState(false);

  // Products
  const [products, setProducts] = useState<ProductResume[]>([]);
  const [productUrl, setProductUrl] = useState('');
  const [processingUrl, setProcessingUrl] = useState(false);

  // Hidden messages (persisted in localStorage since AgentMail doesn't support delete)
  const [hiddenMessageIds, setHiddenMessageIds] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      try { return new Set(JSON.parse(localStorage.getItem('hiddenEmailMsgIds') || '[]')); } catch { return new Set(); }
    }
    return new Set();
  });
  const hideMessage = (id: string) => {
    setHiddenMessageIds(prev => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem('hiddenEmailMsgIds', JSON.stringify([...next]));
      return next;
    });
    setMessages(prev => prev.filter(m => m.messageId !== id));
  };

  const checkApiKey = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/agentmail');
      const data = await res.json();
      setApiKeySet(!!data.apiKey);
      setApiKeyMasked(data.apiKey || '');
      if (!data.apiKey) setShowApiKeyForm(true);
    } catch { setApiKeySet(false); setShowApiKeyForm(true); }
  }, []);

  const loadMessages = useCallback(async (inbox: EmailInbox) => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/email/inboxes/${inbox.inboxId}/messages`);
      if (!res.ok) throw new Error('Failed to load messages');
      const data = await res.json();
      // Filter out hidden messages
      const hidden = (() => { try { return new Set(JSON.parse(localStorage.getItem('hiddenEmailMsgIds') || '[]')); } catch { return new Set(); } })();
      setMessages((data.messages || []).filter((m: EmailMessage) => !hidden.has(m.messageId)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }, []);

  const loadInboxes = useCallback(async () => {
    if (!apiKeySet) return;
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/email/inboxes');
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      const data = await res.json();
      setInboxes(data);
      if (data.length > 0) {
        const inbox = selectedInbox ? data.find((i: EmailInbox) => i.inboxId === selectedInbox.inboxId) || data[0] : data[0];
        setSelectedInbox(inbox);
        await loadMessages(inbox);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }, [apiKeySet, selectedInbox, loadMessages]);

  const loadAgentConfig = useCallback(async (inboxId: string) => {
    try {
      const res = await fetch(`/api/email/agent/config/${inboxId}`);
      const data = await res.json();
      setAgentConfig(data);
      setAgentPersona(data.persona || '');
      setAgentMaxReplies(data.maxRepliesPerThread || 10);
    } catch { /* ignore */ }
  }, []);

  const loadAgentThreads = useCallback(async (inboxId: string) => {
    try {
      const res = await fetch(`/api/email/agent/threads/${inboxId}`);
      const data = await res.json();
      setAgentThreads(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { checkApiKey(); }, [checkApiKey]);
  useEffect(() => { if (apiKeySet) loadInboxes(); }, [apiKeySet]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadProducts = useCallback(async () => {
    try {
      const res = await fetch('/api/email/products');
      const data = await res.json();
      setProducts(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (selectedInbox && tab === 'agent') {
      loadAgentConfig(selectedInbox.inboxId);
      loadAgentThreads(selectedInbox.inboxId);
    }
    if (tab === 'products') loadProducts();
  }, [selectedInbox, tab, loadAgentConfig, loadAgentThreads, loadProducts]);

  const saveApiKey = async () => {
    if (!apiKeyInput.trim()) return;
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/settings/agentmail', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKeyInput.trim() })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      setApiKeySet(true); setApiKeyInput('');
      setApiKeySaved(true); setTimeout(() => setApiKeySaved(false), 3000);
      await checkApiKey();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setLoading(false); }
  };

  const createInbox = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/email/inboxes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: newInboxName || 'AI Agent' })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      setNewInboxName(''); setShowCreateInbox(false);
      await loadInboxes();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  };

  const deleteInbox = async (inboxId: string) => {
    if (!confirm('Delete this inbox permanently?')) return;
    try {
      await fetch(`/api/email/inboxes/${inboxId}`, { method: 'DELETE' });
      if (selectedInbox?.inboxId === inboxId) setSelectedInbox(null);
      await loadInboxes();
    } catch { setError('Failed to delete'); }
  };

  const switchInbox = async (inbox: EmailInbox) => {
    setSelectedInbox(inbox);
    setShowInboxDropdown(false);
    await loadMessages(inbox);
    if (tab === 'agent') {
      loadAgentConfig(inbox.inboxId);
      loadAgentThreads(inbox.inboxId);
    }
  };

  const sendEmail = async () => {
    if (!selectedInbox || !composeTo.trim()) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/email/inboxes/${selectedInbox.inboxId}/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: composeTo, subject: composeSubject, text: composeBody })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      setComposeTo(''); setComposeSubject(''); setComposeBody('');
      setView('inbox');
      await loadMessages(selectedInbox);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  };

  const toggleAgent = async () => {
    if (!selectedInbox) return;
    const action = agentConfig?.enabled ? 'stop' : 'start';
    try {
      await fetch(`/api/email/agent/${action}/${selectedInbox.inboxId}`, { method: 'POST' });
      await loadAgentConfig(selectedInbox.inboxId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const saveAgentConfig = async () => {
    if (!selectedInbox) return;
    setAgentSaving(true);
    try {
      await fetch(`/api/email/agent/config/${selectedInbox.inboxId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona: agentPersona, maxRepliesPerThread: agentMaxReplies })
      });
      await loadAgentConfig(selectedInbox.inboxId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally { setAgentSaving(false); }
  };

  const processUrl = async () => {
    if (!productUrl.trim()) return;
    setProcessingUrl(true); setError('');
    try {
      const res = await fetch('/api/email/products/process', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: productUrl.trim(), inboxId: selectedInbox?.inboxId })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      setProductUrl('');
      await loadProducts();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to process URL');
    } finally { setProcessingUrl(false); }
  };

  const deleteProduct = async (id: string) => {
    try {
      await fetch(`/api/email/products/${id}`, { method: 'DELETE' });
      await loadProducts();
    } catch { setError('Failed to delete'); }
  };

  const getInitials = (inbox: EmailInbox | null) => {
    if (!inbox) return '?';
    return (inbox.displayName || inbox.email).charAt(0).toUpperCase();
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 md:ml-64 pb-24 md:pb-8">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border-b border-gray-200 dark:border-zinc-800">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {(view === 'compose' || view === 'read' || view === 'thread') && (
              <button onClick={() => { setView('inbox'); setSelectedMessage(null); setSelectedThread(null); }}
                className="p-2 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl transition-colors">
                <ArrowLeft size={20} />
              </button>
            )}

            {selectedInbox && view === 'inbox' ? (
              <div className="relative">
                <button onClick={() => setShowInboxDropdown(!showInboxDropdown)}
                  className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl transition-colors">
                  <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0">
                    {getInitials(selectedInbox)}
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-semibold leading-tight">{selectedInbox.displayName || 'Agent'}</p>
                    <p className="text-[11px] text-gray-400 font-mono leading-tight">{selectedInbox.email}</p>
                  </div>
                  <ChevronDown size={14} className="text-gray-400" />
                </button>
                {showInboxDropdown && (
                  <div className="absolute top-full left-0 mt-1 w-72 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-xl z-50 overflow-hidden">
                    {inboxes.map(inbox => (
                      <div key={inbox.inboxId}
                        className={`flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-zinc-800 cursor-pointer ${inbox.inboxId === selectedInbox?.inboxId ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}`}
                        onClick={() => switchInbox(inbox)}>
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
                            {(inbox.displayName || inbox.email).charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{inbox.displayName || 'Agent'}</p>
                            <p className="text-[11px] text-gray-400 font-mono">{inbox.email}</p>
                          </div>
                        </div>
                        <button onClick={e => { e.stopPropagation(); deleteInbox(inbox.inboxId); }}
                          className="p-1 opacity-0 hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-red-400">
                          <Trash2 size={13} /></button>
                      </div>
                    ))}
                    <div className="border-t border-gray-100 dark:border-zinc-700">
                      <button onClick={() => { setShowCreateInbox(true); setShowInboxDropdown(false); }}
                        className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-indigo-600 dark:text-indigo-400 hover:bg-gray-50 dark:hover:bg-zinc-800">
                        <Plus size={14} /> Create new inbox
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Mail className="text-indigo-500" size={22} />
                <h1 className="text-lg font-bold">
                  {view === 'compose' ? 'New Email' : view === 'read' ? (selectedMessage?.subject || 'Email') : view === 'thread' ? (selectedThread?.subject || 'Thread') : 'Email'}
                </h1>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {view === 'inbox' && selectedInbox && tab === 'messages' && (
              <>
                <button onClick={() => setView('compose')} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors text-sm font-medium">
                  <Send size={15} /> Compose
                </button>
                <button onClick={() => selectedInbox && loadMessages(selectedInbox)} className="p-2 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl transition-colors">
                  <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
                </button>
              </>
            )}
            <button onClick={() => setShowApiKeyForm(!showApiKeyForm)} className="p-2 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl transition-colors" title="API Key">
              <Key size={17} className={apiKeySet ? 'text-green-500' : 'text-gray-400'} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        {view === 'inbox' && selectedInbox && (
          <div className="max-w-4xl mx-auto px-4 flex gap-1 pb-2">
            <button onClick={() => setTab('messages')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'messages' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800'}`}>
              <Mail size={15} /> Messages
            </button>
            <button onClick={() => setTab('agent')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'agent' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800'}`}>
              <Bot size={15} /> Agent
              {agentConfig?.enabled && <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
            </button>
            <button onClick={() => setTab('products')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'products' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800'}`}>
              <Package size={15} /> Products
              {products.length > 0 && <span className="text-[10px] bg-gray-200 dark:bg-zinc-700 px-1.5 py-0.5 rounded-full">{products.length}</span>}
            </button>
          </div>
        )}
      </div>

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-3">
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 text-sm">
            <AlertCircle size={16} /> {error}
            <button onClick={() => setError('')} className="ml-auto text-red-500 hover:text-red-700">✕</button>
          </div>
        )}

        {/* API Key */}
        {showApiKeyForm && (
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 p-4">
            <div className="flex items-center justify-between mb-2"><p className="text-sm font-medium">AgentMail API Key</p>{apiKeyMasked && <span className="text-xs text-gray-400 font-mono">{apiKeyMasked}</span>}</div>
            <p className="text-xs text-gray-400 mb-3">Get your key from <a href="https://console.agentmail.to/" target="_blank" rel="noopener noreferrer" className="text-indigo-500 underline">console.agentmail.to</a></p>
            <div className="flex gap-2">
              <input type="password" value={apiKeyInput} onChange={e => setApiKeyInput(e.target.value)} placeholder="am_..." onKeyDown={e => e.key === 'Enter' && saveApiKey()}
                className="flex-1 px-3 py-2 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <button onClick={saveApiKey} disabled={loading || !apiKeyInput.trim()} className="px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium flex items-center gap-1.5">
                {apiKeySaved ? <><Check size={14} /> Saved</> : 'Save'}
              </button>
            </div>
          </div>
        )}

        {showCreateInbox && view === 'inbox' && (
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 p-4">
            <h3 className="font-semibold text-sm mb-2">Create New Inbox</h3>
            <div className="flex gap-2">
              <input type="text" value={newInboxName} onChange={e => setNewInboxName(e.target.value)} placeholder="Display name (e.g. AI Secretary)" onKeyDown={e => e.key === 'Enter' && createInbox()}
                className="flex-1 px-3 py-2 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <button onClick={createInbox} disabled={loading} className="px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium">{loading ? 'Creating...' : 'Create'}</button>
              <button onClick={() => setShowCreateInbox(false)} className="px-3 py-2 bg-gray-100 dark:bg-zinc-800 rounded-xl hover:bg-gray-200 dark:hover:bg-zinc-700 text-sm">✕</button>
            </div>
          </div>
        )}

        {/* No inbox state */}
        {view === 'inbox' && apiKeySet && !selectedInbox && !loading && (
          <div className="text-center py-16">
            <Mail className="mx-auto mb-4 text-gray-300 dark:text-gray-600" size={48} />
            <p className="text-gray-500 dark:text-gray-400 mb-4">No inboxes yet</p>
            <button onClick={() => setShowCreateInbox(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 text-sm font-medium">Create your first inbox</button>
          </div>
        )}

        {/* ──────── MESSAGES TAB ──────── */}
        {view === 'inbox' && selectedInbox && tab === 'messages' && (
          <div className="space-y-2">
            {loading && messages.length === 0 && (
              <div className="text-center py-12 text-gray-500"><RefreshCw className="animate-spin mx-auto mb-3" size={24} /> Loading...</div>
            )}
            {!loading && messages.length === 0 && (
              <div className="text-center py-16">
                <Mail className="mx-auto mb-4 text-gray-300 dark:text-gray-600" size={48} />
                <p className="text-gray-500 dark:text-gray-400">No messages yet</p>
                <p className="text-xs text-gray-400 mt-1">Send an email or receive at <span className="font-mono">{selectedInbox.email}</span></p>
              </div>
            )}
            {messages.map(msg => {
              const isSent = msg.from?.includes(selectedInbox!.email) || msg.from?.includes('agentmail.to');
              return (
                <div key={msg.messageId} onClick={async () => {
                    try {
                      const res = await fetch(`/api/email/inboxes/${selectedInbox!.inboxId}/messages/${msg.messageId}`);
                      if (res.ok) { setSelectedMessage(await res.json()); }
                      else { setSelectedMessage(msg); }
                    } catch { setSelectedMessage(msg); }
                    setView('read');
                  }}
                  className={`group rounded-xl p-4 hover:shadow-md transition-all cursor-pointer border ${
                    isSent
                      ? 'bg-indigo-50/50 dark:bg-indigo-900/10 border-indigo-200 dark:border-indigo-800/50'
                      : 'bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-800'
                  }`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold mt-0.5 ${
                      isSent
                        ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300'
                        : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300'
                    }`}>
                      {isSent ? '↗️' : '↙️'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-0.5">
                        <p className="font-medium text-sm truncate flex-1">{msg.subject || '(no subject)'}</p>
                        <div className="flex items-center gap-1 ml-2 shrink-0">
                          <span className="text-[10px] text-gray-400 whitespace-nowrap">{msg.date ? new Date(msg.date).toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : ''}</span>
                          <button onClick={(e) => {
                              e.stopPropagation();
                              hideMessage(msg.messageId);
                            }}
                            className="p-1 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">
                        {isSent ? <><span className="text-indigo-500 font-medium">To:</span> {msg.to}</> : <><span className="text-emerald-500 font-medium">From:</span> {msg.from}</>}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{msg.text?.substring(0, 120) || '(no content)'}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ──────── AGENT TAB ──────── */}
        {view === 'inbox' && selectedInbox && tab === 'agent' && (
          <div className="space-y-4">
            {/* Agent Toggle */}
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${agentConfig?.enabled ? 'bg-green-100 dark:bg-green-900/30' : 'bg-gray-100 dark:bg-zinc-800'}`}>
                    <Bot size={20} className={agentConfig?.enabled ? 'text-green-600' : 'text-gray-400'} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Auto-Reply Agent</p>
                    <p className="text-xs text-gray-400">
                      {agentConfig?.enabled ? '🟢 Active — polling every 30s' : '⚫ Inactive'}
                    </p>
                  </div>
                </div>
                <button onClick={toggleAgent}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${agentConfig?.enabled
                    ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50'
                    : 'bg-green-600 text-white hover:bg-green-700'}`}>
                  <Power size={15} /> {agentConfig?.enabled ? 'Stop' : 'Start'}
                </button>
              </div>
            </div>

            {/* Persona Editor */}
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Settings2 size={16} className="text-gray-400" />
                  <p className="text-sm font-semibold">Persona & Instructions</p>
                </div>
                <button onClick={saveAgentConfig} disabled={agentSaving}
                  className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-xs font-medium">
                  {agentSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
              <textarea value={agentPersona} onChange={e => setAgentPersona(e.target.value)}
                placeholder="Definește personalitatea agentului... (ex: Ești un negociator expert care caută prețuri mai bune)"
                rows={6}
                className="w-full px-3 py-2.5 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
              <div className="mt-3 flex items-center gap-3">
                <label className="text-xs text-gray-500">Max replies/thread:</label>
                <input type="number" value={agentMaxReplies} onChange={e => setAgentMaxReplies(parseInt(e.target.value) || 10)}
                  min={1} max={50}
                  className="w-16 px-2 py-1 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg text-sm text-center" />
              </div>
            </div>

            {/* Agent Threads */}
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <MessageSquare size={16} className="text-gray-400" />
                  <p className="text-sm font-semibold">Conversations ({agentThreads.length})</p>
                </div>
                <button onClick={() => selectedInbox && loadAgentThreads(selectedInbox.inboxId)}
                  className="p-1.5 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg"><RefreshCw size={14} /></button>
              </div>
              {agentThreads.length === 0 ? (
                <p className="text-xs text-gray-400 py-4 text-center">No conversations yet — agent will respond when emails arrive</p>
              ) : (
                <div className="space-y-2">
                  {agentThreads.map(t => (
                    <div key={t._id} onClick={() => { setSelectedThread(t); setView('thread'); }}
                      className="flex items-center justify-between p-3 bg-gray-50 dark:bg-zinc-800 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-zinc-700 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{t.subject || '(no subject)'}</p>
                        <p className="text-xs text-gray-400 truncate">{t.senderEmail}</p>
                      </div>
                      <div className="flex items-center gap-2 ml-2 shrink-0">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          t.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                          t.status === 'max-replies' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                          'bg-gray-100 text-gray-500 dark:bg-zinc-700 dark:text-gray-400'
                        }`}>{t.status}</span>
                        <span className="text-xs text-gray-400">{t.replyCount} replies</span>
                        <button onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await fetch(`/api/email/agent/thread/${t._id}`, { method: 'DELETE' });
                              setAgentThreads(prev => prev.filter(th => th._id !== t._id));
                            } catch {}
                          }}
                          className="p-1 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-300 hover:text-red-500 transition-colors">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ──────── PRODUCTS TAB ──────── */}
        {view === 'inbox' && tab === 'products' && (
          <div className="space-y-4">
            {/* URL Input */}
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Link size={16} className="text-gray-400" />
                <p className="text-sm font-semibold">Process URL</p>
              </div>
              <p className="text-xs text-gray-400 mb-3">Paste a product/service URL to analyze it for negotiation</p>
              <div className="flex gap-2">
                <input type="url" value={productUrl} onChange={e => setProductUrl(e.target.value)}
                  placeholder="https://example.com/product..." onKeyDown={e => e.key === 'Enter' && processUrl()}
                  className="flex-1 px-3 py-2 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                <button onClick={processUrl} disabled={processingUrl || !productUrl.trim()}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium flex items-center gap-1.5">
                  {processingUrl ? <><RefreshCw size={14} className="animate-spin" /> Analyzing...</> : <><Package size={14} /> Analyze</>}
                </button>
              </div>
            </div>

            {/* Product List */}
            {products.length === 0 ? (
              <div className="text-center py-12">
                <Package className="mx-auto mb-4 text-gray-300 dark:text-gray-600" size={48} />
                <p className="text-gray-500 dark:text-gray-400">No products analyzed yet</p>
                <p className="text-xs text-gray-400 mt-1">Paste a URL above or send a link to the orchestrator</p>
              </div>
            ) : (
              <div className="space-y-3">
                {products.map(p => (
                  <div key={p._id} className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-semibold text-sm">{p.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">{p.type}</span>
                          {p.category !== 'other' && <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-500 dark:bg-zinc-700 dark:text-gray-400">{p.category}</span>}
                          {p.condition && <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-500 dark:bg-zinc-700 dark:text-gray-400">{p.condition}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg text-gray-400">
                          <ExternalLink size={14} /></a>
                        <button onClick={() => deleteProduct(p._id)} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-400">
                          <Trash2 size={14} /></button>
                      </div>
                    </div>
                    {p.price && (
                      <p className="text-lg font-bold text-green-600 dark:text-green-400 mb-1">{p.price} {p.currency || ''}</p>
                    )}
                    {p.seller && <p className="text-xs text-gray-500 mb-1">🏪 {p.seller}</p>}
                    {p.location && <p className="text-xs text-gray-500 mb-1">📍 {p.location}</p>}
                    {p.description && <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{p.description}</p>}
                    {p.keyFeatures?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {p.keyFeatures.map((f, i) => (
                          <span key={i} className="px-2 py-0.5 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded text-[11px] text-gray-600 dark:text-gray-400">{f}</span>
                        ))}
                      </div>
                    )}
                    {p.negotiationNotes && (
                      <div className="mt-2 p-2.5 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg">
                        <p className="text-xs text-amber-800 dark:text-amber-300">💡 <span className="font-medium">Negotiation:</span> {p.negotiationNotes}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Read Message */}
        {view === 'read' && selectedMessage && (() => {
          const isSent = selectedMessage.from?.includes(selectedInbox?.email || '') || selectedMessage.from?.includes('agentmail.to');
          return (
            <div className="space-y-3">
              {/* Subject header */}
              <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-4">
                <h2 className="font-bold text-sm mb-1">{selectedMessage.subject}</h2>
                <p className="text-xs text-gray-400">{selectedMessage.date ? new Date(selectedMessage.date).toLocaleString() : ''}</p>
              </div>
              {/* Message bubble */}
              <div className={`flex ${isSent ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl p-4 text-sm ${
                  isSent
                    ? 'bg-indigo-600 text-white rounded-br-md'
                    : 'bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-bl-md text-gray-700 dark:text-gray-300'
                }`}>
                  <div className={`flex items-center gap-2 mb-2 text-xs ${isSent ? 'text-indigo-200' : 'text-gray-400'}`}>
                    <span className="font-semibold">{isSent ? '↗️ Sent' : '↙️ Received'}</span>
                    <span>•</span>
                    <span>{isSent ? `To: ${selectedMessage.to}` : `From: ${selectedMessage.from}`}</span>
                  </div>
                  {selectedMessage.html && !isSent ? (
                    <div className="prose dark:prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: selectedMessage.html }} />
                  ) : (
                    <pre className={`whitespace-pre-wrap font-sans ${isSent ? 'text-white' : ''}`}>{selectedMessage.text || '(no content)'}</pre>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Thread View */}
        {view === 'thread' && selectedThread && (
          <div className="space-y-3">
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-4">
              <h2 className="font-bold text-sm mb-1">{selectedThread.subject}</h2>
              <p className="text-xs text-gray-400">with {selectedThread.senderEmail} · {selectedThread.replyCount} replies ·
                <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                  selectedThread.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                    : 'bg-gray-100 text-gray-500 dark:bg-zinc-700 dark:text-gray-400'
                }`}>{selectedThread.status}</span>
              </p>
            </div>
            <div className="space-y-2">
              {selectedThread.messages.map((m, i) => {
                const isAgent = m.role === 'assistant';
                return (
                  <div key={i} className={`flex ${isAgent ? 'justify-end' : 'justify-start'}`}>
                    {!isAgent && (
                      <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-emerald-600 text-[10px] font-bold mr-2 mt-1 shrink-0">
                        {selectedThread.senderEmail.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                      isAgent
                        ? 'bg-indigo-600 text-white rounded-br-md'
                        : 'bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-bl-md text-gray-700 dark:text-gray-300'
                    }`}>
                      <div className={`flex items-center gap-2 mb-1.5 text-[10px] ${isAgent ? 'text-indigo-200' : 'text-gray-400'}`}>
                        <span className="font-semibold">{isAgent ? '🤖 Agent' : `📩 ${selectedThread.senderEmail.split('@')[0]}`}</span>
                        <span>{m.timestamp ? new Date(m.timestamp).toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : ''}</span>
                      </div>
                      <pre className={`whitespace-pre-wrap font-sans text-[13px] leading-relaxed ${isAgent ? 'text-white' : ''}`}>{m.content}</pre>
                    </div>
                    {isAgent && (
                      <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-indigo-600 text-[10px] font-bold ml-2 mt-1 shrink-0">
                        🤖
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Compose */}
        {view === 'compose' && (
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 space-y-4">
            <div className="text-xs text-gray-400">From: <span className="font-mono">{selectedInbox?.email}</span></div>
            <input type="email" value={composeTo} onChange={e => setComposeTo(e.target.value)} placeholder="To: recipient@example.com"
              className="w-full px-4 py-3 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <input type="text" value={composeSubject} onChange={e => setComposeSubject(e.target.value)} placeholder="Subject"
              className="w-full px-4 py-3 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <textarea value={composeBody} onChange={e => setComposeBody(e.target.value)} placeholder="Write your email..." rows={10}
              className="w-full px-4 py-3 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
            <button onClick={sendEmail} disabled={loading || !composeTo.trim()}
              className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
              <Send size={16} /> {loading ? 'Sending...' : 'Send Email'}
            </button>
          </div>
        )}
      </div>

      {showInboxDropdown && <div className="fixed inset-0 z-40" onClick={() => setShowInboxDropdown(false)} />}
    </div>
  );
}
