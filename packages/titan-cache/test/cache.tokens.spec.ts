/**
 * Cache Tokens Tests
 *
 * Tests for cache module DI tokens.
 */

import { describe, it, expect } from 'vitest';
import {
  CACHE_SERVICE_TOKEN,
  CACHE_DEFAULT_TOKEN,
  CACHE_OPTIONS_TOKEN,
  getCacheToken,
  DEFAULT_CACHE_NAME,
} from '../src/cache.tokens.js';

describe('Cache Tokens', () => {
  describe('CACHE_SERVICE_TOKEN', () => {
    it('should be defined', () => {
      expect(CACHE_SERVICE_TOKEN).toBeDefined();
    });

    it('should have correct name', () => {
      expect(CACHE_SERVICE_TOKEN.toString()).toContain('CacheService');
    });
  });

  describe('CACHE_DEFAULT_TOKEN', () => {
    it('should be defined', () => {
      expect(CACHE_DEFAULT_TOKEN).toBeDefined();
    });

    it('should have correct name', () => {
      expect(CACHE_DEFAULT_TOKEN.toString()).toContain('Default');
    });
  });

  describe('CACHE_OPTIONS_TOKEN', () => {
    it('should be defined', () => {
      expect(CACHE_OPTIONS_TOKEN).toBeDefined();
    });

    it('should have correct name', () => {
      expect(CACHE_OPTIONS_TOKEN.toString()).toContain('CacheOptions');
    });
  });

  describe('getCacheToken()', () => {
    it('should create token with custom name', () => {
      const token = getCacheToken('users');
      expect(token).toBeDefined();
      expect(token.toString()).toContain('users');
    });

    it('should create unique tokens for different names', () => {
      const token1 = getCacheToken('cache1');
      const token2 = getCacheToken('cache2');

      expect(token1.toString()).not.toBe(token2.toString());
    });

    it('should create consistent tokens for same name', () => {
      const token1 = getCacheToken('test');
      const token2 = getCacheToken('test');

      // Note: tokens are created fresh each time but have same identifier
      expect(token1.toString()).toBe(token2.toString());
    });
  });

  describe('DEFAULT_CACHE_NAME', () => {
    it('should be "default"', () => {
      expect(DEFAULT_CACHE_NAME).toBe('default');
    });
  });
});
