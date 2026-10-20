import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';

/** Lets the page's Content-Security-Policy reach the configured API origin (VITE_API_BASE), and nothing broader. */
function apiCsp(): Plugin {
  return {
    name: 'toosh-api-csp',
    transformIndexHtml(html) {
      const base = process.env.VITE_API_BASE;
      if (!base) return html;
      const origin = new URL(base).origin;
      return html.replace("connect-src 'self' https:", `connect-src 'self' https: ${origin}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), apiCsp()],
  // Relative asset paths so the same build works inside the Android WebView and when served by the API.
  base: './',
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
  server: {
    port: 5173,
    // Same-origin API in development, so browser sessions use the HttpOnly cookie like production.
    proxy: { '/api': { target: process.env.TOOSH_API ?? 'http://127.0.0.1:8787', changeOrigin: false } },
  },
});
