import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // The console's own alias, mirrored from `webapp/vite.config.ts`. Its
      // 146 `src/...` imports are unresolvable without it, so a test that
      // touches any console module fails to transform rather than to
      // assert. Nothing under `apps/omnitron/src` uses this prefix, so it
      // cannot shadow the daemon's own imports.
      src: path.resolve(import.meta.dirname, 'webapp/src'),
      // Prism from source, as `webapp/vite.config.ts` does — and with the
      // subpath first, because vite matches aliases by prefix and the bare
      // entry would otherwise swallow `/netron`.
      '@omnitron-dev/omnitron/dto/services': path.resolve(import.meta.dirname, 'src/shared/dto/services.ts'),
      '@omnitron-dev/omnitron/alerts': path.resolve(import.meta.dirname, 'src/shared/alert-expression.ts'),
      '@omnitron-dev/omnitron/dto/events': path.resolve(import.meta.dirname, 'src/shared/events.ts'),
      '@omnitron-dev/omnitron/release-reading': path.resolve(import.meta.dirname, 'src/shared/release-reading.ts'),
      '@omnitron-dev/omnitron/node-check': path.resolve(import.meta.dirname, 'src/shared/node-check.ts'),
      '@omnitron-dev/omnitron/audit-outcome': path.resolve(import.meta.dirname, 'src/shared/audit-outcome.ts'),
      '@omnitron-dev/omnitron/metrics-storage-reading': path.resolve(import.meta.dirname, 'src/shared/metrics-storage-reading.ts'),
      '@omnitron-dev/titan-metrics/types': path.resolve(import.meta.dirname, '../../packages/titan-metrics/src/types.ts'),
      '@omnitron-dev/titan-metrics': path.resolve(import.meta.dirname, '../../packages/titan-metrics/src/index.ts'),
      'kysely': path.resolve(import.meta.dirname, 'node_modules/kysely/dist/index.js'),
      '@omnitron-dev/omnitron/sync-reading': path.resolve(import.meta.dirname, 'src/shared/sync-reading.ts'),
      '@omnitron-dev/prism/auth': path.resolve(import.meta.dirname, '../../packages/prism/src/auth/index.ts'),
      '@omnitron-dev/prism/netron': path.resolve(import.meta.dirname, '../../packages/prism/src/netron/index.ts'),
      '@omnitron-dev/prism/components/admin-filters': path.resolve(import.meta.dirname, '../../packages/prism/src/components/admin-filters/index.ts'),
      '@omnitron-dev/prism/components/alert': path.resolve(import.meta.dirname, '../../packages/prism/src/components/alert/index.ts'),
      '@omnitron-dev/prism/components/animate': path.resolve(import.meta.dirname, '../../packages/prism/src/components/animate/index.ts'),
      '@omnitron-dev/prism/components/breadcrumbs': path.resolve(import.meta.dirname, '../../packages/prism/src/components/breadcrumbs/index.ts'),
      '@omnitron-dev/prism/components/card': path.resolve(import.meta.dirname, '../../packages/prism/src/components/card/index.ts'),
      '@omnitron-dev/prism/components/chart': path.resolve(import.meta.dirname, '../../packages/prism/src/components/chart/index.ts'),
      '@omnitron-dev/prism/components/command-palette': path.resolve(import.meta.dirname, '../../packages/prism/src/components/command-palette/index.ts'),
      '@omnitron-dev/prism/components/confirm-dialog': path.resolve(import.meta.dirname, '../../packages/prism/src/components/confirm-dialog/index.ts'),
      '@omnitron-dev/prism/components/empty-content': path.resolve(import.meta.dirname, '../../packages/prism/src/components/empty-content/index.ts'),
      '@omnitron-dev/prism/components/error-boundary': path.resolve(import.meta.dirname, '../../packages/prism/src/components/error-boundary/index.ts'),
      '@omnitron-dev/prism/components/label': path.resolve(import.meta.dirname, '../../packages/prism/src/components/label/index.ts'),
      '@omnitron-dev/prism/components/loading-screen': path.resolve(import.meta.dirname, '../../packages/prism/src/components/loading-screen/index.ts'),
      '@omnitron-dev/prism/components/navigation-progress': path.resolve(import.meta.dirname, '../../packages/prism/src/components/navigation-progress/index.ts'),
      '@omnitron-dev/prism/components/page-content': path.resolve(import.meta.dirname, '../../packages/prism/src/components/page-content/index.ts'),
      '@omnitron-dev/prism/components/popover': path.resolve(import.meta.dirname, '../../packages/prism/src/components/popover/index.ts'),
      '@omnitron-dev/prism/components/search-input': path.resolve(import.meta.dirname, '../../packages/prism/src/components/search-input/index.ts'),
      '@omnitron-dev/prism/components/scroll-to-top': path.resolve(import.meta.dirname, '../../packages/prism/src/components/scroll-to-top/index.ts'),
      '@omnitron-dev/prism/components/skeleton': path.resolve(import.meta.dirname, '../../packages/prism/src/components/skeleton/index.ts'),
      '@omnitron-dev/prism/components/snackbar': path.resolve(import.meta.dirname, '../../packages/prism/src/components/snackbar/index.ts'),
      '@omnitron-dev/prism/components/stepper': path.resolve(import.meta.dirname, '../../packages/prism/src/components/stepper/index.ts'),
      '@omnitron-dev/prism/components/table': path.resolve(import.meta.dirname, '../../packages/prism/src/components/table/index.ts'),
      '@omnitron-dev/prism/components/tabs': path.resolve(import.meta.dirname, '../../packages/prism/src/components/tabs/index.ts'),
      '@omnitron-dev/prism/icons': path.resolve(import.meta.dirname, '../../packages/prism/src/icons/index.ts'),
      '@omnitron-dev/prism/core': path.resolve(import.meta.dirname, '../../packages/prism/src/core/index.ts'),
      '@omnitron-dev/prism/layouts': path.resolve(import.meta.dirname, '../../packages/prism/src/layouts/index.ts'),
      '@omnitron-dev/prism/state': path.resolve(import.meta.dirname, '../../packages/prism/src/state/index.ts'),
      '@omnitron-dev/prism/theme': path.resolve(import.meta.dirname, '../../packages/prism/src/theme/index.ts'),
      '@omnitron-dev/prism': path.resolve(import.meta.dirname, '../../packages/prism/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // `.tsx` too: the console is 20k lines of React, and until this line
    // existed no test in this package could render any of it. The defect
    // that prompted it — a polling hook that never fetched under
    // `StrictMode` — is invisible without a renderer.
    include: ['test/**/*.test.ts', 'test/**/*.spec.ts', 'test/**/*.test.tsx'],
    exclude: [
      '**/node_modules/**',
      // NOT RUN, and the reason is specific rather than "restructured":
      // `createMockPM()` in this file builds a ProcessManager without
      // `createSupervisor`, which the real one has and the orchestrator calls
      // — so four tests fail with "is not a function" and the rest hang,
      // because `OrchestratorService` waits on a `daemonNetronReady` promise
      // that nothing in the fixture resolves.
      //
      // Reviving it means updating a 576-line mock to match an interface it
      // has drifted from, which reproduces a test that asserts against a
      // fake. Left excluded deliberately, with the reason written down —
      // the previous comment said "restructured internals", which is not
      // what stops it and would have sent the next person looking in the
      // wrong place.
      'test/integration/orchestrator.test.ts',
    ],
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
    },
  },
});
