import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node', // Node environment for running real server
    include: ['tests/integration/**/*.{test,spec}.ts'],
    setupFiles: ['./tests/setup/integration.ts'], // Setup WebSocket polyfill
    testTimeout: 30000, // Longer timeout for integration tests
    hookTimeout: 30000,
    // Run all tests sequentially to prevent port conflicts
    fileParallelism: false, // Disable parallel file execution
    // These tests start real Titan servers and open real sockets. On vitest's
    // default pool the run produced no output at all and never terminated —
    // not a slow suite, a hang: no collection line, no file summary, killed at
    // 500s. Under `forks` the same files complete. Every other package in this
    // monorepo already runs on forks by way of the root config; this one
    // carried its own config and never inherited it.
    pool: 'forks',
    sequence: {
      shuffle: false, // Don't shuffle - run in predictable order
    },
    // Retry failed tests once to handle race conditions
    retry: 1,
  },
});
