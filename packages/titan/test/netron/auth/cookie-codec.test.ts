/**
 * Tests for the Netron auth cookie codec.
 *
 * @module @omnitron-dev/titan/test/netron/auth
 */

import { describe, it, expect } from 'vitest';
import { buildClearCookie, buildSetCookie, parseCookieHeader } from '../../../src/netron/auth/cookie-codec.js';

describe('cookie-codec', () => {
  describe('parseCookieHeader', () => {
    it('returns an empty Map for undefined / empty input', () => {
      expect(parseCookieHeader(undefined).size).toBe(0);
      expect(parseCookieHeader('').size).toBe(0);
    });

    it('parses a single cookie', () => {
      const cookies = parseCookieHeader('omni_access=eyJhbGc');
      expect(cookies.get('omni_access')).toBe('eyJhbGc');
    });

    it('parses multiple cookies', () => {
      const cookies = parseCookieHeader('a=1; b=2; c=3');
      expect(cookies.get('a')).toBe('1');
      expect(cookies.get('b')).toBe('2');
      expect(cookies.get('c')).toBe('3');
    });

    it('URL-decodes cookie values', () => {
      const cookies = parseCookieHeader('payload=hello%20world');
      expect(cookies.get('payload')).toBe('hello world');
    });

    it('strips surrounding double quotes', () => {
      const cookies = parseCookieHeader('token="abc.def"');
      expect(cookies.get('token')).toBe('abc.def');
    });

    it('skips malformed entries silently', () => {
      const cookies = parseCookieHeader('valid=1; ; =orphan; alsoOk=2');
      expect(cookies.get('valid')).toBe('1');
      expect(cookies.get('alsoOk')).toBe('2');
      expect(cookies.size).toBe(2);
    });

    it('joins array-form headers', () => {
      const cookies = parseCookieHeader(['a=1', 'b=2']);
      expect(cookies.get('a')).toBe('1');
      expect(cookies.get('b')).toBe('2');
    });

    it('keeps the raw value if decode fails', () => {
      // lone percent — decodeURIComponent throws, parser falls back to raw
      const cookies = parseCookieHeader('weird=100%off');
      expect(cookies.get('weird')).toBe('100%off');
    });

    it('tolerates whitespace around names and values', () => {
      const cookies = parseCookieHeader('  a  =  1  ;  b=2');
      expect(cookies.get('a')).toBe('1');
      expect(cookies.get('b')).toBe('2');
    });
  });

  describe('buildSetCookie', () => {
    it('emits secure-by-default attributes', () => {
      const value = buildSetCookie('omni_access', 'jwt');
      expect(value).toContain('omni_access=jwt');
      expect(value).toContain('Path=/');
      expect(value).toContain('HttpOnly');
      expect(value).toContain('Secure');
      expect(value).toContain('SameSite=Strict');
    });

    it('honors maxAge', () => {
      const value = buildSetCookie('t', 'v', { maxAge: 900 });
      expect(value).toContain('Max-Age=900');
    });

    it('floors fractional maxAge', () => {
      const value = buildSetCookie('t', 'v', { maxAge: 60.7 });
      expect(value).toContain('Max-Age=60');
    });

    it('honors path and domain overrides', () => {
      const value = buildSetCookie('t', 'v', { path: '/api/main', domain: 'omni.example' });
      expect(value).toContain('Path=/api/main');
      expect(value).toContain('Domain=omni.example');
    });

    it('omits Secure when explicitly disabled (dev/HTTP)', () => {
      const value = buildSetCookie('t', 'v', { secure: false });
      expect(value).not.toContain('Secure');
    });

    it('omits HttpOnly when explicitly disabled', () => {
      const value = buildSetCookie('csrf', 'token', { httpOnly: false });
      expect(value).not.toContain('HttpOnly');
    });

    it('honors SameSite=Lax / None', () => {
      const lax = buildSetCookie('t', 'v', { sameSite: 'Lax' });
      const none = buildSetCookie('t', 'v', { sameSite: 'None' });
      expect(lax).toContain('SameSite=Lax');
      expect(none).toContain('SameSite=None');
    });

    it('URL-encodes the value', () => {
      const value = buildSetCookie('t', 'a b/c');
      expect(value).toContain('t=a%20b%2Fc');
    });

    it('serializes Expires from a Date', () => {
      const exp = new Date('2030-01-01T00:00:00Z');
      const value = buildSetCookie('t', 'v', { expires: exp });
      expect(value).toContain(`Expires=${exp.toUTCString()}`);
    });

    it('rejects invalid cookie names (CRLF injection guard)', () => {
      expect(() => buildSetCookie('bad name', 'v')).toThrow(/invalid cookie name/i);
      expect(() => buildSetCookie('bad\r\nname', 'v')).toThrow(/invalid cookie name/i);
      expect(() => buildSetCookie('', 'v')).toThrow();
    });
  });

  describe('buildClearCookie', () => {
    it('emits Max-Age=0 with matching path/domain', () => {
      const value = buildClearCookie('omni_access', { path: '/api', domain: 'omni.example' });
      expect(value).toContain('omni_access=');
      expect(value).toContain('Max-Age=0');
      expect(value).toContain('Path=/api');
      expect(value).toContain('Domain=omni.example');
    });

    it('defaults path to /', () => {
      const value = buildClearCookie('omni_access');
      expect(value).toContain('Path=/');
    });
  });

  describe('round-trip', () => {
    it('build then parse yields the original value', () => {
      const set = buildSetCookie('omni', 'hello world!');
      // strip attrs after the first ';'
      const nameValuePair = set.split(';')[0]!;
      const parsed = parseCookieHeader(nameValuePair);
      expect(parsed.get('omni')).toBe('hello world!');
    });
  });
});
