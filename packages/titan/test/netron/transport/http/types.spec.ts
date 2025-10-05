/**
 * Tests for Native HTTP Message Format
 */

import {
  HttpBatchRequest,
  HttpBatchResponse,
  createRequestMessage,
  createSuccessResponse,
  createErrorResponse,
  generateRequestId,
  isHttpRequestMessage,
  isHttpResponseMessage,
  isHttpBatchRequest,
  isHttpBatchResponse
} from '../../../../src/netron/transport/http/types.js';

describe('HTTP Message Types', () => {
  describe('Message Creation', () => {
    it('should create a valid request message', () => {
      const message = createRequestMessage('UserService', 'getUser', { id: '123' });

      expect(message).toMatchObject({
        version: '2.0',
        service: 'UserService',
        method: 'getUser',
        input: { id: '123' }
      });
      expect(message.id).toBeDefined();
      expect(message.timestamp).toBeDefined();
    });

    it('should create a request message with context and hints', () => {
      const message = createRequestMessage('UserService', 'getUser', { id: '123' }, {
        context: { userId: 'user-123', traceId: 'trace-456' },
        hints: { cache: { maxAge: 5000 } }
      });

      expect(message.context).toEqual({
        userId: 'user-123',
        traceId: 'trace-456'
      });
      expect(message.hints).toEqual({
        cache: { maxAge: 5000 }
      });
    });

    it('should create a success response', () => {
      const response = createSuccessResponse('req-123', { name: 'John', age: 30 });

      expect(response).toMatchObject({
        id: 'req-123',
        version: '2.0',
        success: true,
        data: { name: 'John', age: 30 }
      });
      expect(response.timestamp).toBeDefined();
    });

    it('should create an error response', () => {
      const response = createErrorResponse('req-123', {
        code: 'NOT_FOUND',
        message: 'User not found'
      });

      expect(response).toMatchObject({
        id: 'req-123',
        version: '2.0',
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'User not found'
        }
      });
      expect(response.timestamp).toBeDefined();
    });

    it('should create response with hints', () => {
      const response = createSuccessResponse('req-123', { data: 'test' }, {
        cache: {
          maxAge: 300000,
          etag: '"abc123"',
          tags: ['users']
        },
        metrics: {
          serverTime: 25,
          dbQueries: 3
        }
      });

      expect(response.hints).toEqual({
        cache: {
          maxAge: 300000,
          etag: '"abc123"',
          tags: ['users']
        },
        metrics: {
          serverTime: 25,
          dbQueries: 3
        }
      });
    });
  });

  describe('Type Guards', () => {
    describe('isHttpRequestMessage', () => {
      it('should validate a valid request message', () => {
        const message = createRequestMessage('Service', 'method', {});
        expect(isHttpRequestMessage(message)).toBe(true);
      });

      it('should reject invalid messages', () => {
        expect(isHttpRequestMessage(null)).toBe(false);
        expect(isHttpRequestMessage(undefined)).toBe(false);
        expect(isHttpRequestMessage({})).toBe(false);
        expect(isHttpRequestMessage({ id: '123' })).toBe(false);
        expect(isHttpRequestMessage({
          id: '123',
          version: '1.0', // wrong version
          timestamp: Date.now(),
          service: 'Service',
          method: 'method',
          input: {}
        })).toBe(false);
        expect(isHttpRequestMessage({
          id: '123',
          version: '2.0',
          timestamp: Date.now(),
          // missing service
          method: 'method',
          input: {}
        })).toBe(false);
      });
    });

    describe('isHttpResponseMessage', () => {
      it('should validate a valid success response', () => {
        const response = createSuccessResponse('req-123', { result: true });
        expect(isHttpResponseMessage(response)).toBe(true);
      });

      it('should validate a valid error response', () => {
        const response = createErrorResponse('req-123', {
          code: 'ERROR',
          message: 'Something went wrong'
        });
        expect(isHttpResponseMessage(response)).toBe(true);
      });

      it('should reject invalid responses', () => {
        expect(isHttpResponseMessage(null)).toBe(false);
        expect(isHttpResponseMessage(undefined)).toBe(false);
        expect(isHttpResponseMessage({})).toBe(false);
        expect(isHttpResponseMessage({
          id: '123',
          version: '2.0',
          timestamp: Date.now(),
          // missing success field
        })).toBe(false);
        expect(isHttpResponseMessage({
          id: '123',
          version: '2.0',
          timestamp: Date.now(),
          success: true,
          // success response must have data
        })).toBe(false);
        expect(isHttpResponseMessage({
          id: '123',
          version: '2.0',
          timestamp: Date.now(),
          success: false,
          // error response must have error
        })).toBe(false);
      });
    });

    describe('isHttpBatchRequest', () => {
      it('should validate a valid batch request', () => {
        const batch: HttpBatchRequest = {
          id: 'batch-123',
          version: '2.0',
          timestamp: Date.now(),
          requests: [
            { id: 'req-1', service: 'Service1', method: 'method1', input: {} },
            { id: 'req-2', service: 'Service2', method: 'method2', input: { data: true } }
          ]
        };
        expect(isHttpBatchRequest(batch)).toBe(true);
      });

      it('should reject invalid batch requests', () => {
        expect(isHttpBatchRequest(null)).toBe(false);
        expect(isHttpBatchRequest(undefined)).toBe(false);
        expect(isHttpBatchRequest({
          id: 'batch-123',
          version: '2.0',
          timestamp: Date.now(),
          requests: 'not-an-array' // must be array
        })).toBe(false);
        expect(isHttpBatchRequest({
          id: 'batch-123',
          version: '2.0',
          timestamp: Date.now(),
          requests: [
            { id: 'req-1' } // missing required fields
          ]
        })).toBe(false);
      });
    });

    describe('isHttpBatchResponse', () => {
      it('should validate a valid batch response', () => {
        const batch: HttpBatchResponse = {
          id: 'batch-123',
          version: '2.0',
          timestamp: Date.now(),
          responses: [
            { id: 'req-1', success: true, data: { result: 'ok' } },
            { id: 'req-2', success: false, error: { code: 'ERROR', message: 'Failed' } }
          ]
        };
        expect(isHttpBatchResponse(batch)).toBe(true);
      });

      it('should reject invalid batch responses', () => {
        expect(isHttpBatchResponse(null)).toBe(false);
        expect(isHttpBatchResponse(undefined)).toBe(false);
        expect(isHttpBatchResponse({
          id: 'batch-123',
          version: '2.0',
          timestamp: Date.now(),
          responses: 'not-an-array'
        })).toBe(false);
        expect(isHttpBatchResponse({
          id: 'batch-123',
          version: '2.0',
          timestamp: Date.now(),
          responses: [
            { id: 'req-1' } // missing success field
          ]
        })).toBe(false);
      });
    });
  });

  describe('Request ID Generation', () => {
    it('should generate unique request IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        ids.add(generateRequestId());
      }
      expect(ids.size).toBe(1000); // All IDs should be unique
    });

    it('should generate IDs with expected format', () => {
      const id = generateRequestId();
      expect(id).toMatch(/^\d+-[a-z0-9]{9}$/);
    });
  });

  describe('Context and Hints', () => {
    it('should support tracing context', () => {
      const message = createRequestMessage('Service', 'method', {}, {
        context: {
          traceId: 'trace-123',
          spanId: 'span-456',
          userId: 'user-789',
          tenantId: 'tenant-abc',
          metadata: { custom: 'value' }
        }
      });

      expect(message.context).toBeDefined();
      expect(message.context!.traceId).toBe('trace-123');
      expect(message.context!.spanId).toBe('span-456');
      expect(message.context!.userId).toBe('user-789');
      expect(message.context!.tenantId).toBe('tenant-abc');
      expect(message.context!.metadata).toEqual({ custom: 'value' });
    });

    it('should support cache hints', () => {
      const message = createRequestMessage('Service', 'method', {}, {
        hints: {
          cache: {
            maxAge: 60000,
            staleWhileRevalidate: 120000,
            tags: ['tag1', 'tag2']
          }
        }
      });

      expect(message.hints).toBeDefined();
      expect(message.hints!.cache).toEqual({
        maxAge: 60000,
        staleWhileRevalidate: 120000,
        tags: ['tag1', 'tag2']
      });
    });

    it('should support retry hints', () => {
      const message = createRequestMessage('Service', 'method', {}, {
        hints: {
          retry: {
            attempts: 3,
            backoff: 'exponential',
            maxDelay: 10000,
            initialDelay: 1000
          }
        }
      });

      expect(message.hints).toBeDefined();
      expect(message.hints!.retry).toEqual({
        attempts: 3,
        backoff: 'exponential',
        maxDelay: 10000,
        initialDelay: 1000
      });
    });

    it('should support response metrics', () => {
      const response = createSuccessResponse('req-123', { data: 'test' }, {
        metrics: {
          serverTime: 150,
          dbQueries: 5,
          cacheHit: true,
          custom: { additionalMetric: 123 }
        }
      });

      expect(response.hints!.metrics).toEqual({
        serverTime: 150,
        dbQueries: 5,
        cacheHit: true,
        custom: { additionalMetric: 123 }
      });
    });

    it('should support rate limiting info', () => {
      const response = createSuccessResponse('req-123', { data: 'test' }, {
        rateLimit: {
          remaining: 95,
          limit: 100,
          resetAt: Date.now() + 60000
        }
      });

      expect(response.hints!.rateLimit).toBeDefined();
      expect(response.hints!.rateLimit!.remaining).toBe(95);
      expect(response.hints!.rateLimit!.limit).toBe(100);
      expect(response.hints!.rateLimit!.resetAt).toBeGreaterThan(Date.now());
    });
  });

  describe('Batch Operations', () => {
    it('should create batch request with options', () => {
      const batch: HttpBatchRequest = {
        id: 'batch-123',
        version: '2.0',
        timestamp: Date.now(),
        requests: [
          { id: 'req-1', service: 'Service1', method: 'method1', input: {} },
          { id: 'req-2', service: 'Service2', method: 'method2', input: {} }
        ],
        options: {
          parallel: true,
          stopOnError: false,
          maxConcurrency: 5
        }
      };

      expect(batch.options).toBeDefined();
      expect(batch.options!.parallel).toBe(true);
      expect(batch.options!.stopOnError).toBe(false);
      expect(batch.options!.maxConcurrency).toBe(5);
    });

    it('should create batch response with metrics', () => {
      const batch: HttpBatchResponse = {
        id: 'batch-123',
        version: '2.0',
        timestamp: Date.now(),
        responses: [
          { id: 'req-1', success: true, data: { result: 'ok' } },
          { id: 'req-2', success: false, error: { code: 'ERROR', message: 'Failed' } }
        ],
        hints: {
          totalTime: 250,
          successCount: 1,
          failureCount: 1
        }
      };

      expect(batch.hints).toBeDefined();
      expect(batch.hints!.totalTime).toBe(250);
      expect(batch.hints!.successCount).toBe(1);
      expect(batch.hints!.failureCount).toBe(1);
    });
  });
});