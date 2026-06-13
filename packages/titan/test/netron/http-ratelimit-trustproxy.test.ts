/**
 * RL-5: the HTTP SlidingWindowRateLimiter used to default `trustProxy` to true,
 * keying each client off `X-Forwarded-For` — a header the client fully controls.
 * An attacker could then rotate the header per request to land in a fresh limit
 * bucket every time, trivially bypassing the limit. The default is now `false`:
 * the proxy header is ignored unless the deployer explicitly opts in (behind a
 * trusted proxy that overwrites it).
 */

import { describe, it, expect } from 'vitest';
import { SlidingWindowRateLimiter } from '../../src/netron/transport/http/rate-limiter.js';

const req = (xff: string) =>
  new Request('http://example.com/rpc', { headers: { 'X-Forwarded-For': xff } });

describe('HTTP rate limiter trustProxy default (RL-5)', () => {
  it('ignores X-Forwarded-For by default, so spoofing it cannot mint new buckets', () => {
    const limiter = new SlidingWindowRateLimiter({ enabled: true, maxRequests: 1, windowMs: 60_000 });

    // First request consumes the single slot for the (header-independent) key.
    expect(limiter.check(req('1.1.1.1')).allowed).toBe(true);
    // A second request with a DIFFERENT spoofed X-Forwarded-For must still be
    // blocked — pre-RL-5 it would have been a fresh bucket (allowed) = bypass.
    expect(limiter.check(req('2.2.2.2')).allowed).toBe(false);
    expect(limiter.check(req('3.3.3.3')).allowed).toBe(false);
  });

  it('honors X-Forwarded-For when trustProxy is explicitly enabled', () => {
    const limiter = new SlidingWindowRateLimiter({ enabled: true, maxRequests: 1, windowMs: 60_000, trustProxy: true });

    // Distinct forwarded IPs are distinct clients → each gets its own slot.
    expect(limiter.check(req('1.1.1.1')).allowed).toBe(true);
    expect(limiter.check(req('2.2.2.2')).allowed).toBe(true);
    // ...but a repeat of the same forwarded IP is limited.
    expect(limiter.check(req('1.1.1.1')).allowed).toBe(false);
  });
});
