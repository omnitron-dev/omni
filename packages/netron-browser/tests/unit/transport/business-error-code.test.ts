/**
 * What survives of a business error on its way to the browser.
 *
 * The server sends the BUSINESS code in the envelope's `code` field whenever
 * the error carries one — `CART_EXPIRED`, `SESSION_EXPIRED`, `DISPUTE_EXISTS`
 * — and the stringified HTTP status otherwise. Both decoders on this side ran
 * `parseInt` over it, which is NaN for every business code:
 *
 *   sendHttpRequest        `parseInt(raw, 10) || ErrorCode.INTERNAL_ERROR`
 *   createErrorFromResponse `parseInt(raw, 10) as ErrorCode`   → NaN
 *
 * So a 409 arrived as a 500, and the string that said WHICH 409 it was arrived
 * nowhere at all. Every caller trying to tell an expired cart from a modified
 * one was left with the English message, which is not a contract.
 *
 * The 500 is the expensive half: retry policies keyed on 5xx re-send a request
 * that can never succeed, and monitoring counts a buyer's expired cart as a
 * server incident.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { HttpRemotePeer } from '../../../src/transport/http/peer.js';
import { TitanError } from '../../../src/errors/index.js';

const originalFetch = global.fetch;

/** One failed RPC, exactly as the titan HTTP server answers it. */
function respondWith(status: number, error: Record<string, unknown>) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'error',
    headers: new Headers(),
    json: () => Promise.resolve({ id: 'r1', success: false, error }),
  });
}

async function callAndCatch(peer: HttpRemotePeer): Promise<TitanError> {
  try {
    await peer.call('Commerce', 'checkout', [{}]);
  } catch (e) {
    return e as TitanError;
  }
  throw new Error('the call resolved — the fixture is wrong, not the code');
}

describe('a business error code crossing the wire', () => {
  let peer: HttpRemotePeer;

  beforeEach(() => {
    peer = new HttpRemotePeer('https://api.example.com');
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('keeps the HTTP status instead of claiming the server broke', async () => {
    global.fetch = respondWith(409, {
      code: 'CART_EXPIRED',
      message: 'Cart has expired — prices may have changed, please review it again',
      details: { expiredAt: '2026-09-01T00:00:00.000Z', errorCode: 'CART_EXPIRED' },
    }) as never;

    const err = await callAndCatch(peer);

    // This is the assertion the old code failed: 500.
    expect(err.code).toBe(409);
    expect(Number.isNaN(err.code as unknown as number)).toBe(false);
  });

  it('keeps the string that says WHICH 409 it was', async () => {
    global.fetch = respondWith(409, {
      code: 'CART_VERSION_CONFLICT',
      message: 'Cart was modified during checkout — please try again',
      details: { errorCode: 'CART_VERSION_CONFLICT' },
    }) as never;

    const err = await callAndCatch(peer);

    expect(err.code).toBe(409);
    expect((err.details as { errorCode?: string })?.errorCode).toBe('CART_VERSION_CONFLICT');
  });

  it('restores the business code when the envelope carried it only in `code`', async () => {
    // The server mirrors it into details itself, but not every path does —
    // the batch envelope builds `{ code, message }` with no details at all.
    global.fetch = respondWith(409, {
      code: 'DISPUTE_EXISTS',
      message: 'A dispute already exists for this order',
    }) as never;

    const err = await callAndCatch(peer);

    expect((err.details as { errorCode?: string })?.errorCode).toBe('DISPUTE_EXISTS');
  });

  it('still reads a numeric code, which is what most errors send', async () => {
    global.fetch = respondWith(429, {
      code: '429',
      message: 'Too many requests, please try again later',
      details: { retryAfter: 30 },
    }) as never;

    const err = await callAndCatch(peer);

    expect(err.code).toBe(429);
    // A numeric code is not a business code, so nothing is invented from it.
    expect((err.details as { errorCode?: string })?.errorCode).toBeUndefined();
    expect((err.details as { retryAfter?: number })?.retryAfter).toBe(30);
  });

  it('does not mistake a code that merely starts with digits for a status', async () => {
    global.fetch = respondWith(400, {
      code: '22P02_INVALID_TEXT',
      message: 'A value in the request could not be interpreted',
    }) as never;

    const err = await callAndCatch(peer);

    // `parseInt` would have said 22 — a code that is not an HTTP status and
    // means nothing to any caller.
    expect(err.code).toBe(400);
    expect((err.details as { errorCode?: string })?.errorCode).toBe('22P02_INVALID_TEXT');
  });

  it('falls back to a 500 only when there is genuinely nothing to go on', async () => {
    // 200 with success:false — the shape a batched failure comes back in, where
    // the HTTP status describes the batch and not the failure inside it.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      json: () =>
        Promise.resolve({
          id: 'r1',
          success: false,
          error: { code: 'SOMETHING_SPECIFIC', message: 'nope' },
        }),
    }) as never;

    const err = await callAndCatch(peer);

    expect(err.code).toBe(500);
    // The discriminator survives even where the status could not.
    expect((err.details as { errorCode?: string })?.errorCode).toBe('SOMETHING_SPECIFIC');
  });
});
