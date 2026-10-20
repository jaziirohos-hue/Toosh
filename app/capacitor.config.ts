import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'so.toosh.app',
  appName: 'Toosh',
  webDir: 'dist',
  android: {
    // The API is HTTPS in production. Debug builds additionally allow the emulator host (see network_security_config).
    allowMixedContent: false,
  },
};
export default config;
