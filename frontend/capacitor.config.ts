import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.enef.assistant',
  appName: 'Ilie Assistant',
  webDir: 'out',
  server: {
    url: 'https://enef.site/orchestrator?mode=assistant',
    cleartext: true
  }
};

export default config;
