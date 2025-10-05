/**
 * Built-in Policies tests
 */

import { describe, expect, it } from '@jest/globals';
import { BuiltInPolicies } from '../../../src/netron/auth/built-in-policies.js';
import type { ExecutionContext } from '../../../src/netron/auth/types.js';

describe('BuiltInPolicies', () => {
  describe('RBAC Policies', () => {
    describe('requireRole', () => {
      it('should allow user with required role', async () => {
        const policy = BuiltInPolicies.requireRole('admin');
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: ['admin', 'user'],
            permissions: [],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
        expect(decision.reason).toContain('admin');
      });

      it('should deny user without required role', async () => {
        const policy = BuiltInPolicies.requireRole('admin');
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: ['user'],
            permissions: [],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('Missing role');
      });

      it('should deny when no auth context', async () => {
        const policy = BuiltInPolicies.requireRole('admin');
        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
      });
    });

    describe('requireAnyRole', () => {
      it('should allow user with any of required roles', async () => {
        const policy = BuiltInPolicies.requireAnyRole(['admin', 'moderator']);
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: ['user', 'moderator'],
            permissions: [],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
      });

      it('should deny user without any required role', async () => {
        const policy = BuiltInPolicies.requireAnyRole(['admin', 'moderator']);
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: ['user'],
            permissions: [],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('Missing all roles');
      });
    });

    describe('requireAllRoles', () => {
      it('should allow user with all required roles', async () => {
        const policy = BuiltInPolicies.requireAllRoles(['admin', 'moderator']);
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: ['user', 'admin', 'moderator'],
            permissions: [],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
        expect(decision.reason).toContain('Has all required roles');
      });

      it('should deny user missing some roles', async () => {
        const policy = BuiltInPolicies.requireAllRoles(['admin', 'moderator']);
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: ['admin'],
            permissions: [],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('Missing roles');
        expect(decision.reason).toContain('moderator');
      });
    });

    describe('requirePermission', () => {
      it('should allow user with required permission', async () => {
        const policy = BuiltInPolicies.requirePermission('user:delete');
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: ['user:read', 'user:delete'],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
      });

      it('should deny user without required permission', async () => {
        const policy = BuiltInPolicies.requirePermission('user:delete');
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: ['user:read'],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('Missing permission');
      });
    });

    describe('requireAnyPermission', () => {
      it('should allow user with any required permission', async () => {
        const policy = BuiltInPolicies.requireAnyPermission([
          'user:write',
          'user:delete',
        ]);
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: ['user:read', 'user:delete'],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
      });

      it('should deny user without any required permission', async () => {
        const policy = BuiltInPolicies.requireAnyPermission([
          'user:write',
          'user:delete',
        ]);
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: ['user:read'],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
      });
    });

    describe('requireAuth', () => {
      it('should allow authenticated user', async () => {
        const policy = BuiltInPolicies.requireAuth();
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: [],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
        expect(decision.reason).toContain('authenticated');
      });

      it('should deny unauthenticated user', async () => {
        const policy = BuiltInPolicies.requireAuth();
        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('Authentication required');
      });
    });
  });

  describe('ABAC Policies', () => {
    describe('requireResourceOwner', () => {
      it('should allow resource owner', async () => {
        const policy = BuiltInPolicies.requireResourceOwner();
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: [],
          },
          service: { name: 'testService', version: '1.0.0' },
          resource: {
            id: 'doc1',
            owner: 'user1',
          },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
        expect(decision.reason).toContain('owner');
      });

      it('should deny non-owner', async () => {
        const policy = BuiltInPolicies.requireResourceOwner();
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: [],
          },
          service: { name: 'testService', version: '1.0.0' },
          resource: {
            id: 'doc1',
            owner: 'user2',
          },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('not resource owner');
      });

      it('should deny when resource owner is missing', async () => {
        const policy = BuiltInPolicies.requireResourceOwner();
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: [],
          },
          service: { name: 'testService', version: '1.0.0' },
          resource: { id: 'doc1' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
      });
    });

    describe('requireTimeWindow', () => {
      it('should allow access within time window', async () => {
        const policy = BuiltInPolicies.requireTimeWindow('09:00', '17:00');

        const now = new Date();
        now.setHours(12, 0, 0, 0); // Noon

        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
          environment: { timestamp: now },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
        expect(decision.reason).toContain('Within time window');
      });

      it('should deny access outside time window', async () => {
        const policy = BuiltInPolicies.requireTimeWindow('09:00', '17:00');

        const now = new Date();
        now.setHours(20, 0, 0, 0); // 8 PM

        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
          environment: { timestamp: now },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('Outside time window');
      });
    });

    describe('requireIP', () => {
      it('should allow whitelisted IP', async () => {
        const policy = BuiltInPolicies.requireIP(['192.168.1.1', '10.0.0.1']);
        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
          environment: { ip: '192.168.1.1' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
        expect(decision.reason).toContain('in whitelist');
      });

      it('should deny non-whitelisted IP', async () => {
        const policy = BuiltInPolicies.requireIP(['192.168.1.1', '10.0.0.1']);
        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
          environment: { ip: '8.8.8.8' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('not in whitelist');
      });

      it('should deny when IP is not available', async () => {
        const policy = BuiltInPolicies.requireIP(['192.168.1.1']);
        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('not available');
      });
    });

    describe('blockIP', () => {
      it('should allow non-blacklisted IP', async () => {
        const policy = BuiltInPolicies.blockIP(['1.2.3.4', '5.6.7.8']);
        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
          environment: { ip: '192.168.1.1' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
        expect(decision.reason).toContain('not blacklisted');
      });

      it('should deny blacklisted IP', async () => {
        const policy = BuiltInPolicies.blockIP(['1.2.3.4', '5.6.7.8']);
        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
          environment: { ip: '1.2.3.4' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('blacklisted');
      });
    });

    describe('requireAttribute', () => {
      it('should allow when attribute matches', async () => {
        const policy = BuiltInPolicies.requireAttribute(
          'auth.metadata.tier',
          'premium',
        );
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: [],
            metadata: { tier: 'premium' },
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
        expect(decision.reason).toContain('matches');
      });

      it('should deny when attribute does not match', async () => {
        const policy = BuiltInPolicies.requireAttribute(
          'auth.metadata.tier',
          'premium',
        );
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: [],
            metadata: { tier: 'free' },
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('mismatch');
      });
    });

    describe('requireTenantIsolation', () => {
      it('should allow access within same tenant', async () => {
        const policy = BuiltInPolicies.requireTenantIsolation();
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: [],
            metadata: { tenantId: 'tenant1' },
          },
          service: { name: 'testService', version: '1.0.0' },
          resource: {
            id: 'doc1',
            attributes: { tenantId: 'tenant1' },
          },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
        expect(decision.reason).toContain('belongs to resource tenant');
      });

      it('should deny access to different tenant', async () => {
        const policy = BuiltInPolicies.requireTenantIsolation();
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: [],
            metadata: { tenantId: 'tenant1' },
          },
          service: { name: 'testService', version: '1.0.0' },
          resource: {
            id: 'doc1',
            attributes: { tenantId: 'tenant2' },
          },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('does not belong to resource tenant');
      });

      it('should allow global resources without tenant', async () => {
        const policy = BuiltInPolicies.requireTenantIsolation();
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: [],
            metadata: { tenantId: 'tenant1' },
          },
          service: { name: 'testService', version: '1.0.0' },
          resource: { id: 'doc1' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
        expect(decision.reason).toContain('no tenant restriction');
      });
    });
  });

  describe('OAuth2 Policies', () => {
    describe('requireScope', () => {
      it('should allow user with required scope', async () => {
        const policy = BuiltInPolicies.requireScope('read:documents');
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: [],
            scopes: ['read:documents', 'write:documents'],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
      });

      it('should deny user without required scope', async () => {
        const policy = BuiltInPolicies.requireScope('write:documents');
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: [],
            scopes: ['read:documents'],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('Missing scope');
      });
    });

    describe('requireAnyScope', () => {
      it('should allow user with any required scope', async () => {
        const policy = BuiltInPolicies.requireAnyScope([
          'read:documents',
          'write:documents',
        ]);
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: [],
            scopes: ['read:documents'],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
      });

      it('should deny user without any required scope', async () => {
        const policy = BuiltInPolicies.requireAnyScope([
          'read:documents',
          'write:documents',
        ]);
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: [],
            scopes: ['admin:all'],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
      });
    });
  });

  describe('Rate Limiting Policy', () => {
    it('should allow requests within rate limit', async () => {
      const policy = BuiltInPolicies.rateLimit(5, 1000);
      const context: ExecutionContext = {
        auth: {
          userId: 'user1',
          roles: [],
          permissions: [],
        },
        service: { name: 'testService', version: '1.0.0' },
      };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toContain('Within rate limit');
      expect(decision.metadata?.remaining).toBeDefined();
    });

    it('should deny requests exceeding rate limit', async () => {
      const policy = BuiltInPolicies.rateLimit(2, 1000);
      const context: ExecutionContext = {
        auth: {
          userId: 'user1',
          roles: [],
          permissions: [],
        },
        service: { name: 'testService', version: '1.0.0' },
      };

      // First 2 requests should succeed
      await policy.evaluate(context);
      await policy.evaluate(context);

      // Third request should fail
      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Rate limit exceeded');
      expect(decision.metadata?.retryAfter).toBeDefined();
    });

    it('should use IP for anonymous users', async () => {
      const policy = BuiltInPolicies.rateLimit(2, 1000);
      const context: ExecutionContext = {
        service: { name: 'testService', version: '1.0.0' },
        environment: { ip: '192.168.1.1' },
      };

      await policy.evaluate(context);
      await policy.evaluate(context);
      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
    });
  });

  describe('Environment Policies', () => {
    describe('requireEnvironment', () => {
      it('should allow matching environment', async () => {
        const policy = BuiltInPolicies.requireEnvironment('production');
        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
          environment: { env: 'production' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
      });

      it('should deny non-matching environment', async () => {
        const policy = BuiltInPolicies.requireEnvironment('production');
        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
          environment: { env: 'development' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
      });
    });

    describe('requireFeatureFlag', () => {
      it('should allow when feature flag is enabled', async () => {
        const policy = BuiltInPolicies.requireFeatureFlag('newFeature', true);
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: [],
            metadata: {
              featureFlags: { newFeature: true },
            },
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(true);
      });

      it('should deny when feature flag is disabled', async () => {
        const policy = BuiltInPolicies.requireFeatureFlag('newFeature', true);
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: [],
            metadata: {
              featureFlags: { newFeature: false },
            },
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);

        expect(decision.allowed).toBe(false);
      });
    });
  });

  describe('Policy Tags', () => {
    it('should include appropriate tags', () => {
      const rolePolicy = BuiltInPolicies.requireRole('admin');
      expect(rolePolicy.tags).toContain('rbac');
      expect(rolePolicy.tags).toContain('role');

      const resourcePolicy = BuiltInPolicies.requireResourceOwner();
      expect(resourcePolicy.tags).toContain('abac');
      expect(resourcePolicy.tags).toContain('resource');

      const scopePolicy = BuiltInPolicies.requireScope('read:docs');
      expect(scopePolicy.tags).toContain('oauth2');
      expect(scopePolicy.tags).toContain('scope');
    });
  });
});
