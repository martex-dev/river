import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'integration',
    environment: 'node',
    include: ['integration/**/*.test.ts'],
    // Real servers, libsignal and key derivation: slow machines and a busy CI need more than 5 s.
    testTimeout: 30_000,
  },
});
