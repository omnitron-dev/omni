/**
 * A database error is not a business error, and its text is not ours to forward.
 *
 * `toTitanError` copies `error.message` verbatim and `error.code` into
 * `details.errorCode` for any Error, so that a business code like
 * `SESSION_EXPIRED` reaches the client. A driver error has both fields too, and
 * what they contain is the schema:
 *
 *   invalid input syntax for type uuid: "{\"userId\":\"019f25eb-…\"}"
 *   duplicate key value violates unique constraint "content_reports_one_per_reporter_idx"
 *
 * Observed on a live stack: an RPC call answered with SQLSTATE 22P02 and the
 * offending value quoted back. Passed through, that hands any caller the column
 * types, the constraint names and the values that tripped them — a free map of
 * the schema for whoever is probing it, on a platform whose users are the reason
 * it is hardened at all.
 *
 * The full error still travels as `cause`, so logs and the handlers that catch a
 * 23505 to translate it lose nothing. Only the wire changes.
 */

import { describe, it, expect } from 'vitest';
import { toTitanError } from '../../src/errors/factories.js';
import { ErrorCode } from '../../src/errors/codes.js';

/** What `pg` actually throws. */
function pgError(code: string, message: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { code, severity: 'ERROR', routine: 'errorMissingColumn', ...extra });
}

describe('database errors do not reach the client', () => {
  it('replaces the message of a bad-input error', () => {
    const err = toTitanError(
      pgError('22P02', 'invalid input syntax for type uuid: "{\\"userId\\":\\"019f25eb-d254\\"}"'),
    );

    expect(err.message).toBe('A database error occurred');
    expect(err.message).not.toMatch(/uuid|userId|019f25eb/);
    expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
  });

  it('does not name the constraint that was violated', () => {
    const err = toTitanError(
      pgError('23505', 'duplicate key value violates unique constraint "content_reports_one_per_reporter_idx"', {
        constraint: 'content_reports_one_per_reporter_idx',
        table: 'content_reports',
      }),
    );

    expect(err.message).not.toMatch(/content_reports|duplicate key|unique constraint/);
    expect(JSON.stringify(err.details)).not.toMatch(/content_reports/);
  });

  it('does not forward the SQLSTATE as the error code', () => {
    const err = toTitanError(pgError('23503', 'insert or update violates foreign key constraint'));

    expect((err.details as Record<string, unknown>)['errorCode']).toBe('DATABASE_ERROR');
    expect(JSON.stringify(err.details)).not.toContain('23503');
  });

  it('keeps the original as the cause, so the server still knows', () => {
    const original = pgError('22P02', 'invalid input syntax for type uuid: "xyz"');

    const err = toTitanError(original);

    expect(err.cause).toBe(original);
    expect((err.cause as Error).message).toContain('invalid input syntax');
  });

  it('still forwards a business code that merely looks like one', () => {
    // Five characters of [0-9A-Z] but no driver fields: this is someone's own
    // error code and the caller is meant to switch on it.
    const err = toTitanError(Object.assign(new Error('Session has expired'), { code: 'EXPRD', statusCode: 401 }));

    expect(err.message).toBe('Session has expired');
    expect((err.details as Record<string, unknown>)['errorCode']).toBe('EXPRD');
  });

  it('leaves an ordinary application error alone', () => {
    const err = toTitanError(Object.assign(new Error('Shop not found'), { code: 'NOT_FOUND', statusCode: 404 }));

    expect(err.message).toBe('Shop not found');
    expect(err.code).toBe(ErrorCode.NOT_FOUND);
  });
});
