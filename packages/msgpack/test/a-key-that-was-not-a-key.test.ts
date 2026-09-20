/**
 * Three keys are not property names when you ASSIGN them.
 *
 * `decodeMap` built its result with `result[key] = value`, and a sender that
 * puts `__proto__` in a map is not setting a property — it is replacing the
 * decoded object's PROTOTYPE. Measured 2026-09-20, before the fix:
 *
 *     ключи в декодированном: [ 'ok' ]
 *     got.polluted          : yes
 *     got.isAdmin           : true
 *     got2.constructor.name : hijacked
 *
 * So `if (data.isAdmin)` sees a field that `Object.keys` does not list and
 * `JSON.stringify` does not print — a value that decides things and leaves no
 * trace in any log line about the object carrying it. Both sides of this
 * platform's wire decode with this library: the server reading a client's
 * frame, and the browser reading a peer's.
 *
 * The value is KEPT, as an own property. Dropping it would lose data a
 * legitimate payload may carry — a user's JSON object is allowed a field
 * called "constructor" — and rejecting the frame would turn a data shape into
 * a protocol error.
 */
import { describe, it, expect } from 'vitest';

import { encode, decode } from '../src/index.js';

/** A map carrying `key`, the way a hostile sender would put it on the wire. */
function encodeWithKey(key: string, value: unknown): Uint8Array {
  const obj = {};
  Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
  Object.defineProperty(obj, 'ok', { value: 1, enumerable: true, configurable: true, writable: true });
  return encode(obj);
}

describe('a sender cannot reach the prototype of what it sends', () => {
  it('__proto__ arrives as a field, not as the objectit arrived in', () => {
    const got = decode(encodeWithKey('__proto__', { polluted: 'yes', isAdmin: true })) as Record<string, unknown>;

    expect(Object.getPrototypeOf(got)).toBe(Object.prototype);
    expect((got as { isAdmin?: unknown }).isAdmin).toBeUndefined();
    expect((got as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it('and it is VISIBLE, which is what separates data from behaviour', () => {
    const got = decode(encodeWithKey('__proto__', { a: 1 })) as Record<string, unknown>;

    // Before the fix `Object.keys` answered ['ok'] while the value decided
    // things. A field nothing can enumerate is a field no log will show.
    expect(Object.keys(got).sort()).toEqual(['__proto__', 'ok']);
    expect(JSON.parse(JSON.stringify(got))).toHaveProperty('__proto__');
  });

  // `constructor` and `prototype` are handled the same way for uniformity,
  // and these two cases are CONTROLS rather than measurements: measured by
  // removing the guard, plain assignment already made them own properties —
  // only `__proto__` is a setter. They are here so the next reader does not
  // mistake the three-key list for three defects.
  //
  // What plain assignment DOES do to `constructor` is overwrite the field a
  // `x.constructor === Foo` check reads. That is true before and after; the
  // fix does not claim to address it, and a type check on decoded wire data
  // was never safe.
  it('constructor arrives as a field, and the prototype is untouched', () => {
    const got = decode(encodeWithKey('constructor', { name: 'hijacked' })) as Record<string, unknown>;

    expect(Object.keys(got)).toContain('constructor');
    expect(Object.getPrototypeOf(got)).toBe(Object.prototype);
  });

  it('prototype likewise', () => {
    const got = decode(encodeWithKey('prototype', { x: 1 })) as Record<string, unknown>;

    expect(Object.keys(got)).toContain('prototype');
    expect(Object.getPrototypeOf(got)).toBe(Object.prototype);
  });

  it('and nothing global is touched — the control that matters most', () => {
    decode(encodeWithKey('__proto__', { globallyPolluted: true }));

    expect(({} as { globallyPolluted?: unknown }).globallyPolluted).toBeUndefined();
  });

  it('an ordinary map still round-trips — the other control', () => {
    // A rule that dropped or rejected keys would pass every assertion above
    // and break the wire.
    const value = { a: 1, b: 'two', c: [3, 4], d: { e: 5 } };

    expect(decode(encode(value))).toEqual(value);
  });
});
