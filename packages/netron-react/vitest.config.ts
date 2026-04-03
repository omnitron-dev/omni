import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/index.ts', 'src/test/**', 'src/devtools/**'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
    setupFiles: ['./test/setup.ts'],
    deps: {
      interopDefault: true,
    },
    server: {
      deps: {
        inline: [
          'ws',
          '@omnitron-dev/netron-browser',
          '@omnitron-dev/eventemitter',
          '@omnitron-dev/msgpack',
          '@omnitron-dev/cuid',
        ],
      },
    },
  },
  resolve: {
    alias: {
      '@': './src',
      // Resolve workspace dependencies to their source for better test compatibility
      '@omnitron-dev/netron-browser': path.resolve(__dirname, '../netron-browser/src/index.ts'),
    },
  },
});
