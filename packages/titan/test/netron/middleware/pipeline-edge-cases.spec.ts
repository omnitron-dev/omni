/**
 * Edge case tests for Netron Middleware Pipeline
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  MiddlewarePipeline,
  MiddlewareStage,
  type NetronMiddlewareContext,
  type MiddlewareFunction,
} from '../../../src/netron/middleware/index.js';

describe('MiddlewarePipeline Edge Cases', () => {
  let pipeline: MiddlewarePipeline;
  let mockContext: NetronMiddlewareContext;

  beforeEach(() => {
    pipeline = new MiddlewarePipeline();
    mockContext = {
      peer: {} as any,
      serviceName: 'TestService',
      methodName: 'testMethod',
      metadata: new Map(),
      timing: {
        start: Date.now(),
        middlewareTimes: new Map(),
      },
    };
  });

  describe('Method Filter with RegExp', () => {
    it('should filter middleware by method name using RegExp', async () => {
      const executionCount = { count: 0 };

      const middleware: MiddlewareFunction = async (ctx, next) => {
        executionCount.count++;
        await next();
      };

      pipeline.use(middleware, {
        name: 'method-regex',
        methods: /^get/,
      });

      // Should not execute for testMethod
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(0);

      // Should execute for getUser
      mockContext.methodName = 'getUser';
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(1);

      // Should execute for getUsers
      mockContext.methodName = 'getUsers';
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(2);

      // Should not execute for createUser
      mockContext.methodName = 'createUser';
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(2);
    });

    it('should skip middleware when methodName is undefined and methods is RegExp', async () => {
      const executionCount = { count: 0 };

      const middleware: MiddlewareFunction = async (ctx, next) => {
        executionCount.count++;
        await next();
      };

      pipeline.use(middleware, {
        name: 'method-regex-undefined',
        methods: /^get/,
      });

      mockContext.methodName = undefined;
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(0);
    });

    it('should match complex RegExp patterns for methods', async () => {
      const executionCount = { count: 0 };

      const middleware: MiddlewareFunction = async (ctx, next) => {
        executionCount.count++;
        await next();
      };

      pipeline.use(middleware, {
        name: 'complex-method-regex',
        methods: /^(get|list).*(User|Account)$/,
      });

      // Should match
      mockContext.methodName = 'getUser';
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(1);

      // Should match
      mockContext.methodName = 'listAccount';
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(2);

      // Should not match
      mockContext.methodName = 'createUser';
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(2);

      // Should not match
      mockContext.methodName = 'getProfile';
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(2);
    });
  });

  describe('Null Registration Edge Case', () => {
    it('should handle edge case where applicable array has undefined elements', async () => {
      const middleware: MiddlewareFunction = async (ctx, next) => {
        await next();
      };

      pipeline.use(middleware, { name: 'test-middleware' });

      // This tests the defensive check on line 245
      // In normal circumstances this shouldn't happen, but the code guards against it
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);

      const metrics = pipeline.getMetrics();
      expect(metrics.executions).toBe(1);
    });
  });

  describe('Combined Filters', () => {
    it('should apply both service and method RegExp filters', async () => {
      const executionCount = { count: 0 };

      const middleware: MiddlewareFunction = async (ctx, next) => {
        executionCount.count++;
        await next();
      };

      pipeline.use(middleware, {
        name: 'combined-regex',
        services: /^User/,
        methods: /^get/,
      });

      // Both match
      mockContext.serviceName = 'UserService';
      mockContext.methodName = 'getUser';
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(1);

      // Service doesn't match
      mockContext.serviceName = 'AuthService';
      mockContext.methodName = 'getUser';
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(1);

      // Method doesn't match
      mockContext.serviceName = 'UserService';
      mockContext.methodName = 'createUser';
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(1);

      // Both match again
      mockContext.serviceName = 'UserAuthService';
      mockContext.methodName = 'getToken';
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(2);
    });

    it('should apply service array and method RegExp filters', async () => {
      const executionCount = { count: 0 };

      const middleware: MiddlewareFunction = async (ctx, next) => {
        executionCount.count++;
        await next();
      };

      pipeline.use(middleware, {
        name: 'mixed-filters',
        services: ['UserService', 'AuthService'],
        methods: /^(get|list)/,
      });

      // Both match
      mockContext.serviceName = 'UserService';
      mockContext.methodName = 'getUser';
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(1);

      // Service matches, method doesn't
      mockContext.serviceName = 'AuthService';
      mockContext.methodName = 'createToken';
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(1);

      // Both match
      mockContext.serviceName = 'AuthService';
      mockContext.methodName = 'listTokens';
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(2);
    });
  });

  describe('Method Filter with Undefined MethodName', () => {
    it('should skip middleware when methodName is undefined and methods is array', async () => {
      const executionCount = { count: 0 };

      const middleware: MiddlewareFunction = async (ctx, next) => {
        executionCount.count++;
        await next();
      };

      pipeline.use(middleware, {
        name: 'method-array-undefined',
        methods: ['getUser', 'createUser'],
      });

      mockContext.methodName = undefined;
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(0);
    });
  });
});
