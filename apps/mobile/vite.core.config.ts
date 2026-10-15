import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * The client core for phones: apps/desktop/src/main's services in one bundle,
 * with Node and Electron replaced by the shims in core/shims (which call the
 * native interface). Loaded by the app's private, headless core WebView.
 */
const shim = (name: string): string => resolve(import.meta.dirname, 'core/shims', name);
const version = (process.env.RIVER_VERSION ?? process.env.npm_package_version ?? '0.0.0').trim();

export default defineConfig({
  root: resolve(import.meta.dirname, 'core'),
  base: './',
  define: {
    __RIVER_VERSION__: JSON.stringify(version),
    __RIVER_MAC_AUTO_INSTALL__: 'false',
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  resolve: {
    alias: [
      { find: /^(node:)?crypto$/, replacement: shim('crypto.ts') },
      { find: /^(node:)?fs\/promises$/, replacement: shim('fs-promises.ts') },
      { find: /^(node:)?fs$/, replacement: shim('fs.ts') },
      { find: /^(node:)?path$/, replacement: shim('path.ts') },
      { find: /^(node:)?zlib$/, replacement: shim('zlib.ts') },
      { find: /^(node:)?dns\/promises$/, replacement: shim('dns.ts') },
      { find: /^(node:)?net$/, replacement: shim('net.ts') },
      { find: /^electron$/, replacement: shim('electron.ts') },
      { find: /^better-sqlite3-multiple-ciphers$/, replacement: shim('sqlite.ts') },
      { find: /^@signalapp\/libsignal-client$/, replacement: shim('libsignal.ts') },
    ],
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist/core'),
    emptyOutDir: true,
    target: 'chrome110',
    modulePreload: false,
    minify: true,
    sourcemap: false,
    // One file: the shell loads it before the UI asks for anything.
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
