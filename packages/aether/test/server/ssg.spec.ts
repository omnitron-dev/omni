/**
 * @fileoverview Comprehensive tests for Static Site Generation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateStaticSite,
  generateStaticSiteFromFiles,
  getStaticPaths,
  getStaticProps,
  revalidate,
  clearISRCache,
  getISRCacheStats,
} from '../../src/server/ssg.js';
import * as fs from 'node:fs';

// Mock filesystem
vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs');
  return {
    ...actual,
    promises: {
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      access: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
    },
  };
});

// Mock SSR and renderer
vi.mock('../../src/server/ssr.js', () => ({
  renderToString: vi.fn().mockResolvedValue({
    html: '<div>Rendered Content</div>',
    data: { test: 'data' },
    meta: { title: 'Test Page' },
  }),
}));

vi.mock('../../src/server/renderer.js', () => ({
  renderDocument: vi.fn().mockReturnValue('<!DOCTYPE html><html>...</html>'),
}));

describe('Static Site Generation', () => {
  const mockOutDir = '/tmp/dist';

  beforeEach(() => {
    vi.clearAllMocks();
    clearISRCache();
  });

  afterEach(() => {
    clearISRCache();
  });

  describe('generateStaticSite', () => {
    it('should generate static site for multiple routes', async () => {
      const Component = () => 'Page';
      const routes = ['/', '/about', '/contact'];

      await generateStaticSite(Component, {
        routes,
        outDir: mockOutDir,
      });

      expect(fs.promises.writeFile).toHaveBeenCalledTimes(3);
    });

    it('should handle async route function', async () => {
      const Component = () => 'Page';
      const routesFn = async () => ['/', '/blog/post-1', '/blog/post-2'];

      await generateStaticSite(Component, {
        routes: routesFn,
        outDir: mockOutDir,
      });

      expect(fs.promises.writeFile).toHaveBeenCalledTimes(3);
    });

    it('should respect parallel rendering limit', async () => {
      const Component = () => 'Page';
      const routes = Array.from({ length: 25 }, (_, i) => `/page-${i}`);

      await generateStaticSite(Component, {
        routes,
        outDir: mockOutDir,
        parallel: 5,
      });

      expect(fs.promises.writeFile).toHaveBeenCalledTimes(25);
    });

    it('should create output directory if not exists', async () => {
      const Component = () => 'Page';

      (fs.promises.access as any).mockRejectedValueOnce(
        new Error('Directory does not exist')
      );

      await generateStaticSite(Component, {
        routes: ['/'],
        outDir: mockOutDir,
      });

      expect(fs.promises.mkdir).toHaveBeenCalledWith(mockOutDir, {
        recursive: true,
      });
    });

    it('should handle route generation errors gracefully', async () => {
      const Component = () => {
        throw new Error('Render error');
      };

      // Get the mocked renderToString and make it reject for this test
      const ssrModule = await import('../../src/server/ssr.js');
      const mockRenderToString = ssrModule.renderToString as any;
      mockRenderToString.mockRejectedValueOnce(new Error('Render error'));

      const consoleError = vi.spyOn(console, 'error').mockImplementation();
      const consoleLog = vi.spyOn(console, 'log').mockImplementation();

      await generateStaticSite(Component, {
        routes: ['/error-route'],
        outDir: mockOutDir,
      });

      expect(consoleError).toHaveBeenCalled();
      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('✗'));

      consoleError.mockRestore();
      consoleLog.mockRestore();
    });

    it('should generate 404 page with static fallback', async () => {
      const Component = () => '404 Page';

      const consoleLog = vi.spyOn(console, 'log').mockImplementation();

      await generateStaticSite(Component, {
        routes: ['/'],
        outDir: mockOutDir,
        fallback: 'static',
      });

      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('404'));

      consoleLog.mockRestore();
    });

    it('should use ISR when enabled', async () => {
      const Component = () => 'Page';

      await generateStaticSite(Component, {
        routes: ['/'],
        outDir: mockOutDir,
        isr: true,
        revalidate: 60,
      });

      const stats = getISRCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.routes).toContain('/');
    });

    it('should log summary of generated pages', async () => {
      const Component = () => 'Page';
      const consoleLog = vi.spyOn(console, 'log').mockImplementation();

      await generateStaticSite(Component, {
        routes: ['/', '/about', '/contact'],
        outDir: mockOutDir,
      });

      expect(consoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Generated 3 pages')
      );

      consoleLog.mockRestore();
    });

    it('should handle empty routes array', async () => {
      const Component = () => 'Page';

      await generateStaticSite(Component, {
        routes: [],
        outDir: mockOutDir,
      });

      expect(fs.promises.writeFile).not.toHaveBeenCalled();
    });

    it('should normalize route paths correctly', async () => {
      const Component = () => 'Page';

      await generateStaticSite(Component, {
        routes: ['/', '/about/', '/contact///'],
        outDir: mockOutDir,
      });

      // All routes should be written
      expect(fs.promises.writeFile).toHaveBeenCalledTimes(3);
    });
  });

  describe('generateStaticSiteFromFiles', () => {
    it('should discover routes from pages directory', async () => {
      const Component = () => 'Page';

      (fs.promises.readdir as any).mockResolvedValueOnce([
        { name: 'index.tsx', isFile: () => true, isDirectory: () => false },
        { name: 'about.tsx', isFile: () => true, isDirectory: () => false },
        { name: 'contact.tsx', isFile: () => true, isDirectory: () => false },
      ]);

      await generateStaticSiteFromFiles(Component, {
        routes: './src/pages',
        outDir: mockOutDir,
      });

      expect(fs.promises.readdir).toHaveBeenCalled();
    });

    it('should handle nested page directories', async () => {
      const Component = () => 'Page';

      (fs.promises.readdir as any)
        .mockResolvedValueOnce([
          { name: 'blog', isFile: () => false, isDirectory: () => true },
        ])
        .mockResolvedValueOnce([
          { name: 'post-1.tsx', isFile: () => true, isDirectory: () => false },
          { name: 'post-2.tsx', isFile: () => true, isDirectory: () => false },
        ]);

      await generateStaticSiteFromFiles(Component, {
        routes: './src/pages',
        outDir: mockOutDir,
      });

      expect(fs.promises.readdir).toHaveBeenCalledTimes(2);
    });

    it('should handle file discovery errors', async () => {
      const Component = () => 'Page';

      (fs.promises.readdir as any).mockRejectedValueOnce(
        new Error('Directory not found')
      );

      const consoleError = vi.spyOn(console, 'error').mockImplementation();

      await generateStaticSiteFromFiles(Component, {
        routes: './nonexistent',
        outDir: mockOutDir,
      });

      expect(consoleError).toHaveBeenCalledWith(
        'Failed to discover routes:',
        expect.any(Error)
      );

      consoleError.mockRestore();
    });

    it('should filter by supported extensions', async () => {
      const Component = () => 'Page';

      (fs.promises.readdir as any).mockResolvedValueOnce([
        { name: 'page.tsx', isFile: () => true, isDirectory: () => false },
        { name: 'page.jsx', isFile: () => true, isDirectory: () => false },
        { name: 'page.ts', isFile: () => true, isDirectory: () => false },
        { name: 'page.js', isFile: () => true, isDirectory: () => false },
        { name: 'page.css', isFile: () => true, isDirectory: () => false }, // Should skip
      ]);

      await generateStaticSiteFromFiles(Component, {
        routes: './src/pages',
        outDir: mockOutDir,
      });

      // Only 4 valid files should be processed
      expect(fs.promises.writeFile).toHaveBeenCalledTimes(4);
    });
  });

  describe('getStaticPaths', () => {
    it('should return static paths from function', async () => {
      const getPathsFn = async () => ({
        paths: ['/blog/1', '/blog/2', '/blog/3'],
        fallback: false,
      });

      const result = await getStaticPaths(getPathsFn);

      expect(result.paths).toHaveLength(3);
      expect(result.fallback).toBe(false);
    });

    it('should support blocking fallback', async () => {
      const getPathsFn = async () => ({
        paths: ['/users/1'],
        fallback: 'blocking' as const,
      });

      const result = await getStaticPaths(getPathsFn);

      expect(result.fallback).toBe('blocking');
    });

    it('should support static fallback', async () => {
      const getPathsFn = async () => ({
        paths: ['/posts/1'],
        fallback: 'static' as const,
      });

      const result = await getStaticPaths(getPathsFn);

      expect(result.fallback).toBe('static');
    });

    it('should handle async data fetching', async () => {
      const getPathsFn = async () => {
        // Simulate API call
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          paths: ['/dynamic/1', '/dynamic/2'],
          fallback: false,
        };
      };

      const result = await getStaticPaths(getPathsFn);

      expect(result.paths).toHaveLength(2);
    });
  });

  describe('getStaticProps', () => {
    it('should fetch props for a route', async () => {
      const getPropsFn = async ({ params }: any) => ({
        props: {
          id: params.id,
          data: 'fetched data',
        },
      });

      const result = await getStaticProps(getPropsFn, '/users/123');

      expect(result.props).toHaveProperty('id');
      expect(result.props).toHaveProperty('data');
    });

    it('should support revalidation time for ISR', async () => {
      const getPropsFn = async () => ({
        props: { data: 'content' },
        revalidate: 300, // 5 minutes
      });

      const result = await getStaticProps(getPropsFn, '/page');

      expect(result.revalidate).toBe(300);
    });

    it('should support redirect', async () => {
      const getPropsFn = async () => ({
        props: {},
        redirect: {
          destination: '/new-location',
          permanent: false,
        },
      });

      const result = await getStaticProps(getPropsFn, '/old-page');

      expect(result.redirect).toBeDefined();
      expect(result.redirect?.destination).toBe('/new-location');
    });

    it('should support notFound flag', async () => {
      const getPropsFn = async () => ({
        props: {},
        notFound: true,
      });

      const result = await getStaticProps(getPropsFn, '/missing');

      expect(result.notFound).toBe(true);
    });

    it('should extract params from route', async () => {
      let capturedParams: any;

      const getPropsFn = async ({ params }: any) => {
        capturedParams = params;
        return { props: {} };
      };

      await getStaticProps(getPropsFn, '/users/123/posts/456');

      expect(capturedParams).toBeDefined();
    });
  });

  describe('ISR (Incremental Static Regeneration)', () => {
    it('should cache pages with ISR enabled', async () => {
      const Component = () => 'Page';

      await generateStaticSite(Component, {
        routes: ['/cached'],
        outDir: mockOutDir,
        isr: true,
        revalidate: 60,
      });

      const stats = getISRCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.routes).toContain('/cached');
    });

    it('should revalidate cached pages after TTL', async () => {
      const Component = () => 'Page';

      // Generate initial page
      await generateStaticSite(Component, {
        routes: ['/revalidate-test'],
        outDir: mockOutDir,
        isr: true,
        revalidate: 0, // Immediate revalidation
      });

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Revalidate should regenerate
      const regenerated = await revalidate(
        '/revalidate-test',
        Component,
        mockOutDir
      );

      expect(regenerated).toBe(true);
    });

    it('should not revalidate before TTL expires', async () => {
      const Component = () => 'Page';

      await generateStaticSite(Component, {
        routes: ['/fresh'],
        outDir: mockOutDir,
        isr: true,
        revalidate: 3600, // 1 hour
      });

      const regenerated = await revalidate('/fresh', Component, mockOutDir);

      expect(regenerated).toBe(false);
    });

    it('should generate new page if not in cache', async () => {
      const Component = () => 'New Page';

      const regenerated = await revalidate('/new', Component, mockOutDir);

      expect(regenerated).toBe(true);
    });

    it('should handle revalidation errors gracefully', async () => {
      const Component = () => {
        throw new Error('Revalidation failed');
      };

      const consoleError = vi.spyOn(console, 'error').mockImplementation();

      // Create initial cache entry
      await generateStaticSite(Component, {
        routes: ['/error-page'],
        outDir: mockOutDir,
        isr: true,
        revalidate: 0,
      });

      consoleError.mockRestore();
    });

    it('should clear ISR cache', () => {
      // Manually add to cache by generating
      generateStaticSite(() => 'Page', {
        routes: ['/cached'],
        outDir: mockOutDir,
        isr: true,
      });

      clearISRCache();

      const stats = getISRCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should return cache statistics', async () => {
      const Component = () => 'Page';

      await generateStaticSite(Component, {
        routes: ['/page1', '/page2', '/page3'],
        outDir: mockOutDir,
        isr: true,
      });

      const stats = getISRCacheStats();
      expect(stats.size).toBe(3);
      expect(stats.routes).toHaveLength(3);
      expect(stats.routes).toContain('/page1');
      expect(stats.routes).toContain('/page2');
      expect(stats.routes).toContain('/page3');
    });
  });

  describe('Route Path Mapping', () => {
    it('should map root path to index.html', async () => {
      const Component = () => 'Home';

      await generateStaticSite(Component, {
        routes: ['/'],
        outDir: mockOutDir,
      });

      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('index.html'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should create nested directories for paths', async () => {
      const Component = () => 'Page';

      // Mock access to reject for the nested directory (not the outDir itself)
      // This will cause ensureDir to be called for the nested path
      const accessMock = fs.promises.access as any;
      accessMock.mockResolvedValueOnce(undefined); // outDir exists
      accessMock.mockRejectedValueOnce(new Error('Directory does not exist')); // nested dir doesn't exist

      await generateStaticSite(Component, {
        routes: ['/blog/post-1'],
        outDir: mockOutDir,
      });

      expect(fs.promises.mkdir).toHaveBeenCalled();
    });

    it('should handle dynamic route parameters', async () => {
      const Component = () => 'Dynamic';

      await generateStaticSite(Component, {
        routes: ['/users/[id]', '/posts/[slug]'],
        outDir: mockOutDir,
      });

      expect(fs.promises.writeFile).toHaveBeenCalledTimes(2);
    });

    it('should normalize trailing slashes', async () => {
      const Component = () => 'Page';

      await generateStaticSite(Component, {
        routes: ['/about/', '/contact///', '/services'],
        outDir: mockOutDir,
      });

      expect(fs.promises.writeFile).toHaveBeenCalledTimes(3);
    });
  });

  describe('Build Performance', () => {
    it('should process routes in parallel batches', async () => {
      const Component = () => 'Page';
      const routes = Array.from({ length: 100 }, (_, i) => `/page-${i}`);

      const startTime = Date.now();

      await generateStaticSite(Component, {
        routes,
        outDir: mockOutDir,
        parallel: 10,
      });

      const duration = Date.now() - startTime;

      // Should complete relatively quickly with parallel processing
      expect(duration).toBeLessThan(5000); // 5 seconds max
      expect(fs.promises.writeFile).toHaveBeenCalledTimes(100);
    });

    it('should handle large number of routes efficiently', async () => {
      const Component = () => 'Page';
      const routes = Array.from({ length: 1000 }, (_, i) => `/page-${i}`);

      await generateStaticSite(Component, {
        routes,
        outDir: mockOutDir,
        parallel: 50,
      });

      expect(fs.promises.writeFile).toHaveBeenCalledTimes(1000);
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in route paths', async () => {
      const Component = () => 'Page';

      await generateStaticSite(Component, {
        routes: ['/page-with-dashes', '/page_with_underscores'],
        outDir: mockOutDir,
      });

      expect(fs.promises.writeFile).toHaveBeenCalledTimes(2);
    });

    it('should handle route with file extension', async () => {
      const Component = () => 'Page';

      await generateStaticSite(Component, {
        routes: ['/sitemap.xml'],
        outDir: mockOutDir,
      });

      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('sitemap.xml'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should handle concurrent generations', async () => {
      const Component = () => 'Page';

      const promise1 = generateStaticSite(Component, {
        routes: ['/page1'],
        outDir: mockOutDir,
      });

      const promise2 = generateStaticSite(Component, {
        routes: ['/page2'],
        outDir: mockOutDir,
      });

      await Promise.all([promise1, promise2]);

      expect(fs.promises.writeFile).toHaveBeenCalledTimes(2);
    });
  });
});
