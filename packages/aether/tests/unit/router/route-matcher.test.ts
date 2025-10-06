/**
 * Tests for Route Matcher
 */

import { describe, it, expect } from 'vitest';
import {
  parseRoutePattern,
  matchRoute,
  findBestMatch,
  buildPath,
  normalizePath,
} from '../../../src/router/route-matcher.js';
import type { RouteDefinition } from '../../../src/router/types.js';

describe('Route Matcher', () => {
  describe('parseRoutePattern', () => {
    it('should parse static routes', () => {
      const segments = parseRoutePattern('/about');
      expect(segments).toEqual([{ type: 'static', value: 'about' }]);
    });

    it('should parse dynamic routes', () => {
      const segments = parseRoutePattern('/users/[id]');
      expect(segments).toEqual([
        { type: 'static', value: 'users' },
        { type: 'dynamic', name: 'id' },
      ]);
    });

    it('should parse catch-all routes', () => {
      const segments = parseRoutePattern('/docs/[...path]');
      expect(segments).toEqual([
        { type: 'static', value: 'docs' },
        { type: 'catchall', name: 'path' },
      ]);
    });

    it('should parse optional parameters', () => {
      const segments = parseRoutePattern('/blog/[[page]]');
      expect(segments).toEqual([
        { type: 'static', value: 'blog' },
        { type: 'optional-param', name: 'page' },
      ]);
    });

    it('should parse optional catch-all', () => {
      const segments = parseRoutePattern('/shop/[[...categories]]');
      expect(segments).toEqual([
        { type: 'static', value: 'shop' },
        { type: 'optional-catchall', name: 'categories' },
      ]);
    });

    it('should parse multiple dynamic params', () => {
      const segments = parseRoutePattern('/posts/[category]/[slug]');
      expect(segments).toEqual([
        { type: 'static', value: 'posts' },
        { type: 'dynamic', name: 'category' },
        { type: 'dynamic', name: 'slug' },
      ]);
    });
  });

  describe('matchRoute', () => {
    it('should match static routes', () => {
      const route: RouteDefinition = { path: '/about' };
      const match = matchRoute('/about', route);

      expect(match).toBeTruthy();
      expect(match?.params).toEqual({});
      expect(match?.score).toBeGreaterThan(0);
    });

    it('should not match different static routes', () => {
      const route: RouteDefinition = { path: '/about' };
      const match = matchRoute('/contact', route);

      expect(match).toBeNull();
    });

    it('should match dynamic routes', () => {
      const route: RouteDefinition = { path: '/users/[id]' };
      const match = matchRoute('/users/123', route);

      expect(match).toBeTruthy();
      expect(match?.params).toEqual({ id: '123' });
    });

    it('should match multiple dynamic params', () => {
      const route: RouteDefinition = { path: '/posts/[category]/[slug]' };
      const match = matchRoute('/posts/tech/intro-to-aether', route);

      expect(match).toBeTruthy();
      expect(match?.params).toEqual({
        category: 'tech',
        slug: 'intro-to-aether',
      });
    });

    it('should match catch-all routes', () => {
      const route: RouteDefinition = { path: '/docs/[...path]' };
      const match = matchRoute('/docs/guide/getting-started', route);

      expect(match).toBeTruthy();
      expect(match?.params).toEqual({
        path: ['guide', 'getting-started'],
      });
    });

    it('should match single segment catch-all', () => {
      const route: RouteDefinition = { path: '/docs/[...path]' };
      const match = matchRoute('/docs/intro', route);

      expect(match).toBeTruthy();
      expect(match?.params).toEqual({
        path: ['intro'],
      });
    });

    it('should not match catch-all with no segments', () => {
      const route: RouteDefinition = { path: '/docs/[...path]' };
      const match = matchRoute('/docs', route);

      expect(match).toBeNull();
    });

    it('should match optional parameters (present)', () => {
      const route: RouteDefinition = { path: '/blog/[[page]]' };
      const match = matchRoute('/blog/2', route);

      expect(match).toBeTruthy();
      expect(match?.params).toEqual({ page: '2' });
    });

    it('should match optional parameters (absent)', () => {
      const route: RouteDefinition = { path: '/blog/[[page]]' };
      const match = matchRoute('/blog', route);

      expect(match).toBeTruthy();
      expect(match?.params).toEqual({});
    });

    it('should match optional catch-all (present)', () => {
      const route: RouteDefinition = { path: '/shop/[[...categories]]' };
      const match = matchRoute('/shop/electronics/phones', route);

      expect(match).toBeTruthy();
      expect(match?.params).toEqual({
        categories: ['electronics', 'phones'],
      });
    });

    it('should match optional catch-all (absent)', () => {
      const route: RouteDefinition = { path: '/shop/[[...categories]]' };
      const match = matchRoute('/shop', route);

      expect(match).toBeTruthy();
      expect(match?.params).toEqual({});
    });
  });

  describe('findBestMatch', () => {
    it('should find matching route', () => {
      const routes: RouteDefinition[] = [
        { path: '/about' },
        { path: '/contact' },
        { path: '/users/[id]' },
      ];

      const match = findBestMatch('/users/123', routes);

      expect(match).toBeTruthy();
      expect(match?.route.path).toBe('/users/[id]');
      expect(match?.params).toEqual({ id: '123' });
    });

    it('should prioritize static routes over dynamic', () => {
      const routes: RouteDefinition[] = [
        { path: '/users/[id]' },
        { path: '/users/profile' },
      ];

      const match = findBestMatch('/users/profile', routes);

      expect(match?.route.path).toBe('/users/profile');
    });

    it('should prioritize more specific routes', () => {
      const routes: RouteDefinition[] = [
        { path: '/[...all]' },
        { path: '/users/[id]' },
        { path: '/users/profile' },
      ];

      const match = findBestMatch('/users/profile', routes);

      expect(match?.route.path).toBe('/users/profile');
    });

    it('should return null for no match', () => {
      const routes: RouteDefinition[] = [{ path: '/about' }, { path: '/contact' }];

      const match = findBestMatch('/users', routes);

      expect(match).toBeNull();
    });
  });

  describe('buildPath', () => {
    it('should build static path', () => {
      const path = buildPath('/about');
      expect(path).toBe('/about');
    });

    it('should build dynamic path', () => {
      const path = buildPath('/users/[id]', { id: '123' });
      expect(path).toBe('/users/123');
    });

    it('should build path with multiple params', () => {
      const path = buildPath('/posts/[category]/[slug]', {
        category: 'tech',
        slug: 'intro',
      });
      expect(path).toBe('/posts/tech/intro');
    });

    it('should build path with catch-all', () => {
      const path = buildPath('/docs/[...path]', {
        path: ['guide', 'getting-started'],
      });
      expect(path).toBe('/docs/guide/getting-started');
    });

    it('should build path with optional param (present)', () => {
      const path = buildPath('/blog/[[page]]', { page: '2' });
      expect(path).toBe('/blog/2');
    });

    it('should build path with optional param (absent)', () => {
      const path = buildPath('/blog/[[page]]', {});
      expect(path).toBe('/blog');
    });

    it('should throw error for missing required param', () => {
      expect(() => buildPath('/users/[id]', {})).toThrow('Missing parameter: id');
    });

    it('should throw error for missing catch-all param', () => {
      expect(() => buildPath('/docs/[...path]', {})).toThrow('Missing catch-all parameter');
    });
  });

  describe('normalizePath', () => {
    it('should remove trailing slash', () => {
      expect(normalizePath('/about/')).toBe('/about');
    });

    it('should keep single slash for root', () => {
      expect(normalizePath('/')).toBe('/');
    });

    it('should add leading slash', () => {
      expect(normalizePath('about')).toBe('/about');
    });

    it('should handle empty path', () => {
      expect(normalizePath('')).toBe('/');
    });

    it('should not modify already normalized path', () => {
      expect(normalizePath('/about')).toBe('/about');
    });
  });
});
