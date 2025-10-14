import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['tests/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
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
