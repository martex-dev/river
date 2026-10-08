import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// Only runtime `dependencies` (electron-updater) stay external; workspace
// packages, zod and semver are bundled so the packaged app has no loose sources.
const external = externalizeDepsPlugin();

export default defineConfig({
  main: {
    plugins: [external],
    define: {
      // macOS automatic installation needs a Developer ID signature (see docs/deployment/updates.md).
      __RIVER_MAC_AUTO_INSTALL__: JSON.stringify(process.env.RIVER_MAC_SIGNED === 'true'),
    },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    plugins: [external],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        // Sandboxed preload scripts must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      minify: true,
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
  },
});
