/**
 * A status code must survive the round trip AND the normalisation that follows
 * it.
 *
 * `titan-error-serialization.spec.ts` already pins that a decoded TitanError is
 * a TitanError and keeps its fields — checked, and it does: reversing the
 * registration order in `packet/serializer.ts` turns eight of its assertions
 * red. What nothing pinned is the step AFTER: `toTitanError`, which the HTTP
 * server calls on anything a handler threw before turning it into a response.
 *
 * The two are only connected by an assumption. `toTitanError` returns its
 * argument unchanged when it is already a TitanError, and otherwise rebuilds
 * one — reading `.status` and `.statusCode`, which are Express and AppError
 * conventions. A TitanError carries neither; its status lives in `code` and
 * `httpStatus`. So the moment a TitanError arrives as anything else, every
 * status becomes INTERNAL_ERROR and the real one is filed under
 * `details.errorCode`.
 *
 * Measured, on a serializer whose registration order was reversed: 404 → 500,
 * 403 → 500, 429 → 500. The symptom is not a wrong type name in a log; daos
 * propagates service-to-service errors deliberately (`paysys.client.ts` says
 * so in its header, and ten of its eleven methods have no catch), so it is
 * every cross-service "not found" reaching the browser as "internal server
 * error".
 *
 * These assert the end of that chain rather than its middle, so they hold
 * whatever changes: a lost class, a renamed field, a rewritten `toTitanError`.
 */

import { describe, it, expect } from 'vitest';

import { serializer } from '../../src/netron/packet/serializer.js';
import { Errors, toTitanError, ErrorCode } from '../../src/errors/index.js';

const roundTrip = (value: unknown): any => serializer.decode(serializer.encode(value));

describe('a status code after the wire', () => {
  it.each([
    ['notFound', () => Errors.notFound('user', 'u-1'), ErrorCode.NOT_FOUND],
    ['forbidden', () => Errors.forbidden('nope'), ErrorCode.FORBIDDEN],
    ['badRequest', () => Errors.badRequest('bad'), ErrorCode.BAD_REQUEST],
    ['conflict', () => Errors.conflict('taken'), ErrorCode.CONFLICT],
  ])('survives %s through the wire and through toTitanError', (_name, make, code) => {
    const normalised = toTitanError(roundTrip(make()));

    expect(
      normalised.code,
      'the status was rewritten on the way out — the decoded error was not recognised as a TitanError'
    ).toBe(code);
  });

  it('does not file the real status under details.errorCode', () => {
    // The tell of the failure, and the reason it is easy to miss in a log: the
    // status is not lost, it is demoted into the escape hatch `toTitanError`
    // keeps for a foreign business code.
    const normalised = toTitanError(roundTrip(Errors.notFound('user', 'u-1')));

    expect(normalised.details).not.toHaveProperty('errorCode');
    expect(normalised.details).toEqual({ resource: 'user', id: 'u-1' });
  });
});
