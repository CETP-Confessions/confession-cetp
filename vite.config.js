import { defineConfig } from 'vite';

export default defineConfig({
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