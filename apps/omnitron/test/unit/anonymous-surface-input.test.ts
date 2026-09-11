/**
 * The daemon's anonymous surface answered 500 to a malformed request.
 *
 * Seven methods carry `@Public({ auth: { allowAnonymous: true } })` — the five
 * on `OmnitronAuth`, `OmnitronFleet.heartbeat` and
 * `OmnitronTelemetry.pushBatch`. Probing all 122 daemon methods without a
 * token returns 401 or 404 for every other one, so these are the entire
 * surface an unauthenticated caller can reach.
 *
 * None of them looked at what it was given. Measured against the running
 * daemon: `signIn` with an empty payload answered
 * `500 Cannot destructure property 'username' of 'request'` — our fault
 * reported for their malformed request, and a stack-shaped string handed to
 * someone who has not authenticated. `validateToken`, `validateSession`,
 * `refreshSession`, `signOut`, `heartbeat` and `pushBatch` did the same with
 * `Cannot read properties of undefined`.
 */

import { describe, it, expect } from 'vitest';

import { requireArray, requirePayload, requireString } from '../../src/services/anonymous-input.js';

const code = (fn: () => unknown): string => {
  try {
    fn();
    return 'no-throw';
  } catch (e) {
    return String((e as { code?: string; statusCode?: number }).code ?? (e as { statusCode?: number }).statusCode ?? 'unknown');
  }
};

const message = (fn: () => unknown): string => {
  try {
    fn();
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};

describe('requirePayload', () => {
  it('rejects the shapes that produced a 500', () => {
    for (const bad of [undefined, null, 'string', 42, []]) {
      expect(message(() => requirePayload(bad, 'signIn'))).toMatch(/expected an object payload/);
    }
  });

  it('answers 400, not 500', () => {
    expect(code(() => requirePayload(undefined, 'signIn'))).toMatch(/400|BAD_REQUEST/i);
  });

  it('passes an object through', () => {
    const o = { username: 'a' };
    expect(requirePayload(o, 'signIn')).toBe(o);
  });
});

describe('requireString', () => {
  it('names the field that is wrong', () => {
    expect(message(() => requireString({}, 'username', 'signIn'))).toContain("'username'");
  });

  it('rejects an empty string, which reaches the service as a falsy id', () => {
    expect(message(() => requireString({ sessionId: '' }, 'sessionId', 'signOut'))).toMatch(/non-empty/);
  });

  it('rejects a non-string', () => {
    expect(message(() => requireString({ nodeId: 7 }, 'nodeId', 'heartbeat'))).toMatch(/non-empty string/);
  });

  it('returns the value', () => {
    expect(requireString({ token: 'abc' }, 'token', 'validateToken')).toBe('abc');
  });
});

describe('requireArray', () => {
  it('rejects a non-array batch', () => {
    expect(message(() => requireArray({ entries: 'nope' }, 'entries', 'pushBatch'))).toMatch(/must be an array/);
  });

  it('accepts an empty batch, which is a legitimate heartbeat-shaped push', () => {
    expect(requireArray({ entries: [] }, 'entries', 'pushBatch')).toEqual([]);
  });
});
