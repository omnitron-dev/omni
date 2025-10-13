/**
 * Static Paths Tests
 */

import { describe, it, expect } from 'vitest';
import {
  executeStaticPaths,
  createStaticPath,
  patternToPath,
  extractParamNames,
  isDynamicRoute,
  generateParamCombinations,
  deduplicatePaths,
} from '../../src/ssg/static-paths.js';
import type { GetStaticPaths } from '../../src/ssg/types.js';

describe('Static Paths', () => {
  describe('executeStaticPaths', () => {
    it('should execute getStaticPaths and return paths', async () => {
      const getStaticPaths: GetStaticPaths = async () => ({
        paths: [{ params: { slug: 'post-1' } }, { params: { slug: 'post-2' } }],
        fallback: false,
      });

      const result = await executeStaticPaths(getStaticPaths);

      expect(result.paths).toHaveLength(2);
      expect(result.fallback).toBe(false);
    });

    it('should validate paths structure', async () => {
      const getStaticPaths = async () => ({
        paths: [{}],
        fallback: false,
      }) as any;

      await expect(executeStaticPaths(getStaticPaths)).rejects.toThrow();
    });
  });

  describe('patternToPath', () => {
    it('should replace dynamic segments', () => {
      const path = patternToPath('/blog/[slug]', { slug: 'my-post' });
      expect(path).toBe('/blog/my-post');
    });

    it('should replace multiple segments', () => {
      const path = patternToPath('/[category]/[product]', {
        category: 'electronics',
        product: 'laptop',
      });
      expect(path).toBe('/electronics/laptop');
    });

    it('should handle catch-all routes', () => {
      const path = patternToPath('/docs/[...slug]', {
        slug: ['getting-started', 'installation'],
      });
      expect(path).toBe('/docs/getting-started/installation');
    });
  });

  describe('extractParamNames', () => {
    it('should extract param names from pattern', () => {
      const params = extractParamNames('/blog/[slug]');
      expect(params).toEqual(['slug']);
    });

    it('should extract multiple params', () => {
      const params = extractParamNames('/[category]/[product]');
      expect(params).toEqual(['category', 'product']);
    });

    it('should extract catch-all params', () => {
      const params = extractParamNames('/docs/[...slug]');
      expect(params).toEqual(['slug']);
    });
  });

  describe('isDynamicRoute', () => {
    it('should identify dynamic routes', () => {
      expect(isDynamicRoute('/blog/[slug]')).toBe(true);
      expect(isDynamicRoute('/blog')).toBe(false);
    });

    it('should identify catch-all routes', () => {
      expect(isDynamicRoute('/docs/[...slug]')).toBe(true);
    });
  });

  describe('generateParamCombinations', () => {
    it('should generate all combinations', () => {
      const combinations = generateParamCombinations({
        category: ['electronics', 'books'],
        status: ['new', 'used'],
      });

      expect(combinations).toHaveLength(4);
      expect(combinations).toContainEqual({
        category: 'electronics',
        status: 'new',
      });
    });
  });

  describe('deduplicatePaths', () => {
    it('should remove duplicate paths', () => {
      const paths = [
        createStaticPath({ slug: 'post-1' }),
        createStaticPath({ slug: 'post-1' }),
        createStaticPath({ slug: 'post-2' }),
      ];

      const unique = deduplicatePaths(paths);

      expect(unique).toHaveLength(2);
    });
  });
});
