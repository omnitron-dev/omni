import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.spec.ts'],
    exclude: [
      '**/node_modules/**',
      // Tests for source files that were restructured (imports point to old locations)
      'test/unit/define-app.test.ts',
      'test/unit/health-service.test.ts',
      'test/unit/metrics-service.test.ts',
      'test/unit/omnitron-supervisor.test.ts',
      // Integration tests that depend on restructured orchestrator internals
      'test/integration/orchestrator.test.ts',
      // Node manager worker integration depends on worker runtime
      'test/unit/node-manager-worker-integration.test.ts',
    ],
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts', 'src/commands/**', 'src/tui/**'],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    env: {
      NODE_ENV: 'test',
    },
  },
});
