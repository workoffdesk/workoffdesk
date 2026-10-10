import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The service worker on its own, everything it uses put in it: it is registered as a classic script, which
// cannot import a chunk it shares with the page. Built after the page, into the same folder.
export default defineConfig({
  root: __dirname,
  publicDir: false,
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/sw.ts'),
      output: { format: 'iife', entryFileNames: 'sw.js' },
    },
  },
});
