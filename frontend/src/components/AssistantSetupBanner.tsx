'use client';

import { useEffect, useState } from 'react';
import { ensureDefaultAssistant, AssistantSetup } from '@/lib/assistant-setup';

export default function AssistantSetupBanner() {
  const [isDefault, setIsDefault] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    // Verificăm dacă suntem pe Android (Capacitor)
    checkStatus();
  }, []);

  async function checkStatus() {
    try {
      const result = await AssistantSetup.isDefaultAssistant();
      setIsDefault(result.isDefault);
    } catch {
      // Nu suntem pe Android, ascundem bannerul
      setIsDefault(true);
    }
  }

  async function handleSetDefault() {
    setLoading(true);
    setMessage('');
    try {
      const result = await AssistantSetup.requestDefaultAssistant();
      setMessage(result.message);
      if (result.granted) {
        setIsDefault(true);
      }
    } catch (err) {
      setMessage('Eroare la setarea asistentului.');
    } finally {
      setLoading(false);
    }
  }

  // Ascundem dacă e deja setat sau dacă nu suntem pe Android
  if (isDefault === null || isDefault === true) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '80px',
      left: '50%',
      transform: 'translateX(-50%)',
      backgroundColor: '#1a1a2e',
      border: '1px solid #4f46e5',
      borderRadius: '12px',
      padding: '16px 20px',
      zIndex: 9999,
      maxWidth: '340px',
      width: '90%',
      boxShadow: '0 8px 32px rgba(79, 70, 229, 0.3)',
    }}>
      <p style={{
        color: '#e0e0e0',
        fontSize: '14px',
        marginBottom: '12px',
        lineHeight: '1.5',
      }}>
        🤖 <strong>Ilie</strong> nu este setat ca asistent implicit.
        Apasă mai jos pentru a-l activa cu un singur click.
      </p>
      
      <button
        onClick={handleSetDefault}
        disabled={loading}
        style={{
          width: '100%',
          padding: '12px',
          backgroundColor: loading ? '#374151' : '#4f46e5',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          fontSize: '15px',
          fontWeight: '600',
          cursor: loading ? 'not-allowed' : 'pointer',
          transition: 'background-color 0.2s',
        }}
      >
        {loading ? 'Se procesează...' : '⚡ Setează Ilie ca Asistent Implicit'}
      </button>

      {message && (
        <p style={{
          color: message.includes('deja') || message.includes('acum') ? '#34d399' : '#f87171',
          fontSize: '13px',
          marginTop: '10px',
          textAlign: 'center',
        }}>
          {message}
        </p>
      )}
    </div>
  );
}
