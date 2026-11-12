import { defineConfig } from 'vitest/config';

// An explicit qualification target: unavailable Docker/PostgreSQL fails, never substitutes a dialect.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/postgres/**/*.spec.ts'],
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 90_000,
  },
});
