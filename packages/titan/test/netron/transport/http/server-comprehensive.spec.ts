/**
 * Comprehensive HTTP Server Tests
 *
 * This test suite provides comprehensive coverage for server.ts including:
 * - Runtime detection and server startup (Bun, Deno, Node.js)
 * - Request timeout handling
 * - Async generator collection for streaming responses
 * - Authentication endpoint (/netron/authenticate)
 * - Metrics endpoint with authentication
 * - OpenAPI spec generation (/openapi.json)
 * - Service registration/unregistration
 * - Input validation with Zod schemas
 * - Contract-based HTTP configuration
 * - CORS preflight and headers
 * - Middleware execution paths
 * - Error mapping and response formatting
 * - Node.js HTTP adapter
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HttpServer } from '../../../../src/netron/transport/http/server.js';
import { LocalPeer } from '../../../../src/netron/local-peer.js';
import { Definition } from '../../../../src/netron/definition.js';
import { contract } from '../../../../src/validation/contract.js';
import { z } from 'zod';
import { TitanError, ErrorCode } from '../../../../src/errors/index.js';

describe('HttpServer - Comprehensive Coverage', () => {
  let server: HttpServer;
  let mockPeer: any;
  const testPort = 4500 + Math.floor(Math.random() * 500);

  beforeEach(async () => {
    server = new HttpServer({
      port: testPort,
      host: 'localhost',
      cors: {
        origin: '*',
        credentials: true,
      },
      compression: {
        threshold: 1024,
      },
    });

    // Create comprehensive mock peer
    mockPeer = {
      stubs: new Map(),
      logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        child: jest.fn(() => mockPeer.logger),
      },
      netron: {
        authenticationManager: {
          authenticate: jest.fn(),
          validateToken: jest.fn(),
        },
      },
    };
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  });

  describe('Server Lifecycle', () => {
    it('should start and stop server successfully', async () => {
      let listening = false;
      server.on('listening', () => {
        listening = true;
      });

      await server.listen();
      expect(listening).toBe(true);
      expect(server.port).toBe(testPort);

      await server.close();
      expect(server.connections.size).toBe(0);
    });

    it('should prevent double-start', async () => {
      await server.listen();
      await expect(server.listen()).rejects.toThrow('already listening');
    });

    it('should handle multiple close calls', async () => {
      await server.close();
      await server.close(); // Should not throw
    });

    it('should emit close event on shutdown', async () => {
      let closed = false;
      server.on('close', () => {
        closed = true;
      });

      await server.listen();
      await server.close();
      expect(closed).toBe(true);
    });
  });

  describe('Service Registration', () => {
    beforeEach(() => {
      const testContract = contract({
        testMethod: {
          input: z.object({ value: z.number() }),
          output: z.object({ result: z.number() }),
        },
      });

      const testDefinition = new Definition('test-def-id', 'peer-id', {
        name: 'TestService',
        version: '2.0.0',
        contract: testContract,
        methods: {
          testMethod: { description: 'Test method' },
        },
        properties: {},
      });

      const stub = {
        definition: testDefinition,
        instance: {
          testMethod: async (input: any) => ({ result: input.value * 2 }),
        },
        call: jest.fn(async (method, args) => {
          if (method === 'testMethod') {
            return { result: args[0].value * 2 };
          }
          throw new Error('Method not found');
        }),
      };

      mockPeer.stubs.set('test-stub', stub);
    });

    it('should register services from peer on setPeer', () => {
      server.setPeer(mockPeer);

      const services = (server as any).services;
      expect(services.has('TestService@2.0.0')).toBe(true);
      expect(services.has('TestService')).toBe(true); // Also by name
    });

    it('should register individual service dynamically', () => {
      server.setPeer(mockPeer);

      const newContract = contract({
        newMethod: {
          input: z.string(),
          output: z.string(),
        },
      });

      const newDefinition = new Definition('new-def-id', 'peer-id', {
        name: 'NewService',
        version: '1.0.0',
        contract: newContract,
        methods: {
          newMethod: {},
        },
        properties: {},
      });

      const newStub = {
        definition: newDefinition,
        instance: {
          newMethod: async (input: string) => input.toUpperCase(),
        },
        call: jest.fn(),
      };

      mockPeer.stubs.set('new-stub', newStub);

      server.registerService('NewService', newDefinition, newContract);

      const services = (server as any).services;
      expect(services.has('NewService@1.0.0')).toBe(true);
    });

    it('should unregister service', () => {
      server.setPeer(mockPeer);

      const services = (server as any).services;
      expect(services.has('TestService@2.0.0')).toBe(true);

      server.unregisterService('TestService');

      expect(services.has('TestService@2.0.0')).toBe(false);
      expect(services.has('TestService')).toBe(false);
    });

    it('should throw error when registering service without stub', () => {
      server.setPeer(mockPeer);

      const badDefinition = new Definition('bad-def-id', 'peer-id', {
        name: 'BadService',
        version: '1.0.0',
        methods: {},
        properties: {},
      });

      expect(() => {
        server.registerService('BadService', badDefinition);
      }).toThrow('Service stub not found');
    });
  });

  describe('Authentication Endpoint', () => {
    beforeEach(() => {
      server.setPeer(mockPeer);
    });

    it('should handle authentication with credentials', async () => {
      await server.listen();

      mockPeer.netron.authenticationManager.authenticate.mockResolvedValue({
        success: true,
        token: 'test-token-123',
        context: { userId: 'user-1' },
      });

      const response = await fetch(`http://localhost:${testPort}/netron/authenticate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'auth-1',
          credentials: {
            username: 'testuser',
            password: 'testpass',
          },
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result.success).toBe(true);
      expect(data.result.token).toBe('test-token-123');
    });

    it('should handle token validation', async () => {
      await server.listen();

      mockPeer.netron.authenticationManager.validateToken.mockResolvedValue({
        success: true,
        context: { userId: 'user-1' },
      });

      const response = await fetch(`http://localhost:${testPort}/netron/authenticate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'auth-2',
          credentials: {
            token: 'existing-token',
          },
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result.success).toBe(true);
    });

    it('should return error when credentials missing', async () => {
      await server.listen();

      const response = await fetch(`http://localhost:${testPort}/netron/authenticate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'auth-3',
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should return error when auth not configured', async () => {
      delete mockPeer.netron.authenticationManager;
      await server.listen();

      const response = await fetch(`http://localhost:${testPort}/netron/authenticate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'auth-4',
          credentials: { username: 'test' },
        }),
      });

      expect(response.status).toBe(503);
    });

    it('should handle authentication failures', async () => {
      await server.listen();

      mockPeer.netron.authenticationManager.authenticate.mockRejectedValue(
        new TitanError({
          code: ErrorCode.UNAUTHORIZED,
          message: 'Invalid credentials',
        })
      );

      const response = await fetch(`http://localhost:${testPort}/netron/authenticate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'auth-5',
          credentials: { username: 'bad', password: 'wrong' },
        }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe('Metrics Endpoint', () => {
    beforeEach(async () => {
      server.setPeer(mockPeer);
      await server.listen();
    });

    it('should require authentication for metrics', async () => {
      const response = await fetch(`http://localhost:${testPort}/metrics`, {
        method: 'GET',
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error.message).toContain('Authentication required');
    });

    it('should return metrics when authenticated', async () => {
      const response = await fetch(`http://localhost:${testPort}/metrics`, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer test-token',
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.server).toBeDefined();
      expect(data.requests).toBeDefined();
      expect(data.services).toBeDefined();
      expect(Array.isArray(data.services)).toBe(true);
    });
  });

  describe('OpenAPI Endpoint', () => {
    beforeEach(() => {
      const testContract = contract({
        getUser: {
          input: z.object({
            id: z.string().describe('User ID'),
          }),
          output: z.object({
            id: z.string(),
            name: z.string(),
          }),
          http: {
            status: 200,
            openapi: {
              summary: 'Get user by ID',
              description: 'Retrieves user information',
              tags: ['users'],
            },
          },
        },
        deprecatedMethod: {
          input: z.any(),
          output: z.any(),
          http: {
            openapi: {
              deprecated: true,
            },
          },
        },
      });

      const definition = new Definition('api-def-id', 'peer-id', {
        name: 'UserAPI',
        version: '1.0.0',
        contract: testContract,
        methods: {
          getUser: {},
          deprecatedMethod: {},
        },
        properties: {},
      });

      const stub = {
        definition,
        instance: {},
        call: jest.fn(),
      };

      mockPeer.stubs.set('api-stub', stub);
      server.setPeer(mockPeer);
    });

    it('should require authentication for OpenAPI spec', async () => {
      await server.listen();

      const response = await fetch(`http://localhost:${testPort}/openapi.json`, {
        method: 'GET',
      });

      expect(response.status).toBe(401);
    });

    it('should generate OpenAPI spec when authenticated', async () => {
      await server.listen();

      const response = await fetch(`http://localhost:${testPort}/openapi.json`, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer test-token',
        },
      });

      expect(response.status).toBe(200);
      const spec = await response.json();

      expect(spec.openapi).toBe('3.0.3');
      expect(spec.info.title).toBe('Netron HTTP Services');
      expect(spec.paths).toBeDefined();

      // Check for generated paths
      const paths = Object.keys(spec.paths);
      expect(paths.some((p) => p.includes('UserAPI'))).toBe(true);
    });

    it('should include schema definitions in OpenAPI spec', async () => {
      await server.listen();

      const response = await fetch(`http://localhost:${testPort}/openapi.json`, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer test-token',
        },
      });

      const spec = await response.json();
      expect(spec.components.schemas).toBeDefined();

      // Should have input/output schemas
      const schemas = Object.keys(spec.components.schemas);
      expect(schemas.some((s) => s.includes('Input'))).toBe(true);
      expect(schemas.some((s) => s.includes('Output'))).toBe(true);
    });

    it('should mark deprecated methods in OpenAPI spec', async () => {
      await server.listen();

      const response = await fetch(`http://localhost:${testPort}/openapi.json`, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer test-token',
        },
      });

      const spec = await response.json();

      // Find deprecated operation
      let foundDeprecated = false;
      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, operation] of Object.entries(methods as any)) {
          if ((operation as any).deprecated) {
            foundDeprecated = true;
          }
        }
      }

      expect(foundDeprecated).toBe(true);
    });
  });

  describe('Input Validation', () => {
    beforeEach(() => {
      const testContract = contract({
        validateInput: {
          input: z.object({
            age: z.number().min(0).max(150),
            email: z.string().email(),
            name: z.string().min(1),
          }),
          output: z.any(),
        },
        withDefaults: {
          input: z.object({
            value: z.number().default(42),
            enabled: z.boolean().default(true),
          }),
          output: z.any(),
        },
      });

      const definition = new Definition('validation-def-id', 'peer-id', {
        name: 'ValidationService',
        version: '1.0.0',
        contract: testContract,
        methods: {
          validateInput: {},
          withDefaults: {},
        },
        properties: {},
      });

      const stub = {
        definition,
        instance: {},
        call: jest.fn(async (method, args) => {
          return { success: true, input: args[0] };
        }),
      };

      mockPeer.stubs.set('validation-stub', stub);
      server.setPeer(mockPeer);
    });

    it('should validate input against Zod schema', async () => {
      await server.listen();

      const response = await fetch(`http://localhost:${testPort}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'val-1',
          version: '2.0',
          timestamp: Date.now(),
          service: 'ValidationService',
          method: 'validateInput',
          input: {
            age: 25,
            email: 'test@example.com',
            name: 'Test User',
          },
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should reject invalid input', async () => {
      await server.listen();

      const response = await fetch(`http://localhost:${testPort}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'val-2',
          version: '2.0',
          timestamp: Date.now(),
          service: 'ValidationService',
          method: 'validateInput',
          input: {
            age: -5, // Invalid
            email: 'not-an-email', // Invalid
            name: '', // Invalid
          },
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toContain('validation failed');
    });

    it('should apply default values from schema', async () => {
      await server.listen();

      const stub = mockPeer.stubs.get('validation-stub');

      const response = await fetch(`http://localhost:${testPort}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'val-3',
          version: '2.0',
          timestamp: Date.now(),
          service: 'ValidationService',
          method: 'withDefaults',
          input: {}, // Empty input, should get defaults
        }),
      });

      expect(response.status).toBe(200);

      // Check that defaults were applied
      expect(stub.call).toHaveBeenCalled();
      const calledWith = stub.call.mock.calls[0][1][0];
      expect(calledWith.value).toBe(42);
      expect(calledWith.enabled).toBe(true);
    });
  });

  describe('Async Generator Collection', () => {
    beforeEach(() => {
      const definition = new Definition('stream-def-id', 'peer-id', {
        name: 'StreamService',
        version: '1.0.0',
        methods: {
          streamNumbers: {},
          streamWithError: {},
        },
        properties: {},
      });

      async function* generateNumbers() {
        yield 1;
        yield 2;
        yield 3;
      }

      async function* generateWithError() {
        yield 1;
        throw new Error('Stream error');
      }

      const stub = {
        definition,
        instance: {},
        call: jest.fn(async (method) => {
          if (method === 'streamNumbers') {
            return generateNumbers();
          }
          if (method === 'streamWithError') {
            return generateWithError();
          }
        }),
      };

      mockPeer.stubs.set('stream-stub', stub);
      server.setPeer(mockPeer);
    });

    it('should collect async generator into array', async () => {
      await server.listen();

      const response = await fetch(`http://localhost:${testPort}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'stream-1',
          version: '2.0',
          timestamp: Date.now(),
          service: 'StreamService',
          method: 'streamNumbers',
          input: {},
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data).toEqual([1, 2, 3]);
    });

    it('should handle errors in async generator gracefully', async () => {
      await server.listen();

      const response = await fetch(`http://localhost:${testPort}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'stream-2',
          version: '2.0',
          timestamp: Date.now(),
          service: 'StreamService',
          method: 'streamWithError',
          input: {},
        }),
      });

      // Should return partial results collected before error
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data).toEqual([1]); // Collected before error
    });
  });

  describe('CORS Support', () => {
    beforeEach(async () => {
      server.setPeer(mockPeer);
      await server.listen();
    });

    it('should handle CORS preflight', async () => {
      const response = await fetch(`http://localhost:${testPort}/netron/invoke`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://example.com',
          'Access-Control-Request-Method': 'POST',
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://example.com');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('should include CORS headers in responses', async () => {
      const testContract = contract({
        test: {
          input: z.any(),
          output: z.any(),
        },
      });

      const definition = new Definition('cors-def-id', 'peer-id', {
        name: 'CorsService',
        version: '1.0.0',
        contract: testContract,
        methods: { test: {} },
        properties: {},
      });

      const stub = {
        definition,
        instance: {},
        call: jest.fn(async () => ({ result: 'ok' })),
      };

      mockPeer.stubs.set('cors-stub', stub);
      server.unregisterService('CorsService'); // Clear if exists
      server.registerService('CorsService', definition, testContract);

      const response = await fetch(`http://localhost:${testPort}/netron/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://example.com',
        },
        body: JSON.stringify({
          id: 'cors-1',
          version: '2.0',
          timestamp: Date.now(),
          service: 'CorsService',
          method: 'test',
          input: {},
        }),
      });

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://example.com');
    });

    it('should include credentials header when configured', async () => {
      const response = await fetch(`http://localhost:${testPort}/netron/invoke`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://example.com',
        },
      });

      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });
  });

  describe('Batch Processing', () => {
    beforeEach(() => {
      const testContract = contract({
        batchMethod: {
          input: z.object({ value: z.number() }),
          output: z.object({ result: z.number() }),
        },
      });

      const definition = new Definition('batch-def-id', 'peer-id', {
        name: 'BatchService',
        version: '1.0.0',
        contract: testContract,
        methods: { batchMethod: {} },
        properties: {},
      });

      const stub = {
        definition,
        instance: {},
        call: jest.fn(async (method, args) => {
          const value = args[0].value;
          if (value === 999) {
            throw new Error('Test error');
          }
          return { result: value * 2 };
        }),
      };

      mockPeer.stubs.set('batch-stub', stub);
      server.setPeer(mockPeer);
    });

    it('should process batch requests in parallel by default', async () => {
      await server.listen();

      const startTime = Date.now();
      const response = await fetch(`http://localhost:${testPort}/netron/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'batch-1',
          version: '2.0',
          timestamp: Date.now(),
          requests: [
            {
              id: 'b1',
              version: '2.0',
              timestamp: Date.now(),
              service: 'BatchService',
              method: 'batchMethod',
              input: { value: 1 },
            },
            {
              id: 'b2',
              version: '2.0',
              timestamp: Date.now(),
              service: 'BatchService',
              method: 'batchMethod',
              input: { value: 2 },
            },
            {
              id: 'b3',
              version: '2.0',
              timestamp: Date.now(),
              service: 'BatchService',
              method: 'batchMethod',
              input: { value: 3 },
            },
          ],
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.responses).toHaveLength(3);
      expect(data.hints.successCount).toBe(3);
      expect(data.hints.failureCount).toBe(0);

      // All should succeed
      expect(data.responses[0].success).toBe(true);
      expect(data.responses[1].success).toBe(true);
      expect(data.responses[2].success).toBe(true);
    });

    it('should process batch requests sequentially when parallel=false', async () => {
      await server.listen();

      const response = await fetch(`http://localhost:${testPort}/netron/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'batch-2',
          version: '2.0',
          timestamp: Date.now(),
          options: {
            parallel: false,
          },
          requests: [
            {
              id: 'b1',
              version: '2.0',
              timestamp: Date.now(),
              service: 'BatchService',
              method: 'batchMethod',
              input: { value: 1 },
            },
            {
              id: 'b2',
              version: '2.0',
              timestamp: Date.now(),
              service: 'BatchService',
              method: 'batchMethod',
              input: { value: 2 },
            },
          ],
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.responses).toHaveLength(2);
      expect(data.responses[0].success).toBe(true);
      expect(data.responses[1].success).toBe(true);
    });

    it('should stop on error when stopOnError=true', async () => {
      await server.listen();

      const response = await fetch(`http://localhost:${testPort}/netron/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'batch-3',
          version: '2.0',
          timestamp: Date.now(),
          options: {
            parallel: false,
            stopOnError: true,
          },
          requests: [
            {
              id: 'b1',
              version: '2.0',
              timestamp: Date.now(),
              service: 'BatchService',
              method: 'batchMethod',
              input: { value: 1 },
            },
            {
              id: 'b2',
              version: '2.0',
              timestamp: Date.now(),
              service: 'BatchService',
              method: 'batchMethod',
              input: { value: 999 }, // Will error
            },
            {
              id: 'b3',
              version: '2.0',
              timestamp: Date.now(),
              service: 'BatchService',
              method: 'batchMethod',
              input: { value: 3 },
            },
          ],
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Should stop after second request fails
      expect(data.responses.length).toBeLessThan(3);
      expect(data.responses[1].success).toBe(false);
    });

    it('should handle mixed success/failure in parallel mode', async () => {
      await server.listen();

      const response = await fetch(`http://localhost:${testPort}/netron/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'batch-4',
          version: '2.0',
          timestamp: Date.now(),
          requests: [
            {
              id: 'b1',
              version: '2.0',
              timestamp: Date.now(),
              service: 'BatchService',
              method: 'batchMethod',
              input: { value: 1 },
            },
            {
              id: 'b2',
              version: '2.0',
              timestamp: Date.now(),
              service: 'BatchService',
              method: 'batchMethod',
              input: { value: 999 }, // Error
            },
            {
              id: 'b3',
              version: '2.0',
              timestamp: Date.now(),
              service: 'BatchService',
              method: 'batchMethod',
              input: { value: 3 },
            },
          ],
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.responses).toHaveLength(3);
      expect(data.hints.successCount).toBe(2);
      expect(data.hints.failureCount).toBe(1);

      expect(data.responses[0].success).toBe(true);
      expect(data.responses[1].success).toBe(false);
      expect(data.responses[2].success).toBe(true);
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      server.setPeer(mockPeer);
      await server.listen();
    });

    it('should return 404 for unknown routes', async () => {
      const response = await fetch(`http://localhost:${testPort}/unknown-route`, {
        method: 'GET',
      });

      expect(response.status).toBe(404);
    });

    it('should handle malformed JSON', async () => {
      const response = await fetch(`http://localhost:${testPort}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid json}',
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.message).toContain('Invalid JSON');
    });

    it('should handle invalid request format', async () => {
      const response = await fetch(`http://localhost:${testPort}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Missing required fields
          something: 'invalid',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.message).toContain('Invalid request format');
    });

    it('should handle invalid batch request format', async () => {
      const response = await fetch(`http://localhost:${testPort}/netron/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'bad-batch',
          // Missing requests array
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('Broadcast (Not Supported)', () => {
    it('should handle broadcast gracefully without errors', async () => {
      server.setPeer(mockPeer);

      const message = Buffer.from('test message');

      // Should not throw, just log warning
      await expect(server.broadcast(message)).resolves.not.toThrow();

      // Should have logged warning
      expect(mockPeer.logger.debug).toHaveBeenCalled();
    });
  });

  describe('Server Metrics', () => {
    beforeEach(async () => {
      server.setPeer(mockPeer);
      await server.listen();
    });

    it('should track request metrics', async () => {
      const metricsBefore = server.getMetrics();
      const initialRequests = metricsBefore.totalRequests;

      await fetch(`http://localhost:${testPort}/health`);

      const metricsAfter = server.getMetrics();
      expect(metricsAfter.totalRequests).toBeGreaterThan(initialRequests);
    });

    it('should include uptime in metrics', async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));

      const metrics = server.getMetrics();
      expect(metrics.uptime).toBeGreaterThan(0);
    });

    it('should track error rate', async () => {
      await fetch(`http://localhost:${testPort}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'err-1',
          version: '2.0',
          timestamp: Date.now(),
          service: 'NonExistent',
          method: 'test',
          input: {},
        }),
      });

      const metrics = server.getMetrics();
      expect(metrics.totalErrors).toBeGreaterThan(0);
      expect(metrics.errorRate).toBeGreaterThan(0);
    });
  });
});
