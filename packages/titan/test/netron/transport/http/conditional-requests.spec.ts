/**
 * HTTP 304 Not Modified Tests
 *
 * Tests for conditional request handling (If-None-Match, ETag)
 * to validate HTTP caching optimization.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpServer } from '../../../../src/netron/transport/http/server.js';
import { Definition } from '../../../../src/netron/definition.js';
import { contract } from '../../../../src/validation/contract.js';
import { createRequestMessage } from '../../../../src/netron/transport/http/types.js';
import { z } from 'zod';

const skipIntegrationTests = process.env.USE_MOCK_REDIS === 'true' || process.env.CI === 'true';

if (skipIntegrationTests) {
  console.log('⏭️  Skipping conditional-requests.spec.ts - integration test requiring real HTTP');
}

const describeOrSkip = skipIntegrationTests ? describe.skip : describe;

describeOrSkip('HTTP 304 Not Modified', () => {
  let server: HttpServer;
  let mockPeer: any;
  const testPort = 5500 + Math.floor(Math.random() * 500);
  const baseUrl = () => `http://localhost:${testPort}`;

  beforeEach(async () => {
    server = new HttpServer({
      port: testPort,
      host: 'localhost',
    });

    // Create mock peer with test services
    mockPeer = {
      stubs: new Map(),
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(() => mockPeer.logger),
      },
      netron: {
        authenticationManager: {
          authenticate: vi.fn(),
          validateToken: vi.fn(),
        },
      },
    };

    // Register a cacheable service
    const cacheableContract = contract({
      getFixed: {
        input: z.object({}),
        output: z.object({ value: z.string() }),
      },
    });

    const cacheableDefinition = new Definition('cache-def', 'peer-id', {
      name: 'CacheService',
      version: '1.0.0',
      contract: cacheableContract,
      methods: {
        getFixed: {
          description: 'Get fixed data',
          cacheable: true,
          cacheMaxAge: 300000,
        },
      },
      properties: {},
    });

    const stub = {
      definition: cacheableDefinition,
      instance: {
        getFixed: async () => ({ value: 'fixed-content' }),
      },
      call: vi.fn(async (method: string) => {
        if (method === 'getFixed') return { value: 'fixed-content' };
        throw new Error('Method not found');
      }),
    };

    mockPeer.stubs.set('cache-def', stub);
    server.setPeer(mockPeer);
    await server.listen();
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  });

  describe('ETag generation', () => {
    it('should include ETag header for cacheable responses', async () => {
      const message = createRequestMessage('CacheService', 'getFixed', {});

      const response = await fetch(`${baseUrl()}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('ETag')).toBeTruthy();
      expect(response.headers.get('ETag')).toMatch(/^W\/"[a-f0-9]+"/);
    });

    it('should generate consistent ETag for same content', async () => {
      const message = createRequestMessage('CacheService', 'getFixed', {});

      const response1 = await fetch(`${baseUrl()}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });

      const response2 = await fetch(`${baseUrl()}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });

      const etag1 = response1.headers.get('ETag');
      const etag2 = response2.headers.get('ETag');

      expect(etag1).toBeTruthy();
      expect(etag1).toBe(etag2);
    });
  });

  describe('304 Not Modified response', () => {
    it('should return 304 when If-None-Match matches ETag', async () => {
      const message = createRequestMessage('CacheService', 'getFixed', {});

      // First request - get the ETag
      const response1 = await fetch(`${baseUrl()}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });

      expect(response1.status).toBe(200);
      const etag = response1.headers.get('ETag');
      expect(etag).toBeTruthy();

      // Second request with If-None-Match
      const response2 = await fetch(`${baseUrl()}/netron/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'If-None-Match': etag!,
        },
        body: JSON.stringify(message),
      });

      expect(response2.status).toBe(304);

      // 304 response should have empty body
      const body = await response2.text();
      expect(body).toBe('');

      // 304 should still include cache headers
      expect(response2.headers.get('ETag')).toBe(etag);
      expect(response2.headers.get('Cache-Control')).toContain('max-age');
    });

    it('should return 200 when If-None-Match does NOT match', async () => {
      const message = createRequestMessage('CacheService', 'getFixed', {});

      const response = await fetch(`${baseUrl()}/netron/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'If-None-Match': 'W/"invalid-etag"',
        },
        body: JSON.stringify(message),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should match * wildcard in If-None-Match', async () => {
      const message = createRequestMessage('CacheService', 'getFixed', {});

      const response = await fetch(`${baseUrl()}/netron/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'If-None-Match': '*',
        },
        body: JSON.stringify(message),
      });

      expect(response.status).toBe(304);
    });

    it('should handle comma-separated ETags in If-None-Match', async () => {
      const message = createRequestMessage('CacheService', 'getFixed', {});

      // First get the valid ETag
      const response1 = await fetch(`${baseUrl()}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });

      const validEtag = response1.headers.get('ETag');

      // Send multiple ETags including the valid one
      const response2 = await fetch(`${baseUrl()}/netron/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'If-None-Match': `W/"other1", ${validEtag}, W/"other2"`,
        },
        body: JSON.stringify(message),
      });

      expect(response2.status).toBe(304);
    });

    it('should perform weak comparison (ignore W/ prefix)', async () => {
      const message = createRequestMessage('CacheService', 'getFixed', {});

      const response1 = await fetch(`${baseUrl()}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });

      const etag = response1.headers.get('ETag')!;
      // Remove W/ prefix if present
      const strongEtag = etag.startsWith('W/') ? etag.slice(2) : etag;

      // Should still match when sending without W/ prefix
      const response2 = await fetch(`${baseUrl()}/netron/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'If-None-Match': strongEtag,
        },
        body: JSON.stringify(message),
      });

      expect(response2.status).toBe(304);
    });
  });

  describe('bandwidth savings', () => {
    it('should save 100% body bandwidth with 304 responses', async () => {
      const message = createRequestMessage('CacheService', 'getFixed', {});

      // First request - full response
      const response1 = await fetch(`${baseUrl()}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });

      const fullBody = await response1.text();
      const etag = response1.headers.get('ETag');

      // Second request - 304
      const response2 = await fetch(`${baseUrl()}/netron/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'If-None-Match': etag!,
        },
        body: JSON.stringify(message),
      });

      const emptyBody = await response2.text();

      // 304 response should have empty body
      expect(emptyBody.length).toBe(0);
      expect(fullBody.length).toBeGreaterThan(0);
    });
  });
});
