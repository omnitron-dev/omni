/**
 * Comprehensive tests for error factory functions
 */

import { describe, it, expect } from '@jest/globals';
import {
  Errors,
  NetronErrors,
  HttpErrors,
  AuthErrors,
  toTitanError,
  assert,
  assertDefined,
  assertType,
} from '../../src/errors/factories.js';
import { TitanError } from '../../src/errors/core.js';
import { ErrorCode } from '../../src/errors/codes.js';
import { ValidationError } from '../../src/errors/validation.js';
import { RateLimitError } from '../../src/errors/http.js';

describe('Error Factories', () => {
  describe('Errors factory', () => {
    it('should create generic error', () => {
      const error = Errors.create(ErrorCode.BAD_REQUEST, 'Invalid input');

      expect(error).toBeInstanceOf(TitanError);
      expect(error.code).toBe(ErrorCode.BAD_REQUEST);
      expect(error.message).toBe('Invalid input');
    });

    it('should create error with details', () => {
      const error = Errors.create(ErrorCode.NOT_FOUND, 'Not found', { id: '123' });

      expect(error.details).toEqual({ id: '123' });
    });

    it('should create badRequest error', () => {
      const error = Errors.badRequest();

      expect(error.code).toBe(ErrorCode.BAD_REQUEST);
      expect(error.message).toBe('Bad request');
    });

    it('should create badRequest with custom message', () => {
      const error = Errors.badRequest('Invalid parameters', { param: 'email' });

      expect(error.message).toBe('Invalid parameters');
      expect(error.details).toEqual({ param: 'email' });
    });

    it('should create unauthorized error', () => {
      const error = Errors.unauthorized();

      expect(error.code).toBe(ErrorCode.UNAUTHORIZED);
      expect(error.message).toBe('Unauthorized');
    });

    it('should create forbidden error', () => {
      const error = Errors.forbidden();

      expect(error.code).toBe(ErrorCode.FORBIDDEN);
      expect(error.message).toBe('Forbidden');
    });

    it('should create notFound error', () => {
      const error = Errors.notFound('User');

      expect(error.code).toBe(ErrorCode.NOT_FOUND);
      expect(error.message).toBe('User not found');
      expect(error.details.resource).toBe('User');
    });

    it('should create notFound with ID', () => {
      const error = Errors.notFound('User', '123');

      expect(error.message).toBe('User with id 123 not found');
      expect(error.details.id).toBe('123');
    });

    it('should create conflict error', () => {
      const error = Errors.conflict('Resource already exists');

      expect(error.code).toBe(ErrorCode.CONFLICT);
      expect(error.message).toBe('Resource already exists');
    });

    it('should create validation error', () => {
      const errors = [
        { field: 'email', message: 'Invalid email' },
        { field: 'password', message: 'Too short' },
      ];

      const error = Errors.validation(errors);

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.validationErrors).toHaveLength(2);
    });

    it('should create internal error', () => {
      const error = Errors.internal();

      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(error.message).toBe('Internal server error');
    });

    it('should create internal error with cause', () => {
      const cause = new Error('Database failure');
      const error = Errors.internal('Failed to process', cause);

      expect(error.message).toBe('Failed to process');
      expect((error as any).cause).toBe(cause);
    });

    it('should create timeout error', () => {
      const error = Errors.timeout('Database query', 5000);

      expect(error.code).toBe(ErrorCode.REQUEST_TIMEOUT);
      expect(error.message).toBe('Database query timed out after 5000ms');
      expect(error.details.operation).toBe('Database query');
      expect(error.details.timeout).toBe(5000);
    });

    it('should create unavailable error', () => {
      const error = Errors.unavailable('Database');

      expect(error.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
      expect(error.message).toBe('Service Database is unavailable');
      expect(error.details.service).toBe('Database');
    });

    it('should create unavailable with reason', () => {
      const error = Errors.unavailable('API', 'Maintenance mode');

      expect(error.message).toBe('Service API is unavailable: Maintenance mode');
      expect(error.details.reason).toBe('Maintenance mode');
    });

    it('should create tooManyRequests error', () => {
      const error = Errors.tooManyRequests();

      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.code).toBe(ErrorCode.TOO_MANY_REQUESTS);
    });

    it('should create tooManyRequests with retryAfter', () => {
      const error = Errors.tooManyRequests(60);

      expect(error.retryAfter).toBe(60);
    });

    it('should create notImplemented error', () => {
      const error = Errors.notImplemented('GraphQL API');

      expect(error.code).toBe(ErrorCode.NOT_IMPLEMENTED);
      expect(error.message).toBe('GraphQL API is not implemented');
      expect(error.details.feature).toBe('GraphQL API');
    });
  });

  describe('NetronErrors factory', () => {
    it('should create serviceNotFound error', () => {
      const error = NetronErrors.serviceNotFound('auth@1.0.0');

      expect(error.code).toBe(ErrorCode.NOT_FOUND);
      expect(error.serviceId).toBe('auth@1.0.0');
    });

    it('should create methodNotFound error', () => {
      const error = NetronErrors.methodNotFound('calculator@1.0.0', 'divide');

      expect(error.code).toBe(ErrorCode.NOT_FOUND);
      expect(error.serviceId).toBe('calculator@1.0.0');
      expect(error.methodName).toBe('divide');
    });

    it('should create connectionFailed error', () => {
      const cause = new Error('ECONNREFUSED');
      const error = NetronErrors.connectionFailed('tcp', '127.0.0.1:8080', cause);

      expect(error.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
      expect(error.transport).toBe('tcp');
      expect(error.address).toBe('127.0.0.1:8080');
    });

    it('should create connectionTimeout error', () => {
      const error = NetronErrors.connectionTimeout('websocket', 'ws://localhost:3000');

      expect(error.code).toBe(ErrorCode.REQUEST_TIMEOUT);
      expect(error.transport).toBe('websocket');
    });

    it('should create connectionClosed error', () => {
      const error = NetronErrors.connectionClosed('http', 'Server shutdown');

      expect(error.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
      expect(error.details.reason).toBe('Server shutdown');
    });

    it('should create peerNotFound error', () => {
      const error = NetronErrors.peerNotFound('peer-123');

      expect(error.code).toBe(ErrorCode.NOT_FOUND);
      expect(error.peerId).toBe('peer-123');
    });

    it('should create peerDisconnected error', () => {
      const error = NetronErrors.peerDisconnected('peer-456', 'Timeout');

      expect(error.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
      expect(error.peerId).toBe('peer-456');
      expect(error.details.reason).toBe('Timeout');
    });

    it('should create peerUnauthorized error', () => {
      const error = NetronErrors.peerUnauthorized('peer-789');

      expect(error.code).toBe(ErrorCode.UNAUTHORIZED);
      expect(error.peerId).toBe('peer-789');
    });

    it('should create rpcTimeout error', () => {
      const error = NetronErrors.rpcTimeout('service@1.0.0', 'method', 3000);

      expect(error.code).toBe(ErrorCode.REQUEST_TIMEOUT);
      expect(error.serviceId).toBe('service@1.0.0');
      expect(error.methodName).toBe('method');
      expect(error.details.timeout).toBe(3000);
    });

    it('should create invalidRequest error', () => {
      const error = NetronErrors.invalidRequest('Missing field', { field: 'id' });

      expect(error.code).toBe(ErrorCode.BAD_REQUEST);
      expect(error.details).toEqual({ field: 'id' });
    });

    it('should create invalidResponse error', () => {
      const error = NetronErrors.invalidResponse('api@1.0.0', 'getData', { reason: 'malformed' });

      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(error.serviceId).toBe('api@1.0.0');
      expect(error.methodName).toBe('getData');
    });

    it('should create streamClosed error', () => {
      const error = NetronErrors.streamClosed('stream-123', 'EOF');

      expect(error.code).toBe(ErrorCode.GONE);
      expect(error.streamId).toBe('stream-123');
    });

    it('should create streamError', () => {
      const cause = new Error('Write failed');
      const error = NetronErrors.streamError('stream-456', cause);

      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(error.streamId).toBe('stream-456');
    });

    it('should create streamBackpressure error', () => {
      const error = NetronErrors.streamBackpressure('stream-789', 5000);

      expect(error.code).toBe(ErrorCode.TOO_MANY_REQUESTS);
      expect(error.streamId).toBe('stream-789');
      expect(error.details.bufferSize).toBe(5000);
    });

    it('should create serializeEncode error', () => {
      const cause = new Error('Circular reference');
      const error = NetronErrors.serializeEncode({ test: 'data' }, cause);

      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(error.serializationType).toBe('encode');
    });

    it('should create serializeDecode error', () => {
      const cause = new Error('Invalid format');
      const error = NetronErrors.serializeDecode('invalid', cause);

      expect(error.code).toBe(ErrorCode.BAD_REQUEST);
      expect(error.serializationType).toBe('decode');
    });
  });

  describe('HttpErrors factory', () => {
    it('should create from status code', () => {
      const error = HttpErrors.fromStatus(404);

      expect(error.code).toBe(404);
      expect(error.message).toBe('Not Found');
    });

    it('should create from status with custom message', () => {
      const error = HttpErrors.fromStatus(500, 'Server error', { detail: 'test' });

      expect(error.message).toBe('Server error');
      expect(error.details).toEqual({ detail: 'test' });
    });

    it('should create badRequest', () => {
      const error = HttpErrors.badRequest();

      expect(error.code).toBe(400);
    });

    it('should create unauthorized', () => {
      const error = HttpErrors.unauthorized();

      expect(error.code).toBe(401);
    });

    it('should create forbidden', () => {
      const error = HttpErrors.forbidden();

      expect(error.code).toBe(403);
    });

    it('should create notFound', () => {
      const error = HttpErrors.notFound();

      expect(error.code).toBe(404);
    });

    it('should create conflict', () => {
      const error = HttpErrors.conflict();

      expect(error.code).toBe(409);
    });

    it('should create tooManyRequests', () => {
      const error = HttpErrors.tooManyRequests();

      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.code).toBe(429);
    });

    it('should create tooManyRequests with retryAfter', () => {
      const error = HttpErrors.tooManyRequests(120);

      expect(error.retryAfter).toBe(120);
    });

    it('should create internal error', () => {
      const error = HttpErrors.internal();

      expect(error.code).toBe(500);
    });

    it('should create internal with custom message', () => {
      const error = HttpErrors.internal('Database failure', { db: 'users' });

      expect(error.message).toBe('Database failure');
      expect(error.details).toEqual({ db: 'users' });
    });
  });

  describe('AuthErrors factory', () => {
    it('should create bearerTokenRequired', () => {
      const error = AuthErrors.bearerTokenRequired();

      expect(error.code).toBe(401);
      expect(error.authType).toBe('Bearer');
      expect(error.realm).toBe('api');
    });

    it('should create bearerTokenRequired with realm', () => {
      const error = AuthErrors.bearerTokenRequired('admin');

      expect(error.realm).toBe('admin');
    });

    it('should create invalidToken', () => {
      const error = AuthErrors.invalidToken();

      expect(error.code).toBe(401);
      expect(error.message).toBe('Invalid token');
    });

    it('should create invalidToken with reason', () => {
      const error = AuthErrors.invalidToken('Signature mismatch');

      expect(error.message).toBe('Signature mismatch');
    });

    it('should create tokenExpired', () => {
      const error = AuthErrors.tokenExpired();

      expect(error.code).toBe(401);
      expect(error.message).toBe('Token has expired');
    });

    it('should create insufficientPermissions', () => {
      const error = AuthErrors.insufficientPermissions('admin');

      expect(error.code).toBe(403);
      expect(error.requiredPermission).toBe('admin');
    });

    it('should create insufficientPermissions with user permissions', () => {
      const error = AuthErrors.insufficientPermissions('admin', ['read', 'write']);

      expect(error.userPermissions).toEqual(['read', 'write']);
    });
  });

  describe('toTitanError()', () => {
    it('should return TitanError as-is', () => {
      const original = new TitanError({
        code: ErrorCode.NOT_FOUND,
        message: 'Not found',
      });

      const result = toTitanError(original);

      expect(result).toBe(original);
    });

    it('should convert Error to TitanError', () => {
      const original = new Error('Something went wrong');
      const result = toTitanError(original);

      expect(result).toBeInstanceOf(TitanError);
      expect(result.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(result.message).toBe('Something went wrong');
      expect((result as any).cause).toBe(original);
    });

    it('should convert string to TitanError', () => {
      const result = toTitanError('Error message');

      expect(result).toBeInstanceOf(TitanError);
      expect(result.code).toBe(ErrorCode.UNKNOWN_ERROR);
      expect(result.message).toBe('Error message');
    });

    it('should convert number to TitanError', () => {
      const result = toTitanError(123);

      expect(result).toBeInstanceOf(TitanError);
      expect(result.message).toBe('123');
    });

    it('should convert object to TitanError', () => {
      const result = toTitanError({ custom: 'error' });

      expect(result).toBeInstanceOf(TitanError);
      expect(result.code).toBe(ErrorCode.UNKNOWN_ERROR);
      // Object will be converted to string via String()
      expect(result.message).toBeTruthy();
    });
  });

  describe('assert()', () => {
    it('should not throw when condition is true', () => {
      expect(() => {
        assert(true, 'Should not throw');
      }).not.toThrow();
    });

    it('should throw when condition is false', () => {
      expect(() => {
        assert(false, 'Condition failed');
      }).toThrow(TitanError);
    });

    it('should throw with custom error', () => {
      const customError = new TitanError({
        code: ErrorCode.BAD_REQUEST,
        message: 'Custom error',
      });

      expect(() => {
        assert(false, customError);
      }).toThrow(customError);
    });

    it('should include details in thrown error', () => {
      try {
        assert(false, 'Failed', { reason: 'test' });
      } catch (error) {
        expect(error).toBeInstanceOf(TitanError);
        expect((error as TitanError).details).toEqual({ reason: 'test' });
      }
    });
  });

  describe('assertDefined()', () => {
    it('should not throw for defined values', () => {
      expect(() => {
        assertDefined('value', 'Should not throw');
      }).not.toThrow();

      expect(() => {
        assertDefined(0, 'Zero is defined');
      }).not.toThrow();

      expect(() => {
        assertDefined(false, 'False is defined');
      }).not.toThrow();
    });

    it('should throw for null', () => {
      expect(() => {
        assertDefined(null, 'Value is null');
      }).toThrow(TitanError);
    });

    it('should throw for undefined', () => {
      expect(() => {
        assertDefined(undefined, 'Value is undefined');
      }).toThrow(TitanError);
    });

    it('should include message in error', () => {
      try {
        assertDefined(null, 'Required value is missing');
      } catch (error) {
        expect(error).toBeInstanceOf(TitanError);
        expect((error as TitanError).message).toBe('Required value is missing');
      }
    });

    it('should narrow type correctly', () => {
      const value: string | null = 'test';
      assertDefined(value, 'Value is required');
      // After assertion, value is narrowed to string
      const length: number = value.length;
      expect(length).toBe(4);
    });
  });

  describe('assertType()', () => {
    it('should not throw when type matches', () => {
      const check = (value: unknown): value is string => typeof value === 'string';

      expect(() => {
        assertType('test', check, 'Should be string');
      }).not.toThrow();
    });

    it('should throw when type does not match', () => {
      const check = (value: unknown): value is string => typeof value === 'string';

      expect(() => {
        assertType(123, check, 'Expected string');
      }).toThrow(TitanError);
    });

    it('should use BAD_REQUEST code', () => {
      const check = (value: unknown): value is number => typeof value === 'number';

      try {
        assertType('not a number', check, 'Expected number');
      } catch (error) {
        expect(error).toBeInstanceOf(TitanError);
        expect((error as TitanError).code).toBe(ErrorCode.BAD_REQUEST);
      }
    });

    it('should narrow type correctly', () => {
      const isNumber = (value: unknown): value is number => typeof value === 'number';
      const value: unknown = 42;

      assertType(value, isNumber, 'Must be number');
      // After assertion, value is narrowed to number
      const doubled: number = value * 2;
      expect(doubled).toBe(84);
    });
  });
});
