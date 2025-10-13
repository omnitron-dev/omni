/**
 * Tests for API routes
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createApiHandler,
  json,
  error,
  redirect,
  cors,
  composeMiddleware,
  type ApiContext,
  type ApiHandlers,
} from '../../../src/router/file-based/api-routes.js';

describe('API Routes', () => {
  let mockContext: ApiContext;

  beforeEach(() => {
    mockContext = {
      request: new Request('http://localhost/api/test'),
      params: {},
      query: {},
      url: new URL('http://localhost/api/test'),
      headers: new Headers(),
    };
  });

  describe('createApiHandler', () => {
    it('should handle GET requests', async () => {
      const handlers: ApiHandlers = {
        GET: async () => json({ message: 'Hello' }),
      };

      const handler = createApiHandler(handlers);
      const response = await handler(mockContext);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ message: 'Hello' });
    });

    it('should handle POST requests', async () => {
      mockContext.request = new Request('http://localhost/api/test', {
        method: 'POST',
      });

      const handlers: ApiHandlers = {
        POST: async () => json({ created: true }, { status: 201 }),
      };

      const handler = createApiHandler(handlers);
      const response = await handler(mockContext);

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data).toEqual({ created: true });
    });

    it('should return 405 for unsupported methods', async () => {
      mockContext.request = new Request('http://localhost/api/test', {
        method: 'DELETE',
      });

      const handlers: ApiHandlers = {
        GET: async () => json({ message: 'Hello' }),
      };

      const handler = createApiHandler(handlers);
      const response = await handler(mockContext);

      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('GET');

      const data = await response.json();
      expect(data.error).toBe('Method Not Allowed');
    });

    it('should handle multiple methods', async () => {
      const handlers: ApiHandlers = {
        GET: async () => json({ method: 'GET' }),
        POST: async () => json({ method: 'POST' }),
        PUT: async () => json({ method: 'PUT' }),
      };

      const handler = createApiHandler(handlers);

      // Test GET
      const getResponse = await handler(mockContext);
      const getData = await getResponse.json();
      expect(getData.method).toBe('GET');

      // Test POST
      mockContext.request = new Request('http://localhost/api/test', {
        method: 'POST',
      });
      const postResponse = await handler(mockContext);
      const postData = await postResponse.json();
      expect(postData.method).toBe('POST');
    });

    it('should handle errors', async () => {
      const handlers: ApiHandlers = {
        GET: async () => {
          throw new Error('Test error');
        },
      };

      const handler = createApiHandler(handlers);
      const response = await handler(mockContext);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('Internal Server Error');
      expect(data.message).toBe('Test error');
    });
  });

  describe('json helper', () => {
    it('should create JSON response', async () => {
      const response = json({ message: 'Hello' });

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json');

      const data = await response.json();
      expect(data).toEqual({ message: 'Hello' });
    });

    it('should accept custom status', async () => {
      const response = json({ created: true }, { status: 201 });
      expect(response.status).toBe(201);
    });

    it('should accept custom headers', async () => {
      const response = json(
        { data: 'test' },
        {
          headers: { 'X-Custom': 'value' },
        }
      );

      expect(response.headers.get('X-Custom')).toBe('value');
      expect(response.headers.get('Content-Type')).toBe('application/json');
    });
  });

  describe('error helper', () => {
    it('should create error response', async () => {
      const response = error('Not found', 404);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Not Found');
      expect(data.message).toBe('Not found');
    });

    it('should default to 500', async () => {
      const response = error('Server error');
      expect(response.status).toBe(500);
    });

    it('should include correct error names', async () => {
      const tests = [
        { status: 400, name: 'Bad Request' },
        { status: 401, name: 'Unauthorized' },
        { status: 403, name: 'Forbidden' },
        { status: 404, name: 'Not Found' },
        { status: 500, name: 'Internal Server Error' },
      ];

      for (const test of tests) {
        const response = error('Test', test.status);
        const data = await response.json();
        expect(data.error).toBe(test.name);
      }
    });
  });

  describe('redirect helper', () => {
    it('should create redirect response', () => {
      const response = redirect('/login');

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/login');
    });

    it('should accept custom status', () => {
      const response = redirect('/home', 301);
      expect(response.status).toBe(301);
    });
  });

  describe('cors helper', () => {
    it('should add CORS headers', () => {
      const original = new Response('test');
      const response = cors(original);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
      expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
    });

    it('should accept custom origin', () => {
      const original = new Response('test');
      const response = cors(original, {
        origin: 'https://example.com',
      });

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
    });

    it('should handle credentials', () => {
      const original = new Response('test');
      const response = cors(original, {
        credentials: true,
      });

      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });

    it('should accept custom methods', () => {
      const original = new Response('test');
      const response = cors(original, {
        methods: ['GET', 'POST'],
      });

      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST');
    });
  });

  describe('composeMiddleware', () => {
    it('should compose multiple middlewares', async () => {
      const calls: string[] = [];

      const middleware1 = async (_ctx: ApiContext, next: () => Promise<Response>) => {
        calls.push('m1-before');
        const response = await next();
        calls.push('m1-after');
        return response;
      };

      const middleware2 = async (_ctx: ApiContext, next: () => Promise<Response>) => {
        calls.push('m2-before');
        const response = await next();
        calls.push('m2-after');
        return response;
      };

      const handler = async () => {
        calls.push('handler');
        return json({ success: true });
      };

      const composed = composeMiddleware(middleware1, middleware2);
      await composed(mockContext, handler);

      expect(calls).toEqual(['m1-before', 'm2-before', 'handler', 'm2-after', 'm1-after']);
    });

    it('should allow middleware to modify response', async () => {
      const middleware = async (_ctx: ApiContext, next: () => Promise<Response>) => {
        const response = await next();
        const data = await response.json();
        return json({ ...data, modified: true });
      };

      const handler = async () => json({ original: true });

      const composed = composeMiddleware(middleware);
      const response = await composed(mockContext, handler);
      const data = await response.json();

      expect(data).toEqual({ original: true, modified: true });
    });

    it('should allow middleware to short-circuit', async () => {
      const middleware = async () => error('Unauthorized', 401);

      const handler = async () => json({ should: 'not be called' });

      const composed = composeMiddleware(middleware);
      const response = await composed(mockContext, handler);

      expect(response.status).toBe(401);
    });

    it('should handle middleware errors', async () => {
      const middleware = async () => {
        throw new Error('Middleware error');
      };

      const handler = async () => json({ success: true });

      const composed = composeMiddleware(middleware);

      await expect(composed(mockContext, handler)).rejects.toThrow('Middleware error');
    });
  });
});
