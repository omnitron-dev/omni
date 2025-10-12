/**
 * Policy Engine tests
 */

import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { PolicyEngine } from '../../../src/netron/auth/policy-engine.js';
import type { ExecutionContext, PolicyDefinition } from '../../../src/netron/auth/types.js';

describe('PolicyEngine', () => {
  let policyEngine: PolicyEngine;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      child: jest.fn().mockReturnThis(),
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };

    policyEngine = new PolicyEngine(mockLogger);
  });

  describe('Policy Registration', () => {
    it('should register a policy', () => {
      const policy: PolicyDefinition = {
        name: 'test-policy',
        description: 'Test policy',
        evaluate: () => ({ allowed: true }),
      };

      policyEngine.registerPolicy(policy);
      const policies = policyEngine.getPolicies();

      expect(policies).toHaveLength(1);
      expect(policies[0].name).toBe('test-policy');
    });

    it('should throw error when registering duplicate policy', () => {
      const policy: PolicyDefinition = {
        name: 'test-policy',
        evaluate: () => ({ allowed: true }),
      };

      policyEngine.registerPolicy(policy);

      expect(() => policyEngine.registerPolicy(policy)).toThrow('Policy already registered: test-policy');
    });

    it('should register multiple policies', () => {
      const policies: PolicyDefinition[] = [
        { name: 'policy1', evaluate: () => ({ allowed: true }) },
        { name: 'policy2', evaluate: () => ({ allowed: true }) },
        { name: 'policy3', evaluate: () => ({ allowed: true }) },
      ];

      policyEngine.registerPolicies(policies);

      expect(policyEngine.getPolicies()).toHaveLength(3);
    });

    it('should register policy with tags', () => {
      const policy: PolicyDefinition = {
        name: 'rbac-policy',
        tags: ['rbac', 'role'],
        evaluate: () => ({ allowed: true }),
      };

      policyEngine.registerPolicy(policy);

      const rbacPolicies = policyEngine.getPoliciesByTag('rbac');
      expect(rbacPolicies).toHaveLength(1);
      expect(rbacPolicies[0].name).toBe('rbac-policy');
    });
  });

  describe('Policy Evaluation', () => {
    const mockContext: ExecutionContext = {
      auth: {
        userId: 'user1',
        roles: ['user'],
        permissions: ['read'],
      },
      service: { name: 'testService', version: '1.0.0' },
      method: { name: 'testMethod', args: [] },
    };

    it('should evaluate policy and return allowed decision', async () => {
      const policy: PolicyDefinition = {
        name: 'allow-policy',
        evaluate: () => ({ allowed: true, reason: 'Always allowed' }),
      };

      policyEngine.registerPolicy(policy);
      const decision = await policyEngine.evaluate('allow-policy', mockContext);

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe('Always allowed');
      expect(decision.policyName).toBe('allow-policy');
      expect(decision.evaluationTime).toBeGreaterThanOrEqual(0);
    });

    it('should evaluate policy and return denied decision', async () => {
      const policy: PolicyDefinition = {
        name: 'deny-policy',
        evaluate: () => ({ allowed: false, reason: 'Always denied' }),
      };

      policyEngine.registerPolicy(policy);
      const decision = await policyEngine.evaluate('deny-policy', mockContext);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('Always denied');
    });

    it('should throw error for non-existent policy', async () => {
      await expect(policyEngine.evaluate('non-existent', mockContext)).rejects.toThrow(
        'Policy with id non-existent not found'
      );
    });

    it('should evaluate async policy', async () => {
      const policy: PolicyDefinition = {
        name: 'async-policy',
        evaluate: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { allowed: true, reason: 'Async success' };
        },
      };

      policyEngine.registerPolicy(policy);
      const decision = await policyEngine.evaluate('async-policy', mockContext);

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe('Async success');
    });

    it('should handle policy evaluation errors', async () => {
      const policy: PolicyDefinition = {
        name: 'error-policy',
        evaluate: () => {
          throw new Error('Policy error');
        },
      };

      policyEngine.registerPolicy(policy);
      const decision = await policyEngine.evaluate('error-policy', mockContext);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Policy evaluation failed');
      expect(decision.reason).toContain('Policy error');
    });
  });

  describe('Policy Caching', () => {
    const mockContext: ExecutionContext = {
      auth: { userId: 'user1', roles: [], permissions: [] },
      service: { name: 'testService', version: '1.0.0' },
      method: { name: 'testMethod', args: [] },
    };

    it('should cache successful policy evaluations', async () => {
      let evaluationCount = 0;

      const policy: PolicyDefinition = {
        name: 'cached-policy',
        evaluate: () => {
          evaluationCount++;
          return { allowed: true, reason: 'Cached' };
        },
      };

      policyEngine.registerPolicy(policy);

      // First evaluation
      await policyEngine.evaluate('cached-policy', mockContext);
      expect(evaluationCount).toBe(1);

      // Second evaluation should use cache
      await policyEngine.evaluate('cached-policy', mockContext);
      expect(evaluationCount).toBe(1);

      const stats = policyEngine.getCacheStats();
      expect(stats.hits).toBeGreaterThan(0);
    });

    it('should skip cache when skipCache option is true', async () => {
      let evaluationCount = 0;

      const policy: PolicyDefinition = {
        name: 'no-cache-policy',
        evaluate: () => {
          evaluationCount++;
          return { allowed: true };
        },
      };

      policyEngine.registerPolicy(policy);

      await policyEngine.evaluate('no-cache-policy', mockContext);
      await policyEngine.evaluate('no-cache-policy', mockContext, {
        skipCache: true,
      });

      expect(evaluationCount).toBe(2);
    });

    it('should clear cache', async () => {
      const policy: PolicyDefinition = {
        name: 'clear-cache-policy',
        evaluate: () => ({ allowed: true }),
      };

      policyEngine.registerPolicy(policy);
      await policyEngine.evaluate('clear-cache-policy', mockContext);

      policyEngine.clearCache();
      const stats = policyEngine.getCacheStats();

      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it('should clear cache by pattern', async () => {
      const context1: ExecutionContext = {
        ...mockContext,
        service: { name: 'service1', version: '1.0.0' },
      };
      const context2: ExecutionContext = {
        ...mockContext,
        service: { name: 'service2', version: '1.0.0' },
      };

      const policy: PolicyDefinition = {
        name: 'pattern-policy',
        evaluate: () => ({ allowed: true }),
      };

      policyEngine.registerPolicy(policy);
      await policyEngine.evaluate('pattern-policy', context1);
      await policyEngine.evaluate('pattern-policy', context2);

      policyEngine.clearCache('service1');
      const stats = policyEngine.getCacheStats();

      expect(stats.size).toBe(1); // Only service2 entry remains
    });
  });

  describe('Policy Combinations', () => {
    const mockContext: ExecutionContext = {
      auth: { userId: 'user1', roles: ['user'], permissions: ['read'] },
      service: { name: 'testService', version: '1.0.0' },
    };

    beforeEach(() => {
      policyEngine.registerPolicies([
        { name: 'allow1', evaluate: () => ({ allowed: true }) },
        { name: 'allow2', evaluate: () => ({ allowed: true }) },
        { name: 'deny1', evaluate: () => ({ allowed: false, reason: 'Denied' }) },
        { name: 'deny2', evaluate: () => ({ allowed: false, reason: 'Denied' }) },
      ]);
    });

    describe('evaluateAll (AND logic)', () => {
      it('should pass when all policies pass', async () => {
        const decision = await policyEngine.evaluateAll(['allow1', 'allow2'], mockContext);

        expect(decision.allowed).toBe(true);
        expect(decision.reason).toBe('All policies passed');
      });

      it('should fail when one policy fails', async () => {
        const decision = await policyEngine.evaluateAll(['allow1', 'deny1'], mockContext);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toBe('Denied');
      });

      it('should fail when all policies fail', async () => {
        const decision = await policyEngine.evaluateAll(['deny1', 'deny2'], mockContext);

        expect(decision.allowed).toBe(false);
      });
    });

    describe('evaluateAny (OR logic)', () => {
      it('should pass when one policy passes', async () => {
        const decision = await policyEngine.evaluateAny(['deny1', 'allow1'], mockContext);

        expect(decision.allowed).toBe(true);
      });

      it('should pass when all policies pass', async () => {
        const decision = await policyEngine.evaluateAny(['allow1', 'allow2'], mockContext);

        expect(decision.allowed).toBe(true);
      });

      it('should fail when all policies fail', async () => {
        const decision = await policyEngine.evaluateAny(['deny1', 'deny2'], mockContext);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toBe('No policies passed');
      });

      it('should short-circuit on first success', async () => {
        let secondPolicyEvaluated = false;

        policyEngine.registerPolicies([
          { name: 'first-allow', evaluate: () => ({ allowed: true }) },
          {
            name: 'second',
            evaluate: () => {
              secondPolicyEvaluated = true;
              return { allowed: true };
            },
          },
        ]);

        await policyEngine.evaluateAny(['first-allow', 'second'], mockContext);

        expect(secondPolicyEvaluated).toBe(false);
      });
    });
  });

  describe('Policy Expressions', () => {
    const mockContext: ExecutionContext = {
      auth: { userId: 'user1', roles: [], permissions: [] },
      service: { name: 'testService', version: '1.0.0' },
    };

    beforeEach(() => {
      policyEngine.registerPolicies([
        { name: 'allow', evaluate: () => ({ allowed: true }) },
        { name: 'deny', evaluate: () => ({ allowed: false }) },
      ]);
    });

    it('should evaluate string expression', async () => {
      const decision = await policyEngine.evaluateExpression('allow', mockContext);

      expect(decision.allowed).toBe(true);
    });

    it('should evaluate AND expression', async () => {
      const decision = await policyEngine.evaluateExpression({ and: ['allow', 'allow'] }, mockContext);

      expect(decision.allowed).toBe(true);
    });

    it('should fail AND expression when one fails', async () => {
      const decision = await policyEngine.evaluateExpression({ and: ['allow', 'deny'] }, mockContext);

      expect(decision.allowed).toBe(false);
    });

    it('should evaluate OR expression', async () => {
      const decision = await policyEngine.evaluateExpression({ or: ['deny', 'allow'] }, mockContext);

      expect(decision.allowed).toBe(true);
    });

    it('should evaluate NOT expression', async () => {
      const decision = await policyEngine.evaluateExpression({ not: 'deny' }, mockContext);

      expect(decision.allowed).toBe(true);
    });

    it('should evaluate complex nested expression', async () => {
      const decision = await policyEngine.evaluateExpression(
        {
          and: [
            'allow',
            {
              or: ['deny', 'allow'],
            },
          ],
        },
        mockContext
      );

      expect(decision.allowed).toBe(true);
    });
  });

  describe('Circuit Breaker', () => {
    const mockContext: ExecutionContext = {
      auth: { userId: 'user1', roles: [], permissions: [] },
      service: { name: 'testService', version: '1.0.0' },
    };

    it('should open circuit breaker after threshold failures', async () => {
      const policy: PolicyDefinition = {
        name: 'failing-policy',
        evaluate: () => {
          throw new Error('Policy failure');
        },
      };

      policyEngine.registerPolicy(policy, {
        circuitBreaker: {
          threshold: 3,
          timeout: 1000,
          resetTimeout: 5000,
        },
      });

      // Trigger failures
      await policyEngine.evaluate('failing-policy', mockContext);
      await policyEngine.evaluate('failing-policy', mockContext);
      await policyEngine.evaluate('failing-policy', mockContext);

      // Circuit should be open now
      const state = policyEngine.getCircuitBreakerState('failing-policy');
      expect(state).toBe('open');

      // Next evaluation should be rejected by circuit breaker
      const decision = await policyEngine.evaluate('failing-policy', mockContext);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('circuit breaker open');
    });
  });

  describe('Timeout Protection', () => {
    const mockContext: ExecutionContext = {
      auth: { userId: 'user1', roles: [], permissions: [] },
      service: { name: 'testService', version: '1.0.0' },
    };

    it('should timeout long-running policies', async () => {
      const policy: PolicyDefinition = {
        name: 'slow-policy',
        evaluate: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10000));
          return { allowed: true };
        },
      };

      policyEngine.registerPolicy(policy);

      const decision = await policyEngine.evaluate('slow-policy', mockContext, {
        timeout: 100,
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('timeout');
    });
  });

  describe('Debug Mode', () => {
    it('should include debug info when debug mode is enabled', async () => {
      const debugEngine = new PolicyEngine(mockLogger, { debug: true });

      debugEngine.registerPolicies([
        { name: 'policy1', evaluate: () => ({ allowed: true }) },
        { name: 'policy2', evaluate: () => ({ allowed: true }) },
      ]);

      const mockContext: ExecutionContext = {
        auth: { userId: 'user1', roles: [], permissions: [] },
        service: { name: 'testService', version: '1.0.0' },
      };

      const decision = await debugEngine.evaluateAll(['policy1', 'policy2'], mockContext);

      expect(decision.metadata?.allDecisions).toBeDefined();
    });

    it('should not include debug info when debug mode is disabled', async () => {
      policyEngine.registerPolicies([
        { name: 'policy1', evaluate: () => ({ allowed: true }) },
        { name: 'policy2', evaluate: () => ({ allowed: true }) },
      ]);

      const mockContext: ExecutionContext = {
        auth: { userId: 'user1', roles: [], permissions: [] },
        service: { name: 'testService', version: '1.0.0' },
      };

      const decision = await policyEngine.evaluateAll(['policy1', 'policy2'], mockContext);

      expect(decision.metadata?.allDecisions).toBeUndefined();
    });
  });

  describe('Cache Statistics', () => {
    it('should track cache statistics', async () => {
      const policy: PolicyDefinition = {
        name: 'stats-policy',
        evaluate: () => ({ allowed: true }),
      };

      policyEngine.registerPolicy(policy);

      const mockContext: ExecutionContext = {
        auth: { userId: 'user1', roles: [], permissions: [] },
        service: { name: 'testService', version: '1.0.0' },
      };

      // Miss
      await policyEngine.evaluate('stats-policy', mockContext);

      // Hit
      await policyEngine.evaluate('stats-policy', mockContext);

      const stats = policyEngine.getCacheStats();

      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.5);
      expect(stats.size).toBeGreaterThan(0);
    });
  });
});
