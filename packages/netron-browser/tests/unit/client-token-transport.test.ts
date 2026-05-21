/**
 * Unit tests for the client-side token-transport strategies.
 *
 * Covers Bearer / Cookie / Hybrid transports: header injection,
 * credentials policy, WS URL decoration, options handling.
 *
 * @module @omnitron-dev/netron-browser/test/auth
 */

import { describe, it, expect } from 'vitest';
import {
  BearerClientTokenTransport,
  CookieClientTokenTransport,
  HybridClientTokenTransport,
} from '../../src/auth/client-token-transports/index.js';
import type { ClientRequestPrep } from '../../src/auth/client-token-transport.js';

function freshPrep(): ClientRequestPrep {
  return { headers: {} };
}

describe('BearerClientTokenTransport', () => {
  const t = new BearerClientTokenTransport();

  it('reports correct capability flags', () => {
    expect(t.name).toBe('bearer');
    expect(t.usesCookies).toBe(false);
    expect(t.needsLocalTokenStorage).toBe(true);
  });

  it('injects Authorization header when token is present', () => {
    const prep = freshPrep();
    t.prepareRequest(prep, 'jwt-value');
    expect(prep.headers.Authorization).toBe('Bearer jwt-value');
    expect(prep.credentials).toBeUndefined();
  });

  it('does NOT inject header when token is null', () => {
    const prep = freshPrep();
    t.prepareRequest(prep, null);
    expect(prep.headers.Authorization).toBeUndefined();
  });

  it('honors custom header name and prefix', () => {
    const custom = new BearerClientTokenTransport({ headerName: 'X-Auth', tokenPrefix: 'JWT ' });
    const prep = freshPrep();
    custom.prepareRequest(prep, 'jwt');
    expect(prep.headers['X-Auth']).toBe('JWT jwt');
  });

  it('appends ?token= to WS URL when no existing query', () => {
    expect(t.prepareWebSocketUrl('wss://host/ws', 'abc')).toBe('wss://host/ws?token=abc');
  });

  it('appends &token= to WS URL when query already present', () => {
    expect(t.prepareWebSocketUrl('wss://host/ws?v=1', 'abc')).toBe('wss://host/ws?v=1&token=abc');
  });

  it('URL-encodes the token value', () => {
    expect(t.prepareWebSocketUrl('wss://host/ws', 'a/b+c')).toContain('token=a%2Fb%2Bc');
  });

  it('returns URL unchanged when token is null', () => {
    expect(t.prepareWebSocketUrl('wss://host/ws', null)).toBe('wss://host/ws');
  });

  it('returns URL unchanged when wsQueryParam is disabled', () => {
    const strict = new BearerClientTokenTransport({ wsQueryParam: null });
    expect(strict.prepareWebSocketUrl('wss://host/ws', 'abc')).toBe('wss://host/ws');
  });
});

describe('CookieClientTokenTransport', () => {
  const t = new CookieClientTokenTransport();

  it('reports correct capability flags', () => {
    expect(t.name).toBe('cookie');
    expect(t.usesCookies).toBe(true);
    expect(t.needsLocalTokenStorage).toBe(false);
  });

  it('sets credentials to include by default', () => {
    const prep = freshPrep();
    t.prepareRequest(prep, null);
    expect(prep.credentials).toBe('include');
  });

  it('does NOT set Authorization header even when a token is passed', () => {
    const prep = freshPrep();
    t.prepareRequest(prep, 'leaked-jwt');
    expect(prep.headers.Authorization).toBeUndefined();
  });

  it('honors credentials override', () => {
    const sameOrigin = new CookieClientTokenTransport({ credentials: 'same-origin' });
    const prep = freshPrep();
    sameOrigin.prepareRequest(prep, null);
    expect(prep.credentials).toBe('same-origin');
  });

  it('leaves WS URL unchanged (cookie rides upgrade automatically)', () => {
    expect(t.prepareWebSocketUrl('wss://host/ws', null)).toBe('wss://host/ws');
    expect(t.prepareWebSocketUrl('wss://host/ws?x=1', 'anything')).toBe('wss://host/ws?x=1');
  });
});

describe('HybridClientTokenTransport', () => {
  const t = new HybridClientTokenTransport();

  it('reports correct capability flags', () => {
    expect(t.name).toBe('hybrid');
    expect(t.usesCookies).toBe(true);
    expect(t.needsLocalTokenStorage).toBe(true);
  });

  it('sets BOTH Authorization header AND credentials when token is present', () => {
    const prep = freshPrep();
    t.prepareRequest(prep, 'jwt');
    expect(prep.headers.Authorization).toBe('Bearer jwt');
    expect(prep.credentials).toBe('include');
  });

  it('still upgrades credentials when token is null', () => {
    const prep = freshPrep();
    t.prepareRequest(prep, null);
    expect(prep.headers.Authorization).toBeUndefined();
    expect(prep.credentials).toBe('include');
  });

  it('appends ?token= to WS URL (bearer wins for explicit fallback)', () => {
    expect(t.prepareWebSocketUrl('wss://host/ws', 'jwt')).toBe('wss://host/ws?token=jwt');
  });
});
