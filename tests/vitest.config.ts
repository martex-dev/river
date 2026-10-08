import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'integration',
    environment: 'node',
    include: ['integration/**/*.test.ts'],
  },
});
