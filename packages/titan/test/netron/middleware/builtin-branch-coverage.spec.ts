/**
 * Branch coverage tests for Netron Builtin Middleware
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  NetronBuiltinMiddleware,
  type NetronMiddlewareContext,
  type MiddlewareFunction
} from '../../../src/netron/middleware/index.js';
import { TitanError } from '../../../src/errors/index.js';

describe('NetronBuiltinMiddleware - Branch Coverage', () => {
  let mockContext: NetronMiddlewareContext;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockContext = {
      peer: {} as any,
      serviceName: 'TestService',
      methodName: 'testMethod',
      metadata: new Map(),
      timing: {
        start: Date.now(),
        middlewareTimes: new Map()
      }
    };
    mockNext = jest.fn(async () => {});
  });

  describe('rateLimit - default options', () => {
    it('should use default maxRequests and window when no options provided', async () => {
      const middleware = NetronBuiltinMiddleware.rateLimit();
      mockContext.metadata.set('clientId', 'test-client');

      // Should allow default 100 requests
      for (let i = 0; i < 100; i++) {
        await middleware(mockContext, mockNext);
      }

      // 101st request should fail
      await expect(middleware(mockContext, mockNext)).rejects.toThrow('Rate limit exceeded');
    });

    it('should use custom maxRequests and window when provided', async () => {
      const middleware = NetronBuiltinMiddleware.rateLimit({
        maxRequests: 5,
        window: 1000
      });
      mockContext.metadata.set('clientId', 'test-client');

      // Should allow 5 requests
      for (let i = 0; i < 5; i++) {
        await middleware(mockContext, mockNext);
      }

      // 6th request should fail
      await expect(middleware(mockContext, mockNext)).rejects.toThrow('Rate limit exceeded');
    });
  });

  describe('circuitBreaker - default options', () => {
    it('should use default threshold, timeout, and resetTimeout when no options provided', async () => {
      const middleware = NetronBuiltinMiddleware.circuitBreaker();
      const error = new Error('Service error');
      mockNext.mockRejectedValue(error);

      // Default threshold is 5
      for (let i = 0; i < 5; i++) {
        await expect(middleware(mockContext, mockNext)).rejects.toThrow('Service error');
      }

      // Circuit should now be open
      await expect(middleware(mockContext, mockNext)).rejects.toThrow('Circuit breaker is open');
    });

    it('should use custom threshold when provided', async () => {
      const middleware = NetronBuiltinMiddleware.circuitBreaker({
        threshold: 2,
        timeout: 1000,
        resetTimeout: 500
      });
      const error = new Error('Service error');
      mockNext.mockRejectedValue(error);

      // Custom threshold is 2
      for (let i = 0; i < 2; i++) {
        await expect(middleware(mockContext, mockNext)).rejects.toThrow('Service error');
      }

      // Circuit should now be open
      await expect(middleware(mockContext, mockNext)).rejects.toThrow('Circuit breaker is open');
    });
  });

  describe('rateLimitMiddleware - retryAfter fallback', () => {
    it('should use default retryAfter value of 60 when not provided', async () => {
      const limiter = {
        check: jest.fn(async () => ({ allowed: false, retryAfter: undefined }))
      };

      const middleware = NetronBuiltinMiddleware.rateLimitMiddleware(limiter as any);

      try {
        await middleware(mockContext, mockNext);
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(TitanError.isTitanError(error)).toBe(true);
        expect(error.details?.retryAfter).toBe(60);
      }
    });

    it('should use provided retryAfter value when available', async () => {
      const limiter = {
        check: jest.fn(async () => ({ allowed: false, retryAfter: 120 }))
      };

      const middleware = NetronBuiltinMiddleware.rateLimitMiddleware(limiter as any);

      try {
        await middleware(mockContext, mockNext);
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(TitanError.isTitanError(error)).toBe(true);
        expect(error.details?.retryAfter).toBe(120);
      }
    });
  });

  describe('compressionMiddleware - threshold option', () => {
    it('should use default threshold of 1024 when options not provided', async () => {
      const middleware = NetronBuiltinMiddleware.compressionMiddleware();

      mockContext.result = 'x'.repeat(1023);
      await middleware(mockContext, mockNext);

      // Should not compress (below threshold)
      expect(mockContext.metadata.get('compressed')).toBeFalsy();
    });

    it('should use default threshold of 1024 when options.threshold not provided', async () => {
      const middleware = NetronBuiltinMiddleware.compressionMiddleware({});

      mockContext.result = 'x'.repeat(1023);
      await middleware(mockContext, mockNext);

      // Should not compress (below threshold)
      expect(mockContext.metadata.get('compressed')).toBeFalsy();
    });

    it('should use custom threshold when provided', async () => {
      const middleware = NetronBuiltinMiddleware.compressionMiddleware({ threshold: 100 });

      mockContext.result = 'x'.repeat(99);
      await middleware(mockContext, mockNext);

      // Should not compress (below custom threshold)
      expect(mockContext.metadata.get('compressed')).toBeFalsy();

      mockContext.result = 'x'.repeat(150);
      await middleware(mockContext, mockNext);

      // Should compress (above custom threshold)
      expect(mockContext.metadata.get('compressed')).toBe(true);
    });
  });

  describe('validationMiddleware - errors fallback', () => {
    it('should use empty array when validator returns no errors', async () => {
      const validator = {
        validate: jest.fn(() => ({ valid: false, errors: undefined }))
      };

      const middleware = NetronBuiltinMiddleware.validationMiddleware(validator);

      try {
        await middleware(mockContext, mockNext);
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(TitanError.isTitanError(error)).toBe(true);
        expect(error.details?.errors).toEqual([]);
      }
    });

    it('should use provided errors array when available', async () => {
      const validator = {
        validate: jest.fn(() => ({
          valid: false,
          errors: ['Error 1', 'Error 2']
        }))
      };

      const middleware = NetronBuiltinMiddleware.validationMiddleware(validator);

      try {
        await middleware(mockContext, mockNext);
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(TitanError.isTitanError(error)).toBe(true);
        expect(error.details?.errors).toEqual(['Error 1', 'Error 2']);
      }
    });
  });
});
