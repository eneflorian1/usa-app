'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { api } from '@/lib/api';

export default function WhatsAppPage() {
  const [status, setStatus] = useState<string>('disconnected');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);

  useEffect(() => {
    // Poll status every 2 seconds
    const interval = setInterval(() => {
      fetchStatus();
    }, 2000);
    
    // Initial fetch
    fetchStatus();
    
    return () => clearInterval(interval);
  }, []);

  const fetchStatus = async () => {
    try {
      const data = await api.get<{ status: string }>('/api/whatsapp/status');
      setStatus(data.status);

      if (data.status === 'qr') {
        const qrData = await api.get<{ qr: string }>('/api/whatsapp/qr');
        setQrCode(qrData.qr);
        setPhoneNumber(null);
      } else if (data.status === 'connected') {
        const phoneData = await api.get<{ phoneNumber: string }>('/api/whatsapp/phoneNumber');
        setPhoneNumber(phoneData.phoneNumber);
        setQrCode(null);
      } else {
        setQrCode(null);
        setPhoneNumber(null);
      }
    } catch (err) {
      console.error('Error fetching status:', err);
    }
  };

  const handleConnect = async () => {
    setLoading(true);
    try {
      await api.post('/api/whatsapp/connect');
      // The polling will pick up the 'initializing' status
    } catch (err) {
      console.error('Error connecting:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await api.post('/api/whatsapp/logout');
    } catch (err) {
      console.error('Error logging out:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col space-y-6 max-w-2xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">WhatsApp Sync</h1>
      
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm flex-1 flex flex-col">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-semibold">Device Connection</h2>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide
            ${status === 'connected' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 
              status === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
              status === 'qr' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
              status === 'initializing' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
              'bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-gray-400'}`}>
            {status}
          </span>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6">
          {(status === 'disconnected' || status === 'error') && (
            <>
              <div className="w-16 h-16 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-500 mb-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21" /><path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1" /></svg>
              </div>
              <div>
                <h3 className="text-xl font-bold mb-2">Link your WhatsApp</h3>
                <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                  Connect your WhatsApp account to allow the Gemini AI Agent to automatically reply to your incoming messages.
                </p>
              </div>
              <button 
                onClick={handleConnect}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 px-8 rounded-xl transition-colors shadow-sm"
              >
                {loading ? 'Starting...' : 'Generate QR Code'}
              </button>
            </>
          )}

          {status === 'initializing' && (
            <div className="flex flex-col items-center">
              <div className="animate-spin w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full mb-4"></div>
              <p className="text-gray-500 font-medium">Initializing WhatsApp client...</p>
            </div>
          )}

          {status === 'qr' && qrCode && (
            <div className="flex flex-col items-center space-y-6">
              <div>
                <h3 className="text-xl font-bold mb-2">Scan QR Code</h3>
                <p className="text-gray-500 dark:text-gray-400 text-sm max-w-sm mx-auto">
                  Open WhatsApp on your phone, go to Settings &gt; Linked Devices, and scan this code.
                </p>
              </div>
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                <Image src={qrCode} alt="WhatsApp QR Code" width={256} height={256} className="rounded-xl" />
              </div>
              <button 
                onClick={handleLogout}
                className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {status === 'connected' && (
            <>
              <div className="w-20 h-20 rounded-full bg-green-50 dark:bg-green-900/20 flex items-center justify-center text-green-500 mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
              </div>
              <div>
                <h3 className="text-xl font-bold mb-2">Successfully Connected!</h3>
                {phoneNumber && (
                  <div className="bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 px-4 py-2 rounded-xl font-semibold text-lg mb-4 inline-block border border-green-200 dark:border-green-800/30 shadow-sm">
                    {phoneNumber.startsWith('+') || !/^\d+$/.test(phoneNumber.replace(/\D/g, '')) ? phoneNumber : `+${phoneNumber}`}
                  </div>
                )}
                <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                  Your WhatsApp is now synced. The AI agent will automatically reply to incoming personal messages using your configured Gemini API key.
                </p>
              </div>
              <button 
                onClick={handleLogout}
                disabled={loading}
                className="bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-900/20 dark:hover:bg-red-900/40 dark:text-red-400 font-medium py-3 px-8 rounded-xl transition-colors border border-red-200 dark:border-red-800/30"
              >
                {loading ? 'Disconnecting...' : 'Disconnect Device'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}