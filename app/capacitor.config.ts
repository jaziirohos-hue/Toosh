import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'so.toosh.app',
  appName: 'Toosh',
  webDir: 'dist',
  android: {
    // The app page is https://localhost. A development API on plain http:// (emulator 10.0.2.2, adb reverse, LAN)
    // needs mixed content; it is enabled only when VITE_API_BASE is http://. Release builds use an https:// API and
    // their network security config forbids cleartext regardless.
    allowMixedContent: (process.env.VITE_API_BASE ?? '').startsWith('http://'),
  },
};
export default config;
