/**
 * A merge walks keys it did not choose.
 *
 * `__proto__` is a setter: `result['__proto__'] = x` replaces the object's
 * prototype rather than adding a field. Every deep merge in this repository
 * wrote whatever keys the SOURCE carried, and two of them — the config store
 * and the config loader — merge data that arrives from outside the process.
 *
 * This became reachable on 2026-09-20. msgpack's decoder used to let
 * `__proto__` through as a prototype REPLACEMENT and now keeps it as an own,
 * enumerable property (`78880f00`) — safe in the decoded object, and it
 * passes `hasOwnProperty` in every merge that walks it. Fixing one without
 * the other moves the defect rather than removing it.
 */
import { describe, it, expect } from 'vitest';

import { ConfigStore } from '../../src/application/_internal/config-store.js';

/** A source carrying `__proto__` as an own key, the way decoded wire data does. */
function withOwnProto(value: unknown): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  Object.defineProperty(obj, '__proto__', { value, enumerable: true, configurable: true, writable: true });
  Object.defineProperty(obj, 'ordinary', { value: 'kept', enumerable: true, configurable: true, writable: true });
  return obj;
}

function store(seed: Record<string, unknown> = {}) {
  return new ConfigStore({
    name: 'probe',
    version: '0.0.0',
    debug: false,
    environment: 'test',
    userConfig: seed as never,
  });
}

describe('merging a source that carries __proto__', () => {
  it('does not give the result a prototype of the source\'s choosing', () => {
    const s = store({ section: { existing: true } });

    s.merge({ section: withOwnProto({ isAdmin: true }) } as never);

    const merged = s.rawGet('section') as Record<string, unknown>;
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect((merged as { isAdmin?: unknown }).isAdmin).toBeUndefined();
  });

  it('and keeps the ordinary keys — the control', () => {
    // A merge that dropped everything would pass the assertion above.
    const s = store({ section: { existing: true } });

    s.merge({ section: withOwnProto({ isAdmin: true }) } as never);

    const merged = s.rawGet('section') as Record<string, unknown>;
    expect(merged['ordinary']).toBe('kept');
    expect(merged['existing']).toBe(true);
  });

  it('leaves Object.prototype alone', () => {
    store().merge({ section: withOwnProto({ globallyPolluted: true }) } as never);

    expect(({} as { globallyPolluted?: unknown }).globallyPolluted).toBeUndefined();
  });
});
