/**
 * Tests for URL utilities
 */
import { describe, it, expect } from 'vitest';
import {
  safeReturnUrl,
  isActiveLink,
  isExternalUrl,
  buildUrl,
  parseQueryParams,
  getQueryParam,
  hasParams,
  removeParams,
  removeLastSlash,
  isExternalLink,
  isEqualPath,
} from '../url.js';

describe('url utilities', () => {
  describe('safeReturnUrl', () => {
    it('allows relative URLs by default', () => {
      expect(safeReturnUrl('/dashboard')).toBe('/dashboard');
    });

    it('returns fallback for null/undefined', () => {
      expect(safeReturnUrl(null)).toBe('/');
      expect(safeReturnUrl(undefined)).toBe('/');
    });

    it('returns custom fallback', () => {
      expect(safeReturnUrl(null, { fallback: '/home' })).toBe('/home');
    });

    it('blocks disallowed hosts when allowedHosts specified', () => {
      // When allowedHosts is specified, only those hosts are allowed
      expect(
        safeReturnUrl('https://evil.com', {
          allowedHosts: ['safe.com'],
          fallback: '/safe',
        })
      ).toBe('/safe');
    });

    it('allows all external URLs when allowedHosts is empty', () => {
      // Default behavior: external URLs are allowed when no allowedHosts specified
      expect(safeReturnUrl('https://example.com')).toBe('https://example.com');
    });

    it('allows specified hosts', () => {
      expect(
        safeReturnUrl('https://allowed.com/path', {
          allowedHosts: ['allowed.com'],
        })
      ).toBe('https://allowed.com/path');
    });

    it('sanitizes protocol injection attempts', () => {
      expect(safeReturnUrl('javascript:alert(1)')).toBe('/');
    });

    it('blocks double-slash URLs when relative not allowed', () => {
      // Protocol-relative URLs like //evil.com parse as having host
      const result = safeReturnUrl('//evil.com', {
        allowRelative: false,
        allowedHosts: ['safe.com'],
      });
      expect(result).toBe('/');
    });
  });

  describe('isActiveLink', () => {
    it('returns true for exact match', () => {
      expect(isActiveLink('/dashboard', '/dashboard')).toBe(true);
    });

    it('returns true for deep match by default', () => {
      expect(isActiveLink('/dashboard/user/list', '/dashboard')).toBe(true);
    });

    it('returns false for deep match when disabled', () => {
      expect(isActiveLink('/dashboard/user/list', '/dashboard', false)).toBe(false);
    });

    it('ignores query parameters in target path', () => {
      // Current path matches target path even with query params on target
      expect(isActiveLink('/users', '/users?page=1')).toBe(true);
    });

    it('returns false for hash links', () => {
      expect(isActiveLink('/home', '#section')).toBe(false);
    });

    it('returns false for external links', () => {
      expect(isActiveLink('/home', 'https://example.com')).toBe(false);
    });

    it('handles root path specially', () => {
      expect(isActiveLink('/', '/')).toBe(true);
      expect(isActiveLink('/dashboard', '/')).toBe(false);
    });

    it('returns false for empty inputs', () => {
      expect(isActiveLink('', '/home')).toBe(false);
      expect(isActiveLink('/home', '')).toBe(false);
    });
  });

  describe('isExternalUrl', () => {
    it('returns false for relative URLs', () => {
      expect(isExternalUrl('/about')).toBe(false);
    });

    it('returns true for absolute external URLs', () => {
      expect(isExternalUrl('https://example.com', 'http://localhost:3000')).toBe(true);
    });

    it('returns false for same-origin URLs', () => {
      expect(isExternalUrl('https://example.com/path', 'https://example.com')).toBe(false);
    });
  });

  describe('buildUrl', () => {
    it('builds URL with query params', () => {
      const url = buildUrl('/search', { q: 'hello', page: 1 });
      expect(url).toBe('/search?q=hello&page=1');
    });

    it('handles array values', () => {
      const url = buildUrl('/filter', { tag: ['a', 'b'] });
      expect(url).toBe('/filter?tag=a&tag=b');
    });

    it('ignores null/undefined values', () => {
      const url = buildUrl('/search', { q: 'hello', empty: null });
      expect(url).toBe('/search?q=hello');
    });

    it('returns base URL for empty params', () => {
      const url = buildUrl('/path', {});
      expect(url).toBe('/path');
    });

    it('handles boolean values', () => {
      const url = buildUrl('/api', { active: true, disabled: false });
      expect(url).toBe('/api?active=true&disabled=false');
    });

    it('appends to existing query string', () => {
      const url = buildUrl('/search?existing=1', { new: 2 });
      expect(url).toBe('/search?existing=1&new=2');
    });
  });

  describe('parseQueryParams', () => {
    it('parses query parameters', () => {
      const params = parseQueryParams('/search?q=hello&page=1');
      expect(params).toEqual({ q: 'hello', page: '1' });
    });

    it('handles multiple values for same key', () => {
      const params = parseQueryParams('?tag=a&tag=b');
      expect(params).toEqual({ tag: ['a', 'b'] });
    });

    it('handles URL-encoded values', () => {
      const params = parseQueryParams('?q=hello%20world');
      expect(params).toEqual({ q: 'hello world' });
    });

    it('handles query string without ?', () => {
      const params = parseQueryParams('key=value');
      expect(params).toEqual({ key: 'value' });
    });
  });

  describe('getQueryParam', () => {
    it('gets single query parameter', () => {
      expect(getQueryParam('/search?q=hello', 'q')).toBe('hello');
    });

    it('returns undefined for missing param', () => {
      expect(getQueryParam('/search?q=hello', 'page')).toBeUndefined();
    });

    it('returns first value for multiple', () => {
      expect(getQueryParam('?tag=a&tag=b', 'tag')).toBe('a');
    });
  });

  describe('hasParams', () => {
    it('returns true for URL with params', () => {
      expect(hasParams('/search?q=hello')).toBe(true);
    });

    it('returns false for URL without params', () => {
      expect(hasParams('/search')).toBe(false);
    });

    it('returns false for empty query string', () => {
      expect(hasParams('/search?')).toBe(false);
    });
  });

  describe('removeParams', () => {
    it('removes query parameters', () => {
      expect(removeParams('/search?q=hello')).toBe('/search');
    });

    it('returns unchanged URL if no params', () => {
      expect(removeParams('/search')).toBe('/search');
    });
  });

  describe('removeLastSlash', () => {
    it('removes trailing slash', () => {
      expect(removeLastSlash('/users/')).toBe('/users');
    });

    it('preserves root path', () => {
      expect(removeLastSlash('/')).toBe('/');
    });

    it('returns unchanged if no trailing slash', () => {
      expect(removeLastSlash('/users')).toBe('/users');
    });
  });

  describe('isExternalLink', () => {
    it('returns true for http URLs', () => {
      expect(isExternalLink('http://example.com')).toBe(true);
    });

    it('returns true for https URLs', () => {
      expect(isExternalLink('https://example.com')).toBe(true);
    });

    it('returns false for relative paths', () => {
      expect(isExternalLink('/about')).toBe(false);
    });

    it('returns false for hash links', () => {
      expect(isExternalLink('#section')).toBe(false);
    });
  });

  describe('isEqualPath', () => {
    it('compares paths ignoring trailing slash', () => {
      expect(isEqualPath('/users/', '/users')).toBe(true);
    });

    it('compares paths ignoring query params', () => {
      expect(isEqualPath('/users?page=1', '/users')).toBe(true);
    });

    it('supports deep matching', () => {
      // With deep matching, /users/1 should match /users (target is prefix of current)
      expect(isEqualPath('/users', '/users/1', { deep: true })).toBe(true);
    });

    it('returns false for different paths', () => {
      expect(isEqualPath('/users', '/posts')).toBe(false);
    });
  });
});
