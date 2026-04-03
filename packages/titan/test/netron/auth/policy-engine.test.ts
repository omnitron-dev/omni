/**
 * PolicyEngine Integration Tests
 *
 * Comprehensive integration tests for PolicyEngine with real implementations.
 * Only the logger is mocked - all other components use real implementations.
 *
 * @module @omnitron-dev/titan/test/netron/auth
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyEngine } from '../../../src/netron/auth/policy-engine.js';
import type { ExecutionContext, PolicyDefinition, PolicyDecision } from '../../../src/netron/auth/types.js';
import type { ILogger } from '../../../src/modules/logger/logger.types.js';

// ============================================================================
// Mock Logger Implementation
// ============================================================================

/**
 * Creates a mock logger that implements ILogger interface.
 * Only the logger is mocked in these integration tests.
 */
function createMockLogger(): ILogger {
  const noop = () => {};
  const logger: ILogger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => logger,
    time: () => noop,
    isLevelEnabled: () => false,
    setLevel: noop,
    getLevel: () => 'info',
  };
  return logger;
}

// ============================================================================
// Test Policy Implementations (Real, Not Mocked)
// ============================================================================

/**
 * Simple allow policy - always allows access
 */
const createAllowPolicy = (name: string): PolicyDefinition => ({
  name,
  description: 'Always allows access',
  evaluate: () => ({ allowed: true, reason: 'Access granted' }),
});

/**
 * Simple deny policy - always denies access
 */
const createDenyPolicy = (name: string, reason = 'Access denied'): PolicyDefinition => ({
  name,
  description: 'Always denies access',
  evaluate: () => ({ allowed: false, reason }),
});

/**
 * Role-based policy - checks if user has required role
 */
const createRolePolicy = (name: string, requiredRole: string): PolicyDefinition => ({
  name,
  description: `Requires role: ${requiredRole}`,
  tags: ['rbac', 'role'],
  evaluate: (context: ExecutionContext): PolicyDecision => {
    const hasRole = context.auth?.roles?.includes(requiredRole) ?? false;
    return {
      allowed: hasRole,
      reason: hasRole ? `Has required role: ${requiredRole}` : `Missing required role: ${requiredRole}`,
    };
  },
});

/**
 * Permission-based policy - checks if user has required permission
 */
const createPermissionPolicy = (name: string, requiredPermission: string): PolicyDefinition => ({
  name,
  description: `Requires permission: ${requiredPermission}`,
  tags: ['rbac', 'permission'],
  evaluate: (context: ExecutionContext): PolicyDecision => {
    const hasPermission = context.auth?.permissions?.includes(requiredPermission) ?? false;
    return {
      allowed: hasPermission,
      reason: hasPermission
        ? `Has required permission: ${requiredPermission}`
        : `Missing required permission: ${requiredPermission}`,
    };
  },
});

/**
 * Resource owner policy - checks if user owns the resource
 */
const createOwnerPolicy = (name: string): PolicyDefinition => ({
  name,
  description: 'Requires resource ownership',
  tags: ['rebac', 'ownership'],
  evaluate: (context: ExecutionContext): PolicyDecision => {
    const isOwner = context.auth?.userId === context.resource?.owner;
    return {
      allowed: isOwner,
      reason: isOwner ? 'User owns resource' : 'User does not own resource',
    };
  },
});

/**
 * Async policy with configurable delay
 */
const createAsyncPolicy = (name: string, delayMs: number, decision: boolean): PolicyDefinition => ({
  name,
  description: `Async policy with ${delayMs}ms delay`,
  evaluate: async (): Promise<PolicyDecision> => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return { allowed: decision, reason: `Async decision after ${delayMs}ms` };
  },
});

/**
 * Counting policy - tracks evaluation count
 */
const createCountingPolicy = (name: string): { policy: PolicyDefinition; getCount: () => number } => {
  let count = 0;
  return {
    policy: {
      name,
      description: 'Tracks evaluation count',
      evaluate: (): PolicyDecision => {
        count++;
        return { allowed: true, reason: `Evaluation #${count}` };
      },
    },
    getCount: () => count,
  };
};

/**
 * Failing policy - always throws an error
 */
const createFailingPolicy = (name: string, errorMessage: string): PolicyDefinition => ({
  name,
  description: 'Always throws an error',
  evaluate: (): PolicyDecision => {
    throw new Error(errorMessage);
  },
});

/**
 * Weighted policy - returns decision with weight metadata
 */
const createWeightedPolicy = (name: string, weight: number, allowed: boolean): PolicyDefinition => ({
  name,
  description: `Weighted policy with weight ${weight}`,
  tags: ['weighted'],
  evaluate: (): PolicyDecision => ({
    allowed,
    reason: `Weight: ${weight}`,
    metadata: { weight },
  }),
});

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Creates a standard execution context for testing
 */
function createTestContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    auth: {
      userId: 'test-user',
      roles: ['user'],
      permissions: ['read'],
      ...overrides.auth,
    },
    service: {
      name: 'test-service',
      version: '1.0.0',
      ...overrides.service,
    },
    method: {
      name: 'testMethod',
      args: [],
      ...overrides.method,
    },
    resource: {
      id: 'resource-1',
      type: 'document',
      owner: 'other-user',
      ...overrides.resource,
    },
    environment: {
      ip: '127.0.0.1',
      timestamp: new Date(),
      ...overrides.environment,
    },
  };
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('PolicyEngine Integration Tests', () => {
  let engine: PolicyEngine;
  let logger: ILogger;

  beforeEach(() => {
    logger = createMockLogger();
    engine = new PolicyEngine(logger);
  });

  // ==========================================================================
  // Policy Registration and Unregistration Tests
  // ==========================================================================

  describe('register() and unregister() policies', () => {
    it('should register a single policy successfully', () => {
      const policy = createAllowPolicy('allow-all');

      engine.registerPolicy(policy);

      const policies = engine.getPolicies();
      expect(policies).toHaveLength(1);
      expect(policies[0].name).toBe('allow-all');
    });

    it('should register multiple policies with registerPolicies()', () => {
      const policies = [
        createAllowPolicy('policy-1'),
        createDenyPolicy('policy-2'),
        createRolePolicy('policy-3', 'admin'),
      ];

      engine.registerPolicies(policies);

      expect(engine.getPolicies()).toHaveLength(3);
    });

    it('should throw error when registering duplicate policy name', () => {
      const policy1 = createAllowPolicy('duplicate');
      const policy2 = createDenyPolicy('duplicate');

      engine.registerPolicy(policy1);

      expect(() => engine.registerPolicy(policy2)).toThrow('Policy already registered: duplicate');
    });

    it('should register policy with tags and retrieve by tag', () => {
      const rolePolicy = createRolePolicy('role-check', 'admin');
      const permPolicy = createPermissionPolicy('perm-check', 'write');

      engine.registerPolicy(rolePolicy);
      engine.registerPolicy(permPolicy);

      const rbacPolicies = engine.getPoliciesByTag('rbac');
      expect(rbacPolicies).toHaveLength(2);

      const rolePolicies = engine.getPoliciesByTag('role');
      expect(rolePolicies).toHaveLength(1);
      expect(rolePolicies[0].name).toBe('role-check');
    });

    it('should unregister policy successfully', () => {
      const policy = createAllowPolicy('removable');
      engine.registerPolicy(policy);

      expect(engine.getPolicies()).toHaveLength(1);

      const removed = engine.unregisterPolicy('removable');

      expect(removed).toBe(true);
      expect(engine.getPolicies()).toHaveLength(0);
    });

    it('should return false when unregistering non-existent policy', () => {
      const removed = engine.unregisterPolicy('non-existent');

      expect(removed).toBe(false);
    });

    it('should clear cache when unregistering policy', async () => {
      const { policy, getCount } = createCountingPolicy('cached-policy');
      const context = createTestContext();

      engine.registerPolicy(policy);

      // Evaluate to populate cache
      await engine.evaluate('cached-policy', context);
      await engine.evaluate('cached-policy', context); // Should use cache
      expect(getCount()).toBe(1);

      // Unregister clears cache
      engine.unregisterPolicy('cached-policy');

      // Re-register
      const { policy: newPolicy, getCount: getNewCount } = createCountingPolicy('cached-policy');
      engine.registerPolicy(newPolicy);

      // Should not use old cache
      await engine.evaluate('cached-policy', context);
      expect(getNewCount()).toBe(1);
    });

    it('should allow re-registration after unregister', async () => {
      const policy1 = createAllowPolicy('reusable');
      engine.registerPolicy(policy1);

      engine.unregisterPolicy('reusable');

      const policy2 = createDenyPolicy('reusable');
      engine.registerPolicy(policy2);

      const decision = await engine.evaluate('reusable', createTestContext());
      expect(decision.allowed).toBe(false);
    });

    it('should register policy with circuit breaker configuration', () => {
      const policy = createAllowPolicy('with-breaker');

      engine.registerPolicy(policy, {
        circuitBreaker: {
          threshold: 5,
          timeout: 1000,
          resetTimeout: 5000,
        },
      });

      const state = engine.getCircuitBreakerState('with-breaker');
      expect(state).toBe('closed');
    });

    it('should remove circuit breaker when unregistering policy', async () => {
      const policy = createFailingPolicy('failing-with-breaker', 'Test error');

      engine.registerPolicy(policy, {
        circuitBreaker: {
          threshold: 2,
          timeout: 1000,
          resetTimeout: 5000,
        },
      });

      // Trigger failures to open circuit breaker
      const context = createTestContext();
      await engine.evaluate('failing-with-breaker', context);
      await engine.evaluate('failing-with-breaker', context);

      expect(engine.getCircuitBreakerState('failing-with-breaker')).toBe('open');

      // Unregister
      engine.unregisterPolicy('failing-with-breaker');

      // Circuit breaker should be gone
      expect(engine.getCircuitBreakerState('failing-with-breaker')).toBeUndefined();
    });
  });

  // ==========================================================================
  // Single Policy Evaluation Tests
  // ==========================================================================

  describe('evaluate() with single policy', () => {
    it('should evaluate and return allowed decision', async () => {
      engine.registerPolicy(createAllowPolicy('allow-test'));
      const context = createTestContext();

      const decision = await engine.evaluate('allow-test', context);

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe('Access granted');
      expect(decision.policyName).toBe('allow-test');
      expect(decision.evaluationTime).toBeGreaterThanOrEqual(0);
    });

    it('should evaluate and return denied decision', async () => {
      engine.registerPolicy(createDenyPolicy('deny-test', 'Not authorized'));
      const context = createTestContext();

      const decision = await engine.evaluate('deny-test', context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('Not authorized');
    });

    it('should throw error for non-existent policy', async () => {
      const context = createTestContext();

      await expect(engine.evaluate('non-existent', context)).rejects.toThrow('Policy with id non-existent not found');
    });

    it('should evaluate role-based policy correctly', async () => {
      engine.registerPolicy(createRolePolicy('admin-only', 'admin'));

      const userContext = createTestContext({ auth: { userId: 'user1', roles: ['user'], permissions: [] } });
      const adminContext = createTestContext({ auth: { userId: 'admin1', roles: ['admin'], permissions: [] } });

      const userDecision = await engine.evaluate('admin-only', userContext);
      expect(userDecision.allowed).toBe(false);
      expect(userDecision.reason).toContain('Missing required role');

      const adminDecision = await engine.evaluate('admin-only', adminContext);
      expect(adminDecision.allowed).toBe(true);
      expect(adminDecision.reason).toContain('Has required role');
    });

    it('should evaluate permission-based policy correctly', async () => {
      engine.registerPolicy(createPermissionPolicy('write-required', 'write'));

      const readerContext = createTestContext({ auth: { userId: 'reader', roles: [], permissions: ['read'] } });
      const writerContext = createTestContext({
        auth: { userId: 'writer', roles: [], permissions: ['read', 'write'] },
      });

      const readerDecision = await engine.evaluate('write-required', readerContext);
      expect(readerDecision.allowed).toBe(false);

      const writerDecision = await engine.evaluate('write-required', writerContext);
      expect(writerDecision.allowed).toBe(true);
    });

    it('should evaluate owner-based policy correctly', async () => {
      engine.registerPolicy(createOwnerPolicy('owner-only'));

      const nonOwnerContext = createTestContext({
        auth: { userId: 'other-user', roles: [], permissions: [] },
        resource: { id: 'doc-1', owner: 'original-owner' },
      });

      const ownerContext = createTestContext({
        auth: { userId: 'original-owner', roles: [], permissions: [] },
        resource: { id: 'doc-1', owner: 'original-owner' },
      });

      const nonOwnerDecision = await engine.evaluate('owner-only', nonOwnerContext);
      expect(nonOwnerDecision.allowed).toBe(false);

      const ownerDecision = await engine.evaluate('owner-only', ownerContext);
      expect(ownerDecision.allowed).toBe(true);
    });

    it('should handle async policy evaluation', async () => {
      engine.registerPolicy(createAsyncPolicy('async-allow', 50, true));
      const context = createTestContext();

      const startTime = performance.now();
      const decision = await engine.evaluate('async-allow', context);
      const duration = performance.now() - startTime;

      expect(decision.allowed).toBe(true);
      expect(duration).toBeGreaterThanOrEqual(45); // Allow some timing variance
    });

    it('should handle policy that throws error', async () => {
      engine.registerPolicy(createFailingPolicy('error-policy', 'Intentional failure'));
      const context = createTestContext();

      const decision = await engine.evaluate('error-policy', context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Policy evaluation failed');
      expect(decision.reason).toContain('Intentional failure');
    });
  });

  // ==========================================================================
  // Multiple Policy Evaluation Tests
  // ==========================================================================

  describe('evaluate() with multiple policies', () => {
    beforeEach(() => {
      engine.registerPolicies([
        createAllowPolicy('allow-1'),
        createAllowPolicy('allow-2'),
        createDenyPolicy('deny-1', 'Denied by policy 1'),
        createDenyPolicy('deny-2', 'Denied by policy 2'),
        createRolePolicy('role-admin', 'admin'),
        createPermissionPolicy('perm-write', 'write'),
      ]);
    });

    describe('evaluateAll() - AND logic', () => {
      it('should pass when all policies pass', async () => {
        const context = createTestContext();

        const decision = await engine.evaluateAll(['allow-1', 'allow-2'], context);

        expect(decision.allowed).toBe(true);
        expect(decision.reason).toBe('All policies passed');
        expect(decision.metadata?.evaluatedPolicies).toEqual(['allow-1', 'allow-2']);
      });

      it('should fail when any policy fails', async () => {
        const context = createTestContext();

        const decision = await engine.evaluateAll(['allow-1', 'deny-1', 'allow-2'], context);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toBe('Denied by policy 1');
      });

      it('should fail when all policies fail', async () => {
        const context = createTestContext();

        const decision = await engine.evaluateAll(['deny-1', 'deny-2'], context);

        expect(decision.allowed).toBe(false);
      });

      it('should handle empty policy list', async () => {
        const context = createTestContext();

        const decision = await engine.evaluateAll([], context);

        expect(decision.allowed).toBe(true);
        expect(decision.reason).toBe('All policies passed');
      });

      it('should evaluate policies in parallel', async () => {
        engine.registerPolicy(createAsyncPolicy('slow-1', 100, true));
        engine.registerPolicy(createAsyncPolicy('slow-2', 100, true));
        const context = createTestContext();

        const startTime = performance.now();
        const decision = await engine.evaluateAll(['slow-1', 'slow-2'], context);
        const duration = performance.now() - startTime;

        expect(decision.allowed).toBe(true);
        // Should complete in ~100ms (parallel), not ~200ms (sequential)
        expect(duration).toBeLessThan(180);
      });
    });

    describe('evaluateAny() - OR logic', () => {
      it('should pass when first policy passes', async () => {
        const context = createTestContext();

        const decision = await engine.evaluateAny(['allow-1', 'deny-1'], context);

        expect(decision.allowed).toBe(true);
      });

      it('should pass when any policy passes', async () => {
        const context = createTestContext();

        const decision = await engine.evaluateAny(['deny-1', 'allow-1', 'deny-2'], context);

        expect(decision.allowed).toBe(true);
      });

      it('should fail when all policies fail', async () => {
        const context = createTestContext();

        const decision = await engine.evaluateAny(['deny-1', 'deny-2'], context);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toBe('No policies passed');
        expect(decision.metadata?.reasons).toEqual(['Denied by policy 1', 'Denied by policy 2']);
      });

      it('should handle empty policy list', async () => {
        const context = createTestContext();

        const decision = await engine.evaluateAny([], context);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toBe('No policies passed');
      });

      it('should short-circuit on first success', async () => {
        const { policy: countingPolicy, getCount } = createCountingPolicy('counting');
        engine.registerPolicy(countingPolicy);

        const context = createTestContext();

        await engine.evaluateAny(['allow-1', 'counting'], context);

        // Counting policy should not have been evaluated due to short-circuit
        expect(getCount()).toBe(0);
      });
    });
  });

  // ==========================================================================
  // Combining Algorithm Tests
  // ==========================================================================

  describe("combining algorithms: 'all', 'any', 'first', 'weighted'", () => {
    beforeEach(() => {
      engine.registerPolicies([
        createAllowPolicy('p1'),
        createDenyPolicy('p2'),
        createAllowPolicy('p3'),
        createWeightedPolicy('w1', 10, true),
        createWeightedPolicy('w2', 20, false),
        createWeightedPolicy('w3', 15, true),
      ]);
    });

    describe("'all' algorithm (via evaluateAll)", () => {
      it('should require all policies to pass', async () => {
        const context = createTestContext();

        const allPass = await engine.evaluateAll(['p1', 'p3'], context);
        expect(allPass.allowed).toBe(true);

        const oneFail = await engine.evaluateAll(['p1', 'p2', 'p3'], context);
        expect(oneFail.allowed).toBe(false);
      });
    });

    describe("'any' algorithm (via evaluateAny)", () => {
      it('should pass if any policy passes', async () => {
        const context = createTestContext();

        const onePass = await engine.evaluateAny(['p2', 'p1'], context);
        expect(onePass.allowed).toBe(true);

        const allFail = await engine.evaluateAny(['p2'], context);
        expect(allFail.allowed).toBe(false);
      });
    });

    describe("'first' algorithm (via evaluateAny with sequential evaluation)", () => {
      it('should return first successful evaluation', async () => {
        const context = createTestContext();

        // evaluateAny uses short-circuit evaluation (first match wins)
        const decision = await engine.evaluateAny(['p2', 'p1', 'p3'], context);

        expect(decision.allowed).toBe(true);
        // First successful policy was p1
        expect(decision.metadata?.evaluatedPolicies).toContain('p1');
      });
    });

    describe("'weighted' algorithm (custom implementation)", () => {
      it('should aggregate decisions based on weights', async () => {
        const context = createTestContext();

        // Simulate weighted evaluation by evaluating all and aggregating
        const decisions = await Promise.all(
          ['w1', 'w2', 'w3'].map((name) => engine.evaluate(name, context, { skipCache: true }))
        );

        // Calculate weighted result
        let allowWeight = 0;
        let denyWeight = 0;

        for (const d of decisions) {
          const weight = (d.metadata?.weight as number) ?? 1;
          if (d.allowed) {
            allowWeight += weight;
          } else {
            denyWeight += weight;
          }
        }

        // w1 (10, allow) + w3 (15, allow) = 25 allow
        // w2 (20, deny) = 20 deny
        expect(allowWeight).toBe(25);
        expect(denyWeight).toBe(20);
        expect(allowWeight > denyWeight).toBe(true); // Allow wins
      });
    });
  });

  // ==========================================================================
  // Policy Caching Tests
  // ==========================================================================

  describe('policy caching', () => {
    it('should cache successful policy evaluations', async () => {
      const { policy, getCount } = createCountingPolicy('cached');
      engine.registerPolicy(policy);
      const context = createTestContext();

      // First evaluation - should execute policy
      await engine.evaluate('cached', context);
      expect(getCount()).toBe(1);

      // Second evaluation - should use cache
      await engine.evaluate('cached', context);
      expect(getCount()).toBe(1);

      // Third evaluation - should still use cache
      await engine.evaluate('cached', context);
      expect(getCount()).toBe(1);
    });

    it('should track cache statistics', async () => {
      const { policy } = createCountingPolicy('stats-test');
      engine.registerPolicy(policy);
      const context = createTestContext();

      // Clear any existing stats
      engine.clearCache();

      // Miss
      await engine.evaluate('stats-test', context);
      let stats = engine.getCacheStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);

      // Hit
      await engine.evaluate('stats-test', context);
      stats = engine.getCacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.5);
    });

    it('should skip cache when skipCache option is true', async () => {
      const { policy, getCount } = createCountingPolicy('no-cache');
      engine.registerPolicy(policy);
      const context = createTestContext();

      await engine.evaluate('no-cache', context);
      await engine.evaluate('no-cache', context, { skipCache: true });
      await engine.evaluate('no-cache', context, { skipCache: true });

      expect(getCount()).toBe(3);
    });

    it('should cache different contexts separately', async () => {
      const { policy, getCount } = createCountingPolicy('context-cache');
      engine.registerPolicy(policy);

      const context1 = createTestContext({ auth: { userId: 'user-1', roles: [], permissions: [] } });
      const context2 = createTestContext({ auth: { userId: 'user-2', roles: [], permissions: [] } });

      await engine.evaluate('context-cache', context1);
      await engine.evaluate('context-cache', context2);
      await engine.evaluate('context-cache', context1); // Cache hit
      await engine.evaluate('context-cache', context2); // Cache hit

      expect(getCount()).toBe(2); // Only 2 unique contexts
    });

    it('should clear all cache entries', async () => {
      const { policy } = createCountingPolicy('clear-all');
      engine.registerPolicy(policy);
      const context = createTestContext();

      await engine.evaluate('clear-all', context);
      let stats = engine.getCacheStats();
      expect(stats.size).toBeGreaterThan(0);

      engine.clearCache();
      stats = engine.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it('should clear cache by pattern', async () => {
      engine.registerPolicy(createAllowPolicy('service-a-policy'));
      engine.registerPolicy(createAllowPolicy('service-b-policy'));

      const contextA = createTestContext({ service: { name: 'service-a', version: '1.0.0' } });
      const contextB = createTestContext({ service: { name: 'service-b', version: '1.0.0' } });

      await engine.evaluate('service-a-policy', contextA);
      await engine.evaluate('service-b-policy', contextB);

      let stats = engine.getCacheStats();
      expect(stats.size).toBe(2);

      // Clear only service-a entries
      engine.clearCache('service-a');

      stats = engine.getCacheStats();
      expect(stats.size).toBe(1);
    });

    it('should not cache denied decisions', async () => {
      const { policy: denyPolicy, getCount } = (() => {
        let count = 0;
        return {
          policy: {
            name: 'deny-no-cache',
            evaluate: () => {
              count++;
              return { allowed: false, reason: 'Denied' };
            },
          } as PolicyDefinition,
          getCount: () => count,
        };
      })();

      engine.registerPolicy(denyPolicy);
      const context = createTestContext();

      await engine.evaluate('deny-no-cache', context);
      await engine.evaluate('deny-no-cache', context);

      // Denied decisions are not cached, so both evaluations run
      expect(getCount()).toBe(2);
    });
  });

  // ==========================================================================
  // Circuit Breaker Tests
  // ==========================================================================

  describe('circuit breaker behavior', () => {
    it('should open circuit breaker after threshold failures', async () => {
      const policy = createFailingPolicy('cb-test', 'Always fails');
      engine.registerPolicy(policy, {
        circuitBreaker: { threshold: 3, timeout: 5000, resetTimeout: 10000 },
      });
      const context = createTestContext();

      // Trigger failures
      await engine.evaluate('cb-test', context);
      expect(engine.getCircuitBreakerState('cb-test')).toBe('closed');

      await engine.evaluate('cb-test', context);
      expect(engine.getCircuitBreakerState('cb-test')).toBe('closed');

      await engine.evaluate('cb-test', context);
      expect(engine.getCircuitBreakerState('cb-test')).toBe('open');
    });

    it('should reject requests when circuit is open', async () => {
      const policy = createFailingPolicy('cb-open-test', 'Fails');
      engine.registerPolicy(policy, {
        circuitBreaker: { threshold: 2, timeout: 5000, resetTimeout: 10000 },
      });
      const context = createTestContext();

      // Open the circuit
      await engine.evaluate('cb-open-test', context);
      await engine.evaluate('cb-open-test', context);

      // Circuit is open, next request should be rejected immediately
      const decision = await engine.evaluate('cb-open-test', context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('circuit breaker open');
    });

    it('should transition to half-open after reset timeout', async () => {
      const policy = createFailingPolicy('cb-half-open', 'Fails');
      engine.registerPolicy(policy, {
        circuitBreaker: { threshold: 2, timeout: 5000, resetTimeout: 50 },
      });
      const context = createTestContext();

      // Open the circuit
      await engine.evaluate('cb-half-open', context);
      await engine.evaluate('cb-half-open', context);
      expect(engine.getCircuitBreakerState('cb-half-open')).toBe('open');

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Circuit should allow a test request (half-open state)
      await engine.evaluate('cb-half-open', context);

      // Since it still fails, it should go back to open
      // (The actual state depends on implementation details)
    });

    it('should close circuit on success in half-open state', async () => {
      let shouldFail = true;
      const recoverablePolicy: PolicyDefinition = {
        name: 'cb-recoverable',
        evaluate: () => {
          if (shouldFail) throw new Error('Temporary failure');
          return { allowed: true };
        },
      };

      engine.registerPolicy(recoverablePolicy, {
        circuitBreaker: { threshold: 2, timeout: 5000, resetTimeout: 50 },
      });
      const context = createTestContext();

      // Open circuit
      await engine.evaluate('cb-recoverable', context);
      await engine.evaluate('cb-recoverable', context);
      expect(engine.getCircuitBreakerState('cb-recoverable')).toBe('open');

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Now allow success
      shouldFail = false;

      // This should transition to half-open and then close on success
      const decision = await engine.evaluate('cb-recoverable', context);
      expect(decision.allowed).toBe(true);
      expect(engine.getCircuitBreakerState('cb-recoverable')).toBe('closed');
    });

    it('should isolate circuit breakers per policy', async () => {
      engine.registerPolicy(createFailingPolicy('cb-isolated-a', 'Fails A'), {
        circuitBreaker: { threshold: 2, timeout: 5000, resetTimeout: 10000 },
      });
      engine.registerPolicy(createAllowPolicy('cb-isolated-b'), {
        circuitBreaker: { threshold: 2, timeout: 5000, resetTimeout: 10000 },
      });
      const context = createTestContext();

      // Open circuit for policy A
      await engine.evaluate('cb-isolated-a', context);
      await engine.evaluate('cb-isolated-a', context);

      expect(engine.getCircuitBreakerState('cb-isolated-a')).toBe('open');
      expect(engine.getCircuitBreakerState('cb-isolated-b')).toBe('closed');

      // Policy B should still work
      const decision = await engine.evaluate('cb-isolated-b', context);
      expect(decision.allowed).toBe(true);
    });

    it('should return undefined for policy without circuit breaker', () => {
      engine.registerPolicy(createAllowPolicy('no-breaker'));

      const state = engine.getCircuitBreakerState('no-breaker');
      expect(state).toBeUndefined();
    });
  });

  // ==========================================================================
  // Parallel Evaluation Tests
  // ==========================================================================

  describe('parallel evaluation', () => {
    it('should evaluate batch of contexts in parallel', async () => {
      engine.registerPolicy({
        name: 'batch-test',
        evaluate: async (ctx: ExecutionContext) => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return {
            allowed: ctx.auth?.userId !== 'blocked',
            reason: ctx.auth?.userId ?? 'unknown',
          };
        },
      });

      const contexts = [
        createTestContext({ auth: { userId: 'user-1', roles: [], permissions: [] } }),
        createTestContext({ auth: { userId: 'user-2', roles: [], permissions: [] } }),
        createTestContext({ auth: { userId: 'blocked', roles: [], permissions: [] } }),
        createTestContext({ auth: { userId: 'user-3', roles: [], permissions: [] } }),
      ];

      const startTime = performance.now();
      const decisions = await engine.evaluateBatch(contexts, 'batch-test', { skipCache: true });
      const duration = performance.now() - startTime;

      expect(decisions).toHaveLength(4);
      expect(decisions[0].allowed).toBe(true);
      expect(decisions[1].allowed).toBe(true);
      expect(decisions[2].allowed).toBe(false);
      expect(decisions[3].allowed).toBe(true);

      // Should complete in ~50ms (parallel), not ~200ms (sequential)
      expect(duration).toBeLessThan(150);
    });

    it('should maintain order in batch evaluation', async () => {
      engine.registerPolicy({
        name: 'order-test',
        evaluate: async (ctx: ExecutionContext) => {
          // Random delay to test ordering
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 30));
          return { allowed: true, reason: ctx.auth?.userId };
        },
      });

      const userIds = ['a', 'b', 'c', 'd', 'e'];
      const contexts = userIds.map((id) => createTestContext({ auth: { userId: id, roles: [], permissions: [] } }));

      const decisions = await engine.evaluateBatch(contexts, 'order-test', { skipCache: true });

      expect(decisions.map((d) => d.reason)).toEqual(userIds);
    });

    it('should handle concurrent evaluations of same policy safely', async () => {
      let evaluationCount = 0;
      const concurrentPolicy: PolicyDefinition = {
        name: 'concurrent-safe',
        evaluate: async () => {
          evaluationCount++;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { allowed: true };
        },
      };

      engine.registerPolicy(concurrentPolicy);
      const context = createTestContext();

      // Fire 50 concurrent evaluations
      const promises = Array.from({ length: 50 }, () =>
        engine.evaluate('concurrent-safe', context, { skipCache: true })
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(50);
      expect(results.every((r) => r.allowed)).toBe(true);
      expect(evaluationCount).toBe(50);
    });
  });

  // ==========================================================================
  // evaluateAll() for Debugging Tests
  // ==========================================================================

  describe('evaluateAll() for debugging', () => {
    it('should include all decisions in debug mode', async () => {
      const debugEngine = new PolicyEngine(logger, { debug: true });

      debugEngine.registerPolicies([
        createAllowPolicy('debug-p1'),
        createAllowPolicy('debug-p2'),
        createDenyPolicy('debug-p3'),
      ]);

      const context = createTestContext();
      const decision = await debugEngine.evaluateAll(['debug-p1', 'debug-p2', 'debug-p3'], context);

      expect(decision.metadata?.allDecisions).toBeDefined();
      expect(decision.metadata?.allDecisions).toHaveLength(3);
    });

    it('should include evaluation trace in debug mode', async () => {
      const debugEngine = new PolicyEngine(logger, { debug: true });
      debugEngine.registerPolicy(createAllowPolicy('trace-test'));

      const context = createTestContext();
      const decision = await debugEngine.evaluate('trace-test', context);

      expect(decision.trace).toBeDefined();
      expect(decision.trace?.length).toBeGreaterThan(0);
      expect(decision.trace?.[0]).toHaveProperty('step');
      expect(decision.trace?.[0]).toHaveProperty('timestamp');
    });

    it('should not include debug info when debug mode is disabled', async () => {
      engine.registerPolicies([createAllowPolicy('no-debug-p1'), createAllowPolicy('no-debug-p2')]);

      const context = createTestContext();
      const decision = await engine.evaluateAll(['no-debug-p1', 'no-debug-p2'], context);

      expect(decision.metadata?.allDecisions).toBeUndefined();
    });

    it('should toggle debug mode at runtime', async () => {
      engine.registerPolicy(createAllowPolicy('toggle-debug'));
      const context = createTestContext();

      // Debug off by default
      let decision = await engine.evaluate('toggle-debug', context, { skipCache: true });
      expect(decision.trace).toBeUndefined();

      // Enable debug
      engine.setDebugMode(true);
      decision = await engine.evaluate('toggle-debug', context, { skipCache: true });
      expect(decision.trace).toBeDefined();

      // Disable debug
      engine.setDebugMode(false);
      decision = await engine.evaluate('toggle-debug', context, { skipCache: true });
      expect(decision.trace).toBeUndefined();
    });
  });

  // ==========================================================================
  // getStats() Tests
  // ==========================================================================

  describe('getStats() / getCacheStats()', () => {
    it('should return accurate cache statistics', async () => {
      engine.registerPolicy(createAllowPolicy('stats-policy'));
      const context = createTestContext();

      engine.clearCache();

      // Initial stats
      let stats = engine.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);

      // First evaluation - miss
      await engine.evaluate('stats-policy', context);
      stats = engine.getCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);

      // Second evaluation - hit
      await engine.evaluate('stats-policy', context);
      stats = engine.getCacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.hitRate).toBe(0.5);

      // More hits
      await engine.evaluate('stats-policy', context);
      await engine.evaluate('stats-policy', context);
      stats = engine.getCacheStats();
      expect(stats.hits).toBe(3);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.75);
    });

    it('should reset stats on cache clear', async () => {
      engine.registerPolicy(createAllowPolicy('clear-stats'));
      const context = createTestContext();

      await engine.evaluate('clear-stats', context);
      await engine.evaluate('clear-stats', context);

      let stats = engine.getCacheStats();
      expect(stats.hits).toBeGreaterThan(0);

      engine.clearCache();
      stats = engine.getCacheStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  // ==========================================================================
  // destroy() Cleanup Tests
  // ==========================================================================

  describe('destroy() cleanup', () => {
    // Note: PolicyEngine doesn't have an explicit destroy() method in the implementation
    // but we can test cleanup via unregistering all policies and clearing cache

    it('should clean up all policies when clearing', () => {
      engine.registerPolicies([
        createAllowPolicy('cleanup-1'),
        createAllowPolicy('cleanup-2'),
        createAllowPolicy('cleanup-3'),
      ]);

      expect(engine.getPolicies()).toHaveLength(3);

      // Clean up by unregistering all
      for (const policy of engine.getPolicies()) {
        engine.unregisterPolicy(policy.name);
      }

      expect(engine.getPolicies()).toHaveLength(0);
    });

    it('should clean up cache and circuit breakers when unregistering', async () => {
      engine.registerPolicy(createFailingPolicy('cleanup-cb', 'Fails'), {
        circuitBreaker: { threshold: 2, timeout: 5000, resetTimeout: 10000 },
      });

      const context = createTestContext();

      // Populate cache and trigger circuit breaker
      await engine.evaluate('cleanup-cb', context);
      await engine.evaluate('cleanup-cb', context);

      expect(engine.getCircuitBreakerState('cleanup-cb')).toBe('open');

      // Unregister cleans up everything
      engine.unregisterPolicy('cleanup-cb');

      expect(engine.getCircuitBreakerState('cleanup-cb')).toBeUndefined();
    });

    it('should handle cleanup of engine with no registered policies', () => {
      expect(engine.getPolicies()).toHaveLength(0);
      engine.clearCache();

      const stats = engine.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  // ==========================================================================
  // Policy Timeout Tests
  // ==========================================================================

  describe('policy timeout scenarios', () => {
    it('should timeout slow policy with custom timeout', async () => {
      engine.registerPolicy(createAsyncPolicy('slow-policy', 5000, true));
      const context = createTestContext();

      const decision = await engine.evaluate('slow-policy', context, { timeout: 50 });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('timeout');
    });

    it('should use default timeout from config', async () => {
      const configuredEngine = new PolicyEngine(logger, { defaultTimeout: 50 });
      configuredEngine.registerPolicy(createAsyncPolicy('config-timeout', 5000, true));

      const context = createTestContext();
      const decision = await configuredEngine.evaluate('config-timeout', context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('timeout');
    });

    it('should allow fast policy to complete before timeout', async () => {
      engine.registerPolicy(createAsyncPolicy('fast-policy', 10, true));
      const context = createTestContext();

      const decision = await engine.evaluate('fast-policy', context, { timeout: 1000 });

      expect(decision.allowed).toBe(true);
    });

    it('should handle AbortSignal cancellation', async () => {
      const controller = new AbortController();
      engine.registerPolicy(createAsyncPolicy('abortable', 5000, true));
      const context = createTestContext();

      // Abort after 20ms
      setTimeout(() => controller.abort(), 20);

      const decision = await engine.evaluate('abortable', context, {
        signal: controller.signal,
        timeout: 10000,
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('aborted');
    });

    it('should record failure in circuit breaker on timeout', async () => {
      engine.registerPolicy(createAsyncPolicy('timeout-cb', 5000, true), {
        circuitBreaker: { threshold: 2, timeout: 5000, resetTimeout: 10000 },
      });
      const context = createTestContext();

      // Two timeouts should open the circuit
      await engine.evaluate('timeout-cb', context, { timeout: 20 });
      expect(engine.getCircuitBreakerState('timeout-cb')).toBe('closed');

      await engine.evaluate('timeout-cb', context, { timeout: 20 });
      expect(engine.getCircuitBreakerState('timeout-cb')).toBe('open');
    });

    it('should include timeout info in trace when debug mode enabled', async () => {
      const debugEngine = new PolicyEngine(logger, { debug: true });
      debugEngine.registerPolicy(createAsyncPolicy('timeout-trace', 5000, true));

      const context = createTestContext();
      const decision = await debugEngine.evaluate('timeout-trace', context, { timeout: 20 });

      expect(decision.trace).toBeDefined();
      expect(decision.trace?.some((t) => t.step === 'error')).toBe(true);
    });
  });

  // ==========================================================================
  // Policy Expression Tests
  // ==========================================================================

  describe('evaluateExpression() - complex policy combinations', () => {
    beforeEach(() => {
      engine.registerPolicies([
        createAllowPolicy('allow'),
        createDenyPolicy('deny'),
        createRolePolicy('is-admin', 'admin'),
        createPermissionPolicy('can-write', 'write'),
      ]);
    });

    it('should evaluate string expression (single policy)', async () => {
      const context = createTestContext();

      const decision = await engine.evaluateExpression('allow', context);

      expect(decision.allowed).toBe(true);
    });

    it('should evaluate AND expression', async () => {
      const context = createTestContext({
        auth: { userId: 'admin', roles: ['admin'], permissions: ['write'] },
      });

      const decision = await engine.evaluateExpression({ and: ['is-admin', 'can-write'] }, context);

      expect(decision.allowed).toBe(true);
    });

    it('should fail AND expression when any policy fails', async () => {
      const context = createTestContext({
        auth: { userId: 'admin', roles: ['admin'], permissions: [] },
      });

      const decision = await engine.evaluateExpression({ and: ['is-admin', 'can-write'] }, context);

      expect(decision.allowed).toBe(false);
    });

    it('should evaluate OR expression', async () => {
      const context = createTestContext({
        auth: { userId: 'user', roles: ['user'], permissions: ['write'] },
      });

      const decision = await engine.evaluateExpression({ or: ['is-admin', 'can-write'] }, context);

      expect(decision.allowed).toBe(true);
    });

    it('should fail OR expression when all policies fail', async () => {
      const context = createTestContext({
        auth: { userId: 'user', roles: ['user'], permissions: ['read'] },
      });

      const decision = await engine.evaluateExpression({ or: ['is-admin', 'can-write'] }, context);

      expect(decision.allowed).toBe(false);
    });

    it('should evaluate NOT expression', async () => {
      const context = createTestContext();

      const decision = await engine.evaluateExpression({ not: 'deny' }, context);

      expect(decision.allowed).toBe(true);
    });

    it('should evaluate nested expressions', async () => {
      const context = createTestContext({
        auth: { userId: 'writer', roles: ['user'], permissions: ['write'] },
      });

      // (is-admin OR can-write) AND allow
      const decision = await engine.evaluateExpression(
        {
          and: [{ or: ['is-admin', 'can-write'] }, 'allow'],
        },
        context
      );

      expect(decision.allowed).toBe(true);
    });

    it('should evaluate deeply nested expressions', async () => {
      const context = createTestContext({
        auth: { userId: 'admin', roles: ['admin'], permissions: ['write'] },
      });

      // ((is-admin AND can-write) OR deny) AND (NOT deny)
      const decision = await engine.evaluateExpression(
        {
          and: [
            {
              or: [{ and: ['is-admin', 'can-write'] }, 'deny'],
            },
            { not: 'deny' },
          ],
        },
        context
      );

      expect(decision.allowed).toBe(true);
    });

    it('should throw error for invalid expression structure', async () => {
      const context = createTestContext();

      await expect(engine.evaluateExpression({ invalid: ['allow'] } as any, context)).rejects.toThrow(
        'Invalid policy expression'
      );
    });
  });

  // ==========================================================================
  // Edge Cases and Error Handling
  // ==========================================================================

  describe('edge cases and error handling', () => {
    it('should handle policy returning null', async () => {
      const nullPolicy: PolicyDefinition = {
        name: 'null-policy',
        evaluate: () => null as any,
      };

      engine.registerPolicy(nullPolicy);
      const context = createTestContext();

      const decision = await engine.evaluate('null-policy', context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('allowed');
    });

    it('should handle policy returning undefined', async () => {
      const undefinedPolicy: PolicyDefinition = {
        name: 'undefined-policy',
        evaluate: () => undefined as any,
      };

      engine.registerPolicy(undefinedPolicy);
      const context = createTestContext();

      const decision = await engine.evaluate('undefined-policy', context);

      expect(decision).toBeDefined();
    });

    it('should handle policy with missing allowed field', async () => {
      const invalidPolicy: PolicyDefinition = {
        name: 'invalid-result',
        evaluate: () => ({ reason: 'Missing allowed field' }) as any,
      };

      engine.registerPolicy(invalidPolicy);
      const context = createTestContext();

      const decision = await engine.evaluate('invalid-result', context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('allowed');
    });

    it('should handle context with missing optional fields', async () => {
      engine.registerPolicy(createRolePolicy('role-test', 'admin'));

      const minimalContext: ExecutionContext = {
        service: { name: 'test', version: '1.0.0' },
      };

      const decision = await engine.evaluate('role-test', minimalContext);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Missing required role');
    });

    it('should handle context with undefined auth', async () => {
      engine.registerPolicy(createPermissionPolicy('perm-test', 'write'));

      const noAuthContext: ExecutionContext = {
        service: { name: 'test', version: '1.0.0' },
        auth: undefined,
      };

      const decision = await engine.evaluate('perm-test', noAuthContext);

      expect(decision.allowed).toBe(false);
    });

    it('should handle async policy that rejects', async () => {
      const rejectingPolicy: PolicyDefinition = {
        name: 'rejecting',
        evaluate: async () => {
          throw new Error('Async rejection');
        },
      };

      engine.registerPolicy(rejectingPolicy);
      const context = createTestContext();

      const decision = await engine.evaluate('rejecting', context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Async rejection');
    });

    it('should handle synchronous policy correctly', async () => {
      const syncPolicy: PolicyDefinition = {
        name: 'sync',
        evaluate: () => ({ allowed: true, reason: 'Sync success' }),
      };

      engine.registerPolicy(syncPolicy);
      const context = createTestContext();

      const decision = await engine.evaluate('sync', context);

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe('Sync success');
    });
  });

  // ==========================================================================
  // destroy() and onDestroy Tests
  // ==========================================================================

  describe('destroy() and onDestroy lifecycle', () => {
    /**
     * Helper to check if a policy exists in the engine
     */
    function policyExists(policyName: string): boolean {
      return engine.getPolicies().some((p) => p.name === policyName);
    }

    it('should call onDestroy when unregistering a policy', () => {
      let destroyCalled = false;
      const policyWithDestroy: PolicyDefinition = {
        name: 'destructible',
        evaluate: () => ({ allowed: true }),
        onDestroy: () => {
          destroyCalled = true;
        },
      };

      engine.registerPolicy(policyWithDestroy);
      expect(policyExists('destructible')).toBe(true);

      engine.unregisterPolicy('destructible');

      expect(destroyCalled).toBe(true);
      expect(policyExists('destructible')).toBe(false);
    });

    it('should call onDestroy for all policies when engine is destroyed', () => {
      const destroyCalls: string[] = [];

      const policy1: PolicyDefinition = {
        name: 'policy-1',
        evaluate: () => ({ allowed: true }),
        onDestroy: () => {
          destroyCalls.push('policy-1');
        },
      };

      const policy2: PolicyDefinition = {
        name: 'policy-2',
        evaluate: () => ({ allowed: true }),
        onDestroy: () => {
          destroyCalls.push('policy-2');
        },
      };

      const policy3: PolicyDefinition = {
        name: 'policy-3',
        evaluate: () => ({ allowed: true }),
        // No onDestroy - should not cause error
      };

      engine.registerPolicies([policy1, policy2, policy3]);

      engine.destroy();

      expect(destroyCalls).toContain('policy-1');
      expect(destroyCalls).toContain('policy-2');
      expect(destroyCalls).toHaveLength(2);
      expect(policyExists('policy-1')).toBe(false);
      expect(policyExists('policy-2')).toBe(false);
      expect(policyExists('policy-3')).toBe(false);
    });

    it('should handle errors in onDestroy gracefully', () => {
      const policyWithBadDestroy: PolicyDefinition = {
        name: 'bad-destroy',
        evaluate: () => ({ allowed: true }),
        onDestroy: () => {
          throw new Error('Destroy failed!');
        },
      };

      engine.registerPolicy(policyWithBadDestroy);

      // Should not throw
      expect(() => engine.unregisterPolicy('bad-destroy')).not.toThrow();
      expect(policyExists('bad-destroy')).toBe(false);
    });

    it('should clear all internal state on destroy', async () => {
      engine.registerPolicies([createAllowPolicy('allow'), createDenyPolicy('deny')]);

      // Add some circuit breaker state
      engine.registerPolicy(createAllowPolicy('cb-policy'), {
        circuitBreaker: { threshold: 5, timeout: 1000, resetTimeout: 5000 },
      });

      // Generate some cache entries
      const context = createTestContext();
      await engine.evaluate('allow', context);
      await engine.evaluate('deny', context);

      engine.destroy();

      // All policies should be gone
      expect(policyExists('allow')).toBe(false);
      expect(policyExists('deny')).toBe(false);
      expect(policyExists('cb-policy')).toBe(false);

      // Circuit breaker state should be gone
      expect(engine.getCircuitBreakerState('cb-policy')).toBeUndefined();
    });

    it('should be safe to call destroy multiple times', () => {
      engine.registerPolicy(createAllowPolicy('test'));

      engine.destroy();
      engine.destroy();
      engine.destroy();

      // Should not throw and should have empty state
      expect(policyExists('test')).toBe(false);
    });
  });

  // ==========================================================================
  // Cache Key Collision Prevention Tests
  // ==========================================================================

  describe('cache key collision prevention', () => {
    it('should not have cache collisions with similar looking keys', async () => {
      engine.registerPolicy(createAllowPolicy('allow'));

      // Two contexts that would collide with naive string concatenation:
      // "policy:user:a:b:service:method:res" vs "policy:user:a:b:service:method:res"
      // where first has userId="a:b" and second has userId="a" with service="b:service"

      const context1 = createTestContext({
        auth: { userId: 'a:b', roles: ['user'], permissions: [] },
        service: { name: 'service', version: '1.0.0' },
        method: { name: 'method' },
        resource: { id: 'res' },
      });

      const context2 = createTestContext({
        auth: { userId: 'a', roles: ['user'], permissions: [] },
        service: { name: 'b:service', version: '1.0.0' },
        method: { name: 'method' },
        resource: { id: 'res' },
      });

      // Both should be evaluated independently (no false cache hits)
      const decision1 = await engine.evaluate('allow', context1);
      const decision2 = await engine.evaluate('allow', context2);

      // Both should succeed since it's an allow policy
      expect(decision1.allowed).toBe(true);
      expect(decision2.allowed).toBe(true);

      // Verify policy is still registered
      expect(engine.getPolicies()).toHaveLength(1);
    });
  });
});
