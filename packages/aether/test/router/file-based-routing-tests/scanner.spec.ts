/**
 * Tests for file-based routing scanner
 */

import { describe, it, expect } from 'vitest';
import {
  filePathToRoutePath,
  extractRouteGroup,
  getFileType,
  scanRouteFiles,
  sortRoutesBySpecificity,
  DEFAULT_CONVENTIONS,
} from '../../../src/router/file-based/scanner.js';
import type { RouteDefinition } from '../../../src/routing/types.js';

describe('File-Based Routing Scanner', () => {
  describe('filePathToRoutePath', () => {
    it('should convert index files to root path', () => {
      expect(filePathToRoutePath('routes/index.tsx')).toBe('/');
      expect(filePathToRoutePath('routes/page.tsx')).toBe('/');
      expect(filePathToRoutePath('routes/+page.tsx')).toBe('/');
    });

    it('should convert simple paths', () => {
      expect(filePathToRoutePath('routes/about.tsx')).toBe('/about');
      expect(filePathToRoutePath('routes/contact/index.tsx')).toBe('/contact');
      expect(filePathToRoutePath('routes/blog/page.tsx')).toBe('/blog');
    });

    it('should convert dynamic segments', () => {
      expect(filePathToRoutePath('routes/users/[id].tsx')).toBe('/users/:id');
      expect(filePathToRoutePath('routes/posts/[slug]/index.tsx')).toBe('/posts/:slug');
    });

    it('should convert catch-all segments', () => {
      expect(filePathToRoutePath('routes/docs/[...path].tsx')).toBe('/docs/*path');
      expect(filePathToRoutePath('routes/blog/[[...slug]].tsx')).toBe('/blog/*slug?');
    });

    it('should convert optional parameters', () => {
      expect(filePathToRoutePath('routes/blog/[page?].tsx')).toBe('/blog/:page?');
    });

    it('should handle route groups', () => {
      expect(filePathToRoutePath('routes/(auth)/login.tsx')).toBe('/login');
      expect(filePathToRoutePath('routes/(marketing)/about.tsx')).toBe('/about');
      expect(filePathToRoutePath('routes/(app)/dashboard/index.tsx')).toBe('/dashboard');
    });

    it('should handle nested paths', () => {
      expect(filePathToRoutePath('routes/users/[id]/posts/[postId].tsx')).toBe('/users/:id/posts/:postId');
      expect(filePathToRoutePath('routes/blog/2024/[month]/[day].tsx')).toBe('/blog/2024/:month/:day');
    });
  });

  describe('extractRouteGroup', () => {
    it('should detect route groups', () => {
      const result = extractRouteGroup('routes/(auth)/login.tsx');
      expect(result.isGroup).toBe(true);
      expect(result.groupName).toBe('auth');
    });

    it('should return clean path without groups', () => {
      const result = extractRouteGroup('routes/(auth)/login.tsx');
      // The regex replaces (group) with /, so routes/(auth)/login.tsx becomes routes//login.tsx
      expect(result.cleanPath).toMatch(/routes\/+login\.tsx/);
    });

    it('should handle paths without groups', () => {
      const result = extractRouteGroup('routes/about.tsx');
      expect(result.isGroup).toBe(false);
      expect(result.groupName).toBeUndefined();
    });

    it('should handle nested groups', () => {
      const result = extractRouteGroup('routes/(app)/(dashboard)/stats.tsx');
      expect(result.isGroup).toBe(true);
      // First group found
      expect(result.groupName).toBe('app');
    });
  });

  describe('getFileType', () => {
    it('should detect page files', () => {
      expect(getFileType('index.tsx', DEFAULT_CONVENTIONS)).toBe('page');
      expect(getFileType('page.tsx', DEFAULT_CONVENTIONS)).toBe('page');
      expect(getFileType('+page.tsx', DEFAULT_CONVENTIONS)).toBe('page');
    });

    it('should detect layout files', () => {
      expect(getFileType('_layout.tsx', DEFAULT_CONVENTIONS)).toBe('layout');
      expect(getFileType('layout.tsx', DEFAULT_CONVENTIONS)).toBe('layout');
      expect(getFileType('+layout.tsx', DEFAULT_CONVENTIONS)).toBe('layout');
    });

    it('should detect error files', () => {
      expect(getFileType('_error.tsx', DEFAULT_CONVENTIONS)).toBe('error');
      expect(getFileType('error.tsx', DEFAULT_CONVENTIONS)).toBe('error');
    });

    it('should detect loading files', () => {
      expect(getFileType('_loading.tsx', DEFAULT_CONVENTIONS)).toBe('loading');
      expect(getFileType('loading.tsx', DEFAULT_CONVENTIONS)).toBe('loading');
    });

    it('should detect middleware files', () => {
      expect(getFileType('_middleware.ts', DEFAULT_CONVENTIONS)).toBe('middleware');
      expect(getFileType('middleware.ts', DEFAULT_CONVENTIONS)).toBe('middleware');
    });

    it('should detect loader files', () => {
      expect(getFileType('loader.ts', DEFAULT_CONVENTIONS)).toBe('loader');
      expect(getFileType('+loader.ts', DEFAULT_CONVENTIONS)).toBe('loader');
    });

    it('should detect action files', () => {
      expect(getFileType('action.ts', DEFAULT_CONVENTIONS)).toBe('action');
      expect(getFileType('+action.ts', DEFAULT_CONVENTIONS)).toBe('action');
    });

    it('should return null for unknown files', () => {
      expect(getFileType('component.tsx', DEFAULT_CONVENTIONS)).toBeNull();
      expect(getFileType('utils.ts', DEFAULT_CONVENTIONS)).toBeNull();
    });
  });

  describe('scanRouteFiles', () => {
    it('should scan and categorize route files', () => {
      const files = [
        'routes/index.tsx',
        'routes/about/page.tsx',
        'routes/users/[id]/index.tsx',
        'routes/users/_layout.tsx',
        'routes/_error.tsx',
        'routes/api/users.ts',
      ];

      const scanned = scanRouteFiles(files);

      expect(scanned.length).toBeGreaterThan(0);
      // Check that we have the different types of files
      expect(scanned.some((f) => f.type === 'page')).toBe(true);
      expect(scanned.some((f) => f.type === 'layout')).toBe(true);
      expect(scanned.some((f) => f.type === 'error')).toBe(true);
      expect(scanned.some((f) => f.isApi)).toBe(true);

      // Check some specific route paths
      const pageRoutes = scanned.filter((f) => f.type === 'page');
      expect(pageRoutes.length).toBeGreaterThan(0);
    });

    it('should handle route groups', () => {
      const files = [
        'routes/(auth)/login/page.tsx',
        'routes/(auth)/register/index.tsx',
        'routes/(app)/dashboard/page.tsx',
      ];

      const scanned = scanRouteFiles(files);

      expect(scanned.every((f) => f.isGroup)).toBe(true);
      expect(scanned.find((f) => f.routePath === '/login')?.groupName).toBe('auth');
      expect(scanned.find((f) => f.routePath === '/dashboard')?.groupName).toBe('app');
    });

    it('should skip non-route files', () => {
      const files = [
        'routes/index.tsx',
        'routes/_component.tsx', // Should be skipped
        'routes/utils.ts', // Should be skipped
        'routes/about/page.tsx',
      ];

      const scanned = scanRouteFiles(files);

      expect(scanned.length).toBe(2); // Only index and about
      expect(scanned.some((f) => f.fileName === '_component.tsx')).toBe(false);
      expect(scanned.some((f) => f.fileName === 'utils.ts')).toBe(false);
    });
  });

  describe('sortRoutesBySpecificity', () => {
    it('should sort static routes before dynamic', () => {
      const routes: RouteDefinition[] = [{ path: '/users/:id' }, { path: '/users/new' }, { path: '/users' }];

      const sorted = sortRoutesBySpecificity(routes);

      // /users/new = 200 (2 static segments)
      // /users = 100 (1 static segment)
      // /users/:id = 110 (1 static + 1 dynamic)
      expect(sorted[0].path).toBe('/users/new'); // Most specific
      expect(sorted[1].path).toBe('/users/:id');
      expect(sorted[2].path).toBe('/users'); // Least specific (fewer segments)
    });

    it('should sort dynamic routes before catch-all', () => {
      const routes: RouteDefinition[] = [{ path: '/docs/*path' }, { path: '/docs/:category' }, { path: '/docs' }];

      const sorted = sortRoutesBySpecificity(routes);

      // /docs/:category = 110 (1 static + 1 dynamic)
      // /docs = 100 (1 static)
      // /docs/*path = 101 (1 static + 1 catch-all)
      expect(sorted[0].path).toBe('/docs/:category'); // Most specific
      expect(sorted[1].path).toBe('/docs/*path');
      expect(sorted[2].path).toBe('/docs'); // Least specific (fewer segments)
    });

    it('should handle complex paths', () => {
      const routes: RouteDefinition[] = [
        { path: '/blog/*slug' },
        { path: '/blog/:year/:month/:day' },
        { path: '/blog/:year/:month' },
        { path: '/blog/latest' },
        { path: '/blog' },
      ];

      const sorted = sortRoutesBySpecificity(routes);

      // /blog/latest = 200 (all static)
      // /blog/:year/:month/:day = 130 (1 static + 3 dynamic)
      // /blog/:year/:month = 120 (1 static + 2 dynamic)
      // /blog/:year = 110 (1 static + 1 dynamic)
      // /blog/*slug = 101 (1 static + 1 catch-all)
      // /blog = 100 (1 static)
      expect(sorted[0].path).toBe('/blog/latest'); // Most specific (all static)
      expect(sorted[sorted.length - 1].path).toBe('/blog'); // Least specific (single segment)
    });
  });
});
