/**
 * Branch coverage tests for HTTP Middleware Adapter
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { IncomingMessage, ServerResponse } from 'http';
import {
  HttpMiddlewareAdapter,
  HttpBuiltinMiddleware,
  type HttpMiddlewareContext,
} from '../../../src/netron/middleware/index.js';

describe('HttpMiddlewareAdapter - Branch Coverage', () => {
  let adapter: HttpMiddlewareAdapter;
  let mockRequest: Partial<IncomingMessage>;
  let mockResponse: Partial<ServerResponse>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    adapter = new HttpMiddlewareAdapter();
    mockNext = jest.fn(async () => {});

    mockRequest = {
      method: 'GET',
      url: '/test',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer token123',
      },
    };

    mockResponse = {
      statusCode: 200,
      setHeader: jest.fn(),
      getHeader: jest.fn(),
      removeHeader: jest.fn(),
      end: jest.fn(),
    };
  });

  describe('toNetronContext - fallback branches', () => {
    it('should use empty object for peer when not provided', () => {
      const httpCtx = {
        request: mockRequest,
        response: mockResponse,
      };

      const netronCtx = adapter.toNetronContext(httpCtx);

      expect(netronCtx.peer).toEqual({});
    });

    it('should use provided peer when available', () => {
      const customPeer = { id: 'peer-123', address: '127.0.0.1' };
      const httpCtx = {
        peer: customPeer,
        request: mockRequest,
        response: mockResponse,
      };

      const netronCtx = adapter.toNetronContext(httpCtx);

      expect(netronCtx.peer).toBe(customPeer);
    });

    it('should create new Map for metadata when not provided', () => {
      const httpCtx = {
        request: mockRequest,
        response: mockResponse,
      };

      const netronCtx = adapter.toNetronContext(httpCtx);

      expect(netronCtx.metadata).toBeInstanceOf(Map);
    });

    it('should use provided metadata when available', () => {
      const customMetadata = new Map([['key', 'value']]);
      const httpCtx = {
        metadata: customMetadata,
        request: mockRequest,
        response: mockResponse,
      };

      const netronCtx = adapter.toNetronContext(httpCtx);

      expect(netronCtx.metadata).toBe(customMetadata);
      expect(netronCtx.metadata.get('key')).toBe('value');
    });

    it('should create timing object when not provided', () => {
      const httpCtx = {
        request: mockRequest,
        response: mockResponse,
      };

      const netronCtx = adapter.toNetronContext(httpCtx);

      expect(netronCtx.timing).toBeDefined();
      expect(netronCtx.timing.start).toBeGreaterThan(0);
      expect(netronCtx.timing.middlewareTimes).toBeInstanceOf(Map);
    });

    it('should use provided timing when available', () => {
      const customTiming = {
        start: 123456789,
        middlewareTimes: new Map([['middleware1', 100]]),
      };
      const httpCtx = {
        timing: customTiming,
        request: mockRequest,
        response: mockResponse,
      };

      const netronCtx = adapter.toNetronContext(httpCtx);

      expect(netronCtx.timing).toBe(customTiming);
      expect(netronCtx.timing.start).toBe(123456789);
    });

    it('should use route when available, fallback to request.url', () => {
      const httpCtxWithRoute = {
        route: '/api/users/:id',
        request: { ...mockRequest, url: '/api/users/123' },
        response: mockResponse,
      };

      const netronCtx = adapter.toNetronContext(httpCtxWithRoute);

      expect(netronCtx.metadata.get('http-url')).toBe('/api/users/:id');
    });

    it('should fallback to request.url when route not provided', () => {
      const httpCtx = {
        request: mockRequest,
        response: mockResponse,
      };

      const netronCtx = adapter.toNetronContext(httpCtx);

      expect(netronCtx.metadata.get('http-url')).toBe('/test');
    });

    it('should skip headers with falsy values', () => {
      const requestWithFalsyHeaders = {
        ...mockRequest,
        headers: {
          'content-type': 'application/json',
          'empty-header': '',
          'null-header': null as any,
          'undefined-header': undefined as any,
          authorization: 'Bearer token',
        },
      };

      const httpCtx = {
        request: requestWithFalsyHeaders,
        response: mockResponse,
      };

      const netronCtx = adapter.toNetronContext(httpCtx);

      // Only truthy headers should be set
      expect(netronCtx.metadata.get('content-type')).toBe('application/json');
      expect(netronCtx.metadata.get('authorization')).toBe('Bearer token');
      expect(netronCtx.metadata.has('empty-header')).toBe(false);
      expect(netronCtx.metadata.has('null-header')).toBe(false);
      expect(netronCtx.metadata.has('undefined-header')).toBe(false);
    });
  });

  describe('HttpBuiltinMiddleware - default options branches', () => {
    it('should use default options when cors called with no arguments', async () => {
      const middleware = HttpBuiltinMiddleware.cors();

      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: mockRequest as IncomingMessage,
        response: mockResponse as ServerResponse,
      };

      await middleware(ctx, mockNext);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    });

    it('should use empty object when compression called with undefined', async () => {
      const middleware = HttpBuiltinMiddleware.compression(undefined);

      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: {
          ...mockRequest,
          headers: { 'accept-encoding': 'gzip' },
        } as IncomingMessage,
        response: mockResponse as ServerResponse,
        body: 'x'.repeat(2000), // Above threshold
      };

      await middleware(ctx, mockNext);

      // Should compress
      expect(Buffer.isBuffer(ctx.body)).toBe(true);
    });
  });

  describe('corsMiddleware - origin function branches', () => {
    it('should use requestOrigin when function returns true and requestOrigin exists', async () => {
      const middleware = HttpBuiltinMiddleware.corsMiddleware({
        origin: (origin) => origin === 'https://example.com',
      });

      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: {
          ...mockRequest,
          headers: { origin: 'https://example.com' },
        } as IncomingMessage,
        response: mockResponse as ServerResponse,
      };

      await middleware(ctx, mockNext);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://example.com');
    });

    it('should use wildcard when function returns true but requestOrigin is undefined', async () => {
      const middleware = HttpBuiltinMiddleware.corsMiddleware({
        origin: () => true,
      });

      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: {
          ...mockRequest,
          headers: {},
        } as IncomingMessage,
        response: mockResponse as ServerResponse,
      };

      await middleware(ctx, mockNext);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    });

    it('should handle preflightContinue flag', async () => {
      const middleware = HttpBuiltinMiddleware.corsMiddleware({
        origin: '*',
        preflightContinue: true,
      });

      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: {
          ...mockRequest,
          method: 'OPTIONS',
        } as IncomingMessage,
        response: mockResponse as ServerResponse,
      };

      await middleware(ctx, mockNext);

      // Should not end response when preflightContinue is true
      expect(mockResponse.end).not.toHaveBeenCalled();
      expect(ctx.skipRemaining).toBeFalsy();
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('bodyParserMiddleware - content-type branches', () => {
    it('should handle missing content-type header', async () => {
      const middleware = HttpBuiltinMiddleware.bodyParserMiddleware();

      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: {
          ...mockRequest,
          headers: {},
          on: jest.fn((event, handler) => {
            if (event === 'end') {
              setTimeout(() => handler(), 0);
            }
          }),
        } as any,
        response: mockResponse as ServerResponse,
      };

      await middleware(ctx, mockNext);

      // Should return buffer for unknown content-type
      expect(Buffer.isBuffer(ctx.body)).toBe(true);
    });
  });

  describe('compressionMiddleware - body type branches', () => {
    it('should return early when body is null', async () => {
      const middleware = HttpBuiltinMiddleware.compressionMiddleware();

      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: {
          ...mockRequest,
          headers: { 'accept-encoding': 'gzip' },
        } as IncomingMessage,
        response: mockResponse as ServerResponse,
        body: null,
      };

      await middleware(ctx, mockNext);

      expect(ctx.body).toBeNull();
      expect(mockResponse.setHeader).not.toHaveBeenCalledWith('Content-Encoding', expect.anything());
    });

    it('should return early when body is not compressible (boolean)', async () => {
      const middleware = HttpBuiltinMiddleware.compressionMiddleware();

      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: {
          ...mockRequest,
          headers: { 'accept-encoding': 'gzip' },
        } as IncomingMessage,
        response: mockResponse as ServerResponse,
        body: true as any,
      };

      await middleware(ctx, mockNext);

      expect(ctx.body).toBe(true);
      expect(mockResponse.setHeader).not.toHaveBeenCalledWith('Content-Encoding', expect.anything());
    });

    it('should use empty string when accept-encoding header is missing', async () => {
      const middleware = HttpBuiltinMiddleware.compressionMiddleware({ threshold: 10 });

      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: {
          ...mockRequest,
          headers: {},
        } as IncomingMessage,
        response: mockResponse as ServerResponse,
        body: 'x'.repeat(2000),
      };

      await middleware(ctx, mockNext);

      // Should not compress when accept-encoding is missing
      expect(typeof ctx.body).toBe('string');
      expect(mockResponse.setHeader).not.toHaveBeenCalledWith('Content-Encoding', expect.anything());
    });
  });

  describe('securityHeadersMiddleware - conditional headers', () => {
    it('should set X-Content-Type-Options by default', async () => {
      const middleware = HttpBuiltinMiddleware.securityHeadersMiddleware({});

      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: mockRequest as IncomingMessage,
        response: mockResponse as ServerResponse,
      };

      await middleware(ctx, mockNext);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    });

    it('should not set X-Content-Type-Options when explicitly disabled', async () => {
      const middleware = HttpBuiltinMiddleware.securityHeadersMiddleware({
        xContentTypeOptions: false,
      });

      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: mockRequest as IncomingMessage,
        response: mockResponse as ServerResponse,
      };

      await middleware(ctx, mockNext);

      expect(mockResponse.setHeader).not.toHaveBeenCalledWith('X-Content-Type-Options', expect.anything());
    });

    it('should set X-XSS-Protection by default', async () => {
      const middleware = HttpBuiltinMiddleware.securityHeadersMiddleware({});

      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: mockRequest as IncomingMessage,
        response: mockResponse as ServerResponse,
      };

      await middleware(ctx, mockNext);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-XSS-Protection', '1; mode=block');
    });

    it('should not set X-XSS-Protection when explicitly disabled', async () => {
      const middleware = HttpBuiltinMiddleware.securityHeadersMiddleware({
        xXssProtection: false,
      });

      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: mockRequest as IncomingMessage,
        response: mockResponse as ServerResponse,
      };

      await middleware(ctx, mockNext);

      expect(mockResponse.setHeader).not.toHaveBeenCalledWith('X-XSS-Protection', expect.anything());
    });

    it('should set Strict-Transport-Security with includeSubDomains', async () => {
      const middleware = HttpBuiltinMiddleware.securityHeadersMiddleware({
        strictTransportSecurity: {
          maxAge: 31536000,
          includeSubDomains: true,
        },
      });

      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: mockRequest as IncomingMessage,
        response: mockResponse as ServerResponse,
      };

      await middleware(ctx, mockNext);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains'
      );
    });

    it('should set Strict-Transport-Security with preload', async () => {
      const middleware = HttpBuiltinMiddleware.securityHeadersMiddleware({
        strictTransportSecurity: {
          maxAge: 31536000,
          preload: true,
        },
      });

      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: mockRequest as IncomingMessage,
        response: mockResponse as ServerResponse,
      };

      await middleware(ctx, mockNext);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Strict-Transport-Security', 'max-age=31536000; preload');
    });

    it('should set Strict-Transport-Security with both includeSubDomains and preload', async () => {
      const middleware = HttpBuiltinMiddleware.securityHeadersMiddleware({
        strictTransportSecurity: {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true,
        },
      });

      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: mockRequest as IncomingMessage,
        response: mockResponse as ServerResponse,
      };

      await middleware(ctx, mockNext);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload'
      );
    });

    it('should not set Strict-Transport-Security when not provided', async () => {
      const middleware = HttpBuiltinMiddleware.securityHeadersMiddleware({});

      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: mockRequest as IncomingMessage,
        response: mockResponse as ServerResponse,
      };

      await middleware(ctx, mockNext);

      expect(mockResponse.setHeader).not.toHaveBeenCalledWith('Strict-Transport-Security', expect.anything());
    });
  });
});
