/**
 * Edge Case Tests for Netron Built-in Middleware
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  NetronBuiltinMiddleware,
  type NetronMiddlewareContext
} from '../../../src/netron/middleware/index.js';
import { TitanError, ErrorCode } from '../../../src/errors/index.js';

describe('NetronBuiltinMiddleware - Edge Cases', () => {
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
        middlewareTimes: new Map()
      }
    };
    mockNext = jest.fn().mockResolvedValue(undefined);
  });

  describe('requestId', () => {
    it('should generate request ID when not present', async () => {
      const middleware = NetronBuiltinMiddleware.requestId();

      await middleware(mockContext, mockNext);

      expect(mockContext.metadata.get('requestId')).toBeDefined();
      expect(typeof mockContext.metadata.get('requestId')).toBe('string');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should preserve existing request ID', async () => {
      const middleware = NetronBuiltinMiddleware.requestId();

      mockContext.metadata.set('requestId', 'existing-request-id');

      await middleware(mockContext, mockNext);

      expect(mockContext.metadata.get('requestId')).toBe('existing-request-id');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should create metadata map if not present', async () => {
      const middleware = NetronBuiltinMiddleware.requestId();

      const contextWithoutMetadata = {
        ...mockContext,
        metadata: undefined as any
      };

      await middleware(contextWithoutMetadata, mockNext);

      expect(contextWithoutMetadata.metadata).toBeInstanceOf(Map);
      expect(contextWithoutMetadata.metadata.get('requestId')).toBeDefined();
    });

    it('should generate unique IDs for each request', async () => {
      const middleware = NetronBuiltinMiddleware.requestId();

      const context1 = { ...mockContext, metadata: new Map() };
      const context2 = { ...mockContext, metadata: new Map() };

      await middleware(context1, mockNext);
      await middleware(context2, mockNext);

      const id1 = context1.metadata.get('requestId');
      const id2 = context2.metadata.get('requestId');

      expect(id1).not.toBe(id2);
    });
  });

  describe('rateLimit', () => {
    it('should allow requests within rate limit', async () => {
      const middleware = NetronBuiltinMiddleware.rateLimit({
        maxRequests: 5,
        window: 60000
      });

      mockContext.metadata.set('clientId', 'client-1');

      // First 5 requests should succeed
      for (let i = 0; i < 5; i++) {
        await middleware(mockContext, mockNext);
      }

      expect(mockNext).toHaveBeenCalledTimes(5);
    });

    it('should reject requests exceeding rate limit', async () => {
      const middleware = NetronBuiltinMiddleware.rateLimit({
        maxRequests: 3,
        window: 60000
      });

      mockContext.metadata.set('clientId', 'client-2');

      // First 3 requests succeed
      for (let i = 0; i < 3; i++) {
        await middleware(mockContext, mockNext);
      }

      // 4th request should fail
      await expect(middleware(mockContext, mockNext)).rejects.toThrow(TitanError);
      await expect(middleware(mockContext, mockNext)).rejects.toMatchObject({
        code: ErrorCode.TOO_MANY_REQUESTS,
        message: 'Rate limit exceeded'
      });
    });

    it('should reset counter after time window', async () => {
      jest.useFakeTimers();

      const middleware = NetronBuiltinMiddleware.rateLimit({
        maxRequests: 2,
        window: 1000
      });

      mockContext.metadata.set('clientId', 'client-3');

      // Use up the limit
      await middleware(mockContext, mockNext);
      await middleware(mockContext, mockNext);

      // Should fail
      await expect(middleware(mockContext, mockNext)).rejects.toThrow('Rate limit exceeded');

      // Advance time beyond window
      jest.advanceTimersByTime(1001);

      // Should succeed again
      mockNext.mockClear();
      await middleware(mockContext, mockNext);
      expect(mockNext).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should use default clientId if not provided', async () => {
      const middleware = NetronBuiltinMiddleware.rateLimit({
        maxRequests: 2,
        window: 60000
      });

      // No clientId in metadata
      await middleware(mockContext, mockNext);
      await middleware(mockContext, mockNext);

      // Should fail on 3rd request
      await expect(middleware(mockContext, mockNext)).rejects.toThrow('Rate limit exceeded');
    });

    it('should handle different clients independently', async () => {
      const middleware = NetronBuiltinMiddleware.rateLimit({
        maxRequests: 1,
        window: 60000
      });

      const context1 = { ...mockContext, metadata: new Map([['clientId', 'client-a']]) };
      const context2 = { ...mockContext, metadata: new Map([['clientId', 'client-b']]) };

      await middleware(context1, mockNext);
      await middleware(context2, mockNext);

      // Both should succeed because they're different clients
      expect(mockNext).toHaveBeenCalledTimes(2);

      // Second request from client-a should fail
      await expect(middleware(context1, mockNext)).rejects.toThrow('Rate limit exceeded');
    });
  });

  describe('circuitBreaker', () => {
    it('should allow requests when circuit is closed', async () => {
      const middleware = NetronBuiltinMiddleware.circuitBreaker({
        threshold: 3,
        timeout: 60000,
        resetTimeout: 30000
      });

      await middleware(mockContext, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should open circuit after threshold failures', async () => {
      const middleware = NetronBuiltinMiddleware.circuitBreaker({
        threshold: 3,
        timeout: 60000,
        resetTimeout: 30000
      });

      const error = new Error('Service failure');
      mockNext.mockRejectedValue(error);

      // Trigger 3 failures to open circuit
      for (let i = 0; i < 3; i++) {
        await expect(middleware(mockContext, mockNext)).rejects.toThrow('Service failure');
      }

      // Circuit should now be open
      mockNext.mockClear();
      await expect(middleware(mockContext, mockNext)).rejects.toThrow(TitanError);
      await expect(middleware(mockContext, mockNext)).rejects.toMatchObject({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Circuit breaker is open'
      });

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should transition to half-open after reset timeout', async () => {
      jest.useFakeTimers();

      const middleware = NetronBuiltinMiddleware.circuitBreaker({
        threshold: 2,
        timeout: 60000,
        resetTimeout: 1000
      });

      const error = new Error('Service failure');
      mockNext.mockRejectedValue(error);

      // Open the circuit
      await expect(middleware(mockContext, mockNext)).rejects.toThrow('Service failure');
      await expect(middleware(mockContext, mockNext)).rejects.toThrow('Service failure');

      // Circuit is open
      await expect(middleware(mockContext, mockNext)).rejects.toThrow('Circuit breaker is open');

      // Advance time past reset timeout
      jest.advanceTimersByTime(1001);

      // Should allow one request in half-open state
      mockNext.mockResolvedValue(undefined);
      await middleware(mockContext, mockNext);

      // Circuit should be closed now
      expect(mockNext).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should close circuit on successful request in half-open state', async () => {
      jest.useFakeTimers();

      const middleware = NetronBuiltinMiddleware.circuitBreaker({
        threshold: 2,
        timeout: 60000,
        resetTimeout: 1000
      });

      const error = new Error('Service failure');
      mockNext.mockRejectedValue(error);

      // Open the circuit
      await expect(middleware(mockContext, mockNext)).rejects.toThrow('Service failure');
      await expect(middleware(mockContext, mockNext)).rejects.toThrow('Service failure');

      // Advance time
      jest.advanceTimersByTime(1001);

      // Successful request in half-open state
      mockNext.mockResolvedValue(undefined);
      await middleware(mockContext, mockNext);

      // Circuit should be closed, failures reset
      mockNext.mockClear();
      await middleware(mockContext, mockNext);
      expect(mockNext).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('metrics', () => {
    it('should collect metrics with collector', async () => {
      const metricsCollector = jest.fn();

      const middleware = NetronBuiltinMiddleware.metrics(metricsCollector);

      mockContext.result = { success: true };
      await middleware(mockContext, mockNext);

      expect(metricsCollector).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'TestService',
          method: 'testMethod',
          duration: expect.any(Number),
          success: true,
          timestamp: expect.any(String)
        })
      );
      expect(mockNext).toHaveBeenCalled();
    });

    it('should work without metrics collector', async () => {
      const middleware = NetronBuiltinMiddleware.metrics();

      mockContext.result = { success: true };
      await middleware(mockContext, mockNext);

      // Should not throw
      expect(mockNext).toHaveBeenCalled();
    });

    it('should mark failed requests', async () => {
      const metricsCollector = jest.fn();

      const middleware = NetronBuiltinMiddleware.metrics(metricsCollector);

      const error = new Error('Test error');
      mockNext.mockRejectedValue(error);

      await expect(middleware(mockContext, mockNext)).rejects.toThrow('Test error');

      expect(metricsCollector).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'TestService',
          method: 'testMethod',
          duration: expect.any(Number),
          success: false
        })
      );
    });
  });

  describe('logging (alias)', () => {
    it('should work as alias to loggingMiddleware', async () => {
      const logger = {
        info: jest.fn(),
        error: jest.fn()
      };

      const middleware = NetronBuiltinMiddleware.logging(logger);

      mockContext.result = { success: true };
      await middleware(mockContext, mockNext);

      expect(logger.info).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('cachingMiddleware - edge cases', () => {
    it('should not cache when result is undefined', async () => {
      const cache = new Map();

      const middleware = NetronBuiltinMiddleware.cachingMiddleware({
        cache,
        ttl: 60000
      });

      // No result set
      mockContext.result = undefined;
      await middleware(mockContext, mockNext);

      expect(cache.size).toBe(0);
    });

    it('should not cache when error is set', async () => {
      const cache = new Map();

      const middleware = NetronBuiltinMiddleware.cachingMiddleware({
        cache,
        ttl: 60000
      });

      mockContext.result = { data: 'test' };
      mockContext.error = new Error('Some error');
      await middleware(mockContext, mockNext);

      expect(cache.size).toBe(0);
    });

    it('should expire cache after TTL', async () => {
      jest.useFakeTimers();

      const cache = new Map();

      const middleware = NetronBuiltinMiddleware.cachingMiddleware({
        cache,
        ttl: 1000
      });

      mockContext.result = { data: 'cached' };
      await middleware(mockContext, mockNext);

      expect(cache.size).toBe(1);

      // Advance time past TTL
      jest.advanceTimersByTime(1001);

      // Run timers to execute setTimeout callback
      jest.runAllTimers();

      expect(cache.size).toBe(0);

      jest.useRealTimers();
    });

    it('should use custom key generator', async () => {
      const cache = new Map();
      const keyGenerator = jest.fn().mockReturnValue('custom-key');

      const middleware = NetronBuiltinMiddleware.cachingMiddleware({
        cache,
        ttl: 60000,
        keyGenerator
      });

      mockContext.result = { data: 'test' };
      await middleware(mockContext, mockNext);

      expect(keyGenerator).toHaveBeenCalledWith(mockContext);
      expect(cache.has('custom-key')).toBe(true);
    });
  });

  describe('authorizationMiddleware - user.roles array', () => {
    it('should check user.roles array when user.role is not present', async () => {
      const middleware = NetronBuiltinMiddleware.authorizationMiddleware(['admin']);

      mockContext.metadata.set('user', {
        userId: '123',
        roles: ['admin', 'user']
      });

      await middleware(mockContext, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject when user has roles array but not required role', async () => {
      const middleware = NetronBuiltinMiddleware.authorizationMiddleware(['admin']);

      mockContext.metadata.set('user', {
        userId: '123',
        roles: ['user', 'guest']
      });

      await expect(middleware(mockContext, mockNext)).rejects.toThrow(TitanError);
      await expect(middleware(mockContext, mockNext)).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN
      });
    });
  });

  describe('metricsMiddleware - edge cases', () => {
    it('should skip recording when serviceName is not present', async () => {
      const metrics = {
        recordRequest: jest.fn(),
        recordDuration: jest.fn(),
        recordError: jest.fn()
      };

      const middleware = NetronBuiltinMiddleware.metricsMiddleware(metrics);

      const contextWithoutService = {
        ...mockContext,
        serviceName: undefined,
        methodName: undefined
      };

      await middleware(contextWithoutService, mockNext);

      expect(metrics.recordRequest).not.toHaveBeenCalled();
      expect(metrics.recordDuration).not.toHaveBeenCalled();
    });

    it('should skip recording duration when serviceName is not present', async () => {
      const metrics = {
        recordRequest: jest.fn(),
        recordDuration: jest.fn(),
        recordError: jest.fn()
      };

      const middleware = NetronBuiltinMiddleware.metricsMiddleware(metrics);

      const contextWithoutService = {
        ...mockContext,
        serviceName: undefined
      };

      await middleware(contextWithoutService, mockNext);

      expect(metrics.recordRequest).not.toHaveBeenCalled();
      expect(metrics.recordDuration).not.toHaveBeenCalled();
    });

    it('should skip recording error when serviceName is not present', async () => {
      const metrics = {
        recordRequest: jest.fn(),
        recordDuration: jest.fn(),
        recordError: jest.fn()
      };

      const middleware = NetronBuiltinMiddleware.metricsMiddleware(metrics);

      const contextWithoutService = {
        ...mockContext,
        serviceName: undefined
      };

      const error = new Error('Test error');
      mockNext.mockRejectedValue(error);

      await expect(middleware(contextWithoutService, mockNext)).rejects.toThrow('Test error');

      expect(metrics.recordError).not.toHaveBeenCalled();
    });
  });

  describe('authenticationMiddleware - edge cases', () => {
    it('should handle non-Bearer token', async () => {
      const authenticator = {
        verify: jest.fn().mockResolvedValue({ userId: '123' })
      };

      const middleware = NetronBuiltinMiddleware.authenticationMiddleware(authenticator);

      mockContext.metadata.set('authorization', 'raw-token-value');

      await middleware(mockContext, mockNext);

      expect(authenticator.verify).toHaveBeenCalledWith('raw-token-value');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject non-string authorization header', async () => {
      const authenticator = {
        verify: jest.fn()
      };

      const middleware = NetronBuiltinMiddleware.authenticationMiddleware(authenticator);

      mockContext.metadata.set('authorization', 12345 as any);

      await expect(middleware(mockContext, mockNext)).rejects.toThrow(TitanError);
      await expect(middleware(mockContext, mockNext)).rejects.toMatchObject({
        code: ErrorCode.UNAUTHORIZED
      });

      expect(authenticator.verify).not.toHaveBeenCalled();
    });
  });

  describe('compressionMiddleware - edge cases', () => {
    it('should handle object results by stringifying', async () => {
      const middleware = NetronBuiltinMiddleware.compressionMiddleware({
        threshold: 10
      });

      mockContext.result = { large: 'data'.repeat(100) };

      await middleware(mockContext, mockNext);

      expect(mockContext.metadata.get('compressed')).toBe(true);
      expect(mockContext.metadata.get('originalSize')).toBeGreaterThan(10);
    });

    it('should not compress when result is null', async () => {
      const middleware = NetronBuiltinMiddleware.compressionMiddleware({
        threshold: 10
      });

      mockContext.result = null;

      await middleware(mockContext, mockNext);

      expect(mockContext.metadata.get('compressed')).toBeFalsy();
      expect(mockContext.result).toBeNull();
    });
  });

  describe('tracingMiddleware - without inject', () => {
    it('should work without inject method', async () => {
      const tracer = {
        startSpan: jest.fn().mockReturnValue({
          setTag: jest.fn(),
          finish: jest.fn()
        })
      };

      const middleware = NetronBuiltinMiddleware.tracingMiddleware(tracer);

      await middleware(mockContext, mockNext);

      expect(tracer.startSpan).toHaveBeenCalledWith('TestService.testMethod');
      expect(mockNext).toHaveBeenCalled();
    });
  });
});
