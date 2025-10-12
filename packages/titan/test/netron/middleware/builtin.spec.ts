/**
 * Tests for Netron Built-in Middleware
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NetronBuiltinMiddleware, type NetronMiddlewareContext } from '../../../src/netron/middleware/index.js';
import { TitanError, ErrorCode } from '../../../src/errors/index.js';

describe('NetronBuiltinMiddleware', () => {
  let mockContext: NetronMiddlewareContext;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockContext = {
      peer: {} as any,
      serviceName: 'TestService',
      methodName: 'testMethod',
      input: { test: 'data' },
      metadata: new Map(),
      timing: {
        start: Date.now(),
        middlewareTimes: new Map(),
      },
    };
    mockNext = jest.fn().mockResolvedValue(undefined);
  });

  describe('loggingMiddleware', () => {
    it('should log request and response', async () => {
      const logger = {
        info: jest.fn(),
        error: jest.fn(),
      };

      const middleware = NetronBuiltinMiddleware.loggingMiddleware(logger);

      mockContext.result = { success: true };
      await middleware(mockContext, mockNext);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'TestService',
          method: 'testMethod',
        }),
        'Netron request'
      );

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'TestService',
          method: 'testMethod',
          duration: expect.any(Number),
        }),
        'Netron response'
      );

      expect(mockNext).toHaveBeenCalled();
    });

    it('should log errors', async () => {
      const logger = {
        info: jest.fn(),
        error: jest.fn(),
      };

      const middleware = NetronBuiltinMiddleware.loggingMiddleware(logger);

      const error = new Error('Test error');
      mockNext.mockRejectedValue(error);

      await expect(middleware(mockContext, mockNext)).rejects.toThrow('Test error');

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'TestService',
          method: 'testMethod',
          error: error.message,
        }),
        'Netron error'
      );
    });
  });

  describe('metricsMiddleware', () => {
    it('should collect metrics', async () => {
      const metrics = {
        recordRequest: jest.fn(),
        recordDuration: jest.fn(),
        recordError: jest.fn(),
      };

      const middleware = NetronBuiltinMiddleware.metricsMiddleware(metrics);

      mockContext.result = { success: true };
      await middleware(mockContext, mockNext);

      expect(metrics.recordRequest).toHaveBeenCalledWith('TestService', 'testMethod');

      expect(metrics.recordDuration).toHaveBeenCalledWith('TestService', 'testMethod', expect.any(Number));

      expect(mockNext).toHaveBeenCalled();
    });

    it('should record errors', async () => {
      const metrics = {
        recordRequest: jest.fn(),
        recordDuration: jest.fn(),
        recordError: jest.fn(),
      };

      const middleware = NetronBuiltinMiddleware.metricsMiddleware(metrics);

      const error = new Error('Test error');
      mockNext.mockRejectedValue(error);

      await expect(middleware(mockContext, mockNext)).rejects.toThrow('Test error');

      expect(metrics.recordError).toHaveBeenCalledWith('TestService', 'testMethod', error);
    });
  });

  describe('authenticationMiddleware', () => {
    it('should authenticate valid token', async () => {
      const authenticator = {
        verify: jest.fn().mockResolvedValue({ userId: '123', role: 'admin' }),
      };

      const middleware = NetronBuiltinMiddleware.authenticationMiddleware(authenticator);

      mockContext.metadata.set('authorization', 'Bearer valid-token');

      await middleware(mockContext, mockNext);

      expect(authenticator.verify).toHaveBeenCalledWith('valid-token');
      expect(mockContext.metadata.get('user')).toEqual({
        userId: '123',
        role: 'admin',
      });
      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject missing token', async () => {
      const authenticator = {
        verify: jest.fn(),
      };

      const middleware = NetronBuiltinMiddleware.authenticationMiddleware(authenticator);

      await expect(middleware(mockContext, mockNext)).rejects.toThrow(TitanError);
      await expect(middleware(mockContext, mockNext)).rejects.toMatchObject({
        code: ErrorCode.UNAUTHORIZED,
      });

      expect(authenticator.verify).not.toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject invalid token', async () => {
      const authenticator = {
        verify: jest.fn().mockRejectedValue(new Error('Invalid token')),
      };

      const middleware = NetronBuiltinMiddleware.authenticationMiddleware(authenticator);

      mockContext.metadata.set('authorization', 'Bearer invalid-token');

      await expect(middleware(mockContext, mockNext)).rejects.toThrow(TitanError);
      await expect(middleware(mockContext, mockNext)).rejects.toMatchObject({
        code: ErrorCode.UNAUTHORIZED,
      });

      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('authorizationMiddleware', () => {
    it('should authorize user with required role', async () => {
      const middleware = NetronBuiltinMiddleware.authorizationMiddleware(['admin', 'user']);

      mockContext.metadata.set('user', { userId: '123', role: 'admin' });

      await middleware(mockContext, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject user without required role', async () => {
      const middleware = NetronBuiltinMiddleware.authorizationMiddleware(['admin']);

      mockContext.metadata.set('user', { userId: '123', role: 'user' });

      await expect(middleware(mockContext, mockNext)).rejects.toThrow(TitanError);
      await expect(middleware(mockContext, mockNext)).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject unauthenticated user', async () => {
      const middleware = NetronBuiltinMiddleware.authorizationMiddleware(['admin']);

      await expect(middleware(mockContext, mockNext)).rejects.toThrow(TitanError);
      await expect(middleware(mockContext, mockNext)).rejects.toMatchObject({
        code: ErrorCode.UNAUTHORIZED,
      });

      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('rateLimitMiddleware', () => {
    it('should allow requests within limit', async () => {
      const limiter = {
        check: jest.fn().mockResolvedValue({ allowed: true }),
      };

      const middleware = NetronBuiltinMiddleware.rateLimitMiddleware(limiter);

      await middleware(mockContext, mockNext);

      expect(limiter.check).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'TestService.testMethod',
          context: mockContext,
        })
      );
      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject requests over limit', async () => {
      const limiter = {
        check: jest.fn().mockResolvedValue({
          allowed: false,
          retryAfter: 60,
        }),
      };

      const middleware = NetronBuiltinMiddleware.rateLimitMiddleware(limiter);

      await expect(middleware(mockContext, mockNext)).rejects.toThrow(TitanError);
      await expect(middleware(mockContext, mockNext)).rejects.toMatchObject({
        code: ErrorCode.TOO_MANY_REQUESTS,
        details: { retryAfter: 60 },
      });

      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('circuitBreakerMiddleware', () => {
    it('should allow requests when circuit is closed', async () => {
      const breaker = {
        isOpen: jest.fn().mockReturnValue(false),
        onSuccess: jest.fn(),
        onFailure: jest.fn(),
      };

      const middleware = NetronBuiltinMiddleware.circuitBreakerMiddleware(breaker);

      await middleware(mockContext, mockNext);

      expect(breaker.isOpen).toHaveBeenCalledWith('TestService.testMethod');
      expect(breaker.onSuccess).toHaveBeenCalledWith('TestService.testMethod');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject requests when circuit is open', async () => {
      const breaker = {
        isOpen: jest.fn().mockReturnValue(true),
        onSuccess: jest.fn(),
        onFailure: jest.fn(),
      };

      const middleware = NetronBuiltinMiddleware.circuitBreakerMiddleware(breaker);

      await expect(middleware(mockContext, mockNext)).rejects.toThrow(TitanError);
      await expect(middleware(mockContext, mockNext)).rejects.toMatchObject({
        code: ErrorCode.SERVICE_UNAVAILABLE,
      });

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should record failures', async () => {
      const breaker = {
        isOpen: jest.fn().mockReturnValue(false),
        onSuccess: jest.fn(),
        onFailure: jest.fn(),
      };

      const middleware = NetronBuiltinMiddleware.circuitBreakerMiddleware(breaker);

      const error = new Error('Test error');
      mockNext.mockRejectedValue(error);

      await expect(middleware(mockContext, mockNext)).rejects.toThrow('Test error');

      expect(breaker.onFailure).toHaveBeenCalledWith('TestService.testMethod', error);
    });
  });

  describe('timeoutMiddleware', () => {
    it('should complete within timeout', async () => {
      const middleware = NetronBuiltinMiddleware.timeoutMiddleware(1000);

      mockNext.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      await middleware(mockContext, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should timeout long-running requests', async () => {
      const middleware = NetronBuiltinMiddleware.timeoutMiddleware(50);

      mockNext.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      await expect(middleware(mockContext, mockNext)).rejects.toThrow(TitanError);
      await expect(middleware(mockContext, mockNext)).rejects.toMatchObject({
        code: ErrorCode.REQUEST_TIMEOUT,
      });
    });
  });

  describe('cachingMiddleware', () => {
    it('should cache responses', async () => {
      const cache = new Map();

      const middleware = NetronBuiltinMiddleware.cachingMiddleware({
        cache,
        ttl: 60000,
        keyGenerator: (ctx) => `${ctx.serviceName}.${ctx.methodName}:${JSON.stringify(ctx.input)}`,
      });

      mockContext.result = { data: 'cached' };
      await middleware(mockContext, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(cache.size).toBe(1);

      // Second call should use cache
      mockNext.mockClear();
      const newContext = { ...mockContext, result: undefined };
      await middleware(newContext, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(newContext.result).toEqual({ data: 'cached' });
      expect(newContext.metadata.get('cached')).toBe(true);
    });

    it('should bypass cache for errors', async () => {
      const cache = new Map();

      const middleware = NetronBuiltinMiddleware.cachingMiddleware({
        cache,
        ttl: 60000,
      });

      const error = new Error('Test error');
      mockNext.mockRejectedValue(error);

      await expect(middleware(mockContext, mockNext)).rejects.toThrow('Test error');

      expect(cache.size).toBe(0);
    });
  });

  describe('retryMiddleware', () => {
    it('should retry on failure', async () => {
      const middleware = NetronBuiltinMiddleware.retryMiddleware({
        maxAttempts: 3,
        delay: 10,
        shouldRetry: () => true,
      });

      let attempts = 0;
      mockNext.mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Retry me');
        }
        return 'success';
      });

      await middleware(mockContext, mockNext);

      expect(attempts).toBe(3);
      expect(mockNext).toHaveBeenCalledTimes(3);
    });

    it('should not retry when shouldRetry returns false', async () => {
      const middleware = NetronBuiltinMiddleware.retryMiddleware({
        maxAttempts: 3,
        delay: 10,
        shouldRetry: () => false,
      });

      const error = new Error('Do not retry');
      mockNext.mockRejectedValue(error);

      await expect(middleware(mockContext, mockNext)).rejects.toThrow('Do not retry');

      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('should apply exponential backoff', async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;

      (global as any).setTimeout = (fn: Function, delay: number) => {
        delays.push(delay);
        fn();
        return 0;
      };

      const middleware = NetronBuiltinMiddleware.retryMiddleware({
        maxAttempts: 3,
        delay: 100,
        backoffMultiplier: 2,
        shouldRetry: () => true,
      });

      mockNext.mockRejectedValue(new Error('Retry me'));

      await expect(middleware(mockContext, mockNext)).rejects.toThrow('Retry me');

      expect(delays).toEqual([100, 200]); // First retry at 100ms, second at 200ms

      global.setTimeout = originalSetTimeout;
    });
  });

  describe('compressionMiddleware', () => {
    it('should compress large responses', async () => {
      const middleware = NetronBuiltinMiddleware.compressionMiddleware({
        threshold: 10,
      });

      const largeData = 'x'.repeat(100);
      mockContext.result = largeData;

      await middleware(mockContext, mockNext);

      expect(mockContext.metadata.get('compressed')).toBe(true);
      expect(mockContext.metadata.get('originalSize')).toBe(100);
      expect(mockContext.result).not.toBe(largeData); // Should be compressed
    });

    it('should not compress small responses', async () => {
      const middleware = NetronBuiltinMiddleware.compressionMiddleware({
        threshold: 100,
      });

      const smallData = 'small';
      mockContext.result = smallData;

      await middleware(mockContext, mockNext);

      expect(mockContext.metadata.get('compressed')).toBeFalsy();
      expect(mockContext.result).toBe(smallData);
    });
  });

  describe('validationMiddleware', () => {
    it('should validate input successfully', async () => {
      const validator = {
        validate: jest.fn().mockReturnValue({ valid: true }),
      };

      const middleware = NetronBuiltinMiddleware.validationMiddleware(validator);

      await middleware(mockContext, mockNext);

      expect(validator.validate).toHaveBeenCalledWith(
        mockContext.input,
        expect.objectContaining({
          service: 'TestService',
          method: 'testMethod',
        })
      );
      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject invalid input', async () => {
      const validator = {
        validate: jest.fn().mockReturnValue({
          valid: false,
          errors: ['Field required', 'Invalid format'],
        }),
      };

      const middleware = NetronBuiltinMiddleware.validationMiddleware(validator);

      await expect(middleware(mockContext, mockNext)).rejects.toThrow(TitanError);
      await expect(middleware(mockContext, mockNext)).rejects.toMatchObject({
        code: ErrorCode.BAD_REQUEST,
        details: { errors: ['Field required', 'Invalid format'] },
      });

      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('tracingMiddleware', () => {
    it('should add tracing information', async () => {
      const tracer = {
        startSpan: jest.fn().mockReturnValue({
          setTag: jest.fn(),
          finish: jest.fn(),
        }),
        inject: jest.fn(),
      };

      const middleware = NetronBuiltinMiddleware.tracingMiddleware(tracer);

      await middleware(mockContext, mockNext);

      expect(tracer.startSpan).toHaveBeenCalledWith('TestService.testMethod');

      const span = tracer.startSpan.mock.results[0].value;
      expect(span.setTag).toHaveBeenCalledWith('service', 'TestService');
      expect(span.setTag).toHaveBeenCalledWith('method', 'testMethod');
      expect(span.finish).toHaveBeenCalled();

      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle errors in tracing', async () => {
      const tracer = {
        startSpan: jest.fn().mockReturnValue({
          setTag: jest.fn(),
          finish: jest.fn(),
        }),
        inject: jest.fn(),
      };

      const middleware = NetronBuiltinMiddleware.tracingMiddleware(tracer);

      const error = new Error('Test error');
      mockNext.mockRejectedValue(error);

      await expect(middleware(mockContext, mockNext)).rejects.toThrow('Test error');

      const span = tracer.startSpan.mock.results[0].value;
      expect(span.setTag).toHaveBeenCalledWith('error', true);
      expect(span.setTag).toHaveBeenCalledWith('error.message', 'Test error');
      expect(span.finish).toHaveBeenCalled();
    });
  });
});
