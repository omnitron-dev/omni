/**
 * This package's test helper was written for a global setup it did not have.
 *
 * `test/utils/redis-test-utils.ts` resolves its endpoint in four steps: the
 * `.redis-test-info.json` a global setup writes, a `globalThis` the setup
 * sets, `USE_MOCK_REDIS`, and finally a hard-coded `TEST_REDIS_PORT ?? 16379`
 * — the port of the `redis-test` service in the monorepo's
 * `docker-compose.test.yml`. With no global setup registered, the first three
 * could never answer and every test took the fourth. Nothing listens on
 * 16379 unless that compose file is up, so the suite was red on main: five
 * tests in `redis-set-overloads.spec.ts` retried forever and died on the
 * 120 s timeout each (which is why the package took twelve minutes), and
 * three `waitForConnection` tests failed fast only because they pass
 * `lazyConnect`. Every other spec in the package hard-codes 6379 and passes.
 *
 * Re-exported rather than copied: titan's setup already knows five ways to
 * find or start a Redis, and a second copy of that logic would drift.
 */
export { setup, teardown } from '../titan/globalSetup.js';
