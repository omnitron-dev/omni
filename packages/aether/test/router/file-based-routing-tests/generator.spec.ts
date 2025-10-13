/**
 * Tests for route generator
 */

import { describe, it, expect } from 'vitest';
import {
  generateRoutes,
  generateManifestJson,
  generateRouteTypes,
  generateDevManifest,
} from '../../../src/router/file-based/generator.js';

describe('Route Generator', () => {
  const mockFiles = [
    'routes/index.tsx',
    'routes/about.tsx',
    'routes/users/index.tsx',
    'routes/users/[id].tsx',
    'routes/users/[id]/_layout.tsx',
    'routes/blog/[...slug].tsx',
    'routes/(auth)/login.tsx',
    'routes/(auth)/register.tsx',
    'routes/api/users.ts',
    'routes/api/posts/[id].ts',
  ];

  describe('generateRoutes', () => {
    it('should generate route manifest from files', async () => {
      const manifest = await generateRoutes(mockFiles, {
        includeApi: true,
      });

      expect(manifest).toBeDefined();
      expect(manifest.routes).toBeDefined();
      expect(manifest.apiRoutes).toBeDefined();
      expect(manifest.groups).toBeDefined();
      expect(manifest.fileMap).toBeDefined();
      expect(manifest.validation).toBeDefined();
    });

    it('should separate page and API routes', async () => {
      const manifest = await generateRoutes(mockFiles, {
        includeApi: true,
      });

      expect(manifest.routes.length).toBeGreaterThan(0);
      expect(manifest.apiRoutes.length).toBeGreaterThan(0);

      // API routes should have /api prefix
      for (const route of manifest.apiRoutes) {
        expect(route.path).toMatch(/^\/api\//);
      }
    });

    it('should detect route groups', async () => {
      const manifest = await generateRoutes(mockFiles);

      expect(manifest.groups.size).toBeGreaterThan(0);
      expect(manifest.groups.has('auth')).toBe(true);
    });

    it('should validate routes', async () => {
      const manifest = await generateRoutes(mockFiles);

      expect(manifest.validation).toBeDefined();
      expect(typeof manifest.validation.valid).toBe('boolean');
      expect(Array.isArray(manifest.validation.errors)).toBe(true);
      expect(Array.isArray(manifest.validation.warnings)).toBe(true);
    });

    it('should create file map', async () => {
      const manifest = await generateRoutes(mockFiles);

      expect(manifest.fileMap.size).toBe(mockFiles.length);

      for (const file of mockFiles) {
        expect(manifest.fileMap.has(file)).toBe(true);
      }
    });

    it('should optionally exclude API routes', async () => {
      const manifest = await generateRoutes(mockFiles, {
        includeApi: false,
      });

      expect(manifest.apiRoutes.length).toBe(0);
    });
  });

  describe('generateManifestJson', () => {
    it('should generate JSON manifest', async () => {
      const manifest = await generateRoutes(mockFiles);
      const json = generateManifestJson(manifest);

      expect(json).toBeDefined();
      expect(typeof json).toBe('string');

      const parsed = JSON.parse(json);
      expect(parsed.routes).toBeDefined();
      expect(parsed.apiRoutes).toBeDefined();
      expect(parsed.groups).toBeDefined();
      expect(parsed.stats).toBeDefined();
    });

    it('should include statistics', async () => {
      const manifest = await generateRoutes(mockFiles);
      const json = generateManifestJson(manifest);
      const parsed = JSON.parse(json);

      expect(parsed.stats.totalRoutes).toBeDefined();
      expect(parsed.stats.apiRoutes).toBeDefined();
      expect(parsed.stats.groups).toBeDefined();
      expect(parsed.stats.files).toBeDefined();
    });

    it('should be valid JSON', async () => {
      const manifest = await generateRoutes(mockFiles);
      const json = generateManifestJson(manifest);

      expect(() => JSON.parse(json)).not.toThrow();
    });
  });

  describe('generateRouteTypes', () => {
    it('should generate TypeScript types', async () => {
      const manifest = await generateRoutes(mockFiles);
      const types = generateRouteTypes(manifest);

      expect(types).toBeDefined();
      expect(typeof types).toBe('string');
      expect(types).toContain('export type RoutePaths');
      expect(types).toContain('export interface RouteParams');
    });

    it('should include all route paths', async () => {
      const manifest = await generateRoutes(mockFiles);
      const types = generateRouteTypes(manifest);

      expect(types).toContain("'/'");
      expect(types).toContain("'/about'");
      expect(types).toContain("'/users/:id'");
    });

    it('should include parameter types for dynamic routes', async () => {
      const manifest = await generateRoutes(mockFiles);
      const types = generateRouteTypes(manifest);

      expect(types).toContain("'/users/:id'");
      expect(types).toContain('id: string');
    });

    it('should include API route types', async () => {
      const manifest = await generateRoutes(mockFiles, { includeApi: true });
      const types = generateRouteTypes(manifest);

      expect(types).toContain('export type ApiRoutePaths');
      expect(types).toContain("'/api/users'");
    });

    it('should include route groups type', async () => {
      const manifest = await generateRoutes(mockFiles);
      const types = generateRouteTypes(manifest);

      expect(types).toContain('export type RouteGroups');
      expect(types).toContain("'auth'");
    });
  });

  describe('generateDevManifest', () => {
    it('should generate markdown manifest', async () => {
      const manifest = await generateRoutes(mockFiles);
      const markdown = generateDevManifest(manifest);

      expect(markdown).toBeDefined();
      expect(typeof markdown).toBe('string');
      expect(markdown).toContain('# Route Manifest');
      expect(markdown).toContain('## Statistics');
      expect(markdown).toContain('## Page Routes');
    });

    it('should include validation status', async () => {
      const manifest = await generateRoutes(mockFiles);
      const markdown = generateDevManifest(manifest);

      expect(markdown).toContain('## Validation');
    });

    it('should include API routes section if present', async () => {
      const manifest = await generateRoutes(mockFiles, { includeApi: true });
      const markdown = generateDevManifest(manifest);

      expect(markdown).toContain('## API Routes');
    });

    it('should include route groups section if present', async () => {
      const manifest = await generateRoutes(mockFiles);
      const markdown = generateDevManifest(manifest);

      expect(markdown).toContain('## Route Groups');
      expect(markdown).toContain('(auth)');
    });
  });
});
