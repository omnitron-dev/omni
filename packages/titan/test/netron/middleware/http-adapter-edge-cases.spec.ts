/**
 * Edge Case Tests for HTTP Middleware Adapter
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  HttpMiddlewareAdapter,
  HttpBuiltinMiddleware,
  type HttpMiddlewareContext
} from '../../../src/netron/middleware/index.js';
import { TitanError, ErrorCode } from '../../../src/errors/index.js';
import type { IncomingMessage, ServerResponse } from 'http';
import { EventEmitter } from 'events';

describe('HttpMiddlewareAdapter - Edge Cases', () => {
  let adapter: HttpMiddlewareAdapter;
  let mockRequest: Partial<IncomingMessage>;
  let mockResponse: Partial<ServerResponse>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    adapter = new HttpMiddlewareAdapter();

    mockRequest = {
      method: 'POST',
      url: '/api/test',
      headers: {
        'content-type': 'application/json'
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

  describe('fromNetronContext - non-TitanError', () => {
    it('should set status 500 for non-TitanError', () => {
      const netronCtx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: mockRequest as IncomingMessage,
        response: mockResponse as ServerResponse,
        error: new Error('Regular error')
      };

      const httpCtx = {};

      adapter.fromNetronContext(netronCtx, httpCtx);

      expect(mockResponse.statusCode).toBe(500);
    });

    it('should set status from TitanError.httpStatus', () => {
      const titanError = new TitanError({
        code: ErrorCode.BAD_REQUEST,
        message: 'Bad request'
      });

      const netronCtx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: mockRequest as IncomingMessage,
        response: mockResponse as ServerResponse,
        error: titanError
      };

      const httpCtx = {};

      adapter.fromNetronContext(netronCtx, httpCtx);

      expect(mockResponse.statusCode).toBe(400);
    });

    it('should not set status when no error', () => {
      const netronCtx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: mockRequest as IncomingMessage,
        response: mockResponse as ServerResponse
      };

      const httpCtx = {};

      adapter.fromNetronContext(netronCtx, httpCtx);

      expect(mockResponse.statusCode).toBe(200);
    });
  });

  describe('HttpBuiltinMiddleware - alias methods', () => {
    it('should use cors alias', async () => {
      const middleware = HttpBuiltinMiddleware.cors({
        origin: '*'
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
          headers: { origin: 'http://example.com' }
        } as IncomingMessage,
        response: mockResponse as ServerResponse
      };

      await middleware(ctx, mockNext);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    });

    it('should use compression alias with boolean true', async () => {
      const middleware = HttpBuiltinMiddleware.compression(true);

      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: {
          ...mockRequest,
          headers: { 'accept-encoding': 'gzip' }
        } as IncomingMessage,
        response: mockResponse as ServerResponse,
        body: 'x'.repeat(2000) // Large enough to compress
      };

      await middleware(ctx, mockNext);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Encoding', 'gzip');
    });

    it('should use compression alias with boolean false', async () => {
      const middleware = HttpBuiltinMiddleware.compression(false);

      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: {
          ...mockRequest,
          headers: { 'accept-encoding': 'gzip' }
        } as IncomingMessage,
        response: mockResponse as ServerResponse,
        body: 'x'.repeat(2000)
      };

      await middleware(ctx, mockNext);

      // Should not compress
      expect(mockResponse.setHeader).not.toHaveBeenCalledWith('Content-Encoding', 'gzip');
    });

    it('should use compression alias with options object', async () => {
      const middleware = HttpBuiltinMiddleware.compression({
        threshold: 100,
        level: 9
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
          headers: { 'accept-encoding': 'gzip' }
        } as IncomingMessage,
        response: mockResponse as ServerResponse,
        body: 'x'.repeat(200)
      };

      await middleware(ctx, mockNext);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Encoding', 'gzip');
    });
  });

  describe('corsMiddleware - origin as function returning string', () => {
    it('should use function result as allowed origin', async () => {
      const middleware = HttpBuiltinMiddleware.corsMiddleware({
        origin: (requestOrigin) => {
          if (requestOrigin === 'http://trusted.com') {
            return 'http://trusted.com';
          }
          return false;
        }
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
          headers: { origin: 'http://trusted.com' }
        } as IncomingMessage,
        response: mockResponse as ServerResponse
      };

      await middleware(ctx, mockNext);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://trusted.com');
    });

    it('should reject when function returns false', async () => {
      const middleware = HttpBuiltinMiddleware.corsMiddleware({
        origin: () => false
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
          headers: { origin: 'http://untrusted.com' }
        } as IncomingMessage,
        response: mockResponse as ServerResponse
      };

      await middleware(ctx, mockNext);

      expect(mockResponse.setHeader).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        expect.anything()
      );
    });
  });

  describe('bodyParserMiddleware - body already defined', () => {
    it('should skip parsing when body is already defined', async () => {
      const middleware = HttpBuiltinMiddleware.bodyParserMiddleware();

      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: mockRequest as IncomingMessage,
        response: mockResponse as ServerResponse,
        body: { already: 'parsed' }
      };

      await middleware(ctx, mockNext);

      expect(ctx.body).toEqual({ already: 'parsed' });
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('bodyParserMiddleware - content-type variants', () => {
    it('should parse text/plain content', async () => {
      const middleware = HttpBuiltinMiddleware.bodyParserMiddleware();

      const mockStream = new EventEmitter() as any;
      mockStream.headers = { 'content-type': 'text/plain' };
      mockStream.on = jest.fn((event, handler) => {
        if (event === 'data') {
          setTimeout(() => handler(Buffer.from('plain text')), 0);
        } else if (event === 'end') {
          setTimeout(() => handler(), 10);
        }
        return mockStream;
      });

      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: mockStream as IncomingMessage,
        response: mockResponse as ServerResponse
      };

      await middleware(ctx, mockNext);

      expect(ctx.body).toBe('plain text');
    });

    it('should return buffer for unknown content-type', async () => {
      const middleware = HttpBuiltinMiddleware.bodyParserMiddleware();

      const mockStream = new EventEmitter() as any;
      mockStream.headers = { 'content-type': 'application/octet-stream' };
      mockStream.on = jest.fn((event, handler) => {
        if (event === 'data') {
          setTimeout(() => handler(Buffer.from([0x01, 0x02, 0x03])), 0);
        } else if (event === 'end') {
          setTimeout(() => handler(), 10);
        }
        return mockStream;
      });

      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: mockStream as IncomingMessage,
        response: mockResponse as ServerResponse
      };

      await middleware(ctx, mockNext);

      expect(Buffer.isBuffer(ctx.body)).toBe(true);
      expect(ctx.body).toEqual(Buffer.from([0x01, 0x02, 0x03]));
    });
  });

  describe('compressionMiddleware - body type variants', () => {
    it('should compress Buffer body', async () => {
      const middleware = HttpBuiltinMiddleware.compressionMiddleware({
        threshold: 10
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
          headers: { 'accept-encoding': 'gzip' }
        } as IncomingMessage,
        response: mockResponse as ServerResponse,
        body: Buffer.from('x'.repeat(100))
      };

      await middleware(ctx, mockNext);

      expect(Buffer.isBuffer(ctx.body)).toBe(true);
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Encoding', 'gzip');
    });

    it('should compress object body', async () => {
      const middleware = HttpBuiltinMiddleware.compressionMiddleware({
        threshold: 10
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
          headers: { 'accept-encoding': 'gzip' }
        } as IncomingMessage,
        response: mockResponse as ServerResponse,
        body: { data: 'x'.repeat(100) }
      };

      await middleware(ctx, mockNext);

      expect(Buffer.isBuffer(ctx.body)).toBe(true);
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Encoding', 'gzip');
    });

    it('should use deflate encoding when gzip not accepted', async () => {
      const middleware = HttpBuiltinMiddleware.compressionMiddleware({
        threshold: 10
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
          headers: { 'accept-encoding': 'deflate' }
        } as IncomingMessage,
        response: mockResponse as ServerResponse,
        body: 'x'.repeat(100)
      };

      await middleware(ctx, mockNext);

      expect(Buffer.isBuffer(ctx.body)).toBe(true);
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Encoding', 'deflate');
    });

    it('should not compress when accept-encoding does not include gzip or deflate', async () => {
      const middleware = HttpBuiltinMiddleware.compressionMiddleware({
        threshold: 10
      });

      const largeBody = 'x'.repeat(100);
      const ctx: HttpMiddlewareContext = {
        peer: {} as any,
        serviceName: 'TestService',
        methodName: 'testMethod',
        input: {},
        metadata: new Map(),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        request: {
          ...mockRequest,
          headers: { 'accept-encoding': 'identity' }
        } as IncomingMessage,
        response: mockResponse as ServerResponse,
        body: largeBody
      };

      await middleware(ctx, mockNext);

      expect(ctx.body).toBe(largeBody);
      expect(mockResponse.setHeader).not.toHaveBeenCalledWith('Content-Encoding', expect.anything());
    });
  });

  describe('getTransportMiddleware', () => {
    it('should include requestId middleware by default', () => {
      const adapter = new HttpMiddlewareAdapter();

      const middleware = adapter.getTransportMiddleware();

      expect(middleware.length).toBeGreaterThan(0);
    });

    it('should include CORS middleware when options provided', () => {
      const adapter = new HttpMiddlewareAdapter({
        cors: {
          origin: '*'
        }
      });

      const middleware = adapter.getTransportMiddleware();

      expect(middleware.length).toBeGreaterThan(1);
    });
  });
});
