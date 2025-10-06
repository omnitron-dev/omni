/**
 * Tests for HTTP Middleware Adapter
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  HttpMiddlewareAdapter,
  HttpBuiltinMiddleware,
  type HttpMiddlewareContext
} from '../../../src/netron/middleware/index.js';
import { TitanError, ErrorCode } from '../../../src/errors/index.js';
import type { IncomingMessage, ServerResponse } from 'http';

describe('HttpMiddlewareAdapter', () => {
  let adapter: HttpMiddlewareAdapter;
  let mockRequest: Partial<IncomingMessage>;
  let mockResponse: Partial<ServerResponse>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    adapter = new HttpMiddlewareAdapter();

    mockRequest = {
      method: 'POST',
      url: '/api/users/create',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer token123',
        'x-request-id': 'req-123'
      },
      socket: {
        remoteAddress: '127.0.0.1'
      } as any
    };

    mockResponse = {
      statusCode: 200,
      setHeader: jest.fn(),
      writeHead: jest.fn(),
      end: jest.fn()
    };

    mockNext = jest.fn().mockResolvedValue(undefined);
  });

  describe('Context Transformation', () => {
    it('should transform HTTP context to Netron context', () => {
      const httpCtx: HttpMiddlewareContext = {
        peer: {} as any,
        request: mockRequest as IncomingMessage,
        response: mockResponse as ServerResponse,
        route: '/api/users/create',
        params: { id: '123' },
        query: { filter: 'active' },
        body: { name: 'John' },
        metadata: new Map(),
        timing: {
          start: Date.now(),
          middlewareTimes: new Map()
        }
      };

      const netronCtx = adapter.toNetronContext(httpCtx);

      expect(netronCtx).toBeDefined();
      expect(netronCtx.metadata.get('http-method')).toBe('POST');
      expect(netronCtx.metadata.get('http-url')).toBe('/api/users/create');
      expect(netronCtx.metadata.get('authorization')).toBe('Bearer token123');
      expect(netronCtx.metadata.get('request-id')).toBe('req-123');
      expect(netronCtx.input).toEqual({ name: 'John' });
    });

    it('should apply Netron context changes back to HTTP context', () => {
      const httpCtx: HttpMiddlewareContext = {
        peer: {} as any,
        request: mockRequest as IncomingMessage,
        response: mockResponse as ServerResponse,
        route: '/api/users/create',
        metadata: new Map(),
        timing: {
          start: Date.now(),
          middlewareTimes: new Map()
        }
      };

      const netronCtx = adapter.toNetronContext(httpCtx);

      // Modify Netron context
      netronCtx.result = { success: true, userId: '456' };
      netronCtx.metadata.set('cache-control', 'no-cache');
      netronCtx.error = new TitanError({ code: ErrorCode.BAD_REQUEST });

      adapter.fromNetronContext(netronCtx, httpCtx);

      expect(httpCtx.body).toEqual({ success: true, userId: '456' });
      expect(httpCtx.response.statusCode).toBe(400);
      expect(httpCtx.response.setHeader).toHaveBeenCalledWith('cache-control', 'no-cache');
    });
  });

  describe('Transport Middleware', () => {
    it('should provide HTTP-specific middleware', () => {
      const middleware = adapter.getTransportMiddleware();

      expect(middleware).toBeInstanceOf(Array);
      expect(middleware.length).toBeGreaterThan(0);
    });

    it('should include CORS middleware when configured', () => {
      const adapterWithCors = new HttpMiddlewareAdapter({
        cors: {
          origin: '*',
          methods: ['GET', 'POST']
        }
      });

      const middleware = adapterWithCors.getTransportMiddleware();

      // Should have at least one middleware
      expect(middleware.length).toBeGreaterThan(0);
    });
  });
});

describe('HttpBuiltinMiddleware', () => {
  let mockContext: HttpMiddlewareContext;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockContext = {
      peer: {} as any,
      request: {
        method: 'POST',
        url: '/api/test',
        headers: {}
      } as IncomingMessage,
      response: {
        statusCode: 200,
        setHeader: jest.fn(),
        writeHead: jest.fn(),
        end: jest.fn()
      } as any,
      route: '/api/test',
      metadata: new Map(),
      timing: {
        start: Date.now(),
        middlewareTimes: new Map()
      }
    };

    mockNext = jest.fn().mockResolvedValue(undefined);
  });

  describe('corsMiddleware', () => {
    it('should handle preflight requests', async () => {
      const middleware = HttpBuiltinMiddleware.corsMiddleware({
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        headers: ['Content-Type', 'Authorization'],
        credentials: true,
        maxAge: 86400
      });

      mockContext.request.method = 'OPTIONS';
      mockContext.request.headers['origin'] = 'https://example.com';
      mockContext.request.headers['access-control-request-method'] = 'POST';

      await middleware(mockContext, mockNext);

      expect(mockContext.response.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        '*'
      );
      expect(mockContext.response.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, DELETE'
      );
      expect(mockContext.response.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization'
      );
      expect(mockContext.response.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true'
      );
      expect(mockContext.response.setHeader).toHaveBeenCalledWith(
        'Access-Control-Max-Age',
        '86400'
      );
      expect(mockContext.response.statusCode).toBe(204);
      expect(mockContext.response.end).toHaveBeenCalled();
      expect(mockContext.skipRemaining).toBe(true);
    });

    it('should add CORS headers to regular requests', async () => {
      const middleware = HttpBuiltinMiddleware.corsMiddleware({
        origin: 'https://trusted.com'
      });

      mockContext.request.headers['origin'] = 'https://trusted.com';

      await middleware(mockContext, mockNext);

      expect(mockContext.response.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://trusted.com'
      );
      expect(mockNext).toHaveBeenCalled();
    });

    it('should validate origin against allowed list', async () => {
      const middleware = HttpBuiltinMiddleware.corsMiddleware({
        origin: ['https://app1.com', 'https://app2.com']
      });

      mockContext.request.headers['origin'] = 'https://app1.com';

      await middleware(mockContext, mockNext);

      expect(mockContext.response.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://app1.com'
      );

      // Test with disallowed origin
      mockContext.request.headers['origin'] = 'https://evil.com';
      mockContext.response.setHeader = jest.fn();

      await middleware(mockContext, mockNext);

      expect(mockContext.response.setHeader).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://evil.com'
      );
    });

    it('should use function to determine origin', async () => {
      const middleware = HttpBuiltinMiddleware.corsMiddleware({
        origin: (origin) => origin?.endsWith('.trusted.com') || false
      });

      mockContext.request.headers['origin'] = 'https://app.trusted.com';

      await middleware(mockContext, mockNext);

      expect(mockContext.response.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://app.trusted.com'
      );
    });
  });

  describe('bodyParserMiddleware', () => {
    it('should parse JSON body', async () => {
      const middleware = HttpBuiltinMiddleware.bodyParserMiddleware({
        maxSize: 1024 * 1024 // 1MB
      });

      const chunks: any[] = [];
      mockContext.request = {
        ...mockContext.request,
        headers: {
          'content-type': 'application/json'
        },
        on: jest.fn((event, handler) => {
          if (event === 'data') {
            // Simulate data chunks
            handler(Buffer.from('{"name":'));
            handler(Buffer.from('"John"}'));
          }
          if (event === 'end') {
            handler();
          }
        })
      } as any;

      await middleware(mockContext, mockNext);

      expect(mockContext.body).toEqual({ name: 'John' });
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle body parsing errors', async () => {
      const middleware = HttpBuiltinMiddleware.bodyParserMiddleware({});

      mockContext.request = {
        ...mockContext.request,
        headers: {
          'content-type': 'application/json'
        },
        on: jest.fn((event, handler) => {
          if (event === 'data') {
            handler(Buffer.from('invalid json'));
          }
          if (event === 'end') {
            handler();
          }
        })
      } as any;

      await expect(middleware(mockContext, mockNext)).rejects.toThrow(TitanError);
      await expect(middleware(mockContext, mockNext)).rejects.toMatchObject({
        code: ErrorCode.BAD_REQUEST
      });

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject oversized bodies', async () => {
      const middleware = HttpBuiltinMiddleware.bodyParserMiddleware({
        maxSize: 10 // Very small limit
      });

      mockContext.request = {
        ...mockContext.request,
        headers: {
          'content-type': 'application/json'
        },
        on: jest.fn((event, handler) => {
          if (event === 'data') {
            handler(Buffer.from('{"name":"Very long name that exceeds limit"}'));
          }
          if (event === 'end') {
            handler();
          }
        })
      } as any;

      await expect(middleware(mockContext, mockNext)).rejects.toThrow(TitanError);
      await expect(middleware(mockContext, mockNext)).rejects.toMatchObject({
        code: ErrorCode.PAYLOAD_TOO_LARGE
      });
    });
  });

  describe('compressionMiddleware', () => {
    it('should compress response with gzip', async () => {
      const middleware = HttpBuiltinMiddleware.compressionMiddleware({
        threshold: 10
      });

      mockContext.request.headers['accept-encoding'] = 'gzip, deflate';
      mockContext.body = 'x'.repeat(100); // Large response

      await middleware(mockContext, mockNext);

      // Verify compression was applied
      expect(mockContext.response.setHeader).toHaveBeenCalledWith(
        'Content-Encoding',
        'gzip'
      );
      expect(mockContext.body).toBeInstanceOf(Buffer);
      // Compressed size should be smaller than original
      expect((mockContext.body as Buffer).length).toBeLessThan(100);
    });

    it('should not compress small responses', async () => {
      const middleware = HttpBuiltinMiddleware.compressionMiddleware({
        threshold: 100
      });

      mockContext.request.headers['accept-encoding'] = 'gzip';
      mockContext.body = 'small';

      await middleware(mockContext, mockNext);

      expect(mockContext.response.setHeader).not.toHaveBeenCalledWith(
        'Content-Encoding',
        expect.anything()
      );
      expect(mockContext.body).toBe('small');
    });

    it('should skip compression if not supported', async () => {
      const middleware = HttpBuiltinMiddleware.compressionMiddleware({});

      mockContext.request.headers['accept-encoding'] = 'br'; // Only Brotli
      mockContext.body = 'x'.repeat(100);

      await middleware(mockContext, mockNext);

      expect(mockContext.response.setHeader).not.toHaveBeenCalledWith(
        'Content-Encoding',
        expect.anything()
      );
      expect(mockContext.body).toBe('x'.repeat(100));
    });
  });

  describe('securityHeadersMiddleware', () => {
    it('should add security headers', async () => {
      const middleware = HttpBuiltinMiddleware.securityHeadersMiddleware({
        contentSecurityPolicy: "default-src 'self'",
        xFrameOptions: 'DENY',
        xContentTypeOptions: true,
        xXssProtection: true,
        strictTransportSecurity: {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true
        }
      });

      await middleware(mockContext, mockNext);

      expect(mockContext.response.setHeader).toHaveBeenCalledWith(
        'Content-Security-Policy',
        "default-src 'self'"
      );
      expect(mockContext.response.setHeader).toHaveBeenCalledWith(
        'X-Frame-Options',
        'DENY'
      );
      expect(mockContext.response.setHeader).toHaveBeenCalledWith(
        'X-Content-Type-Options',
        'nosniff'
      );
      expect(mockContext.response.setHeader).toHaveBeenCalledWith(
        'X-XSS-Protection',
        '1; mode=block'
      );
      expect(mockContext.response.setHeader).toHaveBeenCalledWith(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload'
      );

      expect(mockNext).toHaveBeenCalled();
    });

    it('should use default security headers', async () => {
      const middleware = HttpBuiltinMiddleware.securityHeadersMiddleware();

      await middleware(mockContext, mockNext);

      expect(mockContext.response.setHeader).toHaveBeenCalledWith(
        'X-Content-Type-Options',
        'nosniff'
      );
      expect(mockContext.response.setHeader).toHaveBeenCalledWith(
        'X-Frame-Options',
        'SAMEORIGIN'
      );
    });
  });

  describe('requestIdMiddleware', () => {
    it('should use existing request ID', async () => {
      const middleware = HttpBuiltinMiddleware.requestIdMiddleware();

      mockContext.request.headers['x-request-id'] = 'existing-id';

      await middleware(mockContext, mockNext);

      expect(mockContext.metadata.get('requestId')).toBe('existing-id');
      expect(mockContext.response.setHeader).toHaveBeenCalledWith(
        'X-Request-Id',
        'existing-id'
      );
      expect(mockNext).toHaveBeenCalled();
    });

    it('should generate new request ID', async () => {
      const middleware = HttpBuiltinMiddleware.requestIdMiddleware({
        header: 'X-Trace-Id'
      });

      await middleware(mockContext, mockNext);

      const requestId = mockContext.metadata.get('requestId');
      expect(requestId).toBeDefined();
      expect(typeof requestId).toBe('string');
      expect(mockContext.response.setHeader).toHaveBeenCalledWith(
        'X-Trace-Id',
        requestId
      );
    });
  });

  describe('requestLoggingMiddleware', () => {
    it('should log requests and responses', async () => {
      const logger = {
        info: jest.fn()
      };

      const middleware = HttpBuiltinMiddleware.requestLoggingMiddleware(logger);

      mockContext.request.headers['user-agent'] = 'TestAgent/1.0';
      mockContext.response.statusCode = 201;
      mockContext.body = { created: true };

      await middleware(mockContext, mockNext);

      expect(logger.info).toHaveBeenCalledTimes(2);

      // Request log
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: '/api/test',
          userAgent: 'TestAgent/1.0'
        }),
        'HTTP Request'
      );

      // Response log
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: '/api/test',
          statusCode: 201,
          duration: expect.any(Number)
        }),
        'HTTP Response'
      );
    });

    it('should log errors', async () => {
      const logger = {
        info: jest.fn(),
        error: jest.fn()
      };

      const middleware = HttpBuiltinMiddleware.requestLoggingMiddleware(logger);

      const error = new TitanError({ code: ErrorCode.INTERNAL_ERROR });
      mockNext.mockRejectedValue(error);

      await expect(middleware(mockContext, mockNext)).rejects.toThrow(error);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: '/api/test',
          error: error.message,
          code: error.code
        }),
        'HTTP Error'
      );
    });
  });
});