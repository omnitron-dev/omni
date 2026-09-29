/**
 * A cookie no transport would carry.
 *
 * `issueTokens` speaks of `access` and `refresh`, and the cookie transport
 * emits exactly the cookies it has been configured with. A platform also
 * needs cookies that the APPLICATION does not read at all: a maintenance
 * bypass an nginx/Lua gateway compares against a stored hash, a canary flag,
 * a shard pin. Before `issueCookie` there was no way to send one — the only
 * door was `TOKEN_ISSUANCE_METADATA_KEYS.setCookies`, which is exported for
 * transports and tests, so every caller would have written into it by hand
 * with its own idea of the attributes.
 *
 * What this court holds:
 *
 *   1. the cookie reaches the response queue the HTTP server flushes — the
 *      SAME queue the transport uses, so the two compose;
 *   2. it composes in BOTH orders and never replaces what is already there:
 *      a helper that assigned instead of appending would silently drop the
 *      session cookie of any handler that set one first;
 *   3. `clearCookie` produces a deletion the browser will honour — empty
 *      value and `Max-Age=0`;
 *   4. calling it outside a request throws, rather than writing nowhere.
 *
 * (2) is the one worth the file. A browser keys cookies on
 * (name, path, domain), so a queue that loses an entry does not fail — it
 * produces a jar with the wrong contents, and the request that follows picks
 * whichever cookie survived.
 */
import { describe, it, expect } from 'vitest';

import {
  issueCookie,
  clearCookie,
  issueTokens,
  runWithTokenIssuanceContext,
  TOKEN_ISSUANCE_METADATA_KEYS,
} from '../../../src/netron/auth/token-issuance.js';

/** What the HTTP server flushes into the response headers. */
function queued(metadata: Map<string, unknown>): string[] {
  return (metadata.get(TOKEN_ISSUANCE_METADATA_KEYS.setCookies) as string[] | undefined) ?? [];
}

describe('a cookie no transport would carry', () => {
  it('queues a Set-Cookie the response builder will flush', () => {
    const metadata = new Map<string, unknown>();
    runWithTokenIssuanceContext(metadata, () => {
      issueCookie('omni_maint', 'deadbeef', { secure: false, maxAge: 3600 });
    });

    expect(queued(metadata)).toHaveLength(1);
    const header = queued(metadata)[0]!;
    expect(header).toContain('omni_maint=deadbeef');
    expect(header).toContain('Max-Age=3600');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Strict');
    // `secure: false` is what an onion / plain-HTTP stand must pass: the
    // browser drops a Secure cookie on an http origin, and the feature then
    // fails with nothing to read anywhere.
    expect(header).not.toContain('Secure');
  });

  it('defaults to the auth-grade attributes', () => {
    const metadata = new Map<string, unknown>();
    runWithTokenIssuanceContext(metadata, () => {
      issueCookie('omni_maint', 'x');
    });
    const header = queued(metadata)[0]!;
    expect(header).toContain('Secure');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Path=/');
  });

  describe('composition with the transport', () => {
    /**
     * The transport reads this queue, copies it, appends its own and writes
     * the result back. A cookie issued BEFORE it must survive that copy.
     */
    it('keeps a cookie queued before the tokens', () => {
      const metadata = new Map<string, unknown>();
      runWithTokenIssuanceContext(metadata, () => {
        issueCookie('omni_maint', 'first', { secure: false });
        issueTokens({ access: 'jwt' });
      });

      expect(queued(metadata)).toHaveLength(1);
      expect(queued(metadata)[0]).toContain('omni_maint=first');
      // The tokens went to their own key; the transport turns them into
      // Set-Cookie later, appending to this same array.
      expect(metadata.get(TOKEN_ISSUANCE_METADATA_KEYS.issued)).toEqual({ access: 'jwt' });
    });

    it('appends rather than replaces when several are issued', () => {
      const metadata = new Map<string, unknown>();
      runWithTokenIssuanceContext(metadata, () => {
        issueCookie('one', 'a', { secure: false });
        issueCookie('two', 'b', { secure: false });
        issueCookie('three', 'c', { secure: false });
      });

      const headers = queued(metadata);
      expect(headers).toHaveLength(3);
      expect(headers.map((h) => h.split('=')[0])).toEqual(['one', 'two', 'three']);
    });

    /**
     * A cookie the transport itself already queued — the shape the HTTP
     * server produces when cookie mode ran first.
     */
    it('appends after a value the transport put there', () => {
      const metadata = new Map<string, unknown>();
      metadata.set(TOKEN_ISSUANCE_METADATA_KEYS.setCookies, ['omni_access=jwt; Path=/; HttpOnly']);
      runWithTokenIssuanceContext(metadata, () => {
        issueCookie('omni_maint', 'x', { secure: false });
      });

      const headers = queued(metadata);
      expect(headers).toHaveLength(2);
      expect(headers[0]).toContain('omni_access=jwt');
      expect(headers[1]).toContain('omni_maint=x');
    });
  });

  describe('clearing', () => {
    it('produces a deletion the browser honours', () => {
      const metadata = new Map<string, unknown>();
      runWithTokenIssuanceContext(metadata, () => {
        clearCookie('omni_maint');
      });
      const header = queued(metadata)[0]!;
      expect(header).toContain('omni_maint=');
      expect(header).toContain('Max-Age=0');
      expect(header).toContain('Path=/');
    });

    /**
     * The tuple the browser deletes by. A clear whose path differs from the
     * issue leaves the cookie in place — a bypass that outlives the session
     * it was given to, with nothing in any log to say so.
     */
    it('carries the path it is told to, so the tuple can match the issue', () => {
      const metadata = new Map<string, unknown>();
      runWithTokenIssuanceContext(metadata, () => {
        clearCookie('omni_maint', { path: '/admin' });
      });
      expect(queued(metadata)[0]).toContain('Path=/admin');
    });
  });

  describe('outside a request', () => {
    it('refuses rather than writing nowhere', () => {
      expect(() => issueCookie('omni_maint', 'x')).toThrow(/outside of a service-handler context/);
      expect(() => clearCookie('omni_maint')).toThrow(/outside of a service-handler context/);
    });

    it('accepts an explicit context instead', () => {
      const ctx = { metadata: new Map<string, unknown>() };
      issueCookie(ctx, 'omni_maint', 'x', { secure: false });
      clearCookie(ctx, 'other');
      expect(queued(ctx.metadata)).toHaveLength(2);
    });
  });
});
