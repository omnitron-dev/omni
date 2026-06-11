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

  describe('__Host- / __Secure- prefix invariants (RFC 6265bis)', () => {
    it('buildSetCookie accepts a valid __Host- cookie (Secure, Path=/, no Domain)', () => {
      const value = buildSetCookie('__Host-omni_access', 'jwt', { maxAge: 900 });
      expect(value).toContain('__Host-omni_access=jwt');
      expect(value).toContain('Path=/;');
      expect(value).toContain('Secure');
      expect(value).not.toContain('Domain=');
    });

    it('buildSetCookie rejects a __Host- cookie with a Domain', () => {
      expect(() => buildSetCookie('__Host-omni_access', 'v', { domain: 'omni.example' })).toThrow(/__Host-.*Domain/);
    });

    it('buildSetCookie rejects a __Host- cookie with a non-/ Path', () => {
      expect(() => buildSetCookie('__Host-omni_access', 'v', { path: '/api' })).toThrow(/__Host-.*Path/);
    });

    it('buildSetCookie rejects a non-Secure __Host- / __Secure- cookie', () => {
      expect(() => buildSetCookie('__Host-omni_access', 'v', { secure: false })).toThrow(/__Host-.*Secure/);
      expect(() => buildSetCookie('__Secure-omni_access', 'v', { secure: false })).toThrow(/__Secure-.*Secure/);
    });

    it('buildClearCookie keeps a __Host- clear valid (Secure + Path=/ + no Domain) so signout deletes it', () => {
      // A __Host- cookie can ONLY be (re)written Secure / Path=/ / no-Domain; a
      // clear that violates this is silently dropped by the browser and the
      // session cookie SURVIVES signout. Pin the invariant — even when the
      // caller passes a path/domain that would otherwise break it.
      const value = buildClearCookie('__Host-omni_access', { path: '/api', domain: 'omni.example' });
      expect(value).toContain('__Host-omni_access=');
      expect(value).toContain('Max-Age=0');
      expect(value).toContain('Path=/;'); // forced to / regardless of attrs
      expect(value).toContain('Secure');
      expect(value).not.toContain('Domain='); // forced host-only
    });

    it('buildClearCookie adds Secure for a __Secure- cookie (path not pinned)', () => {
      const value = buildClearCookie('__Secure-omni_access', { path: '/api' });
      expect(value).toContain('Secure');
      expect(value).toContain('Path=/api');
    });

    it('buildClearCookie leaves unprefixed cookies unchanged (no forced Secure)', () => {
      const value = buildClearCookie('omni_access', { path: '/api', domain: 'omni.example' });
      expect(value).not.toContain('Secure');
      expect(value).toContain('Path=/api');
      expect(value).toContain('Domain=omni.example');
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

  describe('fuzz: round-trip arbitrary payloads (T#376)', () => {
    // Deterministic PRNG so failures reproduce. xorshift32, seeded.
    function makePrng(seed: number): () => number {
      let s = seed | 0;
      return () => {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        return ((s >>> 0) / 0xffffffff);
      };
    }

    const rng = makePrng(0xc0c0_1e51);

    function randomPayload(): string {
      const len = 1 + Math.floor(rng() * 256);
      let out = '';
      for (let i = 0; i < len; i++) {
        const cp = 0x20 + Math.floor(rng() * (0x7e - 0x20));
        out += String.fromCodePoint(cp);
      }
      return out;
    }

    it('500 random payloads survive build → parse', () => {
      for (let i = 0; i < 500; i++) {
        const value = randomPayload();
        const set = buildSetCookie('fuzz', value);
        const nameValuePair = set.split(';')[0]!;
        const parsed = parseCookieHeader(nameValuePair);
        expect(parsed.get('fuzz')).toBe(value);
      }
    });

    it('semicolon-laden multi-cookie strings parse without leaking attrs', () => {
      // Browsers send name=value pairs separated by `; `. Attributes
      // (HttpOnly, Path, etc.) only appear in Set-Cookie, NEVER in
      // the Cookie request header. parseCookieHeader must therefore
      // refuse to mis-interpret attr-shaped tokens as cookies.
      const cookieHeader = 'omni_access=eyJhbGc; HttpOnly; Path=/api; omni_csrf=abc123';
      const parsed = parseCookieHeader(cookieHeader);
      expect(parsed.get('omni_access')).toBe('eyJhbGc');
      expect(parsed.get('omni_csrf')).toBe('abc123');
      // HttpOnly was tokenised as a no-value pair → skipped; Path= as
      // a key=value pair → captured under key 'Path'. The auth layer
      // never reads 'Path' so this is benign but worth pinning down.
      expect(parsed.get('HttpOnly')).toBeUndefined();
    });

    it('malformed entries are skipped without throwing', () => {
      const cookieHeader = '=novalue; ; key-no-equals; valid=ok; =alsoempty=foo';
      const parsed = parseCookieHeader(cookieHeader);
      expect(parsed.get('valid')).toBe('ok');
      expect(parsed.size).toBe(1);
    });

    it('quote-wrapped values are unwrapped', () => {
      const parsed = parseCookieHeader('q="value with spaces"');
      expect(parsed.get('q')).toBe('value with spaces');
    });

    it('URL-encoded values are decoded', () => {
      const parsed = parseCookieHeader('encoded=hello%20world%21');
      expect(parsed.get('encoded')).toBe('hello world!');
    });

    it('control characters in values do not crash decode', () => {
      // Lone-percent invalid encoding falls back to raw value, not
      // throw. The parser MUST be tolerant — browsers can send weird
      // legacy state.
      const parsed = parseCookieHeader('weird=%ZZ');
      expect(parsed.get('weird')).toBe('%ZZ');
    });

    it('buildSetCookie rejects names with whitespace or separators', () => {
      // CRLF injection defense — a header builder must NEVER let a
      // name like "foo\r\nSet-Cookie: evil" through.
      expect(() => buildSetCookie('foo\r\nSet-Cookie: evil', 'x')).toThrow();
      expect(() => buildSetCookie('foo bar', 'x')).toThrow();
      expect(() => buildSetCookie('foo;bar', 'x')).toThrow();
    });
  });
});
