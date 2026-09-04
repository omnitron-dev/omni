/**
 * DistributedLockService against a real Redis.
 *
 * The existing suite (lock.service.spec.ts) drives the service with a
 * `vi.fn()` Redis whose `eval`/`evalsha` return whatever the test says. That
 * verifies the service CALLS the right script with the right arguments — it
 * cannot verify the lock is a lock. Everything that makes this primitive
 * correct lives in the Lua bodies and in Redis's single-threaded execution:
 *
 *   RELEASE:  if redis.call("get", KEYS[1]) == ARGV[1] then del ... end
 *   EXTEND:   if redis.call("get", KEYS[1]) == ARGV[1] then pexpire ... end
 *
 * and in `SET key value NX PX ttl` for acquisition. None of that is exercised
 * by a stub. titan-scheduler's distributed lock (SC-1) runs on this service in
 * production, so these tests run the real thing.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { RedisManager } from '@omnitron-dev/titan-redis';
import type { IRedisClient } from '@omnitron-dev/titan-redis';

import { DistributedLockService } from '../src/lock.service.js';
import type { ILockModuleOptions } from '../src/lock.types.js';

/** Logical DBs 0-4 belong to the apps/omnitron suites; this package uses 12. */
const TEST_DB = 12;
const TEST_HOST = process.env['TEST_REDIS_HOST'] ?? 'localhost';
const TEST_PORT = Number(process.env['TEST_REDIS_PORT'] ?? 16379);

function silentLogger() {
  const logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => logger,
  };
  return logger;
}

describe('DistributedLockService (real Redis)', () => {
  let manager: RedisManager;
  let client: IRedisClient;
  let service: DistributedLockService;

  const options: ILockModuleOptions = {
    // getLockKey() joins as `${keyPrefix}:${key}`, so no trailing colon here.
    keyPrefix: 'test:lock',
    defaultTtl: 5000,
    defaultRetries: 0,
  };

  beforeAll(async () => {
    manager = new RedisManager(
      { config: { host: TEST_HOST, port: TEST_PORT, db: TEST_DB } } as never,
      silentLogger() as never
    );
    await manager.init();
    client = manager.getClient();
  }, 30_000);

  afterAll(async () => {
    await manager?.destroy();
  });

  beforeEach(async () => {
    // Only our own prefix — never flushdb, which would race any other suite
    // sharing this Redis.
    const keys = await client.keys('test:lock:*');
    if (keys.length > 0) await client.del(...keys);

    service = new DistributedLockService(
      client,
      { logger: silentLogger() } as never,
      options
    );
  });

  describe('mutual exclusion', () => {
    it('grants the lock once and refuses the second holder', async () => {
      const first = await service.acquireLock('order-1', 5000);
      expect(first).toBeTruthy();

      const second = await service.acquireLock('order-1', 5000);
      expect(second).toBeNull();
    });

    it('grants different keys independently', async () => {
      expect(await service.acquireLock('a', 5000)).toBeTruthy();
      expect(await service.acquireLock('b', 5000)).toBeTruthy();
    });

    it('admits exactly one winner under concurrent contention', async () => {
      // The assertion a mocked `eval` can never make: SET NX is atomic in
      // Redis, so of fifty simultaneous callers exactly one may hold the lock.
      const results = await Promise.all(
        Array.from({ length: 50 }, () => service.acquireLock('hot-key', 5000))
      );

      const winners = results.filter((id): id is string => id !== null);
      expect(winners).toHaveLength(1);
      expect(await client.get('test:lock:hot-key')).toBe(winners[0]);
    });
  });

  describe('release is owner-scoped', () => {
    it('releases when the lock id matches', async () => {
      const lockId = await service.acquireLock('order-2', 5000);
      expect(await service.releaseLock('order-2', lockId!)).toBe(true);
      expect(await client.exists('test:lock:order-2')).toBe(0);
    });

    it('refuses to release a lock held by someone else', async () => {
      const lockId = await service.acquireLock('order-3', 5000);

      expect(await service.releaseLock('order-3', 'not-the-owner')).toBe(false);
      // Still held, and still by the original owner — the Lua guard is what
      // keeps a late release from freeing the next holder's lock.
      expect(await client.get('test:lock:order-3')).toBe(lockId);
    });

    it('reports false for a lock that is already gone', async () => {
      expect(await service.releaseLock('never-held', 'whatever')).toBe(false);
    });
  });

  describe('extend is owner-scoped', () => {
    it('extends the ttl for the owner', async () => {
      const lockId = await service.acquireLock('order-4', 1000);

      expect(await service.extendLock('order-4', lockId!, 10_000)).toBe(true);

      const ttl = await client.pttl('test:lock:order-4');
      expect(ttl).toBeGreaterThan(5000);
    });

    it('refuses to extend for a non-owner and leaves the ttl alone', async () => {
      await service.acquireLock('order-5', 1000);
      const before = await client.pttl('test:lock:order-5');

      expect(await service.extendLock('order-5', 'not-the-owner', 60_000)).toBe(false);

      const after = await client.pttl('test:lock:order-5');
      expect(after).toBeLessThanOrEqual(before);
    });
  });

  describe('expiry', () => {
    it('releases the lock when the ttl runs out', async () => {
      const lockId = await service.acquireLock('short-lived', 300);
      expect(lockId).toBeTruthy();

      await new Promise((resolve) => setTimeout(resolve, 600));

      expect(await service.isLocked('short-lived')).toBe(false);
      expect(await service.acquireLock('short-lived', 5000)).toBeTruthy();
    });

    it('reports the remaining ttl', async () => {
      await service.acquireLock('ttl-probe', 5000);
      const ttl = await service.getLockTtl('ttl-probe');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(5000);
    });

    it('reports no ttl for a key that is not locked', async () => {
      expect(await service.getLockTtl('absent')).toBeLessThan(0);
    });
  });

  describe('withLock', () => {
    it('runs the callback under the lock and frees it afterwards', async () => {
      const result = await service.withLock('job-1', async () => {
        expect(await service.isLocked('job-1')).toBe(true);
        return 'done';
      });

      expect(result).toBe('done');
      expect(await service.isLocked('job-1')).toBe(false);
    });

    it('frees the lock when the callback throws', async () => {
      await expect(
        service.withLock('job-2', async () => {
          throw new Error('boom');
        })
      ).rejects.toThrow('boom');

      expect(await service.isLocked('job-2')).toBe(false);
    });

    it('serialises concurrent callers rather than interleaving them', async () => {
      // With retries the second caller waits; the critical section must never
      // be entered twice at once.
      let inside = 0;
      let maxInside = 0;
      const body = async () => {
        inside++;
        maxInside = Math.max(maxInside, inside);
        await new Promise((resolve) => setTimeout(resolve, 50));
        inside--;
      };

      await Promise.all([
        service.withLock('job-3', body, { retries: 10, retryDelay: 30 }),
        service.withLock('job-3', body, { retries: 10, retryDelay: 30 }),
        service.withLock('job-3', body, { retries: 10, retryDelay: 30 }),
      ]);

      expect(maxInside).toBe(1);
    });
  });

  describe('retry budget', () => {
    it('still makes one attempt when retries is 0', async () => {
      // `retries: 0` is how a caller says "try once, do not block". The loop
      // used to be `for (i = 0; i < retries; i++)`, so a 0 skipped the body
      // entirely and withLock threw without ever contacting Redis.
      let ran = false;
      const result = await service.withLock(
        'no-retry',
        async () => {
          ran = true;
          return 'ok';
        },
        { retries: 0 }
      );

      expect(ran).toBe(true);
      expect(result).toBe('ok');
      expect(await service.isLocked('no-retry')).toBe(false);
    });

    it('gives up without blocking when the lock is already held', async () => {
      const held = await service.acquireLock('busy', 5000);
      expect(held).toBeTruthy();

      await expect(
        service.withLock('busy', async () => 'never', { retries: 0 })
      ).rejects.toThrow('after 1 attempt(s)');
    });
  });
});
