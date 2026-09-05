/**
 * `SET key value EX n NX` must typecheck and behave atomically.
 *
 * `IRedisClient.set` had five overloads and none combined an expiry with an
 * existence condition — so the canonical "claim this key for N seconds if
 * nobody else has" did not compile, though Redis and ioredis have always
 * accepted it.
 *
 * The compile error is the smaller half. With expiry and NX unavailable
 * together, the shape the types DID permit is `set(k, v, 'NX')` followed by a
 * separate `expire(k, n)` — two round trips with a window between them, and a
 * crash in that window leaves a key with no TTL at all. For a dedup key that
 * means the event is suppressed forever; for a lock, held forever.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Redis } from 'ioredis';

import type { IRedisClient } from '../src/redis.interfaces.js';
import { getTestRedisConfig } from './utils/redis-test-utils.js';

describe('IRedisClient.set expiry + condition', () => {
  let raw: Redis;
  let client: IRedisClient;
  const key = 'set-overload:dedup';

  beforeAll(async () => {
    const { host, port, db } = getTestRedisConfig(15);
    raw = new Redis({ host, port, db, maxRetriesPerRequest: null });
    // The interface is structural over the real client; this is the type the
    // documented dedup recipe uses.
    client = raw as unknown as IRedisClient;
  });

  afterAll(async () => {
    await raw.quit().catch(() => undefined);
  });

  beforeEach(async () => {
    await raw.del(key);
  });

  it('claims a key with a TTL in one round trip', async () => {
    const first = await client.set(key, '1', 'EX', 60, 'NX');
    expect(first).toBe('OK');

    // The TTL is set by the same command — never a separate expire().
    const ttl = await raw.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('refuses a second claim while the key lives', async () => {
    await client.set(key, '1', 'EX', 60, 'NX');

    const second = await client.set(key, '2', 'EX', 60, 'NX');
    expect(second).toBeNull();
    expect(await raw.get(key)).toBe('1');
  });

  it('accepts the condition-first argument order too', async () => {
    // ioredis accepts either order; both are now declared.
    const ok = await client.set(key, '1', 'NX', 'EX', 60);
    expect(ok).toBe('OK');
    expect(await raw.ttl(key)).toBeGreaterThan(0);
  });

  it('supports millisecond expiry', async () => {
    const ok = await client.set(key, '1', 'PX', 60_000, 'NX');
    expect(ok).toBe('OK');

    const pttl = await raw.pttl(key);
    expect(pttl).toBeGreaterThan(0);
    expect(pttl).toBeLessThanOrEqual(60_000);
  });

  it('KEEPTTL replaces the value without resetting the expiry', async () => {
    await client.set(key, 'first', 'EX', 60, 'NX');
    const before = await raw.ttl(key);

    await client.set(key, 'second', 'KEEPTTL');

    expect(await raw.get(key)).toBe('second');
    const after = await raw.ttl(key);
    expect(after).toBeGreaterThan(0);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
  });
});
