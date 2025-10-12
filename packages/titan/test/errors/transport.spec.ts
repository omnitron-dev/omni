/**
 * Comprehensive tests for transport mapping
 */

import { describe, it, expect } from '@jest/globals';
import {
  TransportType,
  mapToTransport,
  HttpTransportAdapter,
  WebSocketTransportAdapter,
  createTransportAdapter,
  parseHttpError,
  mapToHttp,
} from '../../src/errors/transport.js';
import { TitanError } from '../../src/errors/core.js';
import { ErrorCode } from '../../src/errors/codes.js';
import { RateLimitError, AuthError } from '../../src/errors/http.js';

describe('Transport Mapping', () => {
  describe('GraphQL Transport', () => {
    it('should map to GraphQL error format', () => {
      const error = new TitanError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Invalid input data',
        details: { field: 'email' },
        requestId: 'req-gql-001',
      });

      const graphqlError = mapToTransport(error, TransportType.GRAPHQL);

      expect(graphqlError).toEqual({
        message: 'Invalid input data',
        extensions: {
          code: 'UNPROCESSABLE_ENTITY',
          statusCode: 422,
          details: { field: 'email' },
          requestId: 'req-gql-001',
        },
      });
    });

    it('should include context in GraphQL error when requested', () => {
      const error = new TitanError({
        code: ErrorCode.NOT_FOUND,
        message: 'User not found',
        context: { userId: '123', service: 'users' },
      });

      const graphqlError = mapToTransport(error, TransportType.GRAPHQL, {
        includeContext: true,
      });

      expect(graphqlError.extensions.context).toEqual({
        userId: '123',
        service: 'users',
      });
    });

    it('should handle all error codes in GraphQL format', () => {
      const codes = [
        ErrorCode.BAD_REQUEST,
        ErrorCode.UNAUTHORIZED,
        ErrorCode.FORBIDDEN,
        ErrorCode.NOT_FOUND,
        ErrorCode.INTERNAL_ERROR,
      ];

      codes.forEach((code) => {
        const error = new TitanError({ code, message: 'Test error' });
        const graphqlError = mapToTransport(error, TransportType.GRAPHQL);

        expect(graphqlError).toHaveProperty('message');
        expect(graphqlError.extensions).toHaveProperty('code');
        expect(graphqlError.extensions).toHaveProperty('statusCode');
        expect(graphqlError.extensions.statusCode).toBe(code);
      });
    });
  });

  describe('JSON-RPC Transport', () => {
    it('should map BAD_REQUEST to invalid params (-32602)', () => {
      const error = new TitanError({
        code: ErrorCode.BAD_REQUEST,
        message: 'Invalid parameters',
        details: { param: 'id' },
      });

      const jsonRpcError = mapToTransport(error, TransportType.JSONRPC, {
        requestId: 'rpc-1',
      });

      expect(jsonRpcError).toEqual({
        jsonrpc: '2.0',
        id: 'rpc-1',
        error: {
          code: -32602,
          message: 'Invalid parameters',
          data: { param: 'id' },
        },
      });
    });

    it('should map NOT_FOUND to method not found (-32601)', () => {
      const error = new TitanError({
        code: ErrorCode.NOT_FOUND,
        message: 'Method not found',
      });

      const jsonRpcError = mapToTransport(error, TransportType.JSONRPC);

      expect(jsonRpcError.error.code).toBe(-32601);
    });

    it('should map VALIDATION_ERROR to invalid params (-32602)', () => {
      const error = new TitanError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
      });

      const jsonRpcError = mapToTransport(error, TransportType.JSONRPC);

      expect(jsonRpcError.error.code).toBe(-32602);
    });

    it('should map INTERNAL_ERROR to internal error (-32603)', () => {
      const error = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Internal error',
      });

      const jsonRpcError = mapToTransport(error, TransportType.JSONRPC);

      expect(jsonRpcError.error.code).toBe(-32603);
    });

    it('should map other errors to custom server error range', () => {
      const error = new TitanError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Service unavailable',
      });

      const jsonRpcError = mapToTransport(error, TransportType.JSONRPC);

      expect(jsonRpcError.error.code).toBeGreaterThanOrEqual(-32099);
      expect(jsonRpcError.error.code).toBeLessThanOrEqual(-32000);
    });

    it('should include request ID when provided', () => {
      const error = new TitanError({
        code: ErrorCode.BAD_REQUEST,
        message: 'Bad request',
      });

      const jsonRpcError = mapToTransport(error, TransportType.JSONRPC, {
        requestId: '123',
      });

      expect(jsonRpcError.id).toBe('123');
    });

    it('should always include jsonrpc version', () => {
      const error = new TitanError({
        code: ErrorCode.NOT_FOUND,
        message: 'Not found',
      });

      const jsonRpcError = mapToTransport(error, TransportType.JSONRPC);

      expect(jsonRpcError.jsonrpc).toBe('2.0');
    });
  });

  describe('TCP Binary Transport', () => {
    it('should create binary packet with correct structure', () => {
      const error = new TitanError({
        code: ErrorCode.NOT_FOUND,
        message: 'Resource not found',
      });

      const buffer = mapToTransport(error, TransportType.TCP);

      expect(buffer).toBeInstanceOf(Buffer);

      // Parse packet
      const packetType = buffer[0];
      const errorCode = buffer.readUInt16BE(1);
      const messageLength = buffer.readUInt16BE(3);
      const message = buffer.subarray(5, 5 + messageLength).toString('utf-8');

      expect(packetType).toBe(1); // Error packet type
      expect(errorCode).toBe(404);
      expect(messageLength).toBe('Resource not found'.length);
      expect(message).toBe('Resource not found');
    });

    it('should handle various error codes in binary format', () => {
      const codes = [400, 401, 403, 500, 503];

      codes.forEach((code) => {
        const error = new TitanError({
          code: code as ErrorCode,
          message: 'Test message',
        });

        const buffer = mapToTransport(error, TransportType.TCP);
        const parsedCode = buffer.readUInt16BE(1);

        expect(parsedCode).toBe(code);
      });
    });

    it('should handle long error messages', () => {
      const longMessage = 'A'.repeat(1000);
      const error = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: longMessage,
      });

      const buffer = mapToTransport(error, TransportType.TCP);
      const messageLength = buffer.readUInt16BE(3);
      const message = buffer.subarray(5, 5 + messageLength).toString('utf-8');

      expect(messageLength).toBe(1000);
      expect(message).toBe(longMessage);
    });

    it('should handle UTF-8 characters correctly', () => {
      const error = new TitanError({
        code: ErrorCode.BAD_REQUEST,
        message: 'Error: 你好世界 🌍',
      });

      const buffer = mapToTransport(error, TransportType.TCP);
      const messageLength = buffer.readUInt16BE(3);
      const message = buffer.subarray(5, 5 + messageLength).toString('utf-8');

      expect(message).toBe('Error: 你好世界 🌍');
    });
  });

  describe('Transport Adapters', () => {
    describe('HttpTransportAdapter', () => {
      it('should create HTTP adapter', () => {
        const adapter = new HttpTransportAdapter();
        expect(adapter).toBeInstanceOf(HttpTransportAdapter);
      });

      it('should map error correctly', () => {
        const adapter = new HttpTransportAdapter();
        const error = new TitanError({
          code: ErrorCode.NOT_FOUND,
          message: 'Not found',
        });

        const mapped = adapter.mapError(error);

        expect(mapped.status).toBe(404);
        expect(mapped.body.error.message).toBe('Not found');
      });

      it('should send error to HTTP response', async () => {
        const adapter = new HttpTransportAdapter();
        const error = new TitanError({
          code: ErrorCode.BAD_REQUEST,
          message: 'Invalid request',
        });

        const mockResponse = {
          statusValue: 0,
          headers: {} as Record<string, string>,
          body: null as any,
          status(code: number) {
            this.statusValue = code;
            return this;
          },
          setHeader(key: string, value: string) {
            this.headers[key] = value;
            return this;
          },
          json(data: any) {
            this.body = data;
            return this;
          },
        };

        await adapter.sendError(error, mockResponse);

        expect(mockResponse.statusValue).toBe(400);
        expect(mockResponse.headers['Content-Type']).toBe('application/json');
        expect(mockResponse.body.error.message).toBe('Invalid request');
      });

      it('should parse error from response data', () => {
        const adapter = new HttpTransportAdapter();
        const data = {
          error: {
            statusCode: 404,
            message: 'Not found',
            details: { id: '123' },
          },
        };

        const error = adapter.parseError(data);

        expect(error).toBeInstanceOf(TitanError);
        expect(error!.code).toBe(404);
        expect(error!.message).toBe('Not found');
        expect(error!.details).toEqual({ id: '123' });
      });

      it('should return null for invalid error data', () => {
        const adapter = new HttpTransportAdapter();

        expect(adapter.parseError({})).toBeNull();
        expect(adapter.parseError(null)).toBeNull();
        expect(adapter.parseError({ data: 'test' })).toBeNull();
      });
    });

    describe('WebSocketTransportAdapter', () => {
      it('should create WebSocket adapter', () => {
        const adapter = new WebSocketTransportAdapter();
        expect(adapter).toBeInstanceOf(WebSocketTransportAdapter);
      });

      it('should map error correctly', () => {
        const adapter = new WebSocketTransportAdapter();
        const error = new TitanError({
          code: ErrorCode.UNAUTHORIZED,
          message: 'Unauthorized',
          requestId: 'ws-req-001',
        });

        const mapped = adapter.mapError(error, { requestId: 'ws-req-001' });

        expect(mapped.type).toBe('error');
        expect(mapped.id).toBe('ws-req-001');
        expect(mapped.error.code).toBe(401);
        expect(mapped.error.message).toBe('Unauthorized');
      });

      it('should send error to WebSocket', async () => {
        const adapter = new WebSocketTransportAdapter();
        const error = new TitanError({
          code: ErrorCode.BAD_REQUEST,
          message: 'Bad request',
        });

        const mockWs = {
          sentMessages: [] as string[],
          send(message: string) {
            this.sentMessages.push(message);
          },
        };

        await adapter.sendError(error, mockWs);

        expect(mockWs.sentMessages).toHaveLength(1);
        const parsed = JSON.parse(mockWs.sentMessages[0]);
        expect(parsed.type).toBe('error');
        expect(parsed.error.code).toBe(400);
      });

      it('should parse error from WebSocket message', () => {
        const adapter = new WebSocketTransportAdapter();
        const data = {
          error: {
            code: 503,
            message: 'Service unavailable',
            details: { reason: 'maintenance' },
          },
        };

        const error = adapter.parseError(data);

        expect(error).toBeInstanceOf(TitanError);
        expect(error!.code).toBe(503);
        expect(error!.message).toBe('Service unavailable');
        expect(error!.details).toEqual({ reason: 'maintenance' });
      });
    });

    describe('createTransportAdapter()', () => {
      it('should create HTTP adapter', () => {
        const adapter = createTransportAdapter(TransportType.HTTP);
        expect(adapter).toBeInstanceOf(HttpTransportAdapter);
      });

      it('should create WebSocket adapter', () => {
        const adapter = createTransportAdapter(TransportType.WEBSOCKET);
        expect(adapter).toBeInstanceOf(WebSocketTransportAdapter);
      });

      it('should throw for unsupported transport', () => {
        expect(() => {
          createTransportAdapter(TransportType.GRPC);
        }).toThrow('No adapter available for transport: grpc');
      });
    });
  });

  describe('Unsupported Transport', () => {
    it('should throw error for unsupported transport type', () => {
      const error = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Test error',
      });

      expect(() => {
        mapToTransport(error, 'unsupported' as TransportType);
      }).toThrow('Unsupported transport: unsupported');
    });
  });

  describe('HTTP Error Parsing', () => {
    describe('parseHttpError()', () => {
      it('should parse basic HTTP error from status and body', () => {
        const error = parseHttpError(404, {
          error: {
            code: 'NOT_FOUND',
            message: 'Resource not found',
            details: { id: '123' },
          },
        });

        expect(error).toBeInstanceOf(TitanError);
        expect(error.code).toBe(ErrorCode.NOT_FOUND);
        expect(error.message).toBe('Resource not found');
        expect(error.details).toEqual({ id: '123' });
      });

      it('should parse error with numeric code', () => {
        const error = parseHttpError(400, {
          error: {
            code: 400,
            message: 'Bad request',
            details: { field: 'email' },
          },
        });

        expect(error.code).toBe(ErrorCode.BAD_REQUEST);
        expect(error.message).toBe('Bad request');
        expect(error.details).toEqual({ field: 'email' });
      });

      it('should use status as fallback when code is missing', () => {
        const error = parseHttpError(500, {
          error: {
            message: 'Server error',
          },
        });

        expect(error.code).toBe(500);
        expect(error.message).toBe('Server error');
      });

      it('should extract tracing headers', () => {
        const error = parseHttpError(
          404,
          { error: { code: 'NOT_FOUND', message: 'Not found' } },
          {
            'X-Request-ID': 'req-123',
            'X-Correlation-ID': 'corr-456',
            'X-Trace-ID': 'trace-789',
            'X-Span-ID': 'span-abc',
          }
        );

        expect(error.requestId).toBe('req-123');
        expect(error.correlationId).toBe('corr-456');
        expect(error.traceId).toBe('trace-789');
        expect(error.spanId).toBe('span-abc');
      });

      it('should handle case-insensitive headers', () => {
        const error = parseHttpError(
          404,
          { error: { code: 'NOT_FOUND', message: 'Not found' } },
          {
            'x-request-id': 'req-lowercase',
            'X-Correlation-ID': 'corr-mixedcase',
          }
        );

        expect(error.requestId).toBe('req-lowercase');
        expect(error.correlationId).toBe('corr-mixedcase');
      });

      it('should parse rate limit errors with headers', () => {
        const error = parseHttpError(
          429,
          { error: { code: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded' } },
          {
            'Retry-After': '60',
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': '1609459200',
          }
        );

        expect(error).toBeInstanceOf(RateLimitError);
        const rateLimitError = error as RateLimitError;
        expect(rateLimitError.retryAfter).toBe(60);
        expect(rateLimitError.limit).toBe(100);
        expect(rateLimitError.remaining).toBe(0);
        expect(rateLimitError.resetTime).toEqual(new Date(1609459200000));
      });

      it('should parse auth errors with WWW-Authenticate header', () => {
        const error = parseHttpError(
          401,
          { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
          {
            'WWW-Authenticate': 'Bearer realm="api"',
          }
        );

        expect(error).toBeInstanceOf(AuthError);
        const authError = error as AuthError;
        expect(authError.authType).toBe('Bearer');
        expect(authError.realm).toBe('api');
      });

      it('should parse auth error with Basic scheme', () => {
        const error = parseHttpError(
          401,
          { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
          {
            'WWW-Authenticate': 'Basic realm="admin"',
          }
        );

        expect(error).toBeInstanceOf(AuthError);
        const authError = error as AuthError;
        expect(authError.authType).toBe('Basic');
        expect(authError.realm).toBe('admin');
      });

      it('should handle error body without nested error object', () => {
        const error = parseHttpError(500, {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Internal error',
          details: { stack: 'error stack' },
        });

        expect(error.code).toBe(ErrorCode.INTERNAL_SERVER_ERROR);
        expect(error.message).toBe('Internal error');
        expect(error.details).toEqual({ stack: 'error stack' });
      });

      it('should generate default message if none provided', () => {
        const error = parseHttpError(503, {});

        expect(error.message).toBe('HTTP 503');
        expect(error.code).toBe(503);
      });

      it('should handle all standard error codes', () => {
        const codes = [400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504];

        codes.forEach((status) => {
          const error = parseHttpError(status, {
            error: { code: status, message: `Error ${status}` },
          });

          expect(error.code).toBe(status);
          expect(error.message).toBe(`Error ${status}`);
        });
      });
    });

    describe('Round-trip mapping (TitanError → HTTP → TitanError)', () => {
      it('should preserve basic error information', () => {
        const original = new TitanError({
          code: ErrorCode.NOT_FOUND,
          message: 'User not found',
          details: { userId: '123' },
        });

        const httpResponse = mapToHttp(original);
        const parsed = parseHttpError(httpResponse.status, httpResponse.body, httpResponse.headers);

        expect(parsed.code).toBe(original.code);
        expect(parsed.message).toBe(original.message);
        expect(parsed.details).toEqual(original.details);
      });

      it('should preserve tracing information', () => {
        const original = new TitanError({
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Internal error',
          requestId: 'req-abc',
          correlationId: 'corr-def',
          traceId: 'trace-ghi',
          spanId: 'span-jkl',
        });

        const httpResponse = mapToHttp(original);
        const parsed = parseHttpError(httpResponse.status, httpResponse.body, httpResponse.headers);

        expect(parsed.requestId).toBe(original.requestId);
        expect(parsed.correlationId).toBe(original.correlationId);
        expect(parsed.traceId).toBe(original.traceId);
        expect(parsed.spanId).toBe(original.spanId);
      });

      it('should preserve rate limit information', () => {
        const resetTime = new Date('2025-01-01T00:00:00Z');
        const original = new RateLimitError(
          'Rate limit exceeded',
          {},
          {
            limit: 100,
            remaining: 0,
            resetTime,
            retryAfter: 60,
          }
        );

        const httpResponse = mapToHttp(original);
        const parsed = parseHttpError(httpResponse.status, httpResponse.body, httpResponse.headers);

        expect(parsed).toBeInstanceOf(RateLimitError);
        const rateLimitError = parsed as RateLimitError;
        expect(rateLimitError.limit).toBe(100);
        expect(rateLimitError.remaining).toBe(0);
        expect(rateLimitError.retryAfter).toBe(60);
        expect(rateLimitError.resetTime?.getTime()).toBe(resetTime.getTime());
      });

      it('should preserve auth information', () => {
        const original = new AuthError(
          'Bearer token required',
          {},
          {
            authType: 'Bearer',
            realm: 'api',
          }
        );

        const httpResponse = mapToHttp(original);
        const parsed = parseHttpError(httpResponse.status, httpResponse.body, httpResponse.headers);

        expect(parsed).toBeInstanceOf(AuthError);
        const authError = parsed as AuthError;
        expect(authError.authType).toBe('Bearer');
        expect(authError.realm).toBe('api');
      });

      it('should handle errors with retryable status', () => {
        const original = new TitanError({
          code: ErrorCode.SERVICE_UNAVAILABLE,
          message: 'Service temporarily unavailable',
        });

        const httpResponse = mapToHttp(original);
        const parsed = parseHttpError(httpResponse.status, httpResponse.body, httpResponse.headers);

        expect(parsed.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
        expect(parsed.isRetryable()).toBe(true);
      });

      it('should handle validation errors correctly', () => {
        const original = new TitanError({
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Validation failed',
          details: {
            errors: [
              { field: 'email', message: 'Invalid email' },
              { field: 'password', message: 'Too short' },
            ],
          },
        });

        const httpResponse = mapToHttp(original);
        const parsed = parseHttpError(httpResponse.status, httpResponse.body, httpResponse.headers);

        expect(parsed.code).toBe(ErrorCode.VALIDATION_ERROR);
        expect(parsed.message).toBe('Validation failed');
        expect(parsed.details.errors).toHaveLength(2);
      });

      it('should maintain error category after round-trip', () => {
        const codes = [
          ErrorCode.BAD_REQUEST,
          ErrorCode.UNAUTHORIZED,
          ErrorCode.NOT_FOUND,
          ErrorCode.INTERNAL_ERROR,
          ErrorCode.SERVICE_UNAVAILABLE,
        ];

        codes.forEach((code) => {
          const original = new TitanError({ code, message: 'Test error' });
          const httpResponse = mapToHttp(original);
          const parsed = parseHttpError(httpResponse.status, httpResponse.body, httpResponse.headers);

          expect(parsed.category).toBe(original.category);
        });
      });
    });

    describe('Enhanced mapToHttp() headers', () => {
      it('should include WWW-Authenticate header for AuthError', () => {
        const error = new AuthError(
          'Bearer token required',
          {},
          {
            authType: 'Bearer',
            realm: 'api',
          }
        );

        const httpResponse = mapToHttp(error);

        expect(httpResponse.headers['WWW-Authenticate']).toBe('Bearer realm="api"');
      });

      it('should include full rate limit headers for RateLimitError', () => {
        const resetTime = new Date('2025-01-01T00:00:00Z');
        const error = new RateLimitError(
          'Rate limit exceeded',
          {},
          {
            limit: 100,
            remaining: 0,
            resetTime,
            retryAfter: 60,
          }
        );

        const httpResponse = mapToHttp(error);

        expect(httpResponse.headers['X-RateLimit-Limit']).toBe('100');
        expect(httpResponse.headers['X-RateLimit-Remaining']).toBe('0');
        expect(httpResponse.headers['X-RateLimit-Reset']).toBe(String(Math.floor(resetTime.getTime() / 1000)));
        expect(httpResponse.headers['Retry-After']).toBe('60');
      });

      it('should include Retry-After for generic rate limit errors', () => {
        const error = new TitanError({
          code: ErrorCode.TOO_MANY_REQUESTS,
          message: 'Too many requests',
          details: { retryAfter: 30 },
        });

        const httpResponse = mapToHttp(error);

        expect(httpResponse.headers['Retry-After']).toBe('30');
      });
    });
  });
});
