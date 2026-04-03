import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/modules/database/core.spec.ts'],
    testTimeout: 30000,
    alias: {
      '@omnitron-dev/titan': './src',
    },
  },
});
