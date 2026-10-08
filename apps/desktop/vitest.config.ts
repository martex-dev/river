import { defineProject } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineProject({
  plugins: [react()],
  define: { __RIVER_MAC_AUTO_INSTALL__: 'false' },
  test: {
    name: 'desktop',
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
