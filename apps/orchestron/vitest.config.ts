import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',

    // Test patterns
    include: ['test/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],

    // Timeouts - longer for integration tests
    testTimeout: 30000, // 30 seconds for integration tests
    hookTimeout: 10000, // 10 seconds for setup/teardown

    // Concurrent execution
    pool: 'threads',
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 4,
      },
    },

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/cli.ts',
        'src/index.ts',
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },

    // Reporter configuration
    reporter: ['verbose', 'json'],
    outputFile: {
      json: './test-results.json',
    },

    // Setup files
    setupFiles: ['./test/setup.ts'],

    // Retry configuration for potentially flaky tests
    retry: 1,

    // Mock settings
    clearMocks: true,
    restoreMocks: true,

    // Watch mode settings
    watchExclude: ['node_modules/**', 'dist/**', 'coverage/**'],
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@test': path.resolve(__dirname, './test'),
    },
  },

  // Define globals for tests
  define: {
    __TEST__: true,
  },
});