import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** River's UI for phones: the desktop's React app with the phone bridge as window.river. */
export default defineConfig({
  root: resolve(import.meta.dirname, 'ui'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, 'dist/ui'),
    emptyOutDir: true,
    target: 'chrome110',
    minify: true,
  },
});
