/**
 * `lock.service.real.spec.ts` drives the service against a real Redis, and
 * resolved it as `TEST_REDIS_PORT ?? 16379` — the `redis-test` service in the
 * monorepo's `docker-compose.test.yml`. With that stack down, nothing listens
 * there, and ioredis retries rather than failing: all 17 tests in the file sat
 * until vitest's 120 s per-test timeout, so the package produced no summary at
 * all inside a 15-minute budget. A suite that hangs reads as "slow" rather
 * than "misconfigured", which is why it went unnoticed.
 *
 * Re-exported from titan rather than copied: that setup already knows five
 * ways to find or start a Redis, and publishes the choice in
 * `.redis-test-info.json` for `resolveTestRedisEndpoint()` to read.
 */
export { setup, teardown } from '../titan/globalSetup.js';
