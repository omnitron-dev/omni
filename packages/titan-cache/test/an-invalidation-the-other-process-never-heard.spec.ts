/**
 * The shared row went and every other process kept serving the old value.
 *
 * `MultiTierCache` invalidation deletes from L1 here and from L2 there. L1 is
 * per process, so the copy another process holds is untouched — and
 * `MultiTierCache.set` forwards the caller's `ttl` to L1 as well, so an entry
 * written with a five-minute TTL stays readable in every other process for
 * five minutes after the row it mirrors is gone. Fixing the L2 tag index (see
 * `a-tag-flush-that-left-the-shared-copy.spec.ts`) made the shared copy go;
 * it did not make anyone else notice.
 *
 * The case that found it: `DynamicPolicyService.invalidateForRole` in
 * daos/main flushes the permission sets of everyone holding an edited role.
 * With one http process the window is empty; it opens the moment http is
 * scaled out, which is what the Redis L2 tier exists for.
 *
 * `broadcastInvalidations` publishes what was forgotten so the other L1s can
 * forget it too. Delivery is at most once: a message that does not arrive
 * leaves that process stale until its TTL, so the TTL stays the backstop and
 * must not be raised because this exists.
 *
 * ── Which process actually goes stale ───────────────────────────────────────
 *
 * Only one that PROMOTED the entry into its own L1. A process that has merely
 * read through to L2 holds nothing, and once the shared row is deleted its
 * next read misses and re-resolves — it was already correct. Promotion here
 * takes `promotionThreshold` reads (3, the value `CacheService` configures),
 * which is exactly what a permission check on a busy account produces, so the
 * stale copy lives on the hottest keys rather than the coldest.
 *
 * The first version of this file asserted the defect on a process that had
 * never promoted the key, and the assertion was wrong in the safe direction:
 * B answered `undefined` because the invalidation HAD reached it, through the
 * shared row. Warming L1 is not test decoration; it is the precondition.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { MultiTierCache, MemoryL2Adapter } from '../src/multi-tier-cache.js';
import type { IL2CacheAdapter } from '../src/multi-tier-cache.js';

/**
 * One store, one channel, two processes. `MemoryL2Adapter` is shared by
 * reference the way Redis is shared by address; each adapter gets its own
 * handler list, so a publish reaches the other subscriber and not itself
 * except through the channel — exactly the shape the origin filter is for.
 */
class Bus {
  readonly handlers = new Set<(m: string) => void>();
  published: string[] = [];
  publish(message: string): void {
    this.published.push(message);
    for (const h of this.handlers) h(message);
  }
}

function adapterOn(store: MemoryL2Adapter, bus: Bus | null): IL2CacheAdapter {
  const base: IL2CacheAdapter = {
    get: (k) => store.get(k),
    set: (k, v, t) => store.set(k, v, t),
    delete: (k) => store.delete(k),
    exists: (k) => store.exists(k),
    keys: (p) => store.keys(p),
    mget: (k) => store.mget(k),
    mset: (e, t) => store.mset(e, t),
    expire: (k, t) => store.expire(k, t),
    ttl: (k) => store.ttl(k),
    flush: (p) => store.flush(p),
  };
  if (!bus) return base;
  return {
    ...base,
    publishInvalidation: async (message) => {
      bus.publish(message);
    },
    subscribeInvalidation: async (handler) => {
      bus.handlers.add(handler);
      return async () => {
        bus.handlers.delete(handler);
      };
    },
  };
}

const live: MultiTierCache<string>[] = [];
afterEach(async () => {
  for (const c of live.splice(0)) await c.dispose();
});

function pair(broadcast: boolean, name = 'perms') {
  const store = new MemoryL2Adapter();
  const bus = new Bus();
  const make = () => {
    const c = new MultiTierCache<string>({
      name,
      l1: { maxSize: 100, ttl: 300 },
      l2: { client: adapterOn(store, broadcast ? bus : null), ttl: 300, prefix: '' },
      writeStrategy: 'through',
      trackL2Tags: true,
      broadcastInvalidations: broadcast,
    });
    live.push(c);
    return c;
  };
  return { a: make(), b: make(), bus };
}

/** The subscription is established off the constructor; let it settle. */
const settle = () => new Promise((r) => setImmediate(r));

/** Read until B promotes the key into its own L1 — the state that goes stale. */
async function warm(cache: MultiTierCache<string>, key: string): Promise<void> {
  for (let i = 0; i < 3; i++) await cache.get(key);
  const inL1 = await cache.getL1().get(key);
  expect(inL1, `${key} did not reach L1; the premise of this test is gone`).toBeDefined();
}

describe('two processes over one store', () => {
  it('without the broadcast, B keeps serving what A deleted', async () => {
    const { a, b } = pair(false);
    await a.set('user:1', 'old', { tags: ['role:manager'] });
    await warm(b, 'user:1');

    await a.invalidateByTags(['role:manager']);
    await settle();

    expect(await b.get('user:1')).toBe('old');
  });

  it('with it, B forgets what A invalidated by tag', async () => {
    const { a, b } = pair(true);
    await a.set('user:1', 'old', { tags: ['role:manager'] });
    await warm(b, 'user:1');

    await a.invalidateByTags(['role:manager']);
    await settle();

    expect(await b.get('user:1')).toBeUndefined();
  });

  it('and what A deleted by key', async () => {
    const { a, b } = pair(true);
    await a.set('user:1', 'old');
    await warm(b, 'user:1');

    await a.delete('user:1');
    await settle();

    expect(await b.get('user:1')).toBeUndefined();
  });

  it('and everything, when A cleared', async () => {
    const { a, b } = pair(true);
    await a.set('user:1', 'old');
    await a.set('user:2', 'older');
    await warm(b, 'user:1');
    await warm(b, 'user:2');

    await a.clear();
    await settle();

    expect(await b.get('user:1')).toBeUndefined();
    expect(await b.get('user:2')).toBeUndefined();
  });

  it('a message names one cache and leaves the others alone', async () => {
    // Several caches can share one L2 prefix and one channel. A flush of
    // `perms` must not empty `sessions`.
    const store = new MemoryL2Adapter();
    const bus = new Bus();
    const make = (name: string) => {
      const c = new MultiTierCache<string>({
        name,
        l1: { maxSize: 100, ttl: 300 },
        l2: { client: adapterOn(store, bus), ttl: 300, prefix: '' },
        writeStrategy: 'through',
        broadcastInvalidations: true,
      });
      live.push(c);
      return c;
    };
    const perms = make('perms');
    const sessions = make('sessions');
    await sessions.set('user:1', 'session');
    await settle();

    // `perms.delete` removes the SHARED row, so this asserts on what
    // `sessions` holds in its own L1 — which is the thing a cross-talking
    // message would wrongly drop.
    await perms.delete('user:1');
    await settle();

    expect(await sessions.getL1().get('user:1')).toBe('session');
  });

  it('an invalidation still happens when the broadcast cannot go out', async () => {
    // The publish is the last thing, and its failure is the other processes'
    // problem, never the caller's.
    const store = new MemoryL2Adapter();
    const broken: IL2CacheAdapter = {
      ...adapterOn(store, null),
      publishInvalidation: async () => {
        throw new Error('redis down');
      },
      subscribeInvalidation: async () => async () => {},
    };
    const c = new MultiTierCache<string>({
      name: 'perms',
      l1: { maxSize: 100, ttl: 300 },
      l2: { client: broken, ttl: 300, prefix: '' },
      writeStrategy: 'through',
      broadcastInvalidations: true,
    });
    live.push(c);
    await c.set('user:1', 'old');

    await expect(c.delete('user:1')).resolves.toBe(true);
    expect(await c.get('user:1')).toBeUndefined();
  });

  it('the flag alone is not the guarantee — an adapter that cannot carry it says so', () => {
    const store = new MemoryL2Adapter();
    const c = new MultiTierCache<string>({
      name: 'perms',
      l2: { client: adapterOn(store, null), prefix: '' },
      broadcastInvalidations: true,
    });
    live.push(c);
    expect(c.isInvalidationBroadcastActive()).toBe(false);
  });

  it('and one that can', async () => {
    const { a } = pair(true);
    expect(a.isInvalidationBroadcastActive()).toBe(true);
  });

  it('a promoted entry carries no tags, which is why the message carries keys', async () => {
    // The load-bearing fact. L2 holds the serialised value and nothing else,
    // so B's copy — promoted out of L2 — has no tag metadata and a tag flush
    // there finds nothing. Drop the keys from the message and the tag case
    // stops working for exactly the processes it exists to reach.
    const { a, b } = pair(true);
    await a.set('user:1', 'old', { tags: ['role:manager'] });
    await warm(b, 'user:1');

    expect(await b.getL1().invalidateByTags(['role:manager'])).toBe(0);
    expect(await b.getL1().get('user:1')).toBe('old');
  });

  it('a tag flush publishes the tags AND the keys it resolved', async () => {
    const { a, bus } = pair(true);
    await a.set('user:1', 'old', { tags: ['role:manager'] });
    await a.set('user:2', 'older', { tags: ['role:manager'] });

    await a.invalidateByTags(['role:manager']);

    const sent = JSON.parse(bus.published.at(-1)!) as { t: string[]; k: string[] };
    expect(sent.t).toEqual(['role:manager']);
    expect([...sent.k].sort()).toEqual(['user:1', 'user:2']);
  });

  it('a publisher does not re-apply its own message', async () => {
    // Redis delivers a published message to every subscriber of the channel,
    // the publisher's own connection included, and delivery is asynchronous.
    // This is NOT a correctness guarantee — the value the echo would drop
    // still sits in L2, so a later read re-resolves it. What it costs is the
    // L1 copy of a value written AFTER the invalidation: the echo evicts it,
    // and the next reads go to the store until promotion earns it back. On
    // the hot key an invalidation is usually about, that is the whole point
    // of having an L1.
    const { a, bus } = pair(true);
    await a.set('user:1', 'old');

    await a.delete('user:1');
    const echo = bus.published.at(-1)!;

    // The re-read that follows an invalidation, resolving the new value.
    await a.set('user:1', 'new');
    // …and only now does the echo arrive.
    for (const h of bus.handlers) h(echo);
    await settle();

    expect(await a.getL1().get('user:1')).toBe('new');
    expect(await a.get('user:1')).toBe('new');
  });

  it('the same for a tag flush, which drops several keys at once', async () => {
    const { a, bus } = pair(true);
    await a.set('user:1', 'old', { tags: ['role:manager'] });

    await a.invalidateByTags(['role:manager']);
    const echo = bus.published.at(-1)!;

    await a.set('user:1', 'new', { tags: ['role:manager'] });
    for (const h of bus.handlers) h(echo);
    await settle();

    expect(await a.getL1().get('user:1')).toBe('new');
  });

  it('and for a clear, where the echo would empty the whole L1 a second time', async () => {
    const { a, bus } = pair(true);
    await a.set('user:1', 'old');

    await a.clear();
    const echo = bus.published.at(-1)!;

    await a.set('user:1', 'new');
    await a.set('user:2', 'also new');
    for (const h of bus.handlers) h(echo);
    await settle();

    expect(await a.getL1().get('user:1')).toBe('new');
    expect(await a.getL1().get('user:2')).toBe('also new');
  });

  it('the message says who sent it, which cache, and what to forget', async () => {
    const { a, bus } = pair(true);
    await a.set('user:1', 'old');
    await a.delete('user:1');

    expect(bus.published.length).toBe(1);
    const sent = JSON.parse(bus.published[0]!) as { o: string; n: string; k: string };
    expect(sent.n).toBe('perms');
    expect(sent.k).toBe('user:1');
    expect(typeof sent.o).toBe('string');
  });

  it('a message that is not ours does not take down the listener', async () => {
    const { a, b, bus } = pair(true);
    await b.set('user:1', 'old');
    await settle();

    bus.publish('not json');
    bus.publish(JSON.stringify({ o: 'someone', n: 'perms' })); // nothing to forget
    bus.publish(JSON.stringify({ o: 'someone', n: 'perms', t: [1, 2] })); // wrong shape
    await settle();

    expect(await b.getL1().get('user:1')).toBe('old');

    // And the listener is still live.
    await a.delete('user:1');
    await settle();
    expect(await b.getL1().get('user:1')).toBeUndefined();
  });
});
