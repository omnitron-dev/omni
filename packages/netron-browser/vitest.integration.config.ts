import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node', // Node environment for running real server
    include: ['tests/integration/**/*.{test,spec}.ts'],
    setupFiles: ['./tests/setup/integration.ts'], // Setup WebSocket polyfill
    testTimeout: 30000, // Longer timeout for integration tests
    hookTimeout: 30000,
    isolate: true, // Run tests in isolation to avoid port conflicts
  },
});
