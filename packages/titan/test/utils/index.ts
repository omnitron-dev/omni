/**
 * Test Utilities Index
 *
 * Central export for the test utilities that titan itself still needs.
 *
 * The redis/docker helpers in this directory are deliberately NOT re-exported.
 * They import `../../src/modules/redis/*`, a path that disappeared when the
 * Redis module was extracted into `@omnitron-dev/titan-redis`. Because this
 * barrel is what the transport suites import for `getFreePort`/`delay`, that
 * one dead re-export made every one of them fail at import time — which is why
 * ten transport globs ended up in vitest.config's exclude list. Their remaining
 * consumers all import them by path, and all of those live in test trees that
 * were orphaned by the same extraction.
 */

export * from './transport-test-utils.js';
export * from './error-test-utils.js';
