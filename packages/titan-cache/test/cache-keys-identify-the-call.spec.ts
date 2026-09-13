/**
 * A cache key must distinguish two different calls.
 *
 * `stringifyArg` was JSON.stringify with a `String(arg)` fallback, and every
 * way it fell back produced a key two different arguments could share. In a
 * cache, that is one caller being served another caller's result.
 */

import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Cacheable } from '../src/cache.decorators.js';

function fakeCacheService() {
  const store = new Map<string, unknown>();
  const service = {
    getCache: () => ({
      get: async (k: string) => store.get(k),
      set: async (k: string, v: unknown) => void store.set(k, v),
      delete: async (k: string) => store.delete(k),
      clear: async () => store.clear(),
      invalidateByTags: async () => 0,
    }),
  };
  return { store, service };
}

let cacheService: ReturnType<typeof fakeCacheService>;

beforeEach(() => {
  cacheService = fakeCacheService();
});

class Svc {
  cacheService: unknown;
  calls: unknown[][] = [];

  constructor(service: unknown) {
    this.cacheService = service;
  }

  @Cacheable({ keyPrefix: 'svc' })
  async run(...args: unknown[]): Promise<number> {
    this.calls.push(args);
    return this.calls.length;
  }
}

function svc() {
  return new Svc(cacheService.service);
}

describe('two different arguments never share a key', () => {
  it('distinguishes BigInt amounts inside an object', async () => {
    const s = svc();
    expect(await s.run({ amount: 1n, coin: 'BTC' })).toBe(1);
    expect(await s.run({ amount: 2n, coin: 'XMR' })).toBe(2);
  });

  it('distinguishes a bare BigInt from the number beside it', async () => {
    const s = svc();
    expect(await s.run(1n)).toBe(1);
    expect(await s.run(1)).toBe(2);
  });

  it('distinguishes two different cyclic arguments', async () => {
    const a: any = { name: 'a' };
    a.self = a;
    const b: any = { name: 'b' };
    b.self = b;

    const s = svc();
    expect(await s.run(a)).toBe(1);
    expect(await s.run(b)).toBe(2);
  });

  // A string and a number with the same text DO share a key, on purpose: the
  // alternative is quoting every scalar, which stops every
  // `@CacheInvalidate({ keyPattern })` from matching the keys @Cacheable
  // writes. One parameter position has one type; the pattern contract is used.
  it('keeps a scalar readable, so keyPattern can still target the key', async () => {
    const s = svc();
    expect(await s.run(42)).toBe(1);
    expect(await s.run('42')).toBe(1);
    expect([...cacheService.store.keys()]).toEqual(['svc:run:42']);
  });

  it('does not let one argument absorb the next across the : separator', async () => {
    const s = svc();
    expect(await s.run('a:b', 'c')).toBe(1);
    expect(await s.run('a', 'b:c')).toBe(2);
  });

  it('distinguishes a string from the composite whose rendering it copies', async () => {
    const s = svc();
    expect(await s.run({ a: 1 })).toBe(1);
    expect(await s.run('{a:1}')).toBe(2);
    expect(await s.run([1, 2])).toBe(3);
    expect(await s.run('[1,2]')).toBe(4);
  });
});

describe('the same argument always produces the same key', () => {
  it('ignores object key insertion order', async () => {
    const s = svc();
    expect(await s.run({ a: 1, b: 2 })).toBe(1);
    expect(await s.run({ b: 2, a: 1 })).toBe(1);
  });

  it('hits on a repeated call', async () => {
    const s = svc();
    expect(await s.run('same')).toBe(1);
    expect(await s.run('same')).toBe(1);
    expect(s.calls).toHaveLength(1);
  });

  it('keys a Date by its instant, not its identity', async () => {
    const s = svc();
    expect(await s.run(new Date('2026-01-01T00:00:00Z'))).toBe(1);
    expect(await s.run(new Date('2026-01-01T00:00:00Z'))).toBe(1);
    expect(await s.run(new Date('2026-01-02T00:00:00Z'))).toBe(2);
  });
});

describe('an argument that identifies nothing', () => {
  it('runs the method every time instead of sharing one entry', async () => {
    const s = svc();
    expect(await s.run(() => 'x')).toBe(1);
    expect(await s.run(() => 'y')).toBe(2);
    expect(await s.run(() => 'z')).toBe(3);
  });

  it('caches nothing at all for such a call', async () => {
    const s = svc();
    await s.run(Symbol('a'));
    expect(cacheService.store.size).toBe(0);
  });
});
