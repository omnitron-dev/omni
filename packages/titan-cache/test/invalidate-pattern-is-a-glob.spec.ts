/**
 * `invalidatePattern` documents a glob and built an unanchored regex.
 *
 * The old conversion replaced every star with a dot-star and went straight
 * into `clear()`, which does `new RegExp(pattern)` and `regex.test(key)` —
 * no anchors, no escaping. So a pattern naming one key dropped its whole
 * numeric family, a `.` in a key
 * matched any character, and a `{` or `(` in a key fragment made the method
 * throw a SyntaxError at a caller who was only trying to clear a cache.
 */

import { describe, it, expect } from 'vitest';

import { CacheAdapter } from '../src/cache.adapter.js';
import type { ICache } from '../src/cache.types.js';

function fakeCache(keys: string[]) {
  const store = new Set(keys);
  return {
    store,
    cache: {
      get: async () => undefined,
      set: async () => undefined,
      delete: async (k: string) => store.delete(k),
      has: async () => false,
      clear: async (pattern?: string | RegExp) => {
        if (!pattern) return void store.clear();
        const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
        for (const key of [...store]) if (regex.test(key)) store.delete(key);
      },
      getStats: () => ({ hits: 0, misses: 0 }),
    } as unknown as ICache<unknown>,
  };
}

const noopLogger = {
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
  child() { return noopLogger; },
} as any;

function adapterOver(keys: string[]) {
  const { store, cache } = fakeCache(keys);
  const cacheService = { getOrCreateCache: () => cache } as any;
  const adapter = new CacheAdapter(cacheService, { namespace: 'test' } as any, noopLogger);
  return { store, adapter };
}

describe('invalidatePattern', () => {
  it('clears the key it names and not its numeric neighbours', async () => {
    const { store, adapter } = adapterOver(['user:1', 'user:10', 'user:123', 'session:user:1']);
    await adapter.invalidatePattern('user:1');
    expect([...store].sort()).toEqual(['session:user:1', 'user:10', 'user:123']);
  });

  it('anchors the pattern, so a prefix does not match mid-key', async () => {
    const { store, adapter } = adapterOver(['coins:BTC', 'shadow:coins:BTC']);
    await adapter.invalidatePattern('coins:*');
    expect([...store]).toEqual(['shadow:coins:BTC']);
  });

  it('treats a dot in the pattern as a dot', async () => {
    const { store, adapter } = adapterOver(['a.b:1', 'axb:1']);
    await adapter.invalidatePattern('a.b:*');
    expect([...store]).toEqual(['axb:1']);
  });

  it('does not throw on a pattern carrying regex syntax', async () => {
    // An unbalanced `(` or `[` is what actually makes `new RegExp` throw —
    // `{locale}` and `a+b` are accepted as literals — and a path or an
    // expression fragment in a key is where one comes from.
    const { store, adapter } = adapterOver(['route:(ru)/x', 'route:other']);
    await expect(adapter.invalidatePattern('route:(ru)/*')).resolves.toBeUndefined();
    expect([...store]).toEqual(['route:other']);
  });

  it('treats a bracket in the pattern as a bracket, not a character class', async () => {
    const { store, adapter } = adapterOver(['tag:[hot]:1', 'tag:h:1']);
    await adapter.invalidatePattern('tag:[hot]:*');
    expect([...store]).toEqual(['tag:h:1']);
  });

  it('treats a plus in the pattern as a plus', async () => {
    const { store, adapter } = adapterOver(['q:a+b', 'q:aab']);
    await adapter.invalidatePattern('q:a+b');
    expect([...store]).toEqual(['q:aab']);
  });

  it('still expands * to any run of characters, in any position', async () => {
    const { store, adapter } = adapterOver(['wallet:hot:coin:btc', 'wallet:cold:coin:btc', 'asset:hot:coin:btc']);
    await adapter.invalidatePattern('wallet:*:coin:btc');
    expect([...store]).toEqual(['asset:hot:coin:btc']);
  });

  it('clears everything for a bare star', async () => {
    const { store, adapter } = adapterOver(['a', 'b:c', 'd']);
    await adapter.invalidatePattern('*');
    expect([...store]).toEqual([]);
  });
});
