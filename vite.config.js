import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  appType: 'spa',
  server: {
    host: '0.0.0.0',
    port: 4174,
    strictPort: false,
  },
  preview: {
    host: '0.0.0.0',
    port: 4174,
    strictPort: false,
  },
  build: { sourcemap: true },
});