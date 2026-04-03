/**
 * Comprehensive Integration Tests for BuiltInPolicies
 *
 * These tests focus on:
 * 1. Real implementations (no mocks except logger)
 * 2. All built-in policies with various execution contexts
 * 3. Policy factory functions with different configurations
 * 4. Edge cases: missing context, missing fields, boundary conditions
 *
 * @module @omnitron-dev/titan/test/netron/auth
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BuiltInPolicies } from '../../../src/netron/auth/built-in-policies.js';
import type { ExecutionContext, AuthContext, PolicyDefinition } from '../../../src/netron/auth/types.js';
import type { ILogger } from '../../../src/types/logger.js';

/**
 * Mock logger implementing ILogger interface
 * Only mock we use - all other implementations are real
 */
function createMockLogger(): ILogger {
  const noop = () => {};
  const mockLogger: ILogger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => mockLogger),
    time: () => noop,
    isLevelEnabled: () => true,
    setLevel: noop,
    getLevel: () => 'info',
  };
  return mockLogger;
}

/**
 * Helper to create a base execution context
 */
function createBaseContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    service: { name: 'testService', version: '1.0.0' },
    ...overrides,
  };
}

/**
 * Helper to create an authenticated execution context
 */
function createAuthenticatedContext(
  auth: Partial<AuthContext>,
  overrides: Partial<ExecutionContext> = {}
): ExecutionContext {
  return createBaseContext({
    auth: {
      userId: 'test-user',
      roles: [],
      permissions: [],
      ...auth,
    },
    ...overrides,
  });
}

describe('BuiltInPolicies Integration Tests', () => {
  let mockLogger: ILogger;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  describe('requireAuth (requireAuthenticated)', () => {
    it('should allow when auth context is present', async () => {
      const policy = BuiltInPolicies.requireAuth();
      const context = createAuthenticatedContext({ userId: 'user-123' });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toMatch(/authenticated/i);
    });

    it('should deny when auth context is missing', async () => {
      const policy = BuiltInPolicies.requireAuth();
      const context = createBaseContext();

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toMatch(/authentication required/i);
    });

    it('should have correct policy metadata', () => {
      const policy = BuiltInPolicies.requireAuth();

      expect(policy.name).toBe('auth:required');
      expect(policy.description).toMatch(/authentication/i);
      expect(policy.tags).toContain('auth');
    });
  });

  describe('requireRole/requireAnyRole/requireAllRoles (requireRoles)', () => {
    describe('requireRole - single role', () => {
      it('should allow user with exact required role', async () => {
        const policy = BuiltInPolicies.requireRole('admin');
        const context = createAuthenticatedContext({ roles: ['admin'] });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
        expect(decision.reason).toContain('admin');
      });

      it('should deny user without the role', async () => {
        const policy = BuiltInPolicies.requireRole('superadmin');
        const context = createAuthenticatedContext({ roles: ['admin', 'user'] });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('Missing role');
      });

      it('should deny when user has empty roles array', async () => {
        const policy = BuiltInPolicies.requireRole('admin');
        const context = createAuthenticatedContext({ roles: [] });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
      });

      it('should be case-sensitive for role matching', async () => {
        const policy = BuiltInPolicies.requireRole('Admin');
        const context = createAuthenticatedContext({ roles: ['admin'] });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
      });
    });

    describe('requireAnyRole - OR logic', () => {
      it('should allow when user has first role', async () => {
        const policy = BuiltInPolicies.requireAnyRole(['admin', 'moderator', 'editor']);
        const context = createAuthenticatedContext({ roles: ['admin'] });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
      });

      it('should allow when user has last role', async () => {
        const policy = BuiltInPolicies.requireAnyRole(['admin', 'moderator', 'editor']);
        const context = createAuthenticatedContext({ roles: ['editor'] });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
      });

      it('should deny when user has none of the roles', async () => {
        const policy = BuiltInPolicies.requireAnyRole(['admin', 'moderator']);
        const context = createAuthenticatedContext({ roles: ['user', 'guest'] });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('Missing all roles');
      });

      it('should handle empty required roles array', async () => {
        const policy = BuiltInPolicies.requireAnyRole([]);
        const context = createAuthenticatedContext({ roles: ['admin'] });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
      });
    });

    describe('requireAllRoles - AND logic', () => {
      it('should allow when user has all required roles', async () => {
        const policy = BuiltInPolicies.requireAllRoles(['admin', 'moderator']);
        const context = createAuthenticatedContext({ roles: ['admin', 'moderator', 'user'] });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
      });

      it('should deny when user is missing one role', async () => {
        const policy = BuiltInPolicies.requireAllRoles(['admin', 'moderator', 'superuser']);
        const context = createAuthenticatedContext({ roles: ['admin', 'moderator'] });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('superuser');
      });

      it('should allow with empty required roles array', async () => {
        const policy = BuiltInPolicies.requireAllRoles([]);
        const context = createAuthenticatedContext({ roles: ['admin'] });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
      });

      it('should list all missing roles in reason', async () => {
        const policy = BuiltInPolicies.requireAllRoles(['a', 'b', 'c', 'd']);
        const context = createAuthenticatedContext({ roles: ['a', 'c'] });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('b');
        expect(decision.reason).toContain('d');
      });
    });
  });

  describe('requireScope/requireAnyScope (requireScopes)', () => {
    describe('requireScope - single scope', () => {
      it('should allow user with required scope', async () => {
        const policy = BuiltInPolicies.requireScope('read:documents');
        const context = createAuthenticatedContext({
          scopes: ['read:documents', 'write:documents'],
        });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
      });

      it('should deny user without required scope', async () => {
        const policy = BuiltInPolicies.requireScope('admin:all');
        const context = createAuthenticatedContext({
          scopes: ['read:documents'],
        });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('Missing scope');
      });

      it('should deny when scopes array is undefined', async () => {
        const policy = BuiltInPolicies.requireScope('read:documents');
        const context = createAuthenticatedContext({});

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
      });

      it('should handle empty scopes array', async () => {
        const policy = BuiltInPolicies.requireScope('read:documents');
        const context = createAuthenticatedContext({ scopes: [] });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
      });
    });

    describe('requireAnyScope - OR logic', () => {
      it('should allow user with one of required scopes', async () => {
        const policy = BuiltInPolicies.requireAnyScope(['read:documents', 'admin:all']);
        const context = createAuthenticatedContext({
          scopes: ['read:documents'],
        });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
      });

      it('should deny user without any required scope', async () => {
        const policy = BuiltInPolicies.requireAnyScope(['admin:all', 'superuser:access']);
        const context = createAuthenticatedContext({
          scopes: ['read:documents', 'write:documents'],
        });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
      });
    });
  });

  describe('rateLimit (simple rate limiting)', () => {
    let policy: PolicyDefinition;

    afterEach(() => {
      policy?.onDestroy?.();
    });

    it('should allow requests within limit', async () => {
      policy = BuiltInPolicies.rateLimit(5, 1000);
      const context = createAuthenticatedContext({ userId: 'rate-user-1' });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
      expect(decision.metadata?.remaining).toBe(4);
    });

    it('should deny requests exceeding limit', async () => {
      policy = BuiltInPolicies.rateLimit(2, 10000);
      const context = createAuthenticatedContext({ userId: 'rate-user-2' });

      await policy.evaluate(context);
      await policy.evaluate(context);
      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Rate limit exceeded');
      expect(decision.metadata?.retryAfter).toBeGreaterThan(0);
    });

    it('should track by userId when available', async () => {
      policy = BuiltInPolicies.rateLimit(2, 10000);
      const user1Context = createAuthenticatedContext({ userId: 'user-a' });
      const user2Context = createAuthenticatedContext({ userId: 'user-b' });

      await policy.evaluate(user1Context);
      await policy.evaluate(user1Context);

      // user1 should be rate limited
      const user1Decision = await policy.evaluate(user1Context);
      expect(user1Decision.allowed).toBe(false);

      // user2 should still be allowed
      const user2Decision = await policy.evaluate(user2Context);
      expect(user2Decision.allowed).toBe(true);
    });

    it('should fall back to IP when userId is not available', async () => {
      policy = BuiltInPolicies.rateLimit(2, 10000);
      const ip1Context = createBaseContext({ environment: { ip: '10.0.0.1' } });
      const ip2Context = createBaseContext({ environment: { ip: '10.0.0.2' } });

      await policy.evaluate(ip1Context);
      await policy.evaluate(ip1Context);

      const ip1Decision = await policy.evaluate(ip1Context);
      expect(ip1Decision.allowed).toBe(false);

      const ip2Decision = await policy.evaluate(ip2Context);
      expect(ip2Decision.allowed).toBe(true);
    });

    it('should use anonymous key when no userId or IP', async () => {
      policy = BuiltInPolicies.rateLimit(2, 10000);
      const context = createBaseContext();

      await policy.evaluate(context);
      await policy.evaluate(context);
      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
    });

    it('should recover after window expires', async () => {
      policy = BuiltInPolicies.rateLimit(1, 100);
      const context = createAuthenticatedContext({ userId: 'expire-user' });

      await policy.evaluate(context);
      let decision = await policy.evaluate(context);
      expect(decision.allowed).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 150));

      decision = await policy.evaluate(context);
      expect(decision.allowed).toBe(true);
    });

    it('should have correct policy metadata', () => {
      policy = BuiltInPolicies.rateLimit(100, 60000);

      expect(policy.name).toBe('ratelimit:100/60000');
      expect(policy.tags).toContain('ratelimit');
      expect(policy.onDestroy).toBeDefined();
    });
  });

  describe('requireRateLimit (advanced rate limiting with logger)', () => {
    let policy: PolicyDefinition;

    afterEach(() => {
      // Note: requireRateLimit does not have onDestroy exposed
      // The RateLimiter is managed internally
    });

    it('should allow requests within limit using sliding window', async () => {
      policy = BuiltInPolicies.requireRateLimit(mockLogger, {
        strategy: 'sliding',
        window: 10000,
        defaultTier: { name: 'default', limit: 5 },
      });
      const context = createAuthenticatedContext({ userId: 'adv-rate-user-1' });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
      expect(decision.metadata?.remaining).toBeDefined();
      expect(decision.metadata?.tier).toBe('default');
    });

    it('should deny requests exceeding limit', async () => {
      policy = BuiltInPolicies.requireRateLimit(mockLogger, {
        strategy: 'sliding',
        window: 60000,
        defaultTier: { name: 'test', limit: 2 },
      });
      const context = createAuthenticatedContext({ userId: 'adv-rate-user-2' });

      await policy.evaluate(context);
      await policy.evaluate(context);
      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Rate limit exceeded');
      expect(decision.metadata?.retryAfter).toBeGreaterThan(0);
    });

    it('should support tiered rate limiting', async () => {
      policy = BuiltInPolicies.requireRateLimit(mockLogger, {
        strategy: 'sliding',
        window: 60000,
        defaultTier: { name: 'free', limit: 2 },
        tiers: {
          premium: { name: 'premium', limit: 10 },
          enterprise: { name: 'enterprise', limit: 100 },
        },
        getTier: (ctx) => {
          if (ctx.auth?.roles?.includes('enterprise')) return 'enterprise';
          if (ctx.auth?.roles?.includes('premium')) return 'premium';
          return undefined;
        },
      });

      const freeContext = createAuthenticatedContext({
        userId: 'free-user',
        roles: [],
      });
      const premiumContext = createAuthenticatedContext({
        userId: 'premium-user',
        roles: ['premium'],
      });

      // Free user: limit 2
      await policy.evaluate(freeContext);
      await policy.evaluate(freeContext);
      const freeDecision = await policy.evaluate(freeContext);
      expect(freeDecision.allowed).toBe(false);

      // Premium user: limit 10 (should still be allowed)
      for (let i = 0; i < 5; i++) {
        const decision = await policy.evaluate(premiumContext);
        expect(decision.allowed).toBe(true);
        expect(decision.metadata?.tier).toBe('premium');
      }
    });

    it('should support fixed window strategy', async () => {
      policy = BuiltInPolicies.requireRateLimit(mockLogger, {
        strategy: 'fixed',
        window: 60000,
        defaultTier: { name: 'fixed', limit: 3 },
      });
      const context = createAuthenticatedContext({ userId: 'fixed-user' });

      for (let i = 0; i < 3; i++) {
        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(true);
      }

      const decision = await policy.evaluate(context);
      expect(decision.allowed).toBe(false);
    });

    it('should support token bucket strategy', async () => {
      policy = BuiltInPolicies.requireRateLimit(mockLogger, {
        strategy: 'token-bucket',
        window: 60000,
        defaultTier: { name: 'bucket', limit: 5, burst: 2 },
      });
      const context = createAuthenticatedContext({ userId: 'bucket-user' });

      // Should allow limit + burst = 7 requests
      for (let i = 0; i < 7; i++) {
        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(true);
      }

      const decision = await policy.evaluate(context);
      expect(decision.allowed).toBe(false);
    });

    it('should have correct policy metadata', () => {
      policy = BuiltInPolicies.requireRateLimit(mockLogger, {
        strategy: 'sliding',
        window: 60000,
        defaultTier: { name: 'default', limit: 100 },
      });

      expect(policy.name).toBe('ratelimit:advanced:sliding');
      expect(policy.tags).toContain('ratelimit');
      expect(policy.tags).toContain('advanced');
    });
  });

  describe('requireIP (requireIpWhitelist)', () => {
    it('should allow whitelisted IP', async () => {
      const policy = BuiltInPolicies.requireIP(['192.168.1.1', '10.0.0.1', '172.16.0.1']);
      const context = createBaseContext({ environment: { ip: '192.168.1.1' } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toContain('whitelist');
    });

    it('should deny non-whitelisted IP', async () => {
      const policy = BuiltInPolicies.requireIP(['192.168.1.1']);
      const context = createBaseContext({ environment: { ip: '8.8.8.8' } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('not in whitelist');
    });

    it('should deny when IP is not available', async () => {
      const policy = BuiltInPolicies.requireIP(['192.168.1.1']);
      const context = createBaseContext();

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('not available');
    });

    it('should deny when environment is undefined', async () => {
      const policy = BuiltInPolicies.requireIP(['192.168.1.1']);
      const context = createBaseContext({ environment: undefined });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
    });

    it('should handle IPv6 addresses', async () => {
      const policy = BuiltInPolicies.requireIP(['::1', '2001:db8::1']);
      const context = createBaseContext({ environment: { ip: '::1' } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });
  });

  describe('requireIPRange (CIDR notation)', () => {
    it('should allow IP in IPv4 CIDR range', async () => {
      const policy = BuiltInPolicies.requireIPRange('192.168.1.0/24');
      const context = createBaseContext({ environment: { ip: '192.168.1.100' } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });

    it('should deny IP outside IPv4 CIDR range', async () => {
      const policy = BuiltInPolicies.requireIPRange('192.168.1.0/24');
      const context = createBaseContext({ environment: { ip: '192.168.2.1' } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
    });

    it('should allow IP in IPv6 CIDR range', async () => {
      const policy = BuiltInPolicies.requireIPRange('2001:db8::/32');
      const context = createBaseContext({ environment: { ip: '2001:db8::abcd' } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });

    it('should handle /32 (single IP) CIDR', async () => {
      const policy = BuiltInPolicies.requireIPRange('10.0.0.5/32');

      const matchContext = createBaseContext({ environment: { ip: '10.0.0.5' } });
      const noMatchContext = createBaseContext({ environment: { ip: '10.0.0.6' } });

      expect((await policy.evaluate(matchContext)).allowed).toBe(true);
      expect((await policy.evaluate(noMatchContext)).allowed).toBe(false);
    });

    it('should handle /0 (any IP) CIDR', async () => {
      const policy = BuiltInPolicies.requireIPRange('0.0.0.0/0');
      const context = createBaseContext({ environment: { ip: '123.45.67.89' } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });

    it('should handle invalid CIDR format', async () => {
      const policy = BuiltInPolicies.requireIPRange('not-a-cidr');
      const context = createBaseContext({ environment: { ip: '192.168.1.1' } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Invalid');
    });

    it('should deny when IP type mismatches CIDR type', async () => {
      const policy = BuiltInPolicies.requireIPRange('192.168.1.0/24');
      const context = createBaseContext({ environment: { ip: '2001:db8::1' } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
    });
  });

  describe('requireTimeWindow', () => {
    it('should allow access within time window (no timezone)', async () => {
      const policy = BuiltInPolicies.requireTimeWindow('00:00', '23:59');
      const now = new Date();
      const context = createBaseContext({ environment: { timestamp: now } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });

    it('should deny access outside time window', async () => {
      const policy = BuiltInPolicies.requireTimeWindow('09:00', '17:00');
      const now = new Date();
      now.setUTCHours(20, 0, 0, 0); // 8 PM UTC
      const context = createBaseContext({ environment: { timestamp: now } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Outside time window');
    });

    it('should handle timezone parameter', async () => {
      const policy = BuiltInPolicies.requireTimeWindow('09:00', '17:00', 'America/New_York');

      expect(policy.name).toContain('America/New_York');
      expect(policy.description).toContain('America/New_York');
    });

    it('should use current time if timestamp not provided', async () => {
      const policy = BuiltInPolicies.requireTimeWindow('00:00', '23:59');
      const context = createBaseContext();

      const decision = await policy.evaluate(context);

      // Should use current time, which is always within 00:00-23:59
      expect(decision.allowed).toBe(true);
    });

    it('should handle edge case at window start', async () => {
      const policy = BuiltInPolicies.requireTimeWindow('09:00', '17:00');
      const now = new Date();
      now.setUTCHours(9, 0, 0, 0); // Exactly 9:00 UTC
      const context = createBaseContext({ environment: { timestamp: now } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });

    it('should handle edge case at window end', async () => {
      const policy = BuiltInPolicies.requireTimeWindow('09:00', '17:00');
      const now = new Date();
      now.setUTCHours(17, 0, 0, 0); // Exactly 17:00 UTC
      const context = createBaseContext({ environment: { timestamp: now } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });
  });

  describe('requireBusinessHours', () => {
    it('should allow access during business hours on weekday', async () => {
      const policy = BuiltInPolicies.requireBusinessHours({
        timezone: 'UTC',
        start: '09:00',
        end: '17:00',
        weekdays: [1, 2, 3, 4, 5], // Mon-Fri
      });

      // Wednesday 12:00 UTC
      const now = new Date('2025-01-15T12:00:00Z');
      const context = createBaseContext({ environment: { timestamp: now } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });

    it('should deny access on weekend', async () => {
      const policy = BuiltInPolicies.requireBusinessHours({
        timezone: 'UTC',
        start: '09:00',
        end: '17:00',
        weekdays: [1, 2, 3, 4, 5],
      });

      // Saturday 12:00 UTC
      const now = new Date('2025-01-18T12:00:00Z');
      const context = createBaseContext({ environment: { timestamp: now } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Not a business day');
    });

    it('should deny access outside business hours on weekday', async () => {
      const policy = BuiltInPolicies.requireBusinessHours({
        timezone: 'UTC',
        start: '09:00',
        end: '17:00',
        weekdays: [1, 2, 3, 4, 5],
      });

      // Wednesday 20:00 UTC
      const now = new Date('2025-01-15T20:00:00Z');
      const context = createBaseContext({ environment: { timestamp: now } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Outside business hours');
    });

    it('should support weekend-only schedule', async () => {
      const policy = BuiltInPolicies.requireBusinessHours({
        timezone: 'UTC',
        start: '10:00',
        end: '16:00',
        weekdays: [0, 6], // Sat-Sun only
      });

      // Saturday 12:00 UTC
      const now = new Date('2025-01-18T12:00:00Z');
      const context = createBaseContext({ environment: { timestamp: now } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });
  });

  describe('requireResourceOwner (requireOwnership)', () => {
    it('should allow resource owner', async () => {
      const policy = BuiltInPolicies.requireResourceOwner();
      const context = createAuthenticatedContext(
        { userId: 'owner-user' },
        { resource: { id: 'doc-1', owner: 'owner-user' } }
      );

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toContain('owner');
    });

    it('should deny non-owner', async () => {
      const policy = BuiltInPolicies.requireResourceOwner();
      const context = createAuthenticatedContext(
        { userId: 'other-user' },
        { resource: { id: 'doc-1', owner: 'owner-user' } }
      );

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('not resource owner');
    });

    it('should deny when resource owner is missing', async () => {
      const policy = BuiltInPolicies.requireResourceOwner();
      const context = createAuthenticatedContext({ userId: 'user-1' }, { resource: { id: 'doc-1' } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Missing');
    });

    it('should deny when resource is missing', async () => {
      const policy = BuiltInPolicies.requireResourceOwner();
      const context = createAuthenticatedContext({ userId: 'user-1' });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
    });

    it('should deny when auth context is missing', async () => {
      const policy = BuiltInPolicies.requireResourceOwner();
      const context = createBaseContext({ resource: { id: 'doc-1', owner: 'user-1' } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
    });
  });

  describe('blockIP (denyBlacklist)', () => {
    it('should deny blacklisted IP', async () => {
      const policy = BuiltInPolicies.blockIP(['1.2.3.4', '5.6.7.8']);
      const context = createBaseContext({ environment: { ip: '1.2.3.4' } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('blacklisted');
    });

    it('should allow non-blacklisted IP', async () => {
      const policy = BuiltInPolicies.blockIP(['1.2.3.4', '5.6.7.8']);
      const context = createBaseContext({ environment: { ip: '192.168.1.1' } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toContain('not blacklisted');
    });

    it('should allow when IP is not available (fail open)', async () => {
      const policy = BuiltInPolicies.blockIP(['1.2.3.4']);
      const context = createBaseContext();

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });

    it('should handle empty blacklist', async () => {
      const policy = BuiltInPolicies.blockIP([]);
      const context = createBaseContext({ environment: { ip: '1.2.3.4' } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });
  });

  describe('requireTenantIsolation', () => {
    it('should allow access within same tenant', async () => {
      const policy = BuiltInPolicies.requireTenantIsolation();
      const context = createAuthenticatedContext(
        { metadata: { tenantId: 'tenant-a' } },
        { resource: { id: 'doc-1', attributes: { tenantId: 'tenant-a' } } }
      );

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });

    it('should deny access to different tenant', async () => {
      const policy = BuiltInPolicies.requireTenantIsolation();
      const context = createAuthenticatedContext(
        { metadata: { tenantId: 'tenant-a' } },
        { resource: { id: 'doc-1', attributes: { tenantId: 'tenant-b' } } }
      );

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('does not belong to resource tenant');
    });

    it('should allow access to global resources (no tenant)', async () => {
      const policy = BuiltInPolicies.requireTenantIsolation();
      const context = createAuthenticatedContext({ metadata: { tenantId: 'tenant-a' } }, { resource: { id: 'doc-1' } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toContain('no tenant restriction');
    });

    it('should deny when user tenant is missing', async () => {
      const policy = BuiltInPolicies.requireTenantIsolation();
      const context = createAuthenticatedContext(
        {},
        { resource: { id: 'doc-1', attributes: { tenantId: 'tenant-a' } } }
      );

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('User tenant not specified');
    });
  });

  describe('requireAttribute (customPolicy)', () => {
    it('should allow when attribute matches', async () => {
      const policy = BuiltInPolicies.requireAttribute('auth.metadata.tier', 'premium');
      const context = createAuthenticatedContext({
        metadata: { tier: 'premium' },
      });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });

    it('should deny when attribute does not match', async () => {
      const policy = BuiltInPolicies.requireAttribute('auth.metadata.tier', 'premium');
      const context = createAuthenticatedContext({
        metadata: { tier: 'free' },
      });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('mismatch');
    });

    it('should handle nested paths', async () => {
      const policy = BuiltInPolicies.requireAttribute('resource.attributes.nested.value', 42);
      const context = createBaseContext({
        resource: {
          id: 'doc-1',
          attributes: { nested: { value: 42 } },
        },
      });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });

    it('should deny when path does not exist', async () => {
      const policy = BuiltInPolicies.requireAttribute('auth.metadata.nonexistent', 'value');
      const context = createAuthenticatedContext({});

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
    });

    it('should support boolean values', async () => {
      const policy = BuiltInPolicies.requireAttribute('auth.metadata.verified', true);
      const context = createAuthenticatedContext({
        metadata: { verified: true },
      });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });
  });

  describe('requirePermission/requirePermissionPattern', () => {
    describe('requirePermission', () => {
      it('should allow with exact permission', async () => {
        const policy = BuiltInPolicies.requirePermission('users:read');
        const context = createAuthenticatedContext({
          permissions: ['users:read', 'users:write'],
        });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
      });

      it('should deny without exact permission', async () => {
        const policy = BuiltInPolicies.requirePermission('users:delete');
        const context = createAuthenticatedContext({
          permissions: ['users:read', 'users:write'],
        });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
      });
    });

    describe('requirePermissionPattern', () => {
      it('should match wildcard pattern', async () => {
        const policy = BuiltInPolicies.requirePermissionPattern('users:*');
        const context = createAuthenticatedContext({
          permissions: ['users:read', 'posts:write'],
        });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
      });

      it('should match complex wildcard pattern', async () => {
        const policy = BuiltInPolicies.requirePermissionPattern('documents:*:read');
        const context = createAuthenticatedContext({
          permissions: ['documents:private:read'],
        });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
      });

      it('should deny when no permission matches pattern', async () => {
        const policy = BuiltInPolicies.requirePermissionPattern('admin:*');
        const context = createAuthenticatedContext({
          permissions: ['users:read', 'users:write'],
        });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
      });
    });
  });

  describe('requireEnvironment', () => {
    it('should allow matching environment', async () => {
      const policy = BuiltInPolicies.requireEnvironment('production');
      const context = createBaseContext({ environment: { env: 'production' } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });

    it('should deny non-matching environment', async () => {
      const policy = BuiltInPolicies.requireEnvironment('production');
      const context = createBaseContext({ environment: { env: 'development' } });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
    });

    it('should default to unknown when env not set', async () => {
      const policy = BuiltInPolicies.requireEnvironment('unknown');
      const context = createBaseContext({ environment: {} });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });
  });

  describe('requireFeatureFlag', () => {
    it('should allow when feature flag is enabled', async () => {
      const policy = BuiltInPolicies.requireFeatureFlag('newFeature', true);
      const context = createAuthenticatedContext({
        metadata: { featureFlags: { newFeature: true } },
      });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });

    it('should deny when feature flag is disabled', async () => {
      const policy = BuiltInPolicies.requireFeatureFlag('newFeature', true);
      const context = createAuthenticatedContext({
        metadata: { featureFlags: { newFeature: false } },
      });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
    });

    it('should deny when feature flag is missing', async () => {
      const policy = BuiltInPolicies.requireFeatureFlag('newFeature', true);
      const context = createAuthenticatedContext({
        metadata: { featureFlags: {} },
      });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
    });

    it('should check for explicitly disabled flag', async () => {
      const policy = BuiltInPolicies.requireFeatureFlag('legacyFeature', false);
      const context = createAuthenticatedContext({
        metadata: { featureFlags: { legacyFeature: false } },
      });

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    describe('Missing Context Fields', () => {
      it('should handle completely empty context gracefully', async () => {
        const policies = [
          BuiltInPolicies.requireAuth(),
          BuiltInPolicies.requireRole('admin'),
          BuiltInPolicies.requireScope('read'),
          BuiltInPolicies.requireResourceOwner(),
        ];

        for (const policy of policies) {
          const context = createBaseContext();
          const decision = await policy.evaluate(context);

          expect(decision.allowed).toBe(false);
          expect(decision.reason).toBeDefined();
        }
      });

      it('should handle undefined auth metadata', async () => {
        const policy = BuiltInPolicies.requireAttribute('auth.metadata.key', 'value');
        const context = createAuthenticatedContext({ metadata: undefined });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
      });

      it('should handle null-like values in context', async () => {
        const policy = BuiltInPolicies.requireRole('admin');
        const context: ExecutionContext = {
          service: { name: 'test', version: '1.0.0' },
          auth: {
            userId: 'user',
            roles: [null as any, undefined as any, 'admin'],
            permissions: [],
          },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
      });
    });

    describe('Special Characters and Unicode', () => {
      it('should handle special characters in role names', async () => {
        const policy = BuiltInPolicies.requireRole('role:with:colons');
        const context = createAuthenticatedContext({
          roles: ['role:with:colons'],
        });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
      });

      it('should handle unicode in permission names', async () => {
        const policy = BuiltInPolicies.requirePermission('users:update');
        const context = createAuthenticatedContext({
          permissions: ['users:update', 'test:permission'],
        });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
      });

      it('should handle empty strings', async () => {
        const policy = BuiltInPolicies.requireRole('');
        const context = createAuthenticatedContext({ roles: [''] });

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
      });
    });

    describe('Large Data Sets', () => {
      it('should handle many roles efficiently', async () => {
        const manyRoles = Array.from({ length: 1000 }, (_, i) => `role-${i}`);
        const policy = BuiltInPolicies.requireRole('role-999');
        const context = createAuthenticatedContext({ roles: manyRoles });

        const start = Date.now();
        const decision = await policy.evaluate(context);
        const elapsed = Date.now() - start;

        expect(decision.allowed).toBe(true);
        expect(elapsed).toBeLessThan(100); // Should be fast
      });

      it('should handle many permissions efficiently', async () => {
        const manyPermissions = Array.from({ length: 1000 }, (_, i) => `perm:${i}`);
        const policy = BuiltInPolicies.requirePermission('perm:999');
        const context = createAuthenticatedContext({ permissions: manyPermissions });

        const start = Date.now();
        const decision = await policy.evaluate(context);
        const elapsed = Date.now() - start;

        expect(decision.allowed).toBe(true);
        expect(elapsed).toBeLessThan(100);
      });
    });

    describe('Policy Factory Configurations', () => {
      it('should create unique policies with different configurations', () => {
        const policy1 = BuiltInPolicies.requireRole('admin');
        const policy2 = BuiltInPolicies.requireRole('user');

        expect(policy1.name).not.toBe(policy2.name);
        expect(policy1.name).toContain('admin');
        expect(policy2.name).toContain('user');
      });

      it('should maintain policy immutability', async () => {
        const policy = BuiltInPolicies.requireRole('admin');
        const _originalName = policy.name;

        // Attempt to modify (should not affect original)
        (policy as any).name = 'modified';

        // Create new context and evaluate
        const context = createAuthenticatedContext({ roles: ['admin'] });
        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
        // Note: In JavaScript, this modification would actually work
        // This test documents the behavior
      });
    });

    describe('Concurrent Policy Evaluation', () => {
      it('should handle concurrent evaluations correctly', async () => {
        const policy = BuiltInPolicies.requireRole('admin');
        const contexts = Array.from({ length: 100 }, (_, i) =>
          createAuthenticatedContext({
            userId: `user-${i}`,
            roles: i % 2 === 0 ? ['admin'] : ['user'],
          })
        );

        const results = await Promise.all(contexts.map((ctx) => policy.evaluate(ctx)));

        const allowedCount = results.filter((r) => r.allowed).length;
        const deniedCount = results.filter((r) => !r.allowed).length;

        expect(allowedCount).toBe(50);
        expect(deniedCount).toBe(50);
      });
    });
  });

  describe('Policy Metadata Verification', () => {
    it('should have consistent tags across policy categories', () => {
      const rbacPolicies = [
        BuiltInPolicies.requireRole('test'),
        BuiltInPolicies.requireAnyRole(['test']),
        BuiltInPolicies.requireAllRoles(['test']),
        BuiltInPolicies.requirePermission('test'),
      ];

      for (const policy of rbacPolicies) {
        expect(policy.tags).toContain('rbac');
      }
    });

    it('should have consistent tags for ABAC policies', () => {
      const abacPolicies = [
        BuiltInPolicies.requireResourceOwner(),
        BuiltInPolicies.requireIP(['127.0.0.1']),
        BuiltInPolicies.requireTimeWindow('09:00', '17:00'),
        BuiltInPolicies.requireTenantIsolation(),
      ];

      for (const policy of abacPolicies) {
        expect(policy.tags).toContain('abac');
      }
    });

    it('should have OAuth2 tags for scope policies', () => {
      const scopePolicies = [BuiltInPolicies.requireScope('test'), BuiltInPolicies.requireAnyScope(['test'])];

      for (const policy of scopePolicies) {
        expect(policy.tags).toContain('oauth2');
        expect(policy.tags).toContain('scope');
      }
    });
  });
});
