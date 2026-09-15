/**
 * A programming fault and a system error are not messages anyone wrote for a
 * caller, and they name things a caller has no business reading.
 *
 * `toTitanError`'s last branch forwarded `error.message` verbatim, and
 * `HttpServer.createErrorResponse` puts that straight on the wire. So an
 * unanticipated failure anywhere in a handler answered the client with, for
 * example:
 *
 *   TypeError: Cannot read properties of undefined (reading 'map')
 *   Error: ENOENT: no such file or directory, open '/srv/app/secrets.json'
 *   Error: connect ECONNREFUSED 10.0.0.5:5432
 *
 * — an internal field name, a path on the server, a host not meant to be
 * reachable from outside. The first of those is not hypothetical: it is the
 * exact TypeError a contracted zero-argument call produced in this repo
 * earlier today, and it reached the caller with the property name in it.
 *
 * The same file already masks driver errors for the same reason, saying "its
 * message is not ours to forward", and keeps the original as `cause` so logs
 * lose nothing. This extends that to faults, and to nothing else.
 *
 * **What is deliberately left alone.** A hand-written `new Error('Shop is
 * closed')` keeps its message: there is no way to tell one meant for the
 * caller from one that is not, and silencing the ones that are is worse than
 * forwarding the ones that should not be. Declaring `status`/`statusCode`
 * says the error was written WITH a response in mind, so those keep their
 * message whatever their class.
 */

import { describe, it, expect } from 'vitest';
import { toTitanError } from '../../src/errors/factories.js';
import { ErrorCode } from '../../src/errors/codes.js';

const MASKED = 'An unexpected error occurred';

describe('a fault is masked, and its cause is kept', () => {
  it('a TypeError from a property nobody checked', () => {
    const fault = new TypeError("Cannot read properties of undefined (reading 'map')");
    const err = toTitanError(fault);

    expect(err.message).toBe(MASKED);
    expect(err.message).not.toContain('map');
    expect(err.cause, 'the log must still get the whole thing').toBe(fault);
    expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
  });

  it.each([
    // Recognised by `errno`/`syscall`, which Node sets on every system error
    // and nothing else sets — not by the spelling of `code`.
    [
      "ENOENT: no such file or directory, open '/srv/app/secrets.json'",
      { code: 'ENOENT', errno: -2, syscall: 'open', path: '/srv/app/secrets.json' },
      'secrets.json',
    ],
    [
      'connect ECONNREFUSED 10.0.0.5:5432',
      { code: 'ECONNREFUSED', errno: -61, syscall: 'connect', address: '10.0.0.5', port: 5432 },
      '10.0.0.5',
    ],
    ['The "path" argument must be of type string', { code: 'ERR_INVALID_ARG_TYPE' }, 'argument'],
  ])('a system error: %s', (message, fields, secret) => {
    const err = toTitanError(Object.assign(new Error(message), fields));

    expect(err.message).toBe(MASKED);
    expect(err.message).not.toContain(secret);
  });

  it('and a RangeError, a ReferenceError and a SyntaxError too', () => {
    for (const fault of [new RangeError('x'), new ReferenceError('y'), new SyntaxError('z')]) {
      expect(toTitanError(fault).message).toBe(MASKED);
    }
  });
});

describe('and what was written for the caller still reaches them', () => {
  it('a plain Error keeps its message', () => {
    // Non-vacuity: without this the masking could be unconditional and every
    // assertion above would still pass.
    expect(toTitanError(new Error('Shop is closed')).message).toBe('Shop is closed');
  });

  it('an error that declares a status keeps its message, whatever its class', () => {
    // An app error written with a response in mind. daos' `AppError` sets
    // `statusCode` (defaulting to 500), and its subclasses carry sentences
    // users are meant to read.
    const appError = Object.assign(new TypeError('Captcha is required'), {
      statusCode: 400,
      code: 'CAPTCHA_REQUIRED',
    });
    const err = toTitanError(appError);

    expect(err.message).toBe('Captcha is required');
    expect(err.code).toBe(ErrorCode.BAD_REQUEST);
    expect(err.details?.['errorCode']).toBe('CAPTCHA_REQUIRED');
  });

  it('a system code alone does not mask a declared error', () => {
    const declared = Object.assign(new Error('Service temporarily unavailable'), {
      statusCode: 503,
      code: 'ECONNREFUSED',
    });
    expect(toTitanError(declared).message).toBe('Service temporarily unavailable');
  });

  it('a business code that merely looks like a system code is not mistaken for one', () => {
    // This is why the check is `errno`/`syscall` and not the spelling of
    // `code`: a first version matched `/^E[A-Z0-9]+$/` and swallowed this.
    const err = toTitanError(Object.assign(new Error('Your link has expired'), { code: 'EXPIRED' }));
    expect(err.message).toBe('Your link has expired');
  });
});
