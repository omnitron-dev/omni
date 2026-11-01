import { describe, expect, it } from 'vitest';
import { decodeHttpError } from '../src/http-error.js';

describe('shared HTTP error decoding', () => {
  it.each([403, '403', 'FORBIDDEN', 'PERMISSION_DENIED'])('preserves the category of %s', code => {
    expect(decodeHttpError(200, { error: { code, message: 'Denied' } })).toMatchObject({ code: 403, message: 'Denied' });
  });

  it.each([undefined, null, {}, [], 'not JSON'])('handles an absent or malformed body: %s', body => {
    expect(decodeHttpError(401, body).code).toBe(401);
  });

  it.each([NaN, Infinity, -1, 403.5, '403_invalid', 'constructor', '__proto__', '9007199254740993'])('never invents a numeric category from %s', code => {
    expect(decodeHttpError(409, { error: { code } }).code).toBe(409);
  });

  it('preserves business codes and trace identifiers without replacing an explicit discriminator', () => {
    const error = decodeHttpError(409, { error: { code: 'CART_EXPIRED', details: { item: 'example' } } },
      { 'X-ReQuEsT-Id': 'request', 'x-correlation-id': 'correlation' });
    expect(error).toMatchObject({ code: 409, details: { item: 'example', errorCode: 'CART_EXPIRED' },
      requestId: 'request', correlationId: 'correlation' });
    expect(decodeHttpError(409, { error: { code: 'CONFLICTING_CODE', details: { errorCode: 'CANONICAL' } } }).details)
      .toEqual({ errorCode: 'CANONICAL' });
  });

  it('uses an error fallback when a successful batch contains an unclassified refusal', () => {
    expect(decodeHttpError(200, { error: { message: 'Refused' } }).code).toBe(500);
  });
});
