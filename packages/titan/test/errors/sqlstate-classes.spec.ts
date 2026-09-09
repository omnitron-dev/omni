/**
 * A driver error is not automatically a server fault.
 *
 * `toTitanError` mapped every `pg` error to a 500 with "A database error
 * occurred". The masking is right — the driver's text carries the
 * offending value, the column type and the constraint name, which is a
 * free map of the schema — but the STATUS was wrong for two whole
 * SQLSTATE classes.
 *
 * Measured against a running deployment before this change: 94 of 618
 * read-shaped `@Public` methods across six backends answered 5xx to a
 * malformed argument, nearly all of them a uuid parse reaching Postgres.
 * A 500 tells the client the server broke, keeps a retry policy
 * re-sending a request that can never succeed, and buries real incidents
 * in a monitoring signal made mostly of typos.
 *
 *   Class 22 — data exception. The VALUE was wrong: 400.
 *   Class 23 — integrity constraint violation. The request conflicts
 *              with stored data: 409.
 *   Everything else stays 500, because it is.
 */

import { describe, it, expect } from 'vitest';
import { toTitanError } from '../../src/errors/factories.js';
import { ErrorCode } from '../../src/errors/codes.js';

/** What `pg` actually throws: a code, plus severity or routine. */
function pgError(code: string, message: string) {
  return Object.assign(new Error(message), { code, severity: 'ERROR', routine: 'string_to_uuid' });
}

describe('class 22 — the caller sent a value the column could not take', () => {
  it.each([
    ['22P02', 'invalid input syntax for type uuid: "not-a-uuid"'],
    ['22003', 'numeric field overflow'],
    ['22007', 'invalid input syntax for type timestamp: "nope"'],
    ['22001', 'value too long for type character varying(20)'],
  ])('%s → 400', (code, message) => {
    const err = toTitanError(pgError(code, message));
    expect(err.code).toBe(ErrorCode.BAD_REQUEST);
    expect(err.details?.['errorCode']).toBe('DATABASE_INPUT');
  });

  it('still refuses to forward the driver text', () => {
    const err = toTitanError(pgError('22P02', 'invalid input syntax for type uuid: "019f25eb-secret"'));
    expect(err.message).not.toContain('019f25eb-secret');
    expect(err.message).not.toContain('uuid');
  });

  it('keeps the original as `cause` for the server side', () => {
    const original = pgError('22P02', 'invalid input syntax for type uuid: "x"');
    expect(toTitanError(original).cause).toBe(original);
  });
});

describe('class 23 — the request conflicts with what is stored', () => {
  it.each([
    ['23505', 'duplicate key value violates unique constraint "content_reports_one_per_reporter_idx"'],
    ['23503', 'insert or update on table "posts" violates foreign key constraint'],
    ['23514', 'new row for relation "orders" violates check constraint "positive_total"'],
  ])('%s → 409', (code, message) => {
    const err = toTitanError(pgError(code, message));
    expect(err.code).toBe(ErrorCode.CONFLICT);
    expect(err.details?.['errorCode']).toBe('DATABASE_CONSTRAINT');
  });

  it('does not name the constraint', () => {
    const err = toTitanError(pgError('23505', 'duplicate key value violates unique constraint "secret_idx"'));
    expect(err.message).not.toContain('secret_idx');
  });
});

describe('everything else is still a fault', () => {
  it.each([
    ['08006', 'connection failure'],
    ['42601', 'syntax error at or near "SELCT"'],
    ['42P01', 'relation "typo_table" does not exist'],
    ['XX000', 'internal error'],
  ])('%s → 500', (code, message) => {
    const err = toTitanError(pgError(code, message));
    expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(err.details?.['errorCode']).toBe('DATABASE_ERROR');
  });

  it('a plain Error is untouched by the sqlstate branch', () => {
    const err = toTitanError(new Error('something broke'));
    expect(err.details?.['errorCode']).toBeUndefined();
  });
});
