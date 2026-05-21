/**
 * Tests for Netron auth token-transport strategies.
 *
 * Covers Bearer, Cookie, and Composite transports — extract / issue /
 * clear semantics plus edge cases (missing headers, malformed cookies,
 * case-insensitive header lookup, body-strip aggregation).
 *
 * @module @omnitron-dev/titan/test/netron/auth
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  BearerTokenTransport,
  CookieTokenTransport,
  CompositeTokenTransport,
  createCompositeCookieBearer,
} from '../../../src/netron/auth/token-transports/index.js';
import type { TokenIssueResponse } from '../../../src/netron/auth/token-transport.js';

/** Stub response that records every appended header. */
class RecordingResponse implements TokenIssueResponse {
  public headers: Array<[string, string]> = [];
  appendHeader(name: string, value: string): void {
    this.headers.push([name, value]);
  }
  setCookies(): string[] {
    return this.headers.filter(([n]) => n.toLowerCase() === 'set-cookie').map(([, v]) => v);
  }
}

describe('BearerTokenTransport', () => {
  let t: BearerTokenTransport;
  beforeEach(() => {
    t = new BearerTokenTransport();
  });

  it('name and usesCookies flag', () => {
    expect(t.name).toBe('bearer');
    expect(t.usesCookies).toBe(false);
  });

  it('extracts token from Authorization header', () => {
    expect(t.extract({ headers: { authorization: 'Bearer abc' } })).toBe('abc');
  });

  it('extracts token case-insensitively', () => {
    expect(t.extract({ headers: { Authorization: 'Bearer abc' } })).toBe('abc');
  });

  it('returns null for non-Bearer scheme', () => {
    expect(t.extract({ headers: { authorization: 'Basic abc' } })).toBeNull();
  });

  it('falls back to ?token= when header is missing', () => {
    expect(t.extract({ headers: {}, url: '/ws?token=xyz' })).toBe('xyz');
  });

  it('Authorization header wins over ?token=', () => {
    expect(t.extract({ headers: { authorization: 'Bearer header-wins' }, url: '/ws?token=loser' })).toBe('header-wins');
  });

  it('query-param fallback can be disabled', () => {
    const strict = new BearerTokenTransport({ queryParamName: null });
    expect(strict.extract({ headers: {}, url: '/ws?token=xyz' })).toBeNull();
  });

  it('custom header name is honoured', () => {
    const custom = new BearerTokenTransport({ headerName: 'x-auth' });
    expect(custom.extract({ headers: { 'x-auth': 'Bearer custom' } })).toBe('custom');
  });

  it('issue() and clear() are no-ops (no Set-Cookie emitted)', () => {
    const res = new RecordingResponse();
    const result = t.issue(res, { access: 'jwt' });
    t.clear(res);
    expect(res.headers).toEqual([]);
    expect(result.stripFromBody).toBeUndefined();
  });

  it('returns null when URL is malformed for query fallback', () => {
    expect(t.extract({ headers: {}, url: 'not::a::url' })).toBeNull();
  });
});

describe('CookieTokenTransport', () => {
  let t: CookieTokenTransport;
  beforeEach(() => {
    t = new CookieTokenTransport({
      accessCookie: { name: 'omni_access', maxAgeSec: 900, secure: false },
      refreshCookie: { name: 'omni_refresh', maxAgeSec: 7 * 24 * 3600, path: '/api/auth', secure: false },
    });
  });

  it('name and usesCookies flag', () => {
    expect(t.name).toBe('cookie');
    expect(t.usesCookies).toBe(true);
  });

  it('throws when access cookie name is missing', () => {
    expect(() => new CookieTokenTransport({ accessCookie: { name: '' } })).toThrow();
  });

  it('extracts access token from Cookie header', () => {
    expect(t.extract({ headers: { cookie: 'omni_access=jwt-value; other=1' } })).toBe('jwt-value');
  });

  it('handles case-insensitive Cookie header name', () => {
    expect(t.extract({ headers: { Cookie: 'omni_access=jwt' } })).toBe('jwt');
  });

  it('returns null when cookie is absent', () => {
    expect(t.extract({ headers: { cookie: 'something=else' } })).toBeNull();
    expect(t.extract({ headers: {} })).toBeNull();
  });

  it('returns null for empty cookie value', () => {
    expect(t.extract({ headers: { cookie: 'omni_access=' } })).toBeNull();
  });

  it('issues both access and refresh cookies', () => {
    const res = new RecordingResponse();
    const result = t.issue(res, { access: 'access-jwt', refresh: 'refresh-jwt' });
    const setCookies = res.setCookies();
    expect(setCookies.length).toBe(2);
    expect(setCookies[0]).toContain('omni_access=access-jwt');
    expect(setCookies[0]).toContain('Max-Age=900');
    expect(setCookies[0]).toContain('HttpOnly');
    expect(setCookies[1]).toContain('omni_refresh=refresh-jwt');
    expect(setCookies[1]).toContain('Path=/api/auth');
    expect(result.stripFromBody).toEqual(['accessToken', 'refreshToken']);
  });

  it('skips refresh cookie when refresh token not provided', () => {
    const res = new RecordingResponse();
    t.issue(res, { access: 'a' });
    expect(res.setCookies().length).toBe(1);
  });

  it('honors per-call maxAge overrides', () => {
    const res = new RecordingResponse();
    t.issue(res, { access: 'a', accessMaxAgeSec: 60 });
    expect(res.setCookies()[0]).toContain('Max-Age=60');
  });

  it('emits Max-Age=0 cookies on clear()', () => {
    const res = new RecordingResponse();
    t.clear(res);
    const setCookies = res.setCookies();
    expect(setCookies.length).toBe(2);
    expect(setCookies.every((c) => c.includes('Max-Age=0'))).toBe(true);
  });

  it('honors custom stripFields', () => {
    const custom = new CookieTokenTransport({
      accessCookie: { name: 'x' },
      stripFields: ['token', 'sessionToken'],
    });
    const res = new RecordingResponse();
    const result = custom.issue(res, { access: 'a' });
    expect(result.stripFromBody).toEqual(['token', 'sessionToken']);
  });
});

describe('CompositeTokenTransport', () => {
  it('throws when constructed with no delegates', () => {
    expect(() => new CompositeTokenTransport([])).toThrow();
  });

  it('extract returns the first non-null result (cookie wins over bearer)', () => {
    const composite = createCompositeCookieBearer({ accessCookie: { name: 'a', secure: false } });
    const token = composite.extract({
      headers: { cookie: 'a=cookie-token', authorization: 'Bearer bearer-token' },
    });
    expect(token).toBe('cookie-token');
  });

  it('extract falls through when first delegate has no token', () => {
    const composite = createCompositeCookieBearer({ accessCookie: { name: 'a', secure: false } });
    const token = composite.extract({ headers: { authorization: 'Bearer bearer-only' } });
    expect(token).toBe('bearer-only');
  });

  it('extract returns null when no delegate matches', () => {
    const composite = createCompositeCookieBearer({ accessCookie: { name: 'a', secure: false } });
    expect(composite.extract({ headers: {} })).toBeNull();
  });

  it('issue() fans out to all delegates without stripping body (composite serves both cookie + bearer)', () => {
    const composite = createCompositeCookieBearer({ accessCookie: { name: 'a', secure: false } });
    const res = new RecordingResponse();
    const result = composite.issue(res, { access: 'jwt', refresh: 'r' });
    // Cookie delegate still emits Set-Cookie...
    expect(res.setCookies().length).toBeGreaterThan(0);
    // ...but composite deliberately does NOT propagate stripFromBody
    // so bearer-header clients still see the tokens in the JSON body.
    expect(result.stripFromBody).toBeUndefined();
  });

  it('clear() fans out', () => {
    const composite = createCompositeCookieBearer({ accessCookie: { name: 'a', secure: false } });
    const res = new RecordingResponse();
    composite.clear(res);
    expect(res.setCookies().length).toBeGreaterThan(0);
  });

  it('usesCookies is true when any delegate uses cookies', () => {
    const composite = createCompositeCookieBearer({ accessCookie: { name: 'a', secure: false } });
    expect(composite.usesCookies).toBe(true);
  });

  it('name reflects delegate chain', () => {
    const composite = createCompositeCookieBearer({ accessCookie: { name: 'a', secure: false } });
    expect(composite.name).toBe('composite(cookie+bearer)');
  });
});
