/**
 * `localStorage` in a browser that refuses to have one.
 *
 * The console read three keys while the project store was being
 * constructed — at import, above every error boundary. In a browser
 * configured to block site data, touching `localStorage` throws, so that
 * browser got a blank page and no reason for it.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

import { readStored, writeStored, removeStored, readStoredJson, writeStoredJson } from '../../webapp/src/utils/storage.js';

/** Install a `localStorage` for this test; `undefined` removes it entirely. */
function withStorage(impl: unknown): void {
  Object.defineProperty(globalThis, 'localStorage', { value: impl, configurable: true, writable: true });
}

const hostile = {
  get getItem() {
    throw new Error('SecurityError: The operation is insecure.');
  },
  get setItem() {
    throw new Error('SecurityError: The operation is insecure.');
  },
  get removeItem() {
    throw new Error('SecurityError: The operation is insecure.');
  },
};

function working() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

afterEach(() => {
  // @ts-expect-error — removing the property is the point
  delete globalThis.localStorage;
});

describe('storage — when it works', () => {
  it('round-trips a value', () => {
    withStorage(working());
    writeStored('k', 'v');
    expect(readStored('k')).toBe('v');
    removeStored('k');
    expect(readStored('k')).toBeNull();
  });

  it('round-trips JSON', () => {
    withStorage(working());
    writeStoredJson('k', { a: 1 });
    expect(readStoredJson('k', { a: 0 })).toEqual({ a: 1 });
  });

  it('reports an absent key as the fallback, not as an empty object', () => {
    withStorage(working());
    expect(readStoredJson('missing', { seeded: true })).toEqual({ seeded: true });
  });
});

describe('storage — when it does not', () => {
  it('survives a localStorage that throws on access', () => {
    // Not a hypothetical: Firefox's "block all cookies" makes the property
    // itself throw, so even a read has to be guarded.
    withStorage(hostile);

    expect(() => readStored('k')).not.toThrow();
    expect(readStored('k')).toBeNull();
    expect(() => writeStored('k', 'v')).not.toThrow();
    expect(() => removeStored('k')).not.toThrow();
    expect(readStoredJson('k', 'fallback')).toBe('fallback');
    expect(() => writeStoredJson('k', { a: 1 })).not.toThrow();
  });

  it('survives no localStorage at all', () => {
    withStorage(undefined);

    expect(readStored('k')).toBeNull();
    expect(() => writeStored('k', 'v')).not.toThrow();
  });

  it('survives a full quota on write', () => {
    const store = working();
    const full = { ...store, setItem: vi.fn(() => { throw new Error('QuotaExceededError'); }) };
    withStorage(full);

    expect(() => writeStored('k', 'v')).not.toThrow();
    expect(() => writeStoredJson('k', { a: 1 })).not.toThrow();
  });

  it('falls back rather than throwing on corrupt JSON', () => {
    // Half-written by a tab closed mid-save, or written by an older version
    // with a different shape.
    const store = working();
    store.map.set('k', '{"a":');
    withStorage(store);

    expect(readStoredJson('k', { a: 0 })).toEqual({ a: 0 });
  });

  it('does not store a value it cannot serialise', () => {
    const store = working();
    withStorage(store);

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => writeStoredJson('k', circular)).not.toThrow();
    expect(store.map.has('k')).toBe(false);
  });
});
