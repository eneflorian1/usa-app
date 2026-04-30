import { registerPlugin } from '@capacitor/core';

export interface AssistantSetupPlugin {
  isDefaultAssistant(): Promise<{ isDefault: boolean }>;
  requestDefaultAssistant(): Promise<{ granted: boolean; message: string }>;
}

const AssistantSetup = registerPlugin<AssistantSetupPlugin>('AssistantSetup');

export { AssistantSetup };

/**
 * Verifică dacă Ilie este asistentul implicit și cere setarea dacă nu este.
 * Apelează această funcție la pornirea aplicației sau dintr-un buton.
 */
export async function ensureDefaultAssistant(): Promise<void> {
  try {
    const { isDefault } = await AssistantSetup.isDefaultAssistant();
    
    if (!isDefault) {
      const { granted, message } = await AssistantSetup.requestDefaultAssistant();
      console.log(`[AssistantSetup] ${message}`);
      return;
    }

    console.log('[AssistantSetup] Ilie este deja asistentul implicit.');
  } catch (err) {
    // Dacă nu suntem pe Android (ex: web browser), ignorăm
    console.log('[AssistantSetup] Nu rulăm pe Android, skip.');
  }
}
