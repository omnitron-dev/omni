/**
 * @fileoverview Comprehensive tests for file-based routing
 */

import { describe, it, expect, vi } from 'vitest';
import {
  filePathToRoutePath,
  extractParams,
  groupRouteFiles,
  buildRouteFromModules,
  createRouteTree,
  generateRoutesFromFiles,
  validateRoute,
  validateRoutes,
  defaultConventions,
} from '../../src/router/file-based.js';
import type { RouteDefinition } from '../../src/router/types.js';

describe('file-based routing', () => {
  describe('filePathToRoutePath', () => {
    it('should convert simple file path to route path', () => {
      expect(filePathToRoutePath('routes/users/+page.ts')).toBe('/users');
    });

    it('should handle index routes', () => {
      expect(filePathToRoutePath('routes/index/+page.ts')).toBe('/');
      expect(filePathToRoutePath('routes/users/index/+page.ts')).toBe('/users');
    });

    it('should handle root route', () => {
      expect(filePathToRoutePath('routes/+page.ts')).toBe('/');
    });

    it('should convert dynamic segments', () => {
      expect(filePathToRoutePath('routes/users/[id]/+page.ts')).toBe('/users/:id');
      expect(filePathToRoutePath('routes/posts/[postId]/comments/[commentId]/+page.ts'))
        .toBe('/posts/:postId/comments/:commentId');
    });

    it('should handle optional segments', () => {
      expect(filePathToRoutePath('routes/users/[id?]/+page.ts')).toBe('/users/:id?');
    });

    it('should handle catch-all segments', () => {
      expect(filePathToRoutePath('routes/blog/[...slug]/+page.ts')).toBe('/blog/*slug');
      expect(filePathToRoutePath('routes/docs/[...path]/+page.ts')).toBe('/docs/*path');
    });

    it('should handle mixed segments', () => {
      expect(filePathToRoutePath('routes/users/[id]/posts/[...rest]/+page.ts'))
        .toBe('/users/:id/posts/*rest');
    });

    it('should handle nested directories', () => {
      expect(filePathToRoutePath('routes/admin/dashboard/users/+page.ts'))
        .toBe('/admin/dashboard/users');
    });

    it('should handle different file conventions', () => {
      expect(filePathToRoutePath('routes/users/+layout.tsx')).toBe('/users');
      expect(filePathToRoutePath('routes/users/+loader.ts')).toBe('/users');
      expect(filePathToRoutePath('routes/users/+action.js')).toBe('/users');
    });
  });

  describe('extractParams', () => {
    it('should extract dynamic params', () => {
      expect(extractParams('/users/:id')).toEqual(['id']);
      expect(extractParams('/posts/:postId/comments/:commentId')).toEqual(['postId', 'commentId']);
    });

    it('should extract optional params', () => {
      expect(extractParams('/users/:id?')).toEqual(['id']);
    });

    it('should extract catch-all params', () => {
      expect(extractParams('/blog/*slug')).toEqual(['slug']);
    });

    it('should handle mixed params', () => {
      expect(extractParams('/users/:id/posts/*rest')).toEqual(['id', 'rest']);
    });

    it('should handle no params', () => {
      expect(extractParams('/users')).toEqual([]);
      expect(extractParams('/')).toEqual([]);
    });

    it('should handle complex param names', () => {
      expect(extractParams('/api/:userId/data/:dataId')).toEqual(['userId', 'dataId']);
      expect(extractParams('/:_id/:$special')).toEqual(['_id', '$special']);
    });
  });

  describe('groupRouteFiles', () => {
    it('should group files by directory', () => {
      const files = [
        'routes/users/+page.ts',
        'routes/users/+layout.ts',
        'routes/users/+loader.ts',
        'routes/posts/+page.ts',
      ];

      const groups = groupRouteFiles(files);

      expect(groups.has('routes/users')).toBe(true);
      expect(groups.has('routes/posts')).toBe(true);

      const userFiles = groups.get('routes/users');
      expect(userFiles).toHaveLength(3);
    });

    it('should identify file types correctly', () => {
      const files = [
        'routes/users/+page.tsx',
        'routes/users/+layout.tsx',
        'routes/users/+loader.ts',
        'routes/users/+action.ts',
        'routes/users/+error.tsx',
        'routes/users/+loading.tsx',
      ];

      const groups = groupRouteFiles(files);
      const userFiles = groups.get('routes/users')!;

      const types = userFiles.map(f => f.type);
      expect(types).toContain('page');
      expect(types).toContain('layout');
      expect(types).toContain('loader');
      expect(types).toContain('action');
      expect(types).toContain('error');
      expect(types).toContain('loading');
    });

    it('should handle nested routes', () => {
      const files = [
        'routes/users/+page.ts',
        'routes/users/[id]/+page.ts',
        'routes/users/[id]/posts/+page.ts',
      ];

      const groups = groupRouteFiles(files);

      expect(groups.has('routes/users')).toBe(true);
      expect(groups.has('routes/users/[id]')).toBe(true);
      expect(groups.has('routes/users/[id]/posts')).toBe(true);
    });

    it('should ignore non-route files', () => {
      const files = [
        'routes/users/+page.ts',
        'routes/users/helper.ts',
        'routes/users/utils.ts',
      ];

      const groups = groupRouteFiles(files);
      const userFiles = groups.get('routes/users')!;

      expect(userFiles).toHaveLength(1);
      expect(userFiles[0].type).toBe('page');
    });
  });

  describe('buildRouteFromModules', () => {
    it('should build route from page module', () => {
      const pageModule = {
        default: vi.fn(),
        loader: vi.fn(),
        action: vi.fn(),
        meta: { title: 'Test' },
      };

      const route = buildRouteFromModules({ page: pageModule }, '/test');

      expect(route.path).toBe('/test');
      expect(route.component).toBe(pageModule.default);
      expect(route.loader).toBe(pageModule.loader);
      expect(route.action).toBe(pageModule.action);
      expect(route.meta).toEqual({ title: 'Test' });
    });

    it('should build route from layout module', () => {
      const layoutModule = {
        default: vi.fn(),
      };

      const route = buildRouteFromModules({ layout: layoutModule }, '/test');

      expect(route.layout).toBe(layoutModule.default);
    });

    it('should prioritize separate loader module', () => {
      const pageModule = {
        default: vi.fn(),
        loader: vi.fn(),
      };
      const loaderModule = {
        loader: vi.fn(),
      };

      const route = buildRouteFromModules(
        { page: pageModule, loader: loaderModule },
        '/test'
      );

      expect(route.loader).toBe(loaderModule.loader);
    });

    it('should handle all module types', () => {
      const modules = {
        page: { default: vi.fn() },
        layout: { default: vi.fn() },
        loader: { loader: vi.fn() },
        action: { action: vi.fn() },
        error: { default: vi.fn() },
        loading: { default: vi.fn() },
      };

      const route = buildRouteFromModules(modules, '/test');

      expect(route.component).toBe(modules.page.default);
      expect(route.layout).toBe(modules.layout.default);
      expect(route.loader).toBe(modules.loader.loader);
      expect(route.action).toBe(modules.action.action);
      expect(route.errorBoundary).toBe(modules.error.default);
      expect(route.loading).toBe(modules.loading.default);
    });

    it('should handle default exports for loader/action', () => {
      const loaderModule = { default: vi.fn() };
      const actionModule = { default: vi.fn() };

      const route = buildRouteFromModules(
        { loader: loaderModule, action: actionModule },
        '/test'
      );

      expect(route.loader).toBe(loaderModule.default);
      expect(route.action).toBe(actionModule.default);
    });
  });

  describe('createRouteTree', () => {
    it('should create flat tree from single route', () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: vi.fn() },
      ];

      const tree = createRouteTree(routes);

      expect(tree).toHaveLength(1);
      expect(tree[0].path).toBe('/');
    });

    it('should nest child routes', () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: vi.fn() },
        { path: '/users', component: vi.fn() },
        { path: '/users/:id', component: vi.fn() },
      ];

      const tree = createRouteTree(routes);

      expect(tree).toHaveLength(2); // / and /users
      expect(tree[1].children).toHaveLength(1);
      expect(tree[1].children?.[0].path).toBe('/users/:id');
    });

    it('should handle deep nesting', () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: vi.fn() },
        { path: '/admin', component: vi.fn() },
        { path: '/admin/users', component: vi.fn() },
        { path: '/admin/users/:id', component: vi.fn() },
        { path: '/admin/users/:id/edit', component: vi.fn() },
      ];

      const tree = createRouteTree(routes);

      expect(tree).toHaveLength(2); // / and /admin
      const adminRoute = tree[1];
      expect(adminRoute.children).toHaveLength(1);
      expect(adminRoute.children?.[0].path).toBe('/admin/users');
    });

    it('should handle multiple root routes', () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: vi.fn() },
        { path: '/about', component: vi.fn() },
        { path: '/contact', component: vi.fn() },
      ];

      const tree = createRouteTree(routes);

      expect(tree).toHaveLength(3);
    });

    it('should handle sibling routes', () => {
      const routes: RouteDefinition[] = [
        { path: '/users', component: vi.fn() },
        { path: '/users/:id', component: vi.fn() },
        { path: '/users/:id/profile', component: vi.fn() },
        { path: '/posts', component: vi.fn() },
        { path: '/posts/:id', component: vi.fn() },
      ];

      const tree = createRouteTree(routes);

      expect(tree).toHaveLength(2); // /users and /posts
      expect(tree[0].children).toHaveLength(1);
      expect(tree[1].children).toHaveLength(1);
    });
  });

  describe('generateRoutesFromFiles', () => {
    it('should generate routes from files', async () => {
      const files = [
        'routes/+page.ts',
        'routes/users/+page.ts',
        'routes/users/[id]/+page.ts',
      ];

      const importModules = vi.fn(async (path: string) => ({
        default: vi.fn(),
      }));

      const routes = await generateRoutesFromFiles(importModules, files);

      expect(routes).toHaveLength(2); // / and /users
      expect(importModules).toHaveBeenCalledTimes(3);
    });

    it('should handle import errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const files = [
        'routes/valid/+page.ts',
        'routes/invalid/+page.ts',
      ];

      const importModules = vi.fn(async (path: string) => {
        if (path.includes('invalid')) {
          throw new Error('Import failed');
        }
        return { default: vi.fn() };
      });

      const routes = await generateRoutesFromFiles(importModules, files);

      expect(routes).toHaveLength(1);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should combine multiple file types per route', async () => {
      const files = [
        'routes/users/+page.ts',
        'routes/users/+layout.ts',
        'routes/users/+loader.ts',
      ];

      const importModules = vi.fn(async (path: string) => {
        if (path.includes('page')) return { default: vi.fn() };
        if (path.includes('layout')) return { default: vi.fn() };
        if (path.includes('loader')) return { loader: vi.fn() };
        return {};
      });

      const routes = await generateRoutesFromFiles(importModules, files);

      expect(routes).toHaveLength(1);
      expect(routes[0].component).toBeDefined();
      expect(routes[0].layout).toBeDefined();
      expect(routes[0].loader).toBeDefined();
    });
  });

  describe('validateRoute', () => {
    it('should validate valid route', () => {
      const route: RouteDefinition = {
        path: '/users',
        component: vi.fn(),
      };

      const errors = validateRoute(route);

      expect(errors).toHaveLength(0);
    });

    it('should require path', () => {
      const route: RouteDefinition = {
        path: '',
        component: vi.fn(),
      };

      const errors = validateRoute(route);

      expect(errors).toContain('Route must have a path');
    });

    it('should require leading slash', () => {
      const route: RouteDefinition = {
        path: 'users',
        component: vi.fn(),
      };

      const errors = validateRoute(route);

      expect(errors.some(e => e.includes('must start with /'))).toBe(true);
    });

    it('should allow wildcard path', () => {
      const route: RouteDefinition = {
        path: '*',
        component: vi.fn(),
      };

      const errors = validateRoute(route);

      expect(errors).toHaveLength(0);
    });

    it('should require component or children', () => {
      const route: RouteDefinition = {
        path: '/users',
      };

      const errors = validateRoute(route);

      expect(errors.some(e => e.includes('must have a component or children'))).toBe(true);
    });

    it('should allow route with only children', () => {
      const route: RouteDefinition = {
        path: '/users',
        children: [
          { path: '/users/:id', component: vi.fn() },
        ],
      };

      const errors = validateRoute(route);

      expect(errors).toHaveLength(0);
    });

    it('should validate children recursively', () => {
      const route: RouteDefinition = {
        path: '/users',
        component: vi.fn(),
        children: [
          { path: 'invalid', component: vi.fn() }, // Missing leading slash
        ],
      };

      const errors = validateRoute(route);

      expect(errors.some(e => e.includes('must start with /'))).toBe(true);
    });
  });

  describe('validateRoutes', () => {
    it('should validate all routes', () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: vi.fn() },
        { path: '/users', component: vi.fn() },
        { path: 'invalid' }, // Invalid
      ];

      const errors = validateRoutes(routes);

      expect(errors.length).toBeGreaterThan(0);
    });

    it('should return empty for valid routes', () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: vi.fn() },
        { path: '/users', component: vi.fn() },
        { path: '/posts', component: vi.fn() },
      ];

      const errors = validateRoutes(routes);

      expect(errors).toHaveLength(0);
    });

    it('should validate nested routes', () => {
      const routes: RouteDefinition[] = [
        {
          path: '/users',
          component: vi.fn(),
          children: [
            { path: '/users/:id', component: vi.fn() },
            { path: 'invalid' }, // Invalid
          ],
        },
      ];

      const errors = validateRoutes(routes);

      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty file list', async () => {
      const routes = await generateRoutesFromFiles(
        vi.fn(),
        []
      );

      expect(routes).toEqual([]);
    });

    it('should handle Unicode characters in paths', () => {
      const path = filePathToRoutePath('routes/カテゴリ/+page.ts');
      expect(path).toBe('/カテゴリ');
    });

    it('should handle very deep nesting', () => {
      const routes: RouteDefinition[] = Array.from({ length: 10 }, (_, i) => ({
        path: `/${Array.from({ length: i + 1 }, (_, j) => `level${j}`).join('/')}`,
        component: vi.fn(),
      }));

      const tree = createRouteTree(routes);

      // Should create nested structure
      expect(tree).toHaveLength(1);
    });

    it('should handle multiple catch-all routes', () => {
      const path1 = filePathToRoutePath('routes/docs/[...slug]/+page.ts');
      const path2 = filePathToRoutePath('routes/blog/[...path]/+page.ts');

      expect(path1).toBe('/docs/*slug');
      expect(path2).toBe('/blog/*path');
    });

    it('should handle mixed case file names', () => {
      const path = filePathToRoutePath('routes/MyComponent/+Page.ts');
      expect(path).toBe('/MyComponent');
    });
  });
});
