/**
 * Async / correctness audit — a SCAN, not a gate.
 *
 * The type-aware rules the default config does not enable. Run per package;
 * the whole repo at once OOMs even at 8 GB.
 *
 *   NODE_OPTIONS='--max-old-space-size=8192' \
 *     npx eslint --config ./eslint.audit.cjs "packages/<pkg>/src/**\/*.ts"
 *
 * State as of 2026-09-12. Clean: titan-auth, titan-ratelimit, titan-metrics,
 * titan-health, titan-discovery, titan-redis, titan-database,
 * netron-protocol, titan-cache. `require-array-sort-compare` is 0 everywhere,
 * and `no-misused-promises` (conditionals) has one hit in netron-browser
 * (`web-locks-lock.ts`) that is the deliberate is-it-thenable probe.
 *
 * `no-floating-promises` remainders, all read and left on purpose because the
 * async body owns a try/catch and cannot reject:
 *
 *   titan-scheduler  `executeJob` (guarded by `runJob`'s try/catch/finally),
 *                    `executeAsync` (a Promise executor whose catch rejects),
 *                    3x node-cron `task.stop()` — typed `void | Promise<void>`
 *                    and called from the synchronous `stopJob`, so a handler
 *                    is all that could be added and stop() does not reject
 *   titan-pm         `performHealthCheck` (fully wrapped in try/catch)
 *   titan            `emitSpecial` x7 (try/catch per listener, try/finally
 *                    around the drain), `revalidateInBackground`,
 *                    `initializeConnection`; the four `flush()` calls and
 *                    three `ICache` ops are fixed (431f548, 3b69f64)
 *   netron-browser   11 left after the same batcher fix
 *   titan-events     `runJob` x4 (whole body in try/catch, the retry
 *                    setTimeout recurses into that same guard) and three
 *                    node-cron `task.start()` / `task.stop()` handles, typed
 *                    `void | Promise<void>` and called from synchronous
 *                    methods — same shape as titan-scheduler's
 *   titan-notifications  7 in rotif, unread
 *
 * TWO of this sweep's findings presented as a HANG, not an error: a dropped
 * rejection left the caller waiting on a promise that could never settle
 * (`RequestBatcher` 431f548, `EventBusService.request` 8ff461c). Both failed
 * their regression test by timing out at 120s rather than by asserting. When
 * triaging "requests stopped completing", suspect a lost rejection.
 */
// Same resolution the real config uses: typescript-eslint throws on TS >= 7,
// and `tools/lint` is the workspace package pnpm bound to TypeScript 6. See
// the note at the top of eslint.config.cjs.
const { createRequire } = require('node:module');
const lintRequire = createRequire(require.resolve('./tools/lint/package.json'));
const eslintTs = lintRequire('typescript-eslint');
const base = require('./eslint.config.cjs');

module.exports = [
  ...base,
  {
    files: ['packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}', 'apps/*/webapp/src/**/*.{ts,tsx}'],
    // Some packages keep specs beside the code (titan-auth/src/*.spec.ts). The
    // base config sets `project: false` for those, so a type-aware rule cannot
    // run on them and errors out the whole run if asked to.
    ignores: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/*.test.tsx'],
    plugins: { '@typescript-eslint': eslintTs.plugin },
    rules: {
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksConditionals: true, checksVoidReturn: false, checksSpreads: true },
      ],
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true, ignoreIIFE: true }],
      '@typescript-eslint/require-array-sort-compare': ['error', { ignoreStringArrays: true }],
    },
  },
];
