import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'test/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/types.ts',
      ],
      lines: 80,
      branches: 75,
      functions: 80,
      statements: 80,
    },
    include: ['test/**/*.test.ts'],
  },
});
