/**
 * Tests for the CSRF manager (server-side double-submit cookie).
 *
 * @module @omnitron-dev/titan/test/netron/auth
 */

import { describe, it, expect } from 'vitest';
import { CsrfManager } from '../../../src/netron/auth/csrf.js';

describe('CsrfManager', () => {
  const csrf = new CsrfManager();

  it('uses sensible defaults for cookie + header names', () => {
    expect(csrf.cookieName).toBe('omni_csrf');
    expect(csrf.headerName).toBe('x-csrf-token');
  });

  it('generateToken produces 32-byte base64url-encoded values', () => {
    const t1 = csrf.generateToken();
    const t2 = csrf.generateToken();
    // 32 bytes -> 43-char base64url (no padding)
    expect(t1).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(t1).not.toBe(t2); // crypto-random uniqueness
  });

  it('buildCookie emits a non-HttpOnly cookie with SameSite=Strict', () => {
    const token = csrf.generateToken();
    const setCookie = csrf.buildCookie(token);
    expect(setCookie).toContain(`omni_csrf=${token}`);
    expect(setCookie).toContain('Max-Age=900'); // 15 min default
    expect(setCookie).not.toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
  });

  it('buildClearCookie emits Max-Age=0', () => {
    const setCookie = csrf.buildClearCookie();
    expect(setCookie).toContain('Max-Age=0');
    expect(setCookie).toContain('omni_csrf=');
  });

  it('verify returns true when header matches cookie', () => {
    const token = csrf.generateToken();
    const ok = csrf.verify({
      headers: {
        cookie: `omni_csrf=${token}`,
        'x-csrf-token': token,
      },
    });
    expect(ok).toBe(true);
  });

  it('verify returns false on missing cookie', () => {
    const token = csrf.generateToken();
    expect(csrf.verify({ headers: { 'x-csrf-token': token } })).toBe(false);
  });

  it('verify returns false on missing header', () => {
    const token = csrf.generateToken();
    expect(csrf.verify({ headers: { cookie: `omni_csrf=${token}` } })).toBe(false);
  });

  it('verify returns false on mismatch', () => {
    const cookieTok = csrf.generateToken();
    const headerTok = csrf.generateToken();
    expect(
      csrf.verify({
        headers: { cookie: `omni_csrf=${cookieTok}`, 'x-csrf-token': headerTok },
      })
    ).toBe(false);
  });

  it('verify is case-insensitive on header lookup', () => {
    const token = csrf.generateToken();
    expect(
      csrf.verify({
        headers: { cookie: `omni_csrf=${token}`, 'X-CSRF-Token': token },
      })
    ).toBe(true);
  });

  it('verify rejects empty header value even when cookie present', () => {
    const token = csrf.generateToken();
    expect(
      csrf.verify({ headers: { cookie: `omni_csrf=${token}`, 'x-csrf-token': '' } })
    ).toBe(false);
  });

  it('honors custom cookie / header names', () => {
    const custom = new CsrfManager({
      headerName: 'X-Lux-CSRF',
      cookie: { name: 'lux_csrf', maxAgeSec: 60, secure: false },
    });
    expect(custom.cookieName).toBe('lux_csrf');
    expect(custom.headerName).toBe('x-lux-csrf');
    expect(custom.buildCookie('t')).toContain('lux_csrf=t');
    expect(custom.buildCookie('t')).toContain('Max-Age=60');
    expect(custom.buildCookie('t')).not.toContain('Secure');
  });

  it('rejects mismatched-length values without leaking timing', () => {
    // Different lengths should short-circuit safely
    const result = csrf.verify({
      headers: { cookie: 'omni_csrf=short', 'x-csrf-token': 'much-longer-value' },
    });
    expect(result).toBe(false);
  });
});
