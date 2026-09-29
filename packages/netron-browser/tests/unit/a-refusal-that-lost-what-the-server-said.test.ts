/**
 * A refusal that lost what the server said with it.
 *
 * `HttpClient.invoke` threw `new Error(message)` with `code` and nothing else.
 * The server's `error.details` and the HTTP status stopped at the transport,
 * so a caller could learn THAT it was refused and never the rest: how long to
 * wait, which field was wrong, which two currencies disagreed. Measured in the
 * downstream portal on 2026-09-29 — six refused sign-ins, six errors whose only
 * own key was `code`, while each body carried
 * `details: { retryAfter: 897, errorCode: 'RATE_LIMIT_EXCEEDED' }` under a 429.
 *
 * These drive the real client against a scripted `fetch`, in the envelopes
 * servers actually send.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

import { HttpClient } from '../../src/client/http-client.js';

type Refused = Error & { code?: unknown; details?: Record<string, unknown>; status?: number };

/** Answer every request with this status and body. */
function answer(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      typeof body === 'string'
        ? new Response(body, { status, statusText: 'Bad Gateway', headers: { 'content-type': 'text/html' } })
        : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    )
  );
}

async function refusalOf(): Promise<Refused> {
  const client = new HttpClient({ url: 'http://stand.test' });
  return client.invoke('Auth', 'signin', [{}]).then(
    () => {
      throw new Error('the call was expected to be refused');
    },
    (err: Refused) => err
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a refused call', () => {
  it('keeps the details and the status of an application’s refusal, beside its code', async () => {
    answer(429, {
      id: '1',
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded. Try again in 897 seconds.',
        details: { retryAfter: 897, errorCode: 'RATE_LIMIT_EXCEEDED' },
      },
    });

    const err = await refusalOf();

    expect(err.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(err.details).toEqual({ retryAfter: 897, errorCode: 'RATE_LIMIT_EXCEEDED' });
    expect(err.status).toBe(429);
  });

  it('keeps them for a numeric code too, which callers compare as it came', async () => {
    answer(429, { id: '1', success: false, error: { code: 429, message: 'Rate limit exceeded. Retry after 59s.', details: { retryAfter: 59, limit: 10 } } });

    const err = await refusalOf();

    expect(err.code).toBe(429);
    expect(err.details).toEqual({ retryAfter: 59, limit: 10 });
    expect(err.status).toBe(429);
  });

  it('says the status of an answer that was not JSON at all', async () => {
    answer(502, '<html>bad gateway</html>');

    const err = await refusalOf();

    expect(err.code).toBe('HTTP_ERROR');
    expect(err.status).toBe(502);
    expect('details' in err).toBe(false);
  });

  it('invents nothing: no details when the server sent none, no status under a 200', async () => {
    answer(200, { id: '1', success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });

    const err = await refusalOf();

    expect(err.code).toBe('NOT_FOUND');
    expect('details' in err).toBe(false);
    expect('status' in err).toBe(false);
  });
});
