import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mangaflow.app',
  appName: 'Mangetsu',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
