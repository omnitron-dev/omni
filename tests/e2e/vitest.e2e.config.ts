import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const REPO_ROOT = resolve(import.meta.dirname, '../..');

/**
 * Vite plugin to resolve .js imports to .ts source files in ESM mode.
 */
function resolveJsToTs() {
  return {
    name: 'resolve-js-to-ts',
    resolveId(source: string, importer: string | undefined) {
      if (!importer || !source.endsWith('.js')) return null;
      if (!source.startsWith('.')) return null;
      const resolved = resolve(importer, '..', source);
      const tsPath = resolved.replace(/\.js$/, '.ts');
      if (existsSync(tsPath)) return tsPath;
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
    root: REPO_ROOT,
    include: [
      'tests/e2e/harness/*.test.ts',
      'tests/e2e/tier1-features/**/*.test.ts',
      'tests/e2e/tier2-boundaries/**/*.test.ts',
      'tests/e2e/tier3-interactions/**/*.test.ts',
      'tests/e2e/tier4-scenarios/**/*.test.ts',
      'tests/e2e/challenger-*.test.ts',
      'tests/e2e/tier5-adversarial/**/*.spec.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/fixtures/**'],
    reporters: ['default', 'json'],
    outputFile: {
      json: resolve(REPO_ROOT, 'dist/e2e-report.json'),
    },
    setupFiles: [resolve(REPO_ROOT, 'tests/e2e/harness/assertions.ts')],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    alias: [
      { find: /^@omnitron-dev\/lumen-ast\/(.*)$/, replacement: resolve(REPO_ROOT, 'packages/lumen-ast/src/$1') },
      { find: /^@omnitron-dev\/lumen-ast$/, replacement: resolve(REPO_ROOT, 'packages/lumen-ast/src/index.ts') },
      { find: /^@omnitron-dev\/lumen-ui\/(.*)$/, replacement: resolve(REPO_ROOT, 'packages/lumen-ui/src/$1') },
      { find: /^@omnitron-dev\/lumen-ui$/, replacement: resolve(REPO_ROOT, 'packages/lumen-ui/src/index.ts') },
      { find: /^@omnitron-dev\/lumen\/(.*)$/, replacement: resolve(REPO_ROOT, 'packages/lumen/src/$1') },
      { find: /^@omnitron-dev\/lumen$/, replacement: resolve(REPO_ROOT, 'packages/lumen/src/index.ts') },
      { find: /^@omnitron-dev\/titan-lumen\/(.*)$/, replacement: resolve(REPO_ROOT, 'packages/titan-lumen/src/$1') },
      { find: /^@omnitron-dev\/titan-lumen$/, replacement: resolve(REPO_ROOT, 'packages/titan-lumen/src/index.ts') },
      {
        find: /^@omnitron-dev\/lumen-migrate\/(.*)$/,
        replacement: resolve(REPO_ROOT, 'packages/lumen-migrate/src/$1'),
      },
      {
        find: /^@omnitron-dev\/lumen-migrate$/,
        replacement: resolve(REPO_ROOT, 'packages/lumen-migrate/src/index.ts'),
      },
    ],
  },
});
