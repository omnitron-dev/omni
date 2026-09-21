/**
 * Every named cache in a process shared one L2 keyspace, so any clear emptied
 * all of them.
 *
 * `MultiTierCache.getL2Key` is `prefix + key`, and `CacheService` handed every
 * cache the SAME prefix — the module's. The cache's name appeared nowhere in
 * the key. Two consequences, and only the second needs bad luck to be absent:
 *
 *   - A key collision needs two caches to produce the same string. In daos
 *     they mostly do not: five MFA caches carry literal prefixes, permissions
 *     are `user:<uuid>:org:<uuid>`, tags are `popular:<n>`. What is left is
 *     `users`, `sessions` and `organizations`, each keyed on a bare UUID from
 *     a different table. Latent.
 *
 *   - `clear()` needs no luck at all. It is
 *     `l2Adapter.flush(keyPrefix + (pattern ?? '*'))`, so with an empty prefix
 *     one cache's clear deletes EVERY cache's rows.
 *
 * Measured on the daos stand 2026-09-21. Before: five keys — a resolved
 * permission set for a signed-in user, two RBAC entries, a geo country list,
 * and `current`. One `adminSetCountrySupported` call, which ends in
 * `geoCache.clear()`: none. Eight admin geolocation mutations call it, and
 * `rbac.service.ts` has one more.
 *
 * The one that is not merely wasteful: `mfaPending` holds which factors a
 * login has completed and has no durable backing, so editing the country list
 * dropped every login waiting on its second factor.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { CacheService } from '../src/cache.service.js';
import { MemoryL2Adapter } from '../src/multi-tier-cache.js';

let svc: CacheService | undefined;
afterEach(async () => {
  if (svc) await svc.dispose();
  svc = undefined;
});

/** One store for the whole service, the way one Redis serves one backend. */
function build(prefix = 'main:cache:') {
  const store = new MemoryL2Adapter();
  svc = new CacheService({
    multiTier: true,
    l2: { client: store, ttl: 300, prefix },
  });
  return { svc: svc!, store };
}

const keysIn = async (store: MemoryL2Adapter) => (await store.keys('*')).sort();

describe('two caches, one store', () => {
  it('the same key in two caches is two rows', async () => {
    const { svc: s, store } = build();
    const users = s.getOrCreateCache<string>('users', { multiTier: true });
    const sessions = s.getOrCreateCache<string>('sessions', { multiTier: true });
    const id = '019f25eb-d254-74e2-b69c-014190bd32e5';

    await users.set(id, 'the user');
    await sessions.set(id, 'the session');

    expect(await users.get(id)).toBe('the user');
    expect(await sessions.get(id)).toBe('the session');
    expect(await keysIn(store)).toEqual([
      `main:cache:sessions:${id}`,
      `main:cache:users:${id}`,
    ]);
  });

  it('clearing one leaves the other untouched', async () => {
    const { svc: s, store } = build();
    const geo = s.getOrCreateCache<string>('geolocation', { multiTier: true });
    const perms = s.getOrCreateCache<string>('org-permissions', { multiTier: true });
    const mfa = s.getOrCreateCache<string>('mfaPending', { multiTier: true });
    await geo.set('countries:all', 'list');
    await perms.set('user:u1:org:o1', 'resolved');
    await mfa.set('mfa:pending:s1', 'second factor outstanding');

    // What eight admin geolocation mutations do.
    await geo.clear();

    expect(await geo.get('countries:all')).toBeUndefined();
    expect(await perms.get('user:u1:org:o1')).toBe('resolved');
    expect(await mfa.get('mfa:pending:s1')).toBe('second factor outstanding');
    expect(await keysIn(store)).toEqual([
      'main:cache:mfaPending:mfa:pending:s1',
      'main:cache:org-permissions:user:u1:org:o1',
    ]);
  });

  it('and deleting one key does not reach the other cache’s row', async () => {
    // Asserted on the STORE, not through `sessions.get`: that would answer
    // from its own L1 whether or not the shared row survived, and passed
    // under the defect.
    const { svc: s, store } = build();
    const users = s.getOrCreateCache<string>('users', { multiTier: true });
    const sessions = s.getOrCreateCache<string>('sessions', { multiTier: true });
    const id = 'shared-id';
    await users.set(id, 'the user');
    await sessions.set(id, 'the session');

    await users.delete(id);

    expect(await users.get(id)).toBeUndefined();
    expect(await keysIn(store)).toEqual([`main:cache:sessions:${id}`]);
    expect((await store.get(`main:cache:sessions:${id}`))?.toString('utf-8')).toBe('"the session"');
  });

  it('the module’s own prefix still leads, so backends stay apart', async () => {
    const { svc: s, store } = build('geo:cache:');
    const c = s.getOrCreateCache<string>('geolocation', { multiTier: true });
    await c.set('countries:all', 'list');

    expect(await keysIn(store)).toEqual(['geo:cache:geolocation:countries:all']);
  });

  it('a cache reads back what it wrote through the shared store', async () => {
    // The control. Every assertion above is about rows NOT being touched;
    // without this one they would all pass on a cache that stores nothing.
    const { svc: s } = build();
    const c = s.getOrCreateCache<string>('users', { multiTier: true });
    await c.set('u1', 'value');
    expect(await c.get('u1')).toBe('value');
    expect(await c.getL1?.().get('u1')).toBe('value');
  });
});
