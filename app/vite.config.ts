import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative asset paths so the same build works inside the Android WebView and when served by the API.
  base: './',
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
  server: {
    port: 5173,
    // Same-origin API in development, so browser sessions use the HttpOnly cookie like production.
    proxy: { '/api': { target: process.env.TOOSH_API ?? 'http://127.0.0.1:8787', changeOrigin: false } },
  },
});
