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
    sequence: {
      shuffle: false, // Don't shuffle - run in predictable order
    },
    // Retry failed tests once to handle race conditions
    retry: 1,
  },
});
