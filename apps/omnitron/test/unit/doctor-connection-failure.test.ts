/**
 * Telling "the database is gone" from "the database said no".
 *
 * The two findings point in opposite directions — one says start the
 * container, the other says read its logs — and until now they were
 * separated by which CALL threw rather than by what the error said.
 * `createOmnitronDb` builds a lazy pool: it does not connect, so it does not
 * throw, so a database that is simply absent sailed past the "unreachable"
 * branch and failed on the first query. The finding then read "reachable but
 * not queryable … the connection opened", with `ECONNREFUSED` printed in its
 * own evidence two lines above.
 *
 * Seen live, on a host where the Postgres container had exited with "no
 * space left on device".
 */

import { describe, it, expect } from 'vitest';

import { isConnectionFailure } from '../../src/commands/doctor.js';

describe('isConnectionFailure', () => {
  it('recognises the shape Node actually throws', () => {
    // A refused connection to a name that resolves to both ::1 and 127.0.0.1
    // arrives as an AggregateError whose own message is EMPTY — the codes
    // live in `errors[]`, and reading `err.message` alone finds nothing.
    const err = Object.assign(new AggregateError([], ''), {
      code: 'ECONNREFUSED',
      errors: [
        { message: 'connect ECONNREFUSED ::1:5480', code: 'ECONNREFUSED' },
        { message: 'connect ECONNREFUSED 127.0.0.1:5480', code: 'ECONNREFUSED' },
      ],
    });

    expect(isConnectionFailure(err)).toBe(true);
  });

  it('recognises one nested code even without a top-level one', () => {
    const err = Object.assign(new AggregateError([], ''), {
      errors: [{ message: 'connect ETIMEDOUT 10.0.0.5:5432', code: 'ETIMEDOUT' }],
    });

    expect(isConnectionFailure(err)).toBe(true);
  });

  it.each(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'EPIPE'])(
    'recognises %s on the error itself',
    (code) => {
      expect(isConnectionFailure(Object.assign(new Error('nope'), { code }))).toBe(true);
    }
  );

  it('reads a code that only appears in the message', () => {
    // Some drivers wrap and lose the property.
    expect(isConnectionFailure(new Error('connect ECONNREFUSED 127.0.0.1:5480'))).toBe(true);
  });
});

describe('errors the server answered with', () => {
  it.each([
    ['relation "logs" does not exist', '42P01'],
    ['permission denied for table logs', '42501'],
    ['password authentication failed for user "omnitron"', '28P01'],
  ])('does not call %s a connection failure', (message, code) => {
    // These arrive over a connection that opened, and the remedy for them —
    // read the database logs — is the wrong advice for an absent container.
    expect(isConnectionFailure(Object.assign(new Error(message), { code }))).toBe(false);
  });

  it('says no to things that are not errors at all', () => {
    expect(isConnectionFailure(null)).toBe(false);
    expect(isConnectionFailure(undefined)).toBe(false);
    expect(isConnectionFailure({})).toBe(false);
  });
});
