/**
 * Error serialization compatibility tests
 * Ensures browser client errors are compatible with Titan server
 */

import { describe, it, expect } from 'vitest';
import {
  TitanError,
  ErrorCode,
  ErrorCategory,
  NetronError,
  ServiceNotFoundError,
  MethodNotFoundError,
  TransportError,
  RpcError,
  StreamError,
  SerializationError,
  serializeError,
  deserializeError,
  parseHttpError,
  parseWebSocketError,
  serializeWebSocketError,
} from '../../src/errors/index.js';

describe('Error Serialization', () => {
  describe('TitanError', () => {
    it('should create TitanError with correct properties', () => {
      const error = new TitanError({
        code: ErrorCode.NOT_FOUND,
        message: 'Resource not found',
        details: { resourceId: '123' },
      });

      expect(error.code).toBe(ErrorCode.NOT_FOUND);
      expect(error.message).toBe('Resource not found');
      expect(error.category).toBe(ErrorCategory.CLIENT);
      expect(error.details).toEqual({ resourceId: '123' });
      expect(error.httpStatus).toBe(404);
    });

    it('should serialize to JSON correctly', () => {
      const error = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Something went wrong',
        details: { debug: true },
        requestId: 'req-123',
        correlationId: 'cor-456',
      });

      const json = error.toJSON();

      expect(json).toMatchObject({
        name: 'TitanError',
        code: 500,
        category: 'server',
        message: 'Something went wrong',
        details: { debug: true },
        requestId: 'req-123',
        correlationId: 'cor-456',
      });
      expect(json.timestamp).toBeDefined();
    });

    it('should deserialize from JSON correctly', () => {
      const original = new TitanError({
        code: ErrorCode.BAD_REQUEST,
        message: 'Invalid input',
        details: { field: 'email' },
        requestId: 'req-789',
      });

      const serialized = serializeError(original);
      const deserialized = deserializeError(serialized);

      expect(deserialized).toBeInstanceOf(TitanError);
      expect(deserialized.code).toBe(original.code);
      expect(deserialized.message).toBe(original.message);
      expect(deserialized.details).toEqual(original.details);
      expect(deserialized.requestId).toBe(original.requestId);
    });

    it('should handle retry strategy correctly', () => {
      const retryableError = new TitanError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Service is down',
      });

      const nonRetryableError = new TitanError({
        code: ErrorCode.NOT_FOUND,
        message: 'Not found',
      });

      expect(retryableError.isRetryable()).toBe(true);
      expect(nonRetryableError.isRetryable()).toBe(false);

      const strategy = retryableError.getRetryStrategy();
      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.maxAttempts).toBeGreaterThan(0);
    });

    it('should handle rate limit errors with custom retry', () => {
      const rateLimitError = new TitanError({
        code: ErrorCode.TOO_MANY_REQUESTS,
        message: 'Rate limited',
        details: { retryAfter: 30 },
      });

      const strategy = rateLimitError.getRetryStrategy();
      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.delay).toBe(30000); // 30 seconds in ms
    });
  });

  describe('Netron-specific Errors', () => {
    it('should create ServiceNotFoundError', () => {
      const error = ServiceNotFoundError.create('calculator@1.0.0');

      expect(error).toBeInstanceOf(ServiceNotFoundError);
      expect(error).toBeInstanceOf(NetronError);
      expect(error).toBeInstanceOf(TitanError);
      expect(error.code).toBe(ErrorCode.NOT_FOUND);
      expect(error.serviceId).toBe('calculator@1.0.0');
      expect(error.message).toContain('calculator@1.0.0');
    });

    it('should create MethodNotFoundError', () => {
      const error = MethodNotFoundError.create('calculator@1.0.0', 'divide');

      expect(error).toBeInstanceOf(MethodNotFoundError);
      expect(error.code).toBe(ErrorCode.NOT_FOUND);
      expect(error.serviceId).toBe('calculator@1.0.0');
      expect(error.methodName).toBe('divide');
      expect(error.message).toContain('calculator@1.0.0.divide');
    });

    it('should create TransportError for connection failures', () => {
      const error = TransportError.connectionFailed('websocket', 'ws://localhost:3000', new Error('Connection refused'));

      expect(error).toBeInstanceOf(TransportError);
      expect(error.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
      expect(error.transport).toBe('websocket');
      expect(error.address).toBe('ws://localhost:3000');
    });

    it('should create RpcError for timeouts', () => {
      const error = RpcError.timeout('calculator@1.0.0', 'complexOperation', 5000);

      expect(error).toBeInstanceOf(RpcError);
      expect(error.code).toBe(ErrorCode.REQUEST_TIMEOUT);
      expect(error.serviceId).toBe('calculator@1.0.0');
      expect(error.methodName).toBe('complexOperation');
      expect(error.details.timeout).toBe(5000);
    });

    it('should create StreamError for closed streams', () => {
      const error = StreamError.closed('stream-123', 'client closed');

      expect(error).toBeInstanceOf(StreamError);
      expect(error.code).toBe(ErrorCode.GONE);
      expect(error.streamId).toBe('stream-123');
      expect(error.details.reason).toBe('client closed');
    });

    it('should create SerializationError', () => {
      const encodeError = SerializationError.encode({ circular: 'ref' });
      expect(encodeError).toBeInstanceOf(SerializationError);
      expect(encodeError.serializationType).toBe('encode');

      const decodeError = SerializationError.decode(new Uint8Array([1, 2, 3]));
      expect(decodeError).toBeInstanceOf(SerializationError);
      expect(decodeError.serializationType).toBe('decode');
    });
  });

  describe('HTTP Error Parsing', () => {
    it('should parse HTTP error response', () => {
      const body = {
        error: {
          code: 'NOT_FOUND',
          message: 'Resource not found',
          details: { resourceId: '123' },
        },
      };

      const headers = {
        'x-request-id': 'req-123',
        'x-correlation-id': 'cor-456',
      };

      const error = parseHttpError(404, body, headers);

      expect(error).toBeInstanceOf(TitanError);
      expect(error.code).toBe(404);
      expect(error.message).toBe('Resource not found');
      expect(error.details.resourceId).toBe('123');
      expect(error.requestId).toBe('req-123');
      expect(error.correlationId).toBe('cor-456');
    });

    it('should handle HTTP error without error wrapper', () => {
      const body = {
        code: 500,
        message: 'Internal error',
      };

      const error = parseHttpError(500, body);

      expect(error.code).toBe(500);
      expect(error.message).toBe('Internal error');
    });
  });

  describe('WebSocket Error Serialization', () => {
    it('should serialize WebSocket error message', () => {
      const error = new TitanError({
        code: ErrorCode.BAD_REQUEST,
        message: 'Invalid request',
        details: { field: 'name' },
      });

      const message = serializeWebSocketError(error, 'msg-123');

      expect(message).toMatchObject({
        type: 'error',
        id: 'msg-123',
        error: {
          code: 400,
          name: 'BAD_REQUEST',
          message: 'Invalid request',
          details: { field: 'name' },
        },
      });
    });

    it('should parse WebSocket error message', () => {
      const message = {
        type: 'error' as const,
        id: 'msg-456',
        error: {
          code: 404,
          name: 'NOT_FOUND',
          message: 'Not found',
          details: { resource: 'user' },
        },
      };

      const error = parseWebSocketError(message);

      expect(error).toBeInstanceOf(TitanError);
      expect(error.code).toBe(404);
      expect(error.message).toBe('Not found');
      expect(error.details.resource).toBe('user');
    });
  });

  describe('Error Deserialization', () => {
    it('should deserialize ServiceNotFoundError correctly', () => {
      const original = ServiceNotFoundError.create('test@1.0.0');
      const serialized = serializeError(original);

      // Ensure serviceId is in details for deserialization
      serialized.details = { ...serialized.details, serviceId: original.serviceId };

      const deserialized = deserializeError(serialized);

      expect(deserialized).toBeInstanceOf(ServiceNotFoundError);
      expect(deserialized.code).toBe(original.code);
      expect(deserialized.message).toBe(original.message);
    });

    it('should deserialize MethodNotFoundError correctly', () => {
      const original = MethodNotFoundError.create('test@1.0.0', 'testMethod');
      const serialized = serializeError(original);

      // Ensure serviceId and methodName are in details for deserialization
      serialized.details = {
        ...serialized.details,
        serviceId: original.serviceId,
        methodName: original.methodName,
      };

      const deserialized = deserializeError(serialized);

      expect(deserialized).toBeInstanceOf(MethodNotFoundError);
      expect(deserialized.code).toBe(original.code);
      expect(deserialized.message).toBe(original.message);
    });

    it('should handle unknown error types gracefully', () => {
      const unknownError = {
        name: 'CustomError',
        code: 500,
        category: 'server',
        message: 'Unknown error type',
        details: {},
        context: {},
        timestamp: Date.now(),
      };

      const error = deserializeError(unknownError);

      expect(error).toBeInstanceOf(TitanError);
      expect(error.code).toBe(500);
      expect(error.message).toBe('Unknown error type');
    });
  });

  describe('Error Context and Details', () => {
    it('should support adding context to errors', () => {
      const error = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Error occurred',
      });

      const withContext = error.withContext({
        userId: 'user-123',
        operation: 'update',
      });

      expect(withContext.context.userId).toBe('user-123');
      expect(withContext.context.operation).toBe('update');
      expect(withContext.message).toBe(error.message);
    });

    it('should support adding details to errors', () => {
      const error = new TitanError({
        code: ErrorCode.BAD_REQUEST,
        message: 'Validation failed',
        details: { field: 'email' },
      });

      const withDetails = error.withDetails({
        reason: 'invalid format',
      });

      expect(withDetails.details).toEqual({
        field: 'email',
        reason: 'invalid format',
      });
    });
  });
});
