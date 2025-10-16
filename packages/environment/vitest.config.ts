import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/*.test.ts', '**/*.spec.ts'],
      thresholds: {
        lines: 78,
        functions: 88,
        branches: 83,
        statements: 78
      }
    }
  }
});
