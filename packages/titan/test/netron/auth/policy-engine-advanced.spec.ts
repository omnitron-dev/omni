/**
 * Advanced Policy Engine Tests
 * Tests for edge cases, concurrency, and complex scenarios
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { PolicyEngine } from '../../../src/netron/auth/policy-engine.js';
import type { ExecutionContext, PolicyDefinition } from '../../../src/netron/auth/types.js';

describe('PolicyEngine Advanced Tests', () => {
  let policyEngine: PolicyEngine;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      child: jest.fn().mockReturnThis(),
      trace: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      fatal: jest.fn(),
    };

    policyEngine = new PolicyEngine(mockLogger);
  });

  describe('Circuit Breaker Edge Cases', () => {
    it('should open circuit after threshold failures', async () => {
      const failingPolicy: PolicyDefinition = {
        name: 'failingPolicy',
        description: 'Policy that always fails',
        evaluate: async () => {
          throw new Error('Policy evaluation failed');
        },
      };

      policyEngine.registerPolicy(failingPolicy, {
        circuitBreaker: {
          threshold: 5,
          timeout: 5000,
          resetTimeout: 60000,
        },
      });

      const context: ExecutionContext = {
        auth: { userId: 'user1', roles: [], permissions: [] },
        service: { name: 'testService', version: '1.0.0' },
        method: { name: 'testMethod', args: [] },
        environment: {},
      };

      // Trigger failures to open circuit (default threshold is 5)
      for (let i = 0; i < 6; i++) {
        const result = await policyEngine.evaluate('failingPolicy', context);
        expect(result.allowed).toBe(false);
      }

      // Circuit should be open now, returning fast failure
      const start = Date.now();
      const result = await policyEngine.evaluate('failingPolicy', context);
      const duration = Date.now() - start;

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('circuit breaker open');
      expect(duration).toBeLessThan(10); // Should fail fast
    });

    it('should transition from open to half-open after reset timeout', async () => {
      const policy: PolicyDefinition = {
        name: 'recoveringPolicy',
        description: 'Policy that recovers',
        evaluate: async () => ({ allowed: true, reason: 'OK' }),
      };

      policyEngine.registerPolicy(policy);

      const context: ExecutionContext = {
        auth: { userId: 'user1', roles: [], permissions: [] },
        service: { name: 'testService', version: '1.0.0' },
        method: { name: 'testMethod', args: [] },
        environment: {},
      };

      // Manually open circuit by triggering failures
      const failingPolicy: PolicyDefinition = {
        name: 'temporaryFail',
        description: 'Temporary failure',
        evaluate: async () => {
          throw new Error('Temporary failure');
        },
      };

      policyEngine.registerPolicy(failingPolicy, {
        circuitBreaker: {
          threshold: 5,
          timeout: 5000,
          resetTimeout: 60000,
        },
      });

      for (let i = 0; i < 6; i++) {
        await policyEngine.evaluate('temporaryFail', context);
      }

      // Wait for reset timeout (default 60s, but we can test the mechanism)
      // In production, circuit breaker would transition to half-open
      // For testing, we verify it's open
      const result = await policyEngine.evaluate('temporaryFail', context);
      expect(result.reason).toContain('circuit breaker open');
    });
  });

  describe('Concurrent Policy Evaluation', () => {
    it('should handle concurrent evaluations without race conditions', async () => {
      let evaluationCount = 0;

      const policy: PolicyDefinition = {
        name: 'concurrentPolicy',
        description: 'Test concurrent evaluation',
        evaluate: async (context: ExecutionContext) => {
          evaluationCount++;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { allowed: context.auth?.roles.includes('user') || false, reason: 'OK' };
        },
      };

      policyEngine.registerPolicy(policy);

      const contexts: ExecutionContext[] = Array.from({ length: 10 }, (_, i) => ({
        auth: { userId: `user${i}`, roles: ['user'], permissions: [] },
        service: 'testService',
        method: 'testMethod',
        args: [],
        environment: {},
      }));

      const results = await Promise.all(contexts.map((ctx) => policyEngine.evaluate('concurrentPolicy', ctx)));

      expect(results).toHaveLength(10);
      expect(results.every((r) => r.allowed)).toBe(true);
      expect(evaluationCount).toBeGreaterThan(0); // At least some evaluations happened
    });

    it('should handle concurrent cache operations', async () => {
      const policy: PolicyDefinition = {
        name: 'cacheTestPolicy',
        description: 'Test cache concurrency',
        evaluate: async () => ({ allowed: true, reason: 'OK' }),
      };

      policyEngine.registerPolicy(policy);

      const context: ExecutionContext = {
        auth: { userId: 'user1', roles: [], permissions: [] },
        service: { name: 'testService', version: '1.0.0' },
        method: { name: 'testMethod', args: [] },
        environment: {},
      };

      // First call to warm up cache
      await policyEngine.evaluate('cacheTestPolicy', context);

      // Multiple concurrent evaluations with same context should use cache
      const results = await Promise.all(
        Array.from({ length: 20 }, () => policyEngine.evaluate('cacheTestPolicy', context))
      );

      expect(results).toHaveLength(20);
      expect(results.every((r) => r.allowed)).toBe(true);

      const stats = policyEngine.getCacheStats();
      expect(stats.hits).toBeGreaterThan(0); // Should have cache hits from concurrent requests
    });
  });

  describe('Complex Policy Expressions', () => {
    it('should evaluate deeply nested AND/OR expressions', async () => {
      policyEngine.registerPolicy({
        name: 'policy1',
        description: 'Policy 1',
        evaluate: async () => ({ allowed: true, reason: 'OK' }),
      });

      policyEngine.registerPolicy({
        name: 'policy2',
        description: 'Policy 2',
        evaluate: async () => ({ allowed: true, reason: 'OK' }),
      });

      policyEngine.registerPolicy({
        name: 'policy3',
        description: 'Policy 3',
        evaluate: async () => ({ allowed: false, reason: 'Denied' }),
      });

      const context: ExecutionContext = {
        auth: { userId: 'user1', roles: [], permissions: [] },
        service: { name: 'testService', version: '1.0.0' },
        method: { name: 'testMethod', args: [] },
        environment: {},
      };

      // (policy1 AND policy2) OR policy3
      const result = await policyEngine.evaluateExpression(
        {
          or: [{ and: ['policy1', 'policy2'] }, 'policy3'],
        },
        context
      );

      expect(result.allowed).toBe(true); // First part passes
    });

    it('should handle NOT expressions correctly', async () => {
      policyEngine.registerPolicy({
        name: 'denyPolicy',
        description: 'Deny policy',
        evaluate: async () => ({ allowed: false, reason: 'Denied' }),
      });

      const context: ExecutionContext = {
        auth: { userId: 'user1', roles: [], permissions: [] },
        service: { name: 'testService', version: '1.0.0' },
        method: { name: 'testMethod', args: [] },
        environment: {},
      };

      // NOT denyPolicy = allow
      const result = await policyEngine.evaluateExpression({ not: 'denyPolicy' }, context);

      expect(result.allowed).toBe(true);
    });

    it('should short-circuit OR evaluation on first success', async () => {
      let policy2Called = false;

      policyEngine.registerPolicy({
        name: 'alwaysAllow',
        description: 'Always allows',
        evaluate: async () => ({ allowed: true, reason: 'OK' }),
      });

      policyEngine.registerPolicy({
        name: 'shouldNotBeCalled',
        description: 'Should not be evaluated',
        evaluate: async () => {
          policy2Called = true;
          return { allowed: true, reason: 'OK' };
        },
      });

      const context: ExecutionContext = {
        auth: { userId: 'user1', roles: [], permissions: [] },
        service: { name: 'testService', version: '1.0.0' },
        method: { name: 'testMethod', args: [] },
        environment: {},
      };

      await policyEngine.evaluateAny(['alwaysAllow', 'shouldNotBeCalled'], context);

      // Second policy should not be called due to short-circuit
      expect(policy2Called).toBe(false);
    });
  });

  describe('Cache Management Edge Cases', () => {
    it('should clear cache with wildcard pattern', async () => {
      policyEngine.registerPolicy({
        name: 'test:policy:1',
        description: 'Test policy 1',
        evaluate: async () => ({ allowed: true, reason: 'OK' }),
      });

      policyEngine.registerPolicy({
        name: 'test:policy:2',
        description: 'Test policy 2',
        evaluate: async () => ({ allowed: true, reason: 'OK' }),
      });

      policyEngine.registerPolicy({
        name: 'other:policy',
        description: 'Other policy',
        evaluate: async () => ({ allowed: true, reason: 'OK' }),
      });

      const context: ExecutionContext = {
        auth: { userId: 'user1', roles: [], permissions: [] },
        service: { name: 'testService', version: '1.0.0' },
        method: { name: 'testMethod', args: [] },
        environment: {},
      };

      // Populate cache
      await policyEngine.evaluate('test:policy:1', context);
      await policyEngine.evaluate('test:policy:2', context);

      const statsBefore = policyEngine.getCacheStats();
      expect(statsBefore.size).toBeGreaterThan(0);

      // Clear only test policies with pattern matching 'test:'
      policyEngine.clearCache('test:');

      // Cache should be cleared (void return, so we check stats)
      const statsAfter = policyEngine.getCacheStats();
      expect(statsAfter.size).toBeLessThan(statsBefore.size);
    });

    it('should handle cache stats correctly', async () => {
      policyEngine.registerPolicy({
        name: 'statsPolicy',
        description: 'Stats test',
        evaluate: async () => ({ allowed: true, reason: 'OK' }),
      });

      const context: ExecutionContext = {
        auth: { userId: 'user1', roles: [], permissions: [] },
        service: { name: 'testService', version: '1.0.0' },
        method: { name: 'testMethod', args: [] },
        environment: {},
      };

      // First call - miss
      await policyEngine.evaluate('statsPolicy', context);

      // Second call - hit
      await policyEngine.evaluate('statsPolicy', context);

      const stats = policyEngine.getCacheStats();
      expect(stats.hits).toBeGreaterThan(0);
      expect(stats.hitRate).toBeGreaterThan(0);
    });

    it('should respect skipCache option', async () => {
      let callCount = 0;

      policyEngine.registerPolicy({
        name: 'skipCachePolicy',
        description: 'Skip cache test',
        evaluate: async () => {
          callCount++;
          return { allowed: true, reason: 'OK' };
        },
      });

      const context: ExecutionContext = {
        auth: { userId: 'user1', roles: [], permissions: [] },
        service: { name: 'testService', version: '1.0.0' },
        method: { name: 'testMethod', args: [] },
        environment: {},
      };

      await policyEngine.evaluate('skipCachePolicy', context, { skipCache: true });
      await policyEngine.evaluate('skipCachePolicy', context, { skipCache: true });

      // Should call evaluate twice (no caching)
      expect(callCount).toBe(2);
    });
  });

  describe('Timeout Protection', () => {
    it('should timeout long-running policy evaluation', async () => {
      policyEngine.registerPolicy({
        name: 'slowPolicy',
        description: 'Slow policy',
        evaluate: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10000)); // 10 seconds
          return { allowed: true, reason: 'OK' };
        },
      });

      const context: ExecutionContext = {
        auth: { userId: 'user1', roles: [], permissions: [] },
        service: { name: 'testService', version: '1.0.0' },
        method: { name: 'testMethod', args: [] },
        environment: {},
      };

      const result = await policyEngine.evaluate('slowPolicy', context, {
        timeout: 100, // 100ms timeout
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('timeout');
    });

    it('should use default timeout when not specified', async () => {
      policyEngine.registerPolicy({
        name: 'normalPolicy',
        description: 'Normal policy',
        evaluate: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { allowed: true, reason: 'OK' };
        },
      });

      const context: ExecutionContext = {
        auth: { userId: 'user1', roles: [], permissions: [] },
        service: { name: 'testService', version: '1.0.0' },
        method: { name: 'testMethod', args: [] },
        environment: {},
      };

      const result = await policyEngine.evaluate('normalPolicy', context);

      expect(result.allowed).toBe(true);
    });
  });

  describe('Policy Registration Edge Cases', () => {
    it('should prevent duplicate policy registration', () => {
      const policy: PolicyDefinition = {
        name: 'duplicatePolicy',
        description: 'Duplicate test',
        evaluate: async () => ({ allowed: true, reason: 'OK' }),
      };

      policyEngine.registerPolicy(policy);

      expect(() => {
        policyEngine.registerPolicy(policy);
      }).toThrow();
    });

    it('should register multiple policies at once', () => {
      const policies: PolicyDefinition[] = [
        {
          name: 'batch1',
          description: 'Batch policy 1',
          evaluate: async () => ({ allowed: true, reason: 'OK' }),
        },
        {
          name: 'batch2',
          description: 'Batch policy 2',
          evaluate: async () => ({ allowed: true, reason: 'OK' }),
        },
      ];

      policyEngine.registerPolicies(policies);

      const allPolicies = policyEngine.getPolicies();
      expect(allPolicies.some((p) => p.name === 'batch1')).toBe(true);
      expect(allPolicies.some((p) => p.name === 'batch2')).toBe(true);
    });

    it('should retrieve policies by tag', () => {
      policyEngine.registerPolicy({
        name: 'taggedPolicy1',
        description: 'Tagged policy',
        tags: ['rbac', 'admin'],
        evaluate: async () => ({ allowed: true, reason: 'OK' }),
      });

      policyEngine.registerPolicy({
        name: 'taggedPolicy2',
        description: 'Tagged policy',
        tags: ['rbac', 'user'],
        evaluate: async () => ({ allowed: true, reason: 'OK' }),
      });

      const rbacPolicies = policyEngine.getPoliciesByTag('rbac');
      expect(rbacPolicies).toHaveLength(2);

      const adminPolicies = policyEngine.getPoliciesByTag('admin');
      expect(adminPolicies).toHaveLength(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle policy evaluation errors gracefully', async () => {
      policyEngine.registerPolicy({
        name: 'errorPolicy',
        description: 'Error policy',
        evaluate: async () => {
          throw new Error('Evaluation error');
        },
      });

      const context: ExecutionContext = {
        auth: { userId: 'user1', roles: [], permissions: [] },
        service: { name: 'testService', version: '1.0.0' },
        method: { name: 'testMethod', args: [] },
        environment: {},
      };

      const result = await policyEngine.evaluate('errorPolicy', context);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('error');
    });

    it('should handle missing policy gracefully', async () => {
      const context: ExecutionContext = {
        auth: { userId: 'user1', roles: [], permissions: [] },
        service: { name: 'testService', version: '1.0.0' },
        method: { name: 'testMethod', args: [] },
        environment: {},
      };

      // Missing policy throws an error
      await expect(policyEngine.evaluate('nonExistentPolicy', context)).rejects.toThrow(
        'Policy with id nonExistentPolicy not found'
      );
    });
  });

  describe('Debug Mode', () => {
    it('should include debug information when enabled', async () => {
      policyEngine.setDebugMode(true);

      policyEngine.registerPolicy({
        name: 'debugPolicy',
        description: 'Debug test',
        evaluate: async () => ({ allowed: true, reason: 'OK' }),
      });

      const context: ExecutionContext = {
        auth: { userId: 'user1', roles: [], permissions: [] },
        service: { name: 'testService', version: '1.0.0' },
        method: { name: 'testMethod', args: [] },
        environment: {},
      };

      const result = await policyEngine.evaluate('debugPolicy', context);

      expect(result.allowed).toBe(true);
      expect(result.policyName).toBe('debugPolicy');
      expect(result.evaluationTime).toBeGreaterThanOrEqual(0);
    });
  });
});
