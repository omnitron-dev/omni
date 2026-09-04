/**
 * Telling "the operation failed" apart from "we stopped waiting".
 *
 * The daemon cancels nothing when a caller gives up, so a client-side
 * timeout leaves the operation running with an unknown outcome. Reporting
 * that as a failure is worse than reporting nothing: an operator acts on it.
 * Observed exactly that — `omnitron stack start` printed
 * `Failed: RPC request timed out after 60000ms` at the one-minute mark, and
 * all six apps were online twenty seconds later.
 */

import { describe, it, expect } from 'vitest';

import { isRequestTimeout, LONG_REQUEST_TIMEOUT } from '../../src/daemon/daemon-client.js';

describe('isRequestTimeout', () => {
  it('recognises the error the RPC layer actually throws', () => {
    // What `Errors.timeout('RPC request', 60000)` produces, as it arrives at
    // the CLI: a code and a message, both of which must be enough on their own.
    const err = Object.assign(new Error('RPC request timed out after 60000ms'), { code: 408 });
    expect(isRequestTimeout(err)).toBe(true);
  });

  it('recognises it by code alone, whatever the wording', () => {
    expect(isRequestTimeout(Object.assign(new Error('gave up'), { code: 408 }))).toBe(true);
    expect(isRequestTimeout(Object.assign(new Error('gave up'), { code: 'REQUEST_TIMEOUT' }))).toBe(true);
  });

  it('recognises it by message alone, for an error that crossed a boundary', () => {
    // Serialised across the wire an error can arrive as a plain object with
    // no code left on it.
    expect(isRequestTimeout({ message: 'Operation timed out after 5000ms' })).toBe(true);
  });

  it('does not mistake a real failure for a timeout', () => {
    expect(isRequestTimeout(new Error('ECONNREFUSED'))).toBe(false);
    expect(isRequestTimeout(Object.assign(new Error('boom'), { code: 500 }))).toBe(false);
    // A message that merely mentions time is not a timeout.
    expect(isRequestTimeout(new Error('startupTimeout is set to 30000'))).toBe(false);
  });

  it('handles the shapes a catch block really sees', () => {
    for (const input of [null, undefined, 'string', 42, {}]) {
      expect(isRequestTimeout(input)).toBe(false);
    }
  });
});

describe('LONG_REQUEST_TIMEOUT', () => {
  it('leaves room for a cold start of a whole stack', () => {
    // Six Titan apps, each connecting to Postgres, Redis and its siblings
    // before reporting ready, take well over a minute from cold.
    expect(LONG_REQUEST_TIMEOUT).toBeGreaterThan(5 * 60_000);
  });
});
