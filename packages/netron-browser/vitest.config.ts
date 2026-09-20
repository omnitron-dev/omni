import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  /**
   * `packet-compatibility.test.ts` imports BOTH implementations and asserts
   * they agree about the wire. It was importing titan through its published
   * entry, which resolves to `dist` — four days stale when this was measured
   * (2026-09-20), so the test compared today's browser code against a titan
   * from whenever somebody last built it, and a guard added to titan's
   * decoder was invisible to it.
   *
   * A compatibility test that reads a build artefact tests the artefact. The
   * alias points it at titan's SOURCE, so "these two agree" is a statement
   * about what is written in the repository.
   */
  resolve: {
    alias: {
      '@omnitron-dev/titan/netron': resolve(here, '../titan/src/netron/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['tests/unit/**/*.{test,spec}.ts'],
    exclude: ['tests/e2e/**/*', 'tests/integration/**/*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts', 'src/**/*.spec.ts', 'src/**/*.test.ts'],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
});
