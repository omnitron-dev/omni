/**
 * Reading an HTTP status out of a Netron error.
 *
 * This is what decides whether an expired session sends the operator to the
 * sign-in page. Getting it wrong does not throw: the console stays on a page
 * whose every request is being refused, rendering "Applications 0 / No apps
 * yet" — an answer an operator would reasonably read as "my apps are gone".
 *
 * The shapes are not hypothetical. `http/peer.ts` coerces the daemon's
 * `"code": "401"` to a number before building a TitanError; `http/client.ts`
 * wraps the raw response in `NetronErrors.invalidResponse({ error })` and
 * does not. So the same 401 arrives as a number on one path and a string,
 * one level deeper, on the other.
 */

import { describe, it, expect } from 'vitest';

import { errorStatus } from './client.js';

describe('errorStatus', () => {
  it('reads a numeric status from each shape a client produces', () => {
    expect(errorStatus({ status: 401 })).toBe(401);
    expect(errorStatus({ statusCode: 403 })).toBe(403);
    expect(errorStatus({ code: 429 })).toBe(429);
    expect(errorStatus({ response: { status: 500 } })).toBe(500);
    expect(errorStatus({ data: { code: 404 } })).toBe(404);
  });

  it('reads the daemon’s string code', () => {
    // Measured against the running daemon: an unauthenticated call returns
    // `{"code": "401", "message": "Authentication required"}` — code is a
    // string. Accepting numbers only meant no redirect on that path.
    expect(errorStatus({ code: '401' })).toBe(401);
  });

  it('reads a status the wrapper buried one level down', () => {
    expect(errorStatus({ details: { error: { code: '401' } } })).toBe(401);
    expect(errorStatus({ data: { error: { code: 403 } } })).toBe(403);
  });

  it('returns undefined rather than zero for the empty shapes', () => {
    // `Number('')` and `Number(null)` are both 0, and a status of 0 compared
    // against 401 is a silent no-op — the failure this function is meant to
    // detect, converted into a value that looks like an answer.
    for (const input of [null, undefined, {}, 'nope', 42, { code: '' }, { code: null }]) {
      expect(errorStatus(input), JSON.stringify(input)).toBeUndefined();
    }
  });

  it('ignores codes that are not HTTP statuses', () => {
    // Netron's own error codes travel in the same field: `code:
    // 'ECONNREFUSED'` and `code: 'NETRON_TIMEOUT'` must not be read as
    // statuses, and a bare number like 42 is not one either.
    expect(errorStatus({ code: 'ECONNREFUSED' })).toBeUndefined();
    expect(errorStatus({ code: 'NETRON_INVALID_RESPONSE' })).toBeUndefined();
    expect(errorStatus({ code: '4010' })).toBeUndefined();
  });

  it('prefers the outermost status when several are present', () => {
    // A wrapper carrying its own status plus the server's must not report
    // the inner one — the outer is what the transport actually saw.
    expect(errorStatus({ status: 502, details: { error: { code: '401' } } })).toBe(502);
  });
});
