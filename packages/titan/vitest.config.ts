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
      { find: /^@omnitron-dev\/testing\/titan$/, replacement: resolve(__dirname, '../testing/src/titan/index.ts') },
      { find: /^@omnitron-dev\/testing\/docker$/, replacement: resolve(__dirname, '../testing/src/docker/index.ts') },
      { find: /^@omnitron-dev\/testing\/async$/, replacement: resolve(__dirname, '../testing/src/async/index.ts') },
      { find: /^@omnitron-dev\/testing\/helpers$/, replacement: resolve(__dirname, '../testing/src/helpers/index.ts') },
      {
        find: /^@omnitron-dev\/testing\/performance$/,
        replacement: resolve(__dirname, '../testing/src/performance/index.ts'),
      },
      { find: /^@omnitron-dev\/testing\/(.*)$/, replacement: resolve(__dirname, '../testing/src/$1') },
      { find: /^@omnitron-dev\/testing$/, replacement: resolve(__dirname, '../testing/src/index.ts') },
      { find: /^@omnitron-dev\/titan\/module\/(.*)$/, replacement: resolve(__dirname, 'src/modules/$1/index.ts') },
      { find: /^@omnitron-dev\/titan\/(.*)$/, replacement: resolve(__dirname, 'src/$1/index.ts') },
      { find: /^@omnitron-dev\/titan$/, replacement: resolve(__dirname, 'src/index.ts') },
      { find: /^@omnitron-dev\/eventemitter$/, replacement: resolve(__dirname, '../eventemitter/src/index.ts') },
      { find: /^@omnitron-dev\/common$/, replacement: resolve(__dirname, '../common/src/index.ts') },
      {
        find: /^@omnitron-dev\/msgpack\/smart-buffer$/,
        replacement: resolve(__dirname, '../msgpack/src/smart-buffer.ts'),
      },
      { find: /^@omnitron-dev\/msgpack$/, replacement: resolve(__dirname, '../msgpack/src/index.ts') },
      { find: '@/', replacement: resolve(__dirname, 'src') + '/' },
      { find: /^@netron\/(.*)$/, replacement: resolve(__dirname, 'src/netron/$1') },
      { find: /^@netron$/, replacement: resolve(__dirname, 'src/netron/index.ts') },
      { find: /^@nexus\/(.*)$/, replacement: resolve(__dirname, 'src/nexus/$1') },
      { find: /^@nexus$/, replacement: resolve(__dirname, 'src/nexus/index.ts') },
      { find: /^@kysera\/core$/, replacement: resolve(__dirname, 'test/__mocks__/@kysera/core.ts') },
      { find: /^@kysera\/dialects$/, replacement: resolve(__dirname, 'test/__mocks__/@kysera/dialects.ts') },
      { find: /^@kysera\/migrations$/, replacement: resolve(__dirname, 'test/__mocks__/@kysera/migrations.ts') },
      { find: /^@kysera\/repository$/, replacement: resolve(__dirname, 'test/__mocks__/@kysera/repository.ts') },
      { find: /^@kysera\/executor$/, replacement: resolve(__dirname, 'test/__mocks__/@kysera/executor.ts') },
      { find: /^@kysera\/rls$/, replacement: resolve(__dirname, 'test/__mocks__/@kysera/rls.ts') },
      { find: /^@kysera\/infra$/, replacement: resolve(__dirname, 'test/__mocks__/@kysera/infra.ts') },
      { find: /^@kysera\/dal$/, replacement: resolve(__dirname, 'test/__mocks__/@kysera/dal.ts') },
      { find: /^@kysera\/audit$/, replacement: resolve(__dirname, 'test/__mocks__/@kysera/audit.ts') },
      { find: /^@kysera\/testing$/, replacement: resolve(__dirname, 'test/__mocks__/@kysera/testing.ts') },
      { find: /^@kysera\/timestamps$/, replacement: resolve(__dirname, 'test/__mocks__/@kysera/timestamps.ts') },
      { find: /^@kysera\/soft-delete$/, replacement: resolve(__dirname, 'test/__mocks__/@kysera/soft-delete.ts') },
      { find: /^@kysera\/debug$/, replacement: resolve(__dirname, 'test/__mocks__/@kysera/debug.ts') },
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
