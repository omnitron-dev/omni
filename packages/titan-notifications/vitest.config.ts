import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { existsSync } from 'fs';

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
    include: ['test/**/*.spec.ts', 'test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    clearMocks: true,
    // Suites here share one Redis and most call `flushdb()` in beforeEach, so
    // two files must never run concurrently against the same logical database.
    // Each worker gets its own (see toTestDb in test/rotif/helpers/test-utils),
    // and this cap is the other half of that guarantee: 8 workers, 8 databases.
    // Serialising the whole package instead was correct but unusable — the
    // Redis waits stopped overlapping and three files took eight minutes.
    maxWorkers: 8,
    minWorkers: 1,
    alias: [
      { find: /^@omnitron-dev\/titan\/nexus$/, replacement: resolve(__dirname, '../titan/src/nexus/index.ts') },
      { find: /^@omnitron-dev\/titan\/nexus\/(.*)$/, replacement: resolve(__dirname, '../titan/src/nexus/$1') },
      { find: /^@omnitron-dev\/titan\/decorators$/, replacement: resolve(__dirname, '../titan/src/decorators/index.ts') },
      { find: /^@omnitron-dev\/titan\/errors$/, replacement: resolve(__dirname, '../titan/src/errors/index.ts') },
      { find: /^@omnitron-dev\/titan\/utils$/, replacement: resolve(__dirname, '../titan/src/utils/index.ts') },
      { find: /^@omnitron-dev\/titan\/application$/, replacement: resolve(__dirname, '../titan/src/application/index.ts') },
      { find: /^@omnitron-dev\/titan\/netron$/, replacement: resolve(__dirname, '../titan/src/netron/index.ts') },
      { find: /^@omnitron-dev\/titan\/netron\/(.*)$/, replacement: resolve(__dirname, '../titan/src/netron/$1') },
      { find: /^@omnitron-dev\/titan\/rotif$/, replacement: resolve(__dirname, '../titan/src/rotif/index.ts') },
      { find: /^@omnitron-dev\/titan\/validation$/, replacement: resolve(__dirname, '../titan/src/validation/index.ts') },
      { find: /^@omnitron-dev\/titan\/module\/logger$/, replacement: resolve(__dirname, '../titan/src/modules/logger/index.ts') },
      { find: /^@omnitron-dev\/titan\/module\/config$/, replacement: resolve(__dirname, '../titan/src/modules/config/index.ts') },
      { find: /^@omnitron-dev\/titan\/module\/(.*)$/, replacement: resolve(__dirname, '../titan/src/modules/$1/index.ts') },
      { find: /^@omnitron-dev\/titan\/(.*)$/, replacement: resolve(__dirname, '../titan/src/$1/index.ts') },
      { find: /^@omnitron-dev\/titan$/, replacement: resolve(__dirname, '../titan/src/index.ts') },
      { find: /^@omnitron-dev\/eventemitter$/, replacement: resolve(__dirname, '../eventemitter/src/index.ts') },
      { find: /^@omnitron-dev\/common$/, replacement: resolve(__dirname, '../common/src/index.ts') },
      { find: /^@omnitron-dev\/testing\/titan$/, replacement: resolve(__dirname, '../testing/src/titan/index.ts') },
      { find: /^@omnitron-dev\/testing\/(.*)$/, replacement: resolve(__dirname, '../testing/src/$1') },
      { find: /^@omnitron-dev\/testing$/, replacement: resolve(__dirname, '../testing/src/index.ts') },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js', '.json'],
  },
});
