import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const backend = process.env.WORKOFFDESK_DEV_BACKEND ?? 'http://127.0.0.1:7681';
// The page is the server's own, so it runs the server's release, as the phone's update says its own.
const release: string = JSON.parse(readFileSync(resolve(__dirname, '../server/package.json'), 'utf8')).version;

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  define: { __RELEASE__: JSON.stringify(release) },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      // The service worker is built on its own: vite.sw.config.ts.
      input: { main: resolve(__dirname, 'index.html') },
      output: { entryFileNames: 'assets/[name]-[hash].js' },
    },
  },
  server: {
    proxy: { '/api': { target: backend, ws: true, changeOrigin: false } },
  },
});
