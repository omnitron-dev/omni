/**
 * Revalidation Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RevalidationCache,
  getRevalidationCache,
  needsRevalidation,
  isStale,
  isExpired,
  getCacheStats,
} from '../../src/ssg/revalidation.js';
import type { RevalidationCacheEntry } from '../../src/ssg/types.js';

describe('Revalidation', () => {
  let cache: RevalidationCache;

  beforeEach(() => {
    cache = new RevalidationCache();
  });

  describe('RevalidationCache', () => {
    it('should store and retrieve entries', () => {
      const entry: RevalidationCacheEntry = {
        path: '/test',
        props: { data: 'test' },
        html: '<div>Test</div>',
        generatedAt: new Date(),
      };

      cache.set('/test', entry);
      const retrieved = cache.get('/test');

      expect(retrieved).toEqual(entry);
    });

    it('should index by tags', () => {
      const entry: RevalidationCacheEntry = {
        path: '/test',
        props: {},
        html: '',
        generatedAt: new Date(),
        tags: ['tag1', 'tag2'],
      };

      cache.set('/test', entry);
      const paths = cache.getPathsByTag('tag1');

      expect(paths.has('/test')).toBe(true);
    });

    it('should track revalidating paths', () => {
      cache.markRevalidating('/test');
      expect(cache.isRevalidating('/test')).toBe(true);

      cache.unmarkRevalidating('/test');
      expect(cache.isRevalidating('/test')).toBe(false);
    });

    it('should delete entries', () => {
      const entry: RevalidationCacheEntry = {
        path: '/test',
        props: {},
        html: '',
        generatedAt: new Date(),
      };

      cache.set('/test', entry);
      cache.delete('/test');

      expect(cache.has('/test')).toBe(false);
    });
  });

  describe('needsRevalidation', () => {
    it('should return false for fresh entries', () => {
      const entry: RevalidationCacheEntry = {
        path: '/test',
        props: {},
        html: '',
        generatedAt: new Date(),
        revalidate: 60,
      };

      expect(needsRevalidation(entry)).toBe(false);
    });

    it('should return true for old entries', () => {
      const pastDate = new Date(Date.now() - 120 * 1000); // 120 seconds ago
      const entry: RevalidationCacheEntry = {
        path: '/test',
        props: {},
        html: '',
        generatedAt: pastDate,
        revalidate: 60,
      };

      expect(needsRevalidation(entry)).toBe(true);
    });

    it('should return false when revalidate is false', () => {
      const pastDate = new Date(Date.now() - 120 * 1000);
      const entry: RevalidationCacheEntry = {
        path: '/test',
        props: {},
        html: '',
        generatedAt: pastDate,
        revalidate: false,
      };

      expect(needsRevalidation(entry)).toBe(false);
    });
  });

  describe('isStale', () => {
    it('should return true for stale but valid entries', () => {
      const pastDate = new Date(Date.now() - 70 * 1000); // 70 seconds ago
      const entry: RevalidationCacheEntry = {
        path: '/test',
        props: {},
        html: '',
        generatedAt: pastDate,
        revalidate: 60,
        staleWhileRevalidate: 30,
      };

      expect(isStale(entry)).toBe(true);
    });

    it('should return false for fresh entries', () => {
      const entry: RevalidationCacheEntry = {
        path: '/test',
        props: {},
        html: '',
        generatedAt: new Date(),
        revalidate: 60,
        staleWhileRevalidate: 30,
      };

      expect(isStale(entry)).toBe(false);
    });
  });

  describe('isExpired', () => {
    it('should return true for expired entries', () => {
      const pastDate = new Date(Date.now() - 120 * 1000); // 120 seconds ago
      const entry: RevalidationCacheEntry = {
        path: '/test',
        props: {},
        html: '',
        generatedAt: pastDate,
        revalidate: 60,
        staleWhileRevalidate: 30,
      };

      expect(isExpired(entry)).toBe(true);
    });

    it('should return false for stale but not expired', () => {
      const pastDate = new Date(Date.now() - 70 * 1000); // 70 seconds ago
      const entry: RevalidationCacheEntry = {
        path: '/test',
        props: {},
        html: '',
        generatedAt: pastDate,
        revalidate: 60,
        staleWhileRevalidate: 30,
      };

      expect(isExpired(entry)).toBe(false);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', () => {
      const cache = getRevalidationCache();
      cache.clear();

      // Fresh entry
      const entry1: RevalidationCacheEntry = {
        path: '/test1',
        props: {},
        html: '',
        generatedAt: new Date(),
        revalidate: 60,
      };

      // Expired entry (120s old with 60s revalidate, no SWR)
      const entry2: RevalidationCacheEntry = {
        path: '/test2',
        props: {},
        html: '',
        generatedAt: new Date(Date.now() - 120 * 1000),
        revalidate: 60,
      };

      cache.set('/test1', entry1);
      cache.set('/test2', entry2);

      const stats = getCacheStats();

      expect(stats.totalEntries).toBe(2);
      expect(stats.expired).toBe(1);
      expect(stats.needsRevalidation).toBe(0); // expired entries are not counted as needsRevalidation
    });
  });
});
