/**
 * A payload the caller got wrong is a 400, not a 500.
 *
 * `toTitanError` maps any non-Titan `Error` by looking for an HTTP-ish
 * `.status` or `.statusCode` and falling back to `INTERNAL_ERROR`. A Zod
 * validation failure carries neither, so every schema rejection left the
 * server as an internal error.
 *
 * Observed on daos: `Content.createPost` with an invalid `type` answered
 * `{"success":false,"error":{"code":"500", ...}}` with the Zod issue list as
 * its message. Three things follow from that, and none of them are cosmetic.
 * The client cannot tell "I sent the wrong thing" from "the server broke".
 * Monitoring counts user typos as incidents, which is how a real outage gets
 * lost in the noise. And any retry policy keyed on 5xx re-sends a request that
 * can never succeed, turning one bad field into a retry storm.
 *
 * The check is duck-typed rather than `instanceof z.ZodError`, because the
 * application's zod and titan's own copy need not be the same module — and an
 * `instanceof` that silently fails on the errors it exists to catch is worse
 * than no check at all.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { toTitanError } from '../../src/errors/factories.js';
import { ErrorCode } from '../../src/errors/codes.js';
import { mapToHttp } from '../../src/errors/transport.js';

const Schema = z.object({ type: z.enum(['article', 'discussion']) });

function zodFailure(): Error {
  try {
    Schema.parse({ type: 'nonsense' });
    throw new Error('schema accepted an invalid value — this test is broken');
  } catch (err) {
    return err as Error;
  }
}

describe('toTitanError', () => {
  it('reports a schema rejection as a client error', () => {
    const err = zodFailure();
    expect(err.name, 'the fixture really is a Zod error').toBe('ZodError');

    const titan = toTitanError(err);

    expect(titan.code, 'a bad payload is the caller\'s fault').toBe(ErrorCode.BAD_REQUEST);
    expect(mapToHttp(titan).status, 'and reaches the client as 400').toBe(400);
  });

  it('keeps the issues so the client can say which field', () => {
    const titan = toTitanError(zodFailure());
    const issues = (titan.details as { issues?: unknown[] }).issues;

    expect(Array.isArray(issues), 'the issue list survives the conversion').toBe(true);
    expect(JSON.stringify(issues), 'and names the field that failed').toContain('type');
  });

  it('recognises a validation error from a different copy of zod', () => {
    // The dual-package case: same shape, different module identity. An
    // `instanceof` check would fall through here and report 500.
    const foreign = Object.assign(new Error('Validation failed'), {
      name: 'ZodError',
      issues: [{ code: 'invalid_type', path: ['amount'], message: 'Expected string' }],
    });

    expect(toTitanError(foreign).code).toBe(ErrorCode.BAD_REQUEST);
  });

  it('still reports an ordinary failure as internal', () => {
    // The control: the fallback must survive, or this fix would hide real
    // server faults behind a 400.
    expect(toTitanError(new Error('connection reset')).code).toBe(ErrorCode.INTERNAL_ERROR);
  });

  it('does not mistake an error that merely has issues for a validation failure', () => {
    const notZod = Object.assign(new Error('boom'), { issues: [1, 2, 3] });
    expect(toTitanError(notZod).code).toBe(ErrorCode.INTERNAL_ERROR);
  });
});
