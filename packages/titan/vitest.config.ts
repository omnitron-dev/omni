import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { existsSync } from 'fs';

/**
 * Vite plugin to resolve .js imports to .ts source files.
 * Many test files use `import { X } from '../../src/foo.js'` (ESM convention).
 * Vitest needs to map these to .ts source files.
 */
function resolveJsToTs() {
  return {
    name: 'resolve-js-to-ts',
    resolveId(source: string, importer: string | undefined) {
      if (!importer || !source.endsWith('.js')) return null;
      // Only handle relative imports
      if (!source.startsWith('.')) return null;
      const resolved = resolve(importer, '..', source);
      const tsPath = resolved.replace(/\.js$/, '.ts');
      if (existsSync(tsPath)) return tsPath;
      // Try index.ts
      const indexPath = resolved.replace(/\.js$/, '/index.ts');
      if (existsSync(indexPath)) return indexPath;
      return null;
    },
  };
}

export default defineConfig({
  plugins: [resolveJsToTs()],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts', 'test/**/*.test.ts', 'src/**/*.spec.ts', 'e2e/**/*.e2e.spec.ts'],
    exclude: [
      '**/node_modules/**',
      'test/runtime/**',
      'test/nexus/runtime/bun-*',
      'test/nexus/runtime/deno-*',
      'test/nexus/bun/**',
    ],
    testTimeout: 120_000, // 2 minutes for Docker-based tests
    hookTimeout: 120_000,
    maxConcurrency: process.env.TEST_DATABASE ? 1 : 3,
    clearMocks: true,
    globalSetup: ['./globalSetup.ts'],
    setupFiles: ['./vitest.setup.ts'],
    alias: [
      // Order matters — more specific paths first
      { find: /^@omnitron-dev\/testing\/titan$/, replacement: resolve(import.meta.dirname, '../testing/src/titan/index.ts') },
      { find: /^@omnitron-dev\/testing\/docker$/, replacement: resolve(import.meta.dirname, '../testing/src/docker/index.ts') },
      { find: /^@omnitron-dev\/testing\/async$/, replacement: resolve(import.meta.dirname, '../testing/src/async/index.ts') },
      { find: /^@omnitron-dev\/testing\/helpers$/, replacement: resolve(import.meta.dirname, '../testing/src/helpers/index.ts') },
      {
        find: /^@omnitron-dev\/testing\/performance$/,
        replacement: resolve(import.meta.dirname, '../testing/src/performance/index.ts'),
      },
      { find: /^@omnitron-dev\/testing\/(.*)$/, replacement: resolve(import.meta.dirname, '../testing/src/$1') },
      { find: /^@omnitron-dev\/testing$/, replacement: resolve(import.meta.dirname, '../testing/src/index.ts') },
      { find: /^@omnitron-dev\/titan\/module\/(.*)$/, replacement: resolve(import.meta.dirname, 'src/modules/$1/index.ts') },
      { find: /^@omnitron-dev\/titan\/(.*)$/, replacement: resolve(import.meta.dirname, 'src/$1/index.ts') },
      { find: /^@omnitron-dev\/titan$/, replacement: resolve(import.meta.dirname, 'src/index.ts') },
      { find: /^@omnitron-dev\/eventemitter$/, replacement: resolve(import.meta.dirname, '../eventemitter/src/index.ts') },
      { find: /^@omnitron-dev\/common$/, replacement: resolve(import.meta.dirname, '../common/src/index.ts') },
      {
        find: /^@omnitron-dev\/msgpack\/smart-buffer$/,
        replacement: resolve(import.meta.dirname, '../msgpack/src/smart-buffer.ts'),
      },
      { find: /^@omnitron-dev\/msgpack$/, replacement: resolve(import.meta.dirname, '../msgpack/src/index.ts') },
      { find: '@/', replacement: resolve(import.meta.dirname, 'src') + '/' },
      { find: /^@netron\/(.*)$/, replacement: resolve(import.meta.dirname, 'src/netron/$1') },
      { find: /^@netron$/, replacement: resolve(import.meta.dirname, 'src/netron/index.ts') },
      { find: /^@nexus\/(.*)$/, replacement: resolve(import.meta.dirname, 'src/nexus/$1') },
      { find: /^@nexus$/, replacement: resolve(import.meta.dirname, 'src/nexus/index.ts') },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts', 'src/**/__tests__/**', 'src/**/__mocks__/**'],
      reporter: ['text', 'lcov', 'html', 'json-summary'],
    },
  },
  resolve: {
    extensions: ['.ts', '.js', '.json'],
  },
});
