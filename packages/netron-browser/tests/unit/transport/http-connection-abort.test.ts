/**
 * NB-11: HttpConnection used a SINGLE shared `this.abortController`, reassigned on
 * every request. Consequences:
 *  - a request's timeout closure read `this.abortController` at fire time, so it
 *    aborted whichever request wrote the field LAST, not itself;
 *  - `close()` aborted only that last controller, leaving earlier in-flight
 *    requests (and pings, which never set the field at all) uncancellable.
 *
 * The fix gives every request its own AbortController, tracked in a set so
 * `close()` can abort them all. These tests assert (a) concurrent requests get
 * distinct signals, and (b) close() cancels every in-flight request.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { HttpConnection } from '../../../src/transport/http/connection.js';

afterEach(() => vi.unstubAllGlobals());

/** A fetch that never resolves on its own but rejects (AbortError) when its signal aborts. */
function hangingFetch(seenSignals?: Array<AbortSignal | undefined>) {
  return vi.fn((_url: string, init?: RequestInit) => {
    seenSignals?.push(init?.signal ?? undefined);
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  });
}

describe('HttpConnection per-request AbortController (NB-11)', () => {
  it('gives concurrent requests distinct abort signals', async () => {
    const seen: Array<AbortSignal | undefined> = [];
    vi.stubGlobal('fetch', hangingFetch(seen));

    const conn = new HttpConnection('http://test.local');
    const p1 = conn.ping().catch((e) => e);
    const p2 = conn.ping().catch((e) => e);

    // Both fetches are in-flight; each must have received its OWN signal.
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(seen[1]).toBeInstanceOf(AbortSignal);
    expect(seen[0]).not.toBe(seen[1]);

    await conn.close();
    await Promise.all([p1, p2]);
  });

  it('close() aborts every in-flight request, not just the most recent', async () => {
    vi.stubGlobal('fetch', hangingFetch());

    const conn = new HttpConnection('http://test.local');
    const p1 = conn.ping().catch((e) => e);
    const p2 = conn.ping().catch((e) => e);

    await conn.close();

    // With the old single shared controller, the earlier ping could not be
    // cancelled and this would hang. Both must now settle (reject).
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBeInstanceOf(Error);
    expect(r2).toBeInstanceOf(Error);
  });
});
