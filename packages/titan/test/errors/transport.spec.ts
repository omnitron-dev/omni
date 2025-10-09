/**
 * Comprehensive tests for transport mapping
 */

import { describe, it, expect } from '@jest/globals';
import {
  TransportType,
  mapToTransport,
  HttpTransportAdapter,
  WebSocketTransportAdapter,
  createTransportAdapter
} from '../../src/errors/transport.js';
import { TitanError } from '../../src/errors/core.js';
import { ErrorCode } from '../../src/errors/codes.js';

describe('Transport Mapping', () => {
  describe('GraphQL Transport', () => {
    it('should map to GraphQL error format', () => {
      const error = new TitanError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Invalid input data',
        details: { field: 'email' },
        requestId: 'req-gql-001'
      });

      const graphqlError = mapToTransport(error, TransportType.GRAPHQL);

      expect(graphqlError).toEqual({
        message: 'Invalid input data',
        extensions: {
          code: 'UNPROCESSABLE_ENTITY',
          statusCode: 422,
          details: { field: 'email' },
          requestId: 'req-gql-001'
        }
      });
    });

    it('should include context in GraphQL error when requested', () => {
      const error = new TitanError({
        code: ErrorCode.NOT_FOUND,
        message: 'User not found',
        context: { userId: '123', service: 'users' }
      });

      const graphqlError = mapToTransport(error, TransportType.GRAPHQL, {
        includeContext: true
      });

      expect(graphqlError.extensions.context).toEqual({
        userId: '123',
        service: 'users'
      });
    });

    it('should handle all error codes in GraphQL format', () => {
      const codes = [
        ErrorCode.BAD_REQUEST,
        ErrorCode.UNAUTHORIZED,
        ErrorCode.FORBIDDEN,
        ErrorCode.NOT_FOUND,
        ErrorCode.INTERNAL_ERROR
      ];

      codes.forEach(code => {
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
        details: { param: 'id' }
      });

      const jsonRpcError = mapToTransport(error, TransportType.JSONRPC, {
        requestId: 'rpc-1'
      });

      expect(jsonRpcError).toEqual({
        jsonrpc: '2.0',
        id: 'rpc-1',
        error: {
          code: -32602,
          message: 'Invalid parameters',
          data: { param: 'id' }
        }
      });
    });

    it('should map NOT_FOUND to method not found (-32601)', () => {
      const error = new TitanError({
        code: ErrorCode.NOT_FOUND,
        message: 'Method not found'
      });

      const jsonRpcError = mapToTransport(error, TransportType.JSONRPC);

      expect(jsonRpcError.error.code).toBe(-32601);
    });

    it('should map VALIDATION_ERROR to invalid params (-32602)', () => {
      const error = new TitanError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed'
      });

      const jsonRpcError = mapToTransport(error, TransportType.JSONRPC);

      expect(jsonRpcError.error.code).toBe(-32602);
    });

    it('should map INTERNAL_ERROR to internal error (-32603)', () => {
      const error = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Internal error'
      });

      const jsonRpcError = mapToTransport(error, TransportType.JSONRPC);

      expect(jsonRpcError.error.code).toBe(-32603);
    });

    it('should map other errors to custom server error range', () => {
      const error = new TitanError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Service unavailable'
      });

      const jsonRpcError = mapToTransport(error, TransportType.JSONRPC);

      expect(jsonRpcError.error.code).toBeGreaterThanOrEqual(-32099);
      expect(jsonRpcError.error.code).toBeLessThanOrEqual(-32000);
    });

    it('should include request ID when provided', () => {
      const error = new TitanError({
        code: ErrorCode.BAD_REQUEST,
        message: 'Bad request'
      });

      const jsonRpcError = mapToTransport(error, TransportType.JSONRPC, {
        requestId: '123'
      });

      expect(jsonRpcError.id).toBe('123');
    });

    it('should always include jsonrpc version', () => {
      const error = new TitanError({
        code: ErrorCode.NOT_FOUND,
        message: 'Not found'
      });

      const jsonRpcError = mapToTransport(error, TransportType.JSONRPC);

      expect(jsonRpcError.jsonrpc).toBe('2.0');
    });
  });

  describe('TCP Binary Transport', () => {
    it('should create binary packet with correct structure', () => {
      const error = new TitanError({
        code: ErrorCode.NOT_FOUND,
        message: 'Resource not found'
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

      codes.forEach(code => {
        const error = new TitanError({
          code: code as ErrorCode,
          message: 'Test message'
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
        message: longMessage
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
        message: 'Error: 你好世界 🌍'
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
          message: 'Not found'
        });

        const mapped = adapter.mapError(error);

        expect(mapped.status).toBe(404);
        expect(mapped.body.error.message).toBe('Not found');
      });

      it('should send error to HTTP response', async () => {
        const adapter = new HttpTransportAdapter();
        const error = new TitanError({
          code: ErrorCode.BAD_REQUEST,
          message: 'Invalid request'
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
          }
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
            details: { id: '123' }
          }
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
          requestId: 'ws-req-001'
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
          message: 'Bad request'
        });

        const mockWs = {
          sentMessages: [] as string[],
          send(message: string) {
            this.sentMessages.push(message);
          }
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
            details: { reason: 'maintenance' }
          }
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
        message: 'Test error'
      });

      expect(() => {
        mapToTransport(error, 'unsupported' as TransportType);
      }).toThrow('Unsupported transport: unsupported');
    });
  });
});
