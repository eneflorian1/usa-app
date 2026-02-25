'use client';

import { useState, useEffect, useRef } from 'react';

interface Message {
  role: 'user' | 'model';
  content: string;
  timestamp?: string;
}

interface BookingResult {
  success: boolean;
  error?: string;
  booking?: {
    _id: string;
    guestName: string;
    checkIn: string;
    checkOut: string;
  };
}

interface ChatResponse {
  reply: string;
  booking: BookingResult | null;
}

export default function AgentPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadHistory = async () => {
    try {
      const res = await fetch('/api/agent/chat/history');
      const data = await res.json();
      if (Array.isArray(data)) {
        setMessages(data);
      }
    } catch (err) {
      console.error('Failed to load chat history:', err);
    }
    setLoading(false);
  };

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const userMsg = input.trim();
    setInput('');
    setSending(true);

    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg }),
      });
      const data: ChatResponse = await res.json();

      // Add the AI reply
      const modelContent = data.reply;
      setMessages(prev => [...prev, { role: 'model', content: modelContent }]);

      // If there's a booking result, add an inline notification
      if (data.booking) {
        if (data.booking.success && data.booking.booking) {
          const b = data.booking.booking;
          const ciDate = new Date(b.checkIn);
          const coDate = new Date(b.checkOut);
          setMessages(prev => [...prev, {
            role: 'model',
            content: `✅ BOOKING CONFIRMED\n📋 Guest: ${b.guestName}\n📥 Check-in: ${ciDate.toLocaleDateString('ro-RO')} ${ciDate.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}\n📤 Check-out: ${coDate.toLocaleDateString('ro-RO')} ${coDate.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}`
          }]);
        } else if (!data.booking.success) {
          setMessages(prev => [...prev, {
            role: 'model',
            content: `❌ BOOKING FAILED\n${data.booking?.error}`
          }]);
        }
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'model',
        content: '⚠️ Connection error. Please try again.'
      }]);
    }
    setSending(false);
    inputRef.current?.focus();
  };

  const handleClearHistory = async () => {
    if (!confirm('Clear all chat history?')) return;
    try {
      await fetch('/api/agent/chat/history', { method: 'DELETE' });
      setMessages([]);
    } catch (err) {
      console.error('Failed to clear history:', err);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isBookingMessage = (content: string) => {
    return content.startsWith('✅ BOOKING') || content.startsWith('❌ BOOKING');
  };

  return (
    <div className="h-[calc(100vh-7rem)] md:h-[calc(100vh-4rem)] flex flex-col max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 md:pb-4 border-b border-gray-200 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-bold tracking-tight">Booking Agent</h1>
            <p className="text-xs text-emerald-500 font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Online
            </p>
          </div>
        </div>
        <button
          onClick={handleClearHistory}
          className="text-xs text-gray-400 hover:text-red-500 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800"
        >
          Clear
        </button>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto py-4 space-y-3 scrollbar-thin">
        {loading ? (
          <div className="flex justify-center items-center h-full">
            <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-blue-500/10 to-purple-500/10 flex items-center justify-center mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            </div>
            <h3 className="text-base font-semibold mb-1">Booking Agent</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs">
              Ask me to make a reservation. I&apos;ll need a name, check-in date/time, and check-out date/time.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {[
                'Vreau o rezervare',
                'Ce program aveți?',
                'Book a room for tomorrow'
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
                  className="text-xs px-3 py-1.5 rounded-full border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-gray-400 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`
                max-w-[85%] md:max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed
                ${isBookingMessage(msg.content)
                  ? msg.content.startsWith('✅')
                    ? 'bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                    : 'bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                  : msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-md'
                    : 'bg-gray-100 dark:bg-zinc-800 text-gray-800 dark:text-gray-200 rounded-bl-md'
                }
              `}>
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            </div>
          ))
        )}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-gray-100 dark:bg-zinc-800 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1.5">
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="pt-3 border-t border-gray-200 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Type a message..."
            disabled={sending}
            className="flex-1 px-4 py-2.5 md:py-3 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="p-2.5 md:p-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors flex-shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}