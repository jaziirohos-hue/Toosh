import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App.tsx';
import { isNativeAndroid, TooshNative } from './lib/native.ts';

/**
 * Follow the phone's font size by scaling the whole screen (text and the boxes around it together), between 90% and
 * 130%, so text never spills out of buttons. The layout is checked down to the narrowest width this produces.
 */
async function applyFontScale() {
  if (!isNativeAndroid) return;
  try {
    const status = await Promise.race([TooshNative.getStatus(), new Promise<null>(r => setTimeout(() => r(null), 800))]);
    const scale = Math.min(1.3, Math.max(0.9, status?.fontScale ?? 1));
    if (Math.abs(scale - 1) > 0.01) {
      document.documentElement.style.zoom = String(scale);
      document.documentElement.style.setProperty('--app-zoom', String(scale));
    }
  } catch { /* keep 100% */ }
}

applyFontScale().finally(() => createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>));
