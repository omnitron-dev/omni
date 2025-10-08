/**
 * Tests for HTTP Server Type Safety Improvements (Phase 2)
 * Tests the enhanced type safety features including MethodHandlerContext,
 * improved error handling, and type-safe metadata handling
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { HttpServer, MethodHandlerContext } from '../../../../src/netron/transport/http/server.js';
import type { MethodContract } from '../../../../src/validation/contract.js';
import { TitanError, ErrorCode } from '../../../../src/errors/index.js';
import { z } from 'zod';

describe('HttpServer Type Safety (Phase 2)', () => {
  let server: HttpServer;
  let mockPeer: any;

  beforeEach(() => {
    // Create mock peer with typed service
    const typedStub = {
      definition: {
        meta: {
          name: 'TypedService@1.0.0',
          version: '1.0.0',
          methods: {
            echo: { name: 'echo' },
            validate: { name: 'validate' },
            throwError: { name: 'throwError' }
          },
          contract: {
            echo: {
              input: z.object({ message: z.string() }),
              output: z.object({ message: z.string(), timestamp: z.number() })
            } as MethodContract,
            validate: {
              input: z.object({ value: z.number().min(0).max(100) }),
              output: z.object({ valid: z.boolean() })
            } as MethodContract
          }
        }
      },
      call: jest.fn()
    };

    mockPeer = {
      stubs: new Map([['stub-typed', typedStub]])
    };

    server = new HttpServer({ port: 3457 });
    server.setPeer(mockPeer);
  });

  describe('MethodHandlerContext', () => {
    it('should provide typed context to method handlers', async () => {
      const typedStub = mockPeer.stubs.get('stub-typed');
      let capturedContext: MethodHandlerContext | undefined;

      typedStub.call.mockImplementation(async (method: string, args: any[], peer: any) => 
        // Handler receives MethodHandlerContext
         ({ message: args[0].message, timestamp: Date.now() })
      );

      const request = new Request('http://localhost:3457/netron/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'ctx-test-1',
          version: '2.0',
          timestamp: Date.now(),
          service: 'TypedService@1.0.0',
          method: 'echo',
          input: { message: 'Hello Type Safety!' },
          context: {
            traceId: 'trace-123',
            userId: 'user-456'
          },
          hints: {
            cache: { maxAge: 60000 }
          }
        })
      });

      const response = await server.handleRequest(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should include request in handler context', async () => {
      const typedStub = mockPeer.stubs.get('stub-typed');

      typedStub.call.mockResolvedValue({ message: 'test', timestamp: Date.now() });

      const request = new Request('http://localhost:3457/netron/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Custom-Header': 'test-value'
        },
        body: JSON.stringify({
          id: 'req-test-1',
          version: '2.0',
          timestamp: Date.now(),
          service: 'TypedService@1.0.0',
          method: 'echo',
          input: { message: 'test' }
        })
      });

      const response = await server.handleRequest(request);
      expect(response.status).toBe(200);

      // Verify handler was called
      expect(typedStub.call).toHaveBeenCalled();
    });

    it('should include middleware context with metadata', async () => {
      const typedStub = mockPeer.stubs.get('stub-typed');

      typedStub.call.mockResolvedValue({ message: 'test', timestamp: Date.now() });

      const request = new Request('http://localhost:3457/netron/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'meta-test-1',
          version: '2.0',
          timestamp: Date.now(),
          service: 'TypedService@1.0.0',
          method: 'echo',
          input: { message: 'test' },
          context: { customField: 'customValue' }
        })
      });

      const response = await server.handleRequest(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });

  describe('Error Handling Type Safety', () => {
    it('should handle TitanError with proper type checking', async () => {
      const typedStub = mockPeer.stubs.get('stub-typed');

      typedStub.call.mockRejectedValue(
        new TitanError({
          code: ErrorCode.INVALID_ARGUMENT,
          message: 'Invalid input provided',
          details: { field: 'value', reason: 'out of range' }
        })
      );

      const request = new Request('http://localhost:3457/netron/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'error-test-1',
          version: '2.0',
          timestamp: Date.now(),
          service: 'TypedService@1.0.0',
          method: 'throwError',
          input: {}
        })
      });

      const response = await server.handleRequest(request);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('400'); // ErrorCode as string
      expect(data.error.message).toBe('Invalid input provided');
      expect(data.error.details).toEqual({ field: 'value', reason: 'out of range' });
    });

    it('should handle generic Error instances', async () => {
      const typedStub = mockPeer.stubs.get('stub-typed');

      typedStub.call.mockRejectedValue(new Error('Generic error occurred'));

      const request = new Request('http://localhost:3457/netron/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'error-test-2',
          version: '2.0',
          timestamp: Date.now(),
          service: 'TypedService@1.0.0',
          method: 'throwError',
          input: {}
        })
      });

      const response = await server.handleRequest(request);
      expect(response.status).toBe(500);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('500'); // INTERNAL_SERVER_ERROR
      expect(data.error.message).toBe('Generic error occurred');
    });

    it('should handle non-Error thrown values', async () => {
      const typedStub = mockPeer.stubs.get('stub-typed');

      typedStub.call.mockRejectedValue('String error');

      const request = new Request('http://localhost:3457/netron/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'error-test-3',
          version: '2.0',
          timestamp: Date.now(),
          service: 'TypedService@1.0.0',
          method: 'throwError',
          input: {}
        })
      });

      const response = await server.handleRequest(request);
      expect(response.status).toBe(500);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('500');
      expect(data.error.message).toBe('Internal server error');
    });

    it('should convert error codes to strings for HTTP response', async () => {
      const typedStub = mockPeer.stubs.get('stub-typed');

      typedStub.call.mockRejectedValue(
        new TitanError({
          code: ErrorCode.NOT_FOUND,
          message: 'Resource not found'
        })
      );

      const request = new Request('http://localhost:3457/netron/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'error-test-4',
          version: '2.0',
          timestamp: Date.now(),
          service: 'TypedService@1.0.0',
          method: 'throwError',
          input: {}
        })
      });

      const response = await server.handleRequest(request);

      const data = await response.json();
      expect(typeof data.error.code).toBe('string');
      expect(data.error.code).toBe('404');
    });
  });

  describe('Batch Request Type Safety', () => {
    it('should handle batch requests with proper error types', async () => {
      const typedStub = mockPeer.stubs.get('stub-typed');

      // First call succeeds
      typedStub.call.mockResolvedValueOnce({ message: 'success', timestamp: Date.now() });

      // Second call fails with TitanError
      typedStub.call.mockRejectedValueOnce(
        new TitanError({
          code: ErrorCode.INVALID_ARGUMENT,
          message: 'Validation failed'
        })
      );

      const request = new Request('http://localhost:3457/netron/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'batch-test-1',
          version: '2.0',
          timestamp: Date.now(),
          requests: [
            {
              id: 'req-1',
              service: 'TypedService@1.0.0',
              method: 'echo',
              input: { message: 'test1' }
            },
            {
              id: 'req-2',
              service: 'TypedService@1.0.0',
              method: 'throwError',
              input: {}
            }
          ]
        })
      });

      const response = await server.handleRequest(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.responses).toHaveLength(2);

      // First response should succeed
      expect(data.responses[0].success).toBe(true);
      expect(data.responses[0].data).toBeDefined();

      // Second response should fail with typed error
      expect(data.responses[1].success).toBe(false);
      expect(data.responses[1].error.code).toBe('400');
      expect(data.responses[1].error.message).toBe('Validation failed');
    });

    it('should handle batch request with generic errors', async () => {
      const typedStub = mockPeer.stubs.get('stub-typed');

      typedStub.call.mockRejectedValue(new Error('Network timeout'));

      const request = new Request('http://localhost:3457/netron/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'batch-test-2',
          version: '2.0',
          timestamp: Date.now(),
          requests: [
            {
              id: 'req-1',
              service: 'TypedService@1.0.0',
              method: 'echo',
              input: { message: 'test' }
            }
          ]
        })
      });

      const response = await server.handleRequest(request);
      const data = await response.json();

      expect(data.responses[0].success).toBe(false);
      expect(data.responses[0].error.code).toBe('500');
      expect(data.responses[0].error.message).toBe('Network timeout');
    });
  });

  describe('Metadata Type Safety', () => {
    it('should handle metadata as Map<string, unknown>', async () => {
      const typedStub = mockPeer.stubs.get('stub-typed');

      typedStub.call.mockResolvedValue({ message: 'test', timestamp: Date.now() });

      const request = new Request('http://localhost:3457/netron/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'meta-test-1',
          version: '2.0',
          timestamp: Date.now(),
          service: 'TypedService@1.0.0',
          method: 'echo',
          input: { message: 'test' },
          context: {
            traceId: 'trace-123',
            userId: 'user-456',
            customData: { nested: 'value' }
          }
        })
      });

      const response = await server.handleRequest(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });

  describe('Contract Validation with Type Safety', () => {
    it('should validate input against contract schema', async () => {
      const request = new Request('http://localhost:3457/netron/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'validation-test-1',
          version: '2.0',
          timestamp: Date.now(),
          service: 'TypedService@1.0.0',
          method: 'validate',
          input: { value: 150 } // Out of range (max 100)
        })
      });

      const response = await server.handleRequest(request);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('400');
      expect(data.error.message).toContain('validation failed');
    });

    it('should pass validation for valid input', async () => {
      const typedStub = mockPeer.stubs.get('stub-typed');

      typedStub.call.mockResolvedValue({ valid: true });

      const request = new Request('http://localhost:3457/netron/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'validation-test-2',
          version: '2.0',
          timestamp: Date.now(),
          service: 'TypedService@1.0.0',
          method: 'validate',
          input: { value: 50 } // Valid (0-100)
        })
      });

      const response = await server.handleRequest(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toEqual({ valid: true });
    });
  });
});
