/**
 * Tests for ServiceError class
 */

import { ServiceError } from '../../src/validation/validation-engine.js';

describe('ServiceError', () => {
  describe('constructor', () => {
    it('should create ServiceError with status code and data', () => {
      const error = new ServiceError(404, { message: 'Not found', id: '123' });

      expect(error).toBeInstanceOf(Error);
      expect(error.statusCode).toBe(404);
      expect(error.data).toEqual({ message: 'Not found', id: '123' });
      expect(error.name).toBe('ServiceError');
      expect(error.message).toBe('Service error: 404');
    });

    it('should support different status codes', () => {
      const error400 = new ServiceError(400, { error: 'Bad request' });
      const error401 = new ServiceError(401, { error: 'Unauthorized' });
      const error403 = new ServiceError(403, { error: 'Forbidden' });
      const error500 = new ServiceError(500, { error: 'Internal server error' });

      expect(error400.statusCode).toBe(400);
      expect(error401.statusCode).toBe(401);
      expect(error403.statusCode).toBe(403);
      expect(error500.statusCode).toBe(500);
    });

    it('should accept empty data object', () => {
      const error = new ServiceError(204, {});

      expect(error.statusCode).toBe(204);
      expect(error.data).toEqual({});
    });

    it('should accept complex nested data', () => {
      const error = new ServiceError(422, {
        errors: [
          { field: 'email', message: 'Invalid email' },
          { field: 'age', message: 'Must be positive' },
        ],
        metadata: {
          timestamp: Date.now(),
          requestId: 'abc-123',
        },
      });

      expect(error.statusCode).toBe(422);
      expect(error.data.errors).toHaveLength(2);
      expect(error.data.metadata).toBeDefined();
    });

    it('should support typed status codes', () => {
      const error404 = new ServiceError<404>(404, { resource: 'user' });
      const error409 = new ServiceError<409>(409, { conflict: 'email exists' });

      expect(error404.statusCode).toBe(404);
      expect(error409.statusCode).toBe(409);
    });
  });

  describe('error properties', () => {
    it('should have correct error properties', () => {
      const error = new ServiceError(500, { message: 'Internal error' });

      expect(error.name).toBe('ServiceError');
      expect(error.message).toContain('500');
      expect(error.statusCode).toBe(500);
      expect(error.data).toBeDefined();
    });

    it('should be catchable as Error', () => {
      try {
        throw new ServiceError(403, { message: 'Forbidden' });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(ServiceError);
        if (error instanceof ServiceError) {
          expect(error.statusCode).toBe(403);
        }
      }
    });
  });

  describe('real-world scenarios', () => {
    it('should represent validation errors', () => {
      const error = new ServiceError(422, {
        code: 'VALIDATION_ERROR',
        errors: [
          { field: 'email', message: 'Invalid email format' },
          { field: 'password', message: 'Password too short' },
        ],
      });

      expect(error.statusCode).toBe(422);
      expect(error.data.code).toBe('VALIDATION_ERROR');
    });

    it('should represent not found errors', () => {
      const error = new ServiceError(404, {
        code: 'NOT_FOUND',
        resource: 'user',
        id: '123',
      });

      expect(error.statusCode).toBe(404);
      expect(error.data.resource).toBe('user');
    });

    it('should represent conflict errors', () => {
      const error = new ServiceError(409, {
        code: 'CONFLICT',
        message: 'User with this email already exists',
        field: 'email',
      });

      expect(error.statusCode).toBe(409);
      expect(error.data.code).toBe('CONFLICT');
    });

    it('should represent rate limit errors', () => {
      const error = new ServiceError(429, {
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: 60,
        limit: 100,
        remaining: 0,
      });

      expect(error.statusCode).toBe(429);
      expect(error.data.retryAfter).toBe(60);
    });

    it('should represent authentication errors', () => {
      const error = new ServiceError(401, {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired token',
      });

      expect(error.statusCode).toBe(401);
      expect(error.data.code).toBe('UNAUTHORIZED');
    });
  });
});
