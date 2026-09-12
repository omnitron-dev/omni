/**
 * This package's test helper resolves its Redis through a global setup.
 *
 * `readRedisInfoFile()` looks for `join(process.cwd(), '.redis-test-info.json')`
 * — "published by a globalSetup, if any" — and with none registered the
 * answer was always "none", so every test fell through to
 * `TEST_REDIS_PORT ?? 16379`, the port of the `redis-test` service in the
 * monorepo's `docker-compose.test.yml`. Nothing listens there unless that
 * compose file is up, and the suite was red on main.
 *
 * Re-exported from titan rather than copied: that setup already knows five
 * ways to find or start a Redis (existing on 16379, existing on 6379, a
 * native redis-server, Docker, and finally mock), and a second copy would
 * drift. It still prefers 16379, so nothing changes for a developer who does
 * run the compose stack.
 */
export { setup, teardown } from '../titan/globalSetup.js';
