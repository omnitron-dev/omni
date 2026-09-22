/**
 * The client refused to cache a zero it could never be sent.
 *
 * `HttpRemotePeer.handleCacheHints` is written correctly:
 *
 *     if (cacheHints.maxAge && cacheHints.maxAge > 0) { cacheManager.set(…) }
 *
 * A `maxAge` of 0 means «do not hold this», and the client honours it. The
 * server, in both places that build the hint, did:
 *
 *     maxAge: method.cacheMaxAge || 300000
 *
 * so a method declaring `cacheMaxAge: 0` — the one way to say «cacheable in
 * principle, but do not keep my answer» — had that zero replaced by five
 * minutes before it ever left the process. The guard on the other side was
 * unreachable, and the response it was meant to protect was held for 300 s.
 *
 * That is the shape worth naming: not a missing defence, but a defence the
 * value never arrives at. Reading the client alone says caching is handled
 * properly; reading the server alone says a default is being applied. Only
 * the pair shows that one of them cannot do its job.
 *
 * The hint was also built TWICE, identically, in the two response paths. Two
 * copies of one rule is how they come to differ, so this is now one function
 * and the two call sites read it.
 */

import { describe, it, expect } from 'vitest';

import { cacheHintFor } from '../../src/netron/transport/http/server.js';

describe('a defence the value never reached', () => {
  it('carries a zero through, so the client can refuse it', () => {
    const hint = cacheHintFor({ cacheable: true, cacheMaxAge: 0 });

    expect(hint, 'the method asked for a hint').not.toBeNull();
    expect(hint?.maxAge, 'zero means do not hold this').toBe(0);
  });

  it('still defaults when the method named no age', () => {
    // Control: absent is not zero. A cacheable method that states no age
    // keeps the five-minute default it always had.
    expect(cacheHintFor({ cacheable: true })?.maxAge).toBe(300_000);
  });

  it('carries a stated age unchanged', () => {
    expect(cacheHintFor({ cacheable: true, cacheMaxAge: 1_000 })?.maxAge).toBe(1_000);
  });

  it('makes no hint for a method that asked for none', () => {
    // Control: the gate above it. A method that is not cacheable and sets no
    // Cache-Control header must produce no hint at all — not a hint of zero,
    // which would read as «I considered this and decided not to hold it».
    expect(cacheHintFor({})).toBeNull();
    expect(cacheHintFor({ cacheable: false })).toBeNull();
  });

  it('a Cache-Control header alone is enough to ask', () => {
    // The other half of the gate, kept because it is easy to drop when the
    // expression moves into a function.
    const hint = cacheHintFor({
      contract: { http: { responseHeaders: { 'Cache-Control': 'public, max-age=60' } } },
    });

    expect(hint).not.toBeNull();
    expect(hint?.tags).toEqual([]);
  });
});
