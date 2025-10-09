/**
 * Tests for TitanError serialization in Netron packet serializer
 */

import { describe, it, expect } from '@jest/globals';
import { SmartBuffer } from '@omnitron-dev/msgpack/smart-buffer';
import { serializer } from '../../src/netron/packet/serializer.js';
import { TitanError } from '../../src/errors/core.js';
import { ErrorCode } from '../../src/errors/codes.js';
import { NetronError, RpcError } from '../../src/errors/netron.js';
import { HttpError } from '../../src/errors/http.js';
import { ValidationError } from '../../src/errors/validation.js';

describe('TitanError Serialization', () => {
  describe('Basic TitanError serialization', () => {
    it('should serialize and deserialize a simple TitanError', () => {
      const original = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Test error message'
      });

      const buffer = new SmartBuffer();
      serializer.encode(original, buffer);
      buffer.roffset = 0;
      const decoded = serializer.decode(buffer);

      expect(decoded).toBeInstanceOf(TitanError);
      expect(decoded.code).toBe(original.code);
      expect(decoded.message).toBe(original.message);
      expect(decoded.name).toBe('TitanError');
    });

    it('should preserve all TitanError properties', () => {
      const original = new TitanError({
        code: ErrorCode.BAD_REQUEST,
        message: 'Invalid input',
        details: { field: 'email', reason: 'invalid format' },
        context: { userId: '123', service: 'auth' },
        requestId: 'req-001',
        correlationId: 'corr-001',
        spanId: 'span-001',
        traceId: 'trace-001'
      });

      const buffer = new SmartBuffer();
      serializer.encode(original, buffer);
      buffer.roffset = 0;
      const decoded = serializer.decode(buffer);

      expect(decoded.code).toBe(original.code);
      expect(decoded.message).toBe(original.message);
      expect(decoded.details).toEqual(original.details);
      expect(decoded.context).toEqual(original.context);
      expect(decoded.requestId).toBe(original.requestId);
      expect(decoded.correlationId).toBe(original.correlationId);
      expect(decoded.spanId).toBe(original.spanId);
      expect(decoded.traceId).toBe(original.traceId);
      expect(decoded.timestamp).toBe(original.timestamp);
    });

    it('should preserve stack trace', () => {
      const original = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Test error'
      });

      const buffer = new SmartBuffer();
      serializer.encode(original, buffer);
      buffer.roffset = 0;
      const decoded = serializer.decode(buffer);

      expect(decoded.stack).toBeDefined();
      expect(decoded.stack).toContain('TitanError');
    });
  });

  describe('Error subclass serialization', () => {
    it('should serialize and deserialize NetronError', () => {
      const original = new NetronError({
        code: ErrorCode.NOT_FOUND,
        message: 'Service not found',
        serviceId: 'auth@1.0.0',
        methodName: 'login',
        peerId: 'peer-123'
      });

      const buffer = new SmartBuffer();
      serializer.encode(original, buffer);
      buffer.roffset = 0;
      const decoded = serializer.decode(buffer);

      expect(decoded).toBeInstanceOf(TitanError);
      expect(decoded.name).toBe('NetronError');
      expect(decoded.code).toBe(original.code);
      expect(decoded.message).toBe(original.message);
    });

    it('should serialize and deserialize RpcError', () => {
      const original = RpcError.timeout('calculator@1.0.0', 'add', 5000);

      const buffer = new SmartBuffer();
      serializer.encode(original, buffer);
      buffer.roffset = 0;
      const decoded = serializer.decode(buffer);

      expect(decoded).toBeInstanceOf(TitanError);
      expect(decoded.name).toBe('RpcError');
      expect(decoded.code).toBe(ErrorCode.REQUEST_TIMEOUT);
      expect(decoded.message).toContain('timed out');
      expect(decoded.details).toEqual({ timeout: 5000 });
    });

    it('should serialize and deserialize HttpError', () => {
      const original = HttpError.notFound('Resource not found', { resource: 'user', id: '123' });

      const buffer = new SmartBuffer();
      serializer.encode(original, buffer);
      buffer.roffset = 0;
      const decoded = serializer.decode(buffer);

      expect(decoded).toBeInstanceOf(TitanError);
      expect(decoded.name).toBe('HttpError');
      expect(decoded.code).toBe(404);
      expect(decoded.message).toBe('Resource not found');
      expect(decoded.details).toEqual({ resource: 'user', id: '123' });
    });

    it('should serialize and deserialize ValidationError', () => {
      const original = ValidationError.fromFieldErrors(
        [
          { field: 'email', message: 'Invalid email format', code: 'invalid_email' },
          { field: 'password', message: 'Password too short', code: 'min_length' }
        ],
        { message: 'Validation failed' }
      );

      const buffer = new SmartBuffer();
      serializer.encode(original, buffer);
      buffer.roffset = 0;
      const decoded = serializer.decode(buffer);

      expect(decoded).toBeInstanceOf(TitanError);
      expect(decoded.name).toBe('ValidationError');
      expect(decoded.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(decoded.message).toBe('Validation failed');
      expect(decoded.details.errors).toBeDefined();
      expect(decoded.details.errors).toHaveLength(2);
    });
  });

  describe('Error cause chain serialization', () => {
    it('should serialize error with TitanError cause', () => {
      const cause = new TitanError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Database connection failed'
      });

      const original = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Failed to save user',
        cause
      });

      const buffer = new SmartBuffer();
      serializer.encode(original, buffer);
      buffer.roffset = 0;
      const decoded = serializer.decode(buffer);

      expect(decoded.code).toBe(original.code);
      expect(decoded.message).toBe(original.message);
      expect((decoded as any).cause).toBeInstanceOf(TitanError);
      expect((decoded as any).cause.code).toBe(cause.code);
      expect((decoded as any).cause.message).toBe(cause.message);
    });

    it('should serialize error with plain Error cause', () => {
      const cause = new Error('Connection timeout');
      cause.name = 'TimeoutError';

      const original = new TitanError({
        code: ErrorCode.REQUEST_TIMEOUT,
        message: 'Request failed',
        cause
      });

      const buffer = new SmartBuffer();
      serializer.encode(original, buffer);
      buffer.roffset = 0;
      const decoded = serializer.decode(buffer);

      expect(decoded.code).toBe(original.code);
      expect(decoded.message).toBe(original.message);
      expect((decoded as any).cause).toBeInstanceOf(Error);
      expect((decoded as any).cause.name).toBe('TimeoutError');
      expect((decoded as any).cause.message).toBe('Connection timeout');
    });

    it('should serialize error with nested cause chain', () => {
      const rootCause = new Error('Socket closed');
      const middleCause = new TitanError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Connection lost',
        cause: rootCause
      });
      const original = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Operation failed',
        cause: middleCause
      });

      const buffer = new SmartBuffer();
      serializer.encode(original, buffer);
      buffer.roffset = 0;
      const decoded = serializer.decode(buffer);

      expect(decoded.code).toBe(original.code);
      expect((decoded as any).cause).toBeInstanceOf(TitanError);
      expect((decoded as any).cause.code).toBe(middleCause.code);
      expect(((decoded as any).cause as any).cause).toBeInstanceOf(Error);
      expect(((decoded as any).cause as any).cause.message).toBe('Socket closed');
    });

    it('should handle error without cause', () => {
      const original = new TitanError({
        code: ErrorCode.NOT_FOUND,
        message: 'Resource not found'
      });

      const buffer = new SmartBuffer();
      serializer.encode(original, buffer);
      buffer.roffset = 0;
      const decoded = serializer.decode(buffer);

      expect(decoded.code).toBe(original.code);
      expect(decoded.message).toBe(original.message);
      expect((decoded as any).cause).toBeUndefined();
    });
  });

  describe('Round-trip serialization', () => {
    it('should handle multiple encode/decode cycles', () => {
      const original = new TitanError({
        code: ErrorCode.BAD_REQUEST,
        message: 'Invalid request',
        details: { reason: 'test' },
        context: { service: 'api' },
        requestId: 'req-123'
      });

      // First cycle
      const buffer1 = new SmartBuffer();
      serializer.encode(original, buffer1);
      buffer1.offset = 0;
      const decoded1 = serializer.decode(buffer1);

      // Second cycle
      const buffer2 = new SmartBuffer();
      serializer.encode(decoded1, buffer2);
      buffer2.offset = 0;
      const decoded2 = serializer.decode(buffer2);

      // Third cycle
      const buffer3 = new SmartBuffer();
      serializer.encode(decoded2, buffer3);
      buffer3.offset = 0;
      const decoded3 = serializer.decode(buffer3);

      expect(decoded3.code).toBe(original.code);
      expect(decoded3.message).toBe(original.message);
      expect(decoded3.details).toEqual(original.details);
      expect(decoded3.context).toEqual(original.context);
      expect(decoded3.requestId).toBe(original.requestId);
    });
  });

  describe('Error serialization in arrays and objects', () => {
    it('should serialize single error in array', () => {
      const errors = [
        new TitanError({ code: ErrorCode.BAD_REQUEST, message: 'Error 1' })
      ];

      const encoded = serializer.encode(errors);
      const decoded = serializer.decode(encoded);

      expect(Array.isArray(decoded)).toBe(true);
      expect(decoded).toHaveLength(1);
      expect(decoded[0]).toBeInstanceOf(TitanError);
      expect(decoded[0].message).toBe('Error 1');
    });
  });
});
