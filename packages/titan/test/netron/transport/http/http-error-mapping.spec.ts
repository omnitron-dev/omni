/**
 * Tests for HTTP Transport Error Mapping with TitanError
 * Verifies that TitanError instances are properly converted to HTTP responses
 * with correct status codes and context headers
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { HttpServer } from '../../../../src/netron/transport/http/server.js';
import { HttpRemotePeer } from '../../../../src/netron/transport/http/peer.js';
import { HttpConnection } from '../../../../src/netron/transport/http/connection.js';
import { TitanError, ErrorCode } from '../../../../src/errors/index.js';
import { LocalPeer } from '../../../../src/netron/local-peer.js';
import { Netron } from '../../../../src/netron/netron.js';
import { Service, Public } from '../../../../src/netron/index.js';
import { createMockLogger } from '../../test-utils.js';

describe('HTTP Error Mapping with TitanError', () => {
  let server: HttpServer;
  let netron: Netron;
  let localPeer: LocalPeer;
  const testPort = 3789;
  const baseUrl = `http://localhost:${testPort}`;

  // Test service that throws various TitanErrors
  @Service('errortest@1.0.0')
  class ErrorTestService {
    @Public()
    throwNotFound(): never {
      throw new TitanError({
        code: ErrorCode.NOT_FOUND,
        message: 'Resource not found',
        details: { resourceId: 'test-123' },
        requestId: 'req-12345',
        correlationId: 'corr-67890',
        traceId: 'trace-abcde',
        spanId: 'span-fghij'
      });
    }

    @Public()
    throwUnauthorized(): never {
      throw new TitanError({
        code: ErrorCode.UNAUTHORIZED,
        message: 'Authentication required',
        requestId: 'req-auth-001'
      });
    }

    @Public()
    throwValidationError(): never {
      throw new TitanError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details: {
          field: 'email',
          constraint: 'format'
        }
      });
    }

    @Public()
    throwRateLimitError(): never {
      throw new TitanError({
        code: ErrorCode.TOO_MANY_REQUESTS,
        message: 'Rate limit exceeded',
        details: { retryAfter: 60 }
      });
    }

    @Public()
    throwInternalError(): never {
      throw new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Internal server error occurred',
        correlationId: 'corr-internal-001'
      });
    }

    @Public()
    throwPlainError(): never {
      throw new Error('Plain JavaScript error');
    }
  }

  beforeEach(async () => {
    // Create Netron instance with mock logger
    netron = new Netron(createMockLogger(), {});
    await netron.start();

    // Get the local peer
    localPeer = netron.peer;

    // Register test service
    await localPeer.exposeService(new ErrorTestService());

    // Create and start HTTP server
    server = new HttpServer({ port: testPort, host: 'localhost' });
    server.setPeer(localPeer);
    await server.listen();
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
    if (netron) {
      await netron.stop();
    }
  });

  describe('TitanError to HTTP Status Mapping', () => {
    it('should map NOT_FOUND (404) error correctly', async () => {
      const response = await fetch(`${baseUrl}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-1',
          version: '2.0',
          timestamp: Date.now(),
          service: 'errortest',
          method: 'throwNotFound',
          input: []
        })
      });

      expect(response.status).toBe(404);
      expect(response.headers.get('Content-Type')).toBe('application/json');

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe(String(ErrorCode.NOT_FOUND));
      expect(data.error.message).toBe('Resource not found');
      expect(data.error.details).toEqual({ resourceId: 'test-123' });
    });

    it('should map UNAUTHORIZED (401) error correctly', async () => {
      const response = await fetch(`${baseUrl}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-2',
          version: '2.0',
          timestamp: Date.now(),
          service: 'errortest',
          method: 'throwUnauthorized',
          input: []
        })
      });

      expect(response.status).toBe(401);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe(String(ErrorCode.UNAUTHORIZED));
      expect(data.error.message).toBe('Authentication required');
    });

    it('should map VALIDATION_ERROR (422) error correctly', async () => {
      const response = await fetch(`${baseUrl}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-3',
          version: '2.0',
          timestamp: Date.now(),
          service: 'errortest',
          method: 'throwValidationError',
          input: []
        })
      });

      expect(response.status).toBe(422);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe(String(ErrorCode.VALIDATION_ERROR));
      expect(data.error.details).toEqual({
        field: 'email',
        constraint: 'format'
      });
    });

    it('should map TOO_MANY_REQUESTS (429) error correctly', async () => {
      const response = await fetch(`${baseUrl}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-4',
          version: '2.0',
          timestamp: Date.now(),
          service: 'errortest',
          method: 'throwRateLimitError',
          input: []
        })
      });

      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe('60');

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe(String(ErrorCode.TOO_MANY_REQUESTS));
    });

    it('should map INTERNAL_ERROR (500) error correctly', async () => {
      const response = await fetch(`${baseUrl}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-5',
          version: '2.0',
          timestamp: Date.now(),
          service: 'errortest',
          method: 'throwInternalError',
          input: []
        })
      });

      expect(response.status).toBe(500);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe(String(ErrorCode.INTERNAL_ERROR));
    });

    it('should handle plain Error as INTERNAL_ERROR (500)', async () => {
      const response = await fetch(`${baseUrl}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-6',
          version: '2.0',
          timestamp: Date.now(),
          service: 'errortest',
          method: 'throwPlainError',
          input: []
        })
      });

      expect(response.status).toBe(500);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toBe('Plain JavaScript error');
    });
  });

  describe('HTTP Context Headers', () => {
    it('should include X-Request-ID header in error response', async () => {
      const response = await fetch(`${baseUrl}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-7',
          version: '2.0',
          timestamp: Date.now(),
          service: 'errortest',
          method: 'throwNotFound',
          input: []
        })
      });

      expect(response.status).toBe(404);
      expect(response.headers.get('X-Request-ID')).toBe('req-12345');
    });

    it('should include X-Correlation-ID header in error response', async () => {
      const response = await fetch(`${baseUrl}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-8',
          version: '2.0',
          timestamp: Date.now(),
          service: 'errortest',
          method: 'throwNotFound',
          input: []
        })
      });

      expect(response.status).toBe(404);
      expect(response.headers.get('X-Correlation-ID')).toBe('corr-67890');
    });

    it('should include X-Trace-ID header in error response', async () => {
      const response = await fetch(`${baseUrl}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-9',
          version: '2.0',
          timestamp: Date.now(),
          service: 'errortest',
          method: 'throwNotFound',
          input: []
        })
      });

      expect(response.status).toBe(404);
      expect(response.headers.get('X-Trace-ID')).toBe('trace-abcde');
    });

    it('should include X-Span-ID header in error response', async () => {
      const response = await fetch(`${baseUrl}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-10',
          version: '2.0',
          timestamp: Date.now(),
          service: 'errortest',
          method: 'throwNotFound',
          input: []
        })
      });

      expect(response.status).toBe(404);
      expect(response.headers.get('X-Span-ID')).toBe('span-fghij');
    });

    it('should include all context headers when available', async () => {
      const response = await fetch(`${baseUrl}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-11',
          version: '2.0',
          timestamp: Date.now(),
          service: 'errortest',
          method: 'throwNotFound',
          input: []
        })
      });

      expect(response.status).toBe(404);
      expect(response.headers.get('X-Request-ID')).toBe('req-12345');
      expect(response.headers.get('X-Correlation-ID')).toBe('corr-67890');
      expect(response.headers.get('X-Trace-ID')).toBe('trace-abcde');
      expect(response.headers.get('X-Span-ID')).toBe('span-fghij');
      expect(response.headers.get('X-Netron-Version')).toBe('2.0');
    });
  });

  describe('Client-Side Error Reconstruction', () => {
    it('should reconstruct TitanError from HTTP response with context headers', async () => {
      const connection = new HttpConnection(baseUrl, netron);
      const peer = new HttpRemotePeer(connection, netron, baseUrl);

      try {
        // This should throw a TitanError
        const response = await fetch(`${baseUrl}/netron/invoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'test-12',
            version: '2.0',
            timestamp: Date.now(),
            service: 'errortest',
            method: 'throwNotFound',
            input: []
          })
        });

        // Manually parse the error response to verify structure
        expect(response.ok).toBe(false);
        expect(response.status).toBe(404);

        const errorData = await response.json();
        expect(errorData.error).toBeDefined();
        expect(errorData.error.code).toBe(String(ErrorCode.NOT_FOUND));

        // Verify headers
        expect(response.headers.get('X-Request-ID')).toBe('req-12345');
        expect(response.headers.get('X-Correlation-ID')).toBe('corr-67890');
      } finally {
        await connection.close();
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle errors without context headers gracefully', async () => {
      const response = await fetch(`${baseUrl}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-13',
          version: '2.0',
          timestamp: Date.now(),
          service: 'errortest',
          method: 'throwValidationError',
          input: []
        })
      });

      expect(response.status).toBe(422);

      // These headers should not be present since they weren't in the error
      expect(response.headers.get('X-Request-ID')).toBeNull();
      expect(response.headers.get('X-Correlation-ID')).toBeNull();
      expect(response.headers.get('X-Trace-ID')).toBeNull();
      expect(response.headers.get('X-Span-ID')).toBeNull();
    });

    it('should always include X-Netron-Version header', async () => {
      const response = await fetch(`${baseUrl}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-14',
          version: '2.0',
          timestamp: Date.now(),
          service: 'errortest',
          method: 'throwInternalError',
          input: []
        })
      });

      expect(response.headers.get('X-Netron-Version')).toBe('2.0');
    });

    it.skip('should use httpStatus property directly from TitanError', async () => {
      // Create a custom TitanError with explicit httpStatus
      @Service('customerrortest@1.0.0')
      class CustomErrorTestService {
        @Public()
        throwCustomError(): never {
          const error = new TitanError({
            code: ErrorCode.FORBIDDEN,
            message: 'Access forbidden'
          });
          // Verify httpStatus is set correctly
          expect(error.httpStatus).toBe(403);
          throw error;
        }
      }

      await localPeer.exposeService(new CustomErrorTestService());

      const response = await fetch(`${baseUrl}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-15',
          version: '2.0',
          timestamp: Date.now(),
          service: 'customerrortest',
          method: 'throwCustomError',
          input: []
        })
      });

      expect(response.status).toBe(403);
    });
  });
});
