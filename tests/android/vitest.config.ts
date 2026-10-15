import { defineConfig } from 'vitest/config';

/** Runs only on CI's Android emulator job (.github/workflows/android.yml), never in `npm test`. */
export default defineConfig({
  test: {
    name: 'android',
    environment: 'node',
    include: ['tests/android/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});
