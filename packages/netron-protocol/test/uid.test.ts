import { describe, it, expect } from 'vitest';
import { Uid, MAX_UID_VALUE } from '../src/index.js';

describe('Uid', () => {
  it('generates a sequential counter starting at 1', () => {
    const uid = new Uid();
    expect(uid.next()).toBe(1);
    expect(uid.next()).toBe(2);
    expect(uid.next()).toBe(3);
  });

  it('continues from an explicit initial value', () => {
    const uid = new Uid(10);
    expect(uid.next()).toBe(11);
  });

  it('wraps around to 1 at MAX_UID_VALUE instead of throwing', () => {
    const uid = new Uid(MAX_UID_VALUE - 1);
    expect(uid.next()).toBe(MAX_UID_VALUE);
    // The next tick wraps to 1 (circular counter — never throws).
    expect(uid.next()).toBe(1);
  });

  it('reset() coerces to an unsigned 32-bit value', () => {
    const uid = new Uid();
    uid.next();
    uid.reset(5);
    expect(uid.next()).toBe(6);
  });

  it('MAX_UID_VALUE is the 32-bit-unsigned coercion of MAX_SAFE_INTEGER', () => {
    expect(MAX_UID_VALUE).toBe(Number.MAX_SAFE_INTEGER >>> 0);
  });
});
