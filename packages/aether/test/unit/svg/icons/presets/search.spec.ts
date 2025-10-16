/**
 * Tests for HugeIcons search utilities
 */

import { describe, it, expect } from 'vitest';
import { searchIcons, getMatchingIconNames } from '../utils/search.js';

describe('HugeIcons Search', () => {
  describe('searchIcons', () => {
    it('should find icons by exact name match', async () => {
      const results = await searchIcons({
        query: 'abacus',
        preset: 'stroke',
      });

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('abacus');
      expect(results[0].relevance).toBe(1.0);
    });

    it('should find icons by partial name match', async () => {
      const results = await searchIcons({
        query: 'user',
        preset: 'stroke',
        limit: 10,
      });

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(10);
      expect(results.some((r) => r.name.includes('user'))).toBe(true);
    });

    it('should search across all presets', async () => {
      const results = await searchIcons({
        query: 'home',
        preset: 'all',
        limit: 30,
      });

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);

      // Should have results from multiple presets
      const presets = new Set(results.map((r) => r.preset));
      expect(presets.size).toBeGreaterThan(1);
    });

    it('should sort results by relevance', async () => {
      const results = await searchIcons({
        query: 'add',
        preset: 'stroke',
        limit: 20,
      });

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(1);

      // Results should be sorted by relevance (descending)
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].relevance).toBeGreaterThanOrEqual(results[i].relevance);
      }
    });

    it('should respect limit parameter', async () => {
      const results = await searchIcons({
        query: 'a',
        preset: 'stroke',
        limit: 5,
      });

      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should handle case-insensitive search by default', async () => {
      const results1 = await searchIcons({
        query: 'ABACUS',
        preset: 'stroke',
      });

      const results2 = await searchIcons({
        query: 'abacus',
        preset: 'stroke',
      });

      expect(results1.length).toBe(results2.length);
    });

    it('should throw error for empty query', async () => {
      await expect(
        searchIcons({
          query: '',
          preset: 'stroke',
        })
      ).rejects.toThrow();
    });
  });

  describe('getMatchingIconNames', () => {
    it('should return only icon names', async () => {
      const names = await getMatchingIconNames({
        query: 'arrow',
        preset: 'stroke',
        limit: 10,
      });

      expect(names).toBeDefined();
      expect(Array.isArray(names)).toBe(true);
      expect(names.length).toBeGreaterThan(0);
      expect(names.every((name) => typeof name === 'string')).toBe(true);
    });

    it('should match searchIcons results', async () => {
      const options = {
        query: 'circle',
        preset: 'stroke' as const,
        limit: 5,
      };

      const results = await searchIcons(options);
      const names = await getMatchingIconNames(options);

      expect(names.length).toBe(results.length);
      expect(names).toEqual(results.map((r) => r.name));
    });
  });
});
