/**
 * A tag invalidation that dropped the local copy and left the shared one.
 *
 * `MultiTierCache` holds L1 in this process and L2 in Redis. `invalidateByTags`
 * flushes L1 — where the LRU stores tags natively — and then walks
 * `l2TagIndex` for L2. That index is only written when `trackL2Tags` is on,
 * and it is `false` by default (`options.trackL2Tags ?? false`).
 *
 * So by default a tag flush removes the entry from THIS process and leaves it
 * in Redis, where the very next read finds it and promotes it back into L1.
 * The call returns a count and reports success; nothing was durably dropped.
 *
 * Found through a permission cache. `DynamicPolicyService.invalidateForRole`
 * exists so that editing a role's `permissions[]` drops every cached set that
 * consumed it — its own comment calls a miss here «Critical security gap» —
 * and it flushes by tag. Measured on the daos stand 2026-09-20: a platform
 * admin removed `org.products.list` from a role, the database showed it gone,
 * the flush ran, and the holder kept reading the gated endpoint until the
 * five-minute TTL expired.
 *
 * The suite had a test named `should invalidate L1 entries by tags`. It set
 * the tagged entry on `getL1()` directly — never through the multi-tier write
 * path, so no L2 copy existed — and asserted
 * `expect(invalidated).toBeGreaterThanOrEqual(0)`, which every possible
 * outcome satisfies, this defect included.
 *
 * ── What `trackL2Tags` still does not buy ───────────────────────────────────
 *
 * `l2TagIndex` is a `Map` in THIS process, capped and swept. It cannot know
 * about an entry another process wrote, and a restart starts it empty while
 * Redis keeps the rows. Turning it on makes a flush reach the shared copy of
 * what this process cached; it does not make tag invalidation cross-process.
 * A guarantee that has to hold across processes needs the index in Redis.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { MultiTierCache, MemoryL2Adapter } from '../src/multi-tier-cache.js';

let cache: MultiTierCache<string> | undefined;

afterEach(async () => {
  if (cache) await cache.dispose();
  cache = undefined;
});

function build(trackL2Tags: boolean) {
  const l2 = new MemoryL2Adapter();
  cache = new MultiTierCache<string>({
    l1: { maxSize: 100 },
    l2: { client: l2, ttl: 300, prefix: '' },
    writeStrategy: 'through',
    trackL2Tags,
  });
  return { cache: cache!, l2 };
}

describe('a tagged entry written through both tiers', () => {
  it('survives its own flush when the L2 tag index is off — the default', async () => {
    const { cache: c } = build(false);
    await c.set('user:1:org:a', 'permissions', { tags: ['role:manager'] });

    const dropped = await c.invalidateByTags(['role:manager']);

    // The flush reports what it removed from L1 and says nothing about L2.
    expect(dropped).toBeGreaterThanOrEqual(0);
    // And the value the caller asked to have removed is still readable.
    expect(await c.get('user:1:org:a')).toBe('permissions');
  });

  it('is gone from both tiers when the index is on', async () => {
    const { cache: c } = build(true);
    await c.set('user:1:org:a', 'permissions', { tags: ['role:manager'] });

    await c.invalidateByTags(['role:manager']);

    expect(await c.get('user:1:org:a')).toBeUndefined();
  });

  it('and the shared row itself is gone, not merely the local one', async () => {
    // Read through the adapter, so a promotion cannot make a live L2 row look
    // like an absent one — or an absent one like a live one.
    const { cache: c, l2 } = build(true);
    await c.set('user:1:org:a', 'permissions', { tags: ['role:manager'] });
    expect(await l2.get('user:1:org:a')).toBeTruthy();

    await c.invalidateByTags(['role:manager']);

    expect(await l2.get('user:1:org:a')).toBeFalsy();
  });

  it('a tag nobody used removes nothing', async () => {
    const { cache: c } = build(true);
    await c.set('user:1:org:a', 'permissions', { tags: ['role:manager'] });

    await c.invalidateByTags(['role:auditor']);

    expect(await c.get('user:1:org:a')).toBe('permissions');
  });

  it('one of several tags on an entry is enough to drop it', async () => {
    const { cache: c } = build(true);
    await c.set('user:1:org:a', 'permissions', {
      tags: ['user:1', 'role:manager', 'role:courier'],
    });

    await c.invalidateByTags(['role:courier']);

    expect(await c.get('user:1:org:a')).toBeUndefined();
  });

  it('the cache says which of the two it is', () => {
    // A caller that depends on the guarantee can ask rather than assume.
    expect(build(false).cache.isL2TagTrackingEnabled()).toBe(false);
    expect(build(true).cache.isL2TagTrackingEnabled()).toBe(true);
  });
});

/**
 * And the flag had no way in.
 *
 * `MultiTierCacheOptions.trackL2Tags` has existed all along; every cache built
 * through `CacheService` goes through `createMultiTierCache`, which assembled
 * its options field by field and did not include it. So the option was
 * unreachable from the module surface — declared, documented, and impossible
 * to set. See [[dead_operator_knobs]].
 */
describe('the option reaches the cache it configures', () => {
  it('a cache created through the service honours trackL2Tags', async () => {
    const { CacheService } = await import('../src/cache.service.js');
    const svc = new CacheService({ multiTier: true });
    try {
      const off = svc.getOrCreateCache('off', { multiTier: true }) as unknown as {
        isL2TagTrackingEnabled(): boolean;
      };
      const on = svc.getOrCreateCache('on', { multiTier: true, trackL2Tags: true }) as unknown as {
        isL2TagTrackingEnabled(): boolean;
      };
      expect(off.isL2TagTrackingEnabled()).toBe(false);
      expect(on.isL2TagTrackingEnabled()).toBe(true);
      // Every flag `MultiTierCacheOptions` declares has to survive the trip
      // through `createMultiTierCache`, which builds its options field by
      // field. This one was added after `trackL2Tags` and would have been
      // dropped the same way; the compiler caught it only because the module
      // options interface was missing it too.
      const broadcast = svc.getOrCreateCache('bcast', {
        multiTier: true,
        broadcastInvalidations: true,
        l2: {
          client: {
            get: async () => null,
            set: async () => {},
            delete: async () => false,
            exists: async () => false,
            keys: async () => [],
            mget: async () => [],
            mset: async () => {},
            expire: async () => {},
            ttl: async () => -1,
            flush: async () => {},
            publishInvalidation: async () => {},
            subscribeInvalidation: async () => async () => {},
          },
        },
      }) as unknown as { isInvalidationBroadcastActive(): boolean };
      expect(broadcast.isInvalidationBroadcastActive()).toBe(true);
    } finally {
      await svc.dispose();
    }
  });
});
