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

describe('the structured code is the primary check', () => {
  /**
   * A colleague found a dispatch in titan's module discovery that decided
   * escalation by `error.message.includes('missing required')` — so renaming
   * the message silently changed behaviour, which is what happened to them
   * when they renamed it.
   *
   * `isRequestTimeout` also looks at message text, but only AFTER the code.
   * These pin that ordering, so the fallback cannot quietly become the only
   * thing holding the behaviour up.
   */
  it('recognises the real error by its code, not its wording', () => {
    // What `Errors.timeout('RPC request', 60000)` actually produces — verified
    // against the running package: code 408.
    const real = Object.assign(new Error('RPC request timed out after 60000ms'), { code: 408 });
    expect(isRequestTimeout(real)).toBe(true);

    // Same error with the wording changed: still recognised.
    const reworded = Object.assign(new Error('the request gave up waiting'), { code: 408 });
    expect(isRequestTimeout(reworded)).toBe(true);
  });

  it('keeps the text fallback for an error that lost its code crossing a boundary', () => {
    expect(isRequestTimeout({ message: 'Operation timed out after 5000ms' })).toBe(true);
  });

  it('does not treat a coded non-timeout as one, whatever it says', () => {
    // Writing this test is what exposed the weakness. The message matches the
    // fallback pattern, and the fallback used to run for ANY error whose code
    // did not match — so a 500 mentioning a timeout was reported as "we
    // stopped waiting, the operation may still be running". That is the
    // opposite conclusion from "it failed", and the CLI acts on it.
    const misleading = Object.assign(new Error('waiting for the migration timed out after a while'), {
      code: 500,
    });

    expect(isRequestTimeout(misleading)).toBe(false);
  });
});

describe('LONG_REQUEST_TIMEOUT', () => {
  it('leaves room for a cold start of a whole stack', () => {
    // Six Titan apps, each connecting to Postgres, Redis and its siblings
    // before reporting ready, take well over a minute from cold.
    expect(LONG_REQUEST_TIMEOUT).toBeGreaterThan(5 * 60_000);
  });
});
