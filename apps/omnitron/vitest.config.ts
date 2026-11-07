import path from 'node:path';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { defineConfig } from 'vitest/config';
import { withPrismSourceAliases } from './scripts/console-source-aliases.js';

const require = createRequire(import.meta.url);
const webappRequire = createRequire(path.join(import.meta.dirname, 'webapp/package.json'));
// Filesystem admission tests use physical paths, including on macOS where /tmp is a symlink.
const temporaryDirectory = realpathSync(tmpdir());

export default defineConfig({
  resolve: {
    alias: withPrismSourceAliases({
      '@omnitron-dev/titan-database/coordination': path.resolve(import.meta.dirname, '../../packages/titan-database/src/exports/coordination.ts'),
      // Exercise current source contracts without rebuilding packages used by live applications.
      '@omnitron-dev/titan-pm': path.resolve(import.meta.dirname, '../../packages/titan-pm/src/index.ts'),
      '@omnitron-dev/titan/utils': path.resolve(import.meta.dirname, '../../packages/titan/src/utils/index.ts'),
      // The console's own alias, mirrored from `webapp/vite.config.ts`. Its
      // 146 `src/...` imports are unresolvable without it, so a test that
      // touches any console module fails to transform rather than to
      // assert. Nothing under `apps/omnitron/src` uses this prefix, so it
      // cannot shadow the daemon's own imports.
      src: path.resolve(import.meta.dirname, 'webapp/src'),
      '@xyflow/react': path.dirname(webappRequire.resolve('@xyflow/react/package.json')),
      '@omnitron-dev/omnitron/dto/services': path.resolve(import.meta.dirname, 'src/shared/dto/services.ts'),
      '@omnitron-dev/omnitron/alerts': path.resolve(import.meta.dirname, 'src/shared/alert-expression.ts'),
      '@omnitron-dev/omnitron/dto/events': path.resolve(import.meta.dirname, 'src/shared/events.ts'),
      '@omnitron-dev/omnitron/release-reading': path.resolve(import.meta.dirname, 'src/shared/release-reading.ts'),
      '@omnitron-dev/omnitron/release-source': path.resolve(import.meta.dirname, 'src/shared/framework-source.ts'),
      '@omnitron-dev/omnitron/node-check': path.resolve(import.meta.dirname, 'src/shared/node-check.ts'),
      '@omnitron-dev/omnitron/audit-outcome': path.resolve(import.meta.dirname, 'src/shared/audit-outcome.ts'),
      '@omnitron-dev/omnitron/metrics-storage-reading': path.resolve(
        import.meta.dirname,
        'src/shared/metrics-storage-reading.ts'
      ),
      '@omnitron-dev/titan-metrics/types': path.resolve(
        import.meta.dirname,
        '../../packages/titan-metrics/src/types.ts'
      ),
      '@omnitron-dev/titan-metrics': path.resolve(import.meta.dirname, '../../packages/titan-metrics/src/index.ts'),
      kysely: require.resolve('kysely'),
      '@omnitron-dev/omnitron/relay-reading': path.resolve(import.meta.dirname, 'src/shared/relay-reading.ts'),
      '@omnitron-dev/omnitron/stack-reading': path.resolve(import.meta.dirname, 'src/shared/stack-reading.ts'),
      '@omnitron-dev/omnitron/sync-reading': path.resolve(import.meta.dirname, 'src/shared/sync-reading.ts'),

    }),
  },
  test: {
    globals: true,
    environment: 'node',
    // `.tsx` too: the console is 20k lines of React, and until this line
    // existed no test in this package could render any of it. The defect
    // that prompted it — a polling hook that never fetched under
    // `StrictMode` — is invisible without a renderer.
    include: [
      'test/**/*.test.ts',
      'test/**/*.spec.ts',
      'test/**/*.test.tsx',
      'webapp/src/**/*.test.ts',
      'webapp/src/**/*.test.tsx',
    ],
    exclude: ['**/node_modules/**'],
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts', 'src/commands/**', 'src/tui/**'],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    env: {
      NODE_ENV: 'test',
      TMPDIR: temporaryDirectory,
      TMP: temporaryDirectory,
      TEMP: temporaryDirectory,
    },
  },
});
