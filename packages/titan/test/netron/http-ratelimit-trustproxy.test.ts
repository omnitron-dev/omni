/**
 * RL-5: the HTTP SlidingWindowRateLimiter used to default `trustProxy` to true,
 * keying each client off `X-Forwarded-For` — a header the client fully controls.
 * An attacker could then rotate the header per request to land in a fresh limit
 * bucket every time, trivially bypassing the limit. The default is now `false`:
 * the proxy header is ignored unless the deployer explicitly opts in (behind a
 * trusted proxy that overwrites it).
 */

import { describe, it, expect, vi } from 'vitest';
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

describe('shared transport admission', () => {
  it('uses the direct socket address, ignoring both Host and untrusted forwarding', () => {
    const limiter = new SlidingWindowRateLimiter({ enabled: true, maxRequests: 1 });
    expect(limiter.check(req('198.51.100.2'), '::ffff:192.0.2.1').allowed).toBe(true);
    expect(limiter.check(new Request('https://different.example/'), '192.0.2.1').allowed).toBe(false);
    expect(limiter.check(req('198.51.100.2'), '192.0.2.2').allowed).toBe(true);
    expect(limiter.check(new Request('https://a/')).allowed).toBe(true);
    expect(limiter.check(new Request('https://b/')).allowed).toBe(false);
  });

  it('canonicalises IPv6 aliases and discards invalid forwarded addresses', () => {
    const limiter = new SlidingWindowRateLimiter({ enabled: true, trustProxy: true, maxRequests: 1 });
    expect(limiter.check(req('2001:db8::1')).allowed).toBe(true);
    expect(limiter.check(req('2001:0DB8:0:0:0:0:0:1')).allowed).toBe(false);
    expect(limiter.check(req('spoof'), '192.0.2.1').allowed).toBe(true);
    expect(limiter.check(req('other'), '192.0.2.1').allowed).toBe(false);
  });

  it('reserves a batch atomically and prevents one blocked client exhausting the global budget', () => {
    const limiter = new SlidingWindowRateLimiter({ enabled: true, maxRequests: 3, globalMaxRequests: 5 });
    expect(limiter.consume('a', 4).allowed).toBe(false);
    expect(limiter.getStats().activeClients).toBe(0);
    expect(limiter.consume('a', 3).allowed).toBe(true);
    for (let n = 0; n < 20; n++) expect(limiter.consume('a').allowed).toBe(false);
    expect(limiter.consume('b', 3).allowed).toBe(false);
    expect(limiter.consume('b', 2).allowed).toBe(true);
    expect(limiter.consume('c').allowed).toBe(false);
    expect(limiter.getStats()).toMatchObject({ activeClients: 2, globalCount: 5 });
  });

  it('clears expired keys under sustained churn and starts a fresh window', () => {
    vi.useFakeTimers();
    try {
      const limiter = new SlidingWindowRateLimiter({ enabled: true, windowMs: 1_000, maxRequests: 1, globalMaxRequests: 3 });
      for (let i = 0; i < 30; i++) limiter.consume(String(i));
      expect(limiter.getStats().activeClients).toBe(3);
      vi.advanceTimersByTime(1_000);
      expect(limiter.getStats()).toMatchObject({ activeClients: 0, globalCount: 0 });
      expect(limiter.consume('0').allowed).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
