/**
 * `recordSent` runs once per notification sent. It updated three time windows,
 * each with a separate `INCR` and a separate `EXPIRE` — six sequential Redis
 * round trips per notification.
 *
 * The separation was also a correctness hole: a process dying between an `INCR`
 * and its `EXPIRE` left a counter key with no TTL, and nothing else removes
 * those. Unbounded growth in the counter namespace, invisible until somebody
 * counts keys. A transaction fixes both — the six commands cost one round trip
 * and either all apply or none do.
 */
import { describe, it, expect, vi } from 'vitest';

import { RedisPreferenceStore } from '../src/redis-preference-store.js';

function fakeRedis() {
  const calls: string[] = [];
  const tx = {
    incr: vi.fn((key: string) => {
      calls.push(`incr:${key}`);
      return tx;
    }),
    expire: vi.fn((key: string, ttl: number) => {
      calls.push(`expire:${key}:${ttl}`);
      return tx;
    }),
    exec: vi.fn(async () => {
      calls.push('exec');
      return [];
    }),
  };
  const redis = {
    multi: vi.fn(() => tx),
    incr: vi.fn(async (key: string) => {
      calls.push(`direct-incr:${key}`);
      return 1;
    }),
    expire: vi.fn(async (key: string) => {
      calls.push(`direct-expire:${key}`);
      return 1;
    }),
  };
  return { redis, calls };
}

describe('RedisPreferenceStore.recordSent', () => {
  it('updates all three windows in one transaction', async () => {
    const { redis, calls } = fakeRedis();
    const store = new RedisPreferenceStore(redis as any);

    await store.recordSent('user-1', 'billing');

    // One exec, and no command issued outside the transaction.
    expect(calls.filter((c) => c === 'exec')).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith('direct-'))).toHaveLength(0);

    // Every INCR is paired with an EXPIRE inside the same transaction, so a
    // counter key can never be created without its TTL.
    const incrs = calls.filter((c) => c.startsWith('incr:')).map((c) => c.slice('incr:'.length));
    const expires = calls.filter((c) => c.startsWith('expire:')).map((c) => c.split(':').slice(1, -1).join(':'));
    expect(incrs).toHaveLength(3);
    expect(expires).toEqual(incrs);
    expect(new Set(incrs.map((k) => k.split(':').at(-2)))).toEqual(new Set(['minute', 'hour', 'day']));
  });
});
