import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { getTestRedisConfig, toTestDb } from './test-utils.js';

/**
 * Regression guard for the endpoint the whole suite connects to.
 *
 * The suite used to fall back to `redis://localhost:6379` — the DEFAULT Redis
 * port — while docker-compose.test.yml publishes the test instance on 16379.
 * Nothing listened on 6379, so every ioredis client emitted
 * `[ioredis] Unhandled error event: AggregateError` and all 58 tests in the
 * package failed for one reason that had nothing to do with discovery.
 */
describe('getTestRedisConfig', () => {
  it('never falls back to the default Redis port', () => {
    // Still the sharpest line in this file. A Redis answering on 6379 is
    // whatever the developer happens to run — here, the downstream dev stand, whose
    // db0..db5 are main/storage/messaging/pricing/payments/geo. This suite
    // calls `flushdb`, so borrowing that endpoint erases a live database and
    // reports a clean run. titan's globalSetup now refuses 6379 unless
    // `TEST_REDIS_ALLOW_DEFAULT_PORT=true` says otherwise, and provisions an
    // isolated instance instead.
    const config = getTestRedisConfig();
    expect(config.port).not.toBe(6379);
  });

  it('defaults to the compose test port when nothing overrides it', () => {
    const expectedPort = Number(process.env['TEST_REDIS_PORT'] ?? 16379);
    const config = getTestRedisConfig();

    // A globalSetup info file or globalThis.globalRedis legitimately wins over
    // the default; assert the default only when neither is in play.
    //
    // Both mechanisms, not one. The prose here always said "info file or
    // globalThis" and the code only looked at `globalThis` — which the setup
    // sets in the MAIN process, where these workers never see it. So once a
    // globalSetup was registered the file won, this test compared against the
    // compose default anyway, and failed on a correctly configured run.
    const overridden =
      (globalThis as { globalRedis?: unknown }).globalRedis !== undefined ||
      existsSync(join(process.cwd(), '.redis-test-info.json'));
    if (!overridden) {
      expect(config.port).toBe(expectedPort);
      expect(config.host).toBe(process.env['TEST_REDIS_HOST'] ?? 'localhost');
    }
  });

  it('builds a url that agrees with host, port and db', () => {
    // The db is no longer the caller's to choose — concurrent spec files
    // picking their own is what let one file's `cleanupRedis` delete another
    // file's nodes (see redis-db-isolation.spec.ts). What this line was
    // actually guarding is that the url and the fields describe ONE endpoint,
    // and that still holds against whatever the partition returns.
    const config = getTestRedisConfig(7);
    expect(config.db).toBe(toTestDb());
    expect(config.url).toBe(`redis://${config.host}:${config.port}/${config.db}`);
  });
});
