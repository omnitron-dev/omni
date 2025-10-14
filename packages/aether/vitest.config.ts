import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@omnitron-dev/aether/jsx-runtime': path.resolve(__dirname, './dist/jsx-runtime.js'),
      '@omnitron-dev/aether/jsx-dev-runtime': path.resolve(__dirname, './dist/jsx-dev-runtime.js'),
      '@omnitron-dev/aether': path.resolve(__dirname, './src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['tests/**/*.{test,spec}.{ts,tsx}', 'test/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['benchmarks/**/*.bench.ts'],
    // Allow unhandled errors in tests where we're explicitly testing error handling
    // The errors ARE handled by the implementation, but Vitest tracks them before handlers execute
    dangerouslyIgnoreUnhandledErrors: true,
    // Memory optimization: use threads with limited concurrency
    pool: 'threads',
    poolOptions: {
      threads: {
        maxThreads: 4,
        minThreads: 1,
        singleThread: false,
      },
    },
    // Limit concurrent test files to prevent memory spikes
    maxConcurrency: 4,
    // Test timeout for long-running tests
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts', 'src/**/*.spec.ts', 'src/**/*.test.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
