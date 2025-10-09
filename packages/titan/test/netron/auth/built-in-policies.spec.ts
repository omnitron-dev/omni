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
        now.setUTCHours(12, 0, 0, 0); // Noon UTC

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
        now.setUTCHours(20, 0, 0, 0); // 8 PM UTC

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

  describe('Enhanced RBAC Policies', () => {
    describe('Role Hierarchies', () => {
      it('should support role hierarchies with admin > moderator > user', async () => {
        const policy = BuiltInPolicies.requireAnyRole([
          'admin',
          'moderator',
          'user',
        ]);

        // Admin should have access
        const adminContext: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: ['admin'],
            permissions: [],
          },
          service: { name: 'testService', version: '1.0.0' },
        };
        expect((await policy.evaluate(adminContext)).allowed).toBe(true);

        // Moderator should have access
        const modContext: ExecutionContext = {
          auth: {
            userId: 'user2',
            roles: ['moderator'],
            permissions: [],
          },
          service: { name: 'testService', version: '1.0.0' },
        };
        expect((await policy.evaluate(modContext)).allowed).toBe(true);

        // User should have access
        const userContext: ExecutionContext = {
          auth: {
            userId: 'user3',
            roles: ['user'],
            permissions: [],
          },
          service: { name: 'testService', version: '1.0.0' },
        };
        expect((await policy.evaluate(userContext)).allowed).toBe(true);
      });

      it('should support nested role checks with inheritance', async () => {
        const policy = BuiltInPolicies.requireAllRoles(['moderator', 'editor']);
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: ['admin', 'moderator', 'editor', 'user'],
            permissions: [],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(true);
        expect(decision.reason).toContain('Has all required roles');
      });

      it('should support dynamic role resolution', async () => {
        const dynamicRole = 'dynamic_role_' + Date.now();
        const policy = BuiltInPolicies.requireRole(dynamicRole);

        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [dynamicRole],
            permissions: [],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(true);
        expect(decision.reason).toContain(dynamicRole);
      });
    });

    describe('Permission Patterns', () => {
      it('should match permission wildcards (users:*)', async () => {
        const policy = BuiltInPolicies.requirePermissionPattern('users:*');
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: ['users:read', 'users:write', 'posts:read'],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(true);
        expect(decision.reason).toContain('matching pattern');
      });

      it('should match permission hierarchies (admin:*)', async () => {
        const policy = BuiltInPolicies.requirePermissionPattern('admin:*');
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: ['admin:read', 'admin:write', 'admin:delete'],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(true);
      });

      it('should support permission patterns with multiple segments', async () => {
        const policy =
          BuiltInPolicies.requirePermissionPattern('documents:*:read');
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: ['documents:private:read', 'documents:public:read'],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(true);
      });

      it('should deny when no permissions match pattern', async () => {
        const policy = BuiltInPolicies.requirePermissionPattern('admin:*');
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: ['user:read', 'user:write'],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('No permission matches pattern');
      });
    });
  });

  describe('Enhanced Scope Policies', () => {
    describe('Scope Formatting', () => {
      it('should handle space-separated scopes', async () => {
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

      it('should support OAuth2 scope hierarchies', async () => {
        const policy = BuiltInPolicies.requireAnyScope([
          'openid',
          'profile',
          'email',
        ]);
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: [],
            scopes: ['openid', 'profile'],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(true);
      });
    });
  });

  describe('Enhanced Resource Policies', () => {
    describe('Complex Resource Attributes', () => {
      it('should check nested object attributes', async () => {
        const policy = BuiltInPolicies.requireAttribute(
          'resource.attributes.status',
          'published',
        );
        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
          resource: {
            id: 'doc1',
            attributes: {
              status: 'published',
              visibility: 'public',
            },
          },
        };

        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(true);
      });

      it('should handle resource not found gracefully', async () => {
        const policy = BuiltInPolicies.requireResourceOwner();
        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: [],
            permissions: [],
          },
          service: { name: 'testService', version: '1.0.0' },
          // No resource provided
        };

        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('Missing');
      });
    });
  });

  describe('Enhanced Time-based Policies', () => {
    describe('Timezone Handling', () => {
      it('should handle UTC timezone', async () => {
        const policy = BuiltInPolicies.requireTimeWindow(
          '09:00',
          '17:00',
          'UTC',
        );
        const now = new Date();
        now.setUTCHours(12, 0, 0, 0);

        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
          environment: { timestamp: now },
        };

        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(true);
      });

      it('should handle EST timezone', async () => {
        const policy = BuiltInPolicies.requireTimeWindow(
          '09:00',
          '17:00',
          'America/New_York',
        );
        // Create a time that's 12:00 EST
        const now = new Date('2025-01-15T17:00:00Z'); // 12:00 EST

        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
          environment: { timestamp: now },
        };

        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(true);
      });

      it('should handle PST timezone', async () => {
        const policy = BuiltInPolicies.requireTimeWindow(
          '09:00',
          '17:00',
          'America/Los_Angeles',
        );
        // Create a time that's 12:00 PST
        const now = new Date('2025-01-15T20:00:00Z'); // 12:00 PST

        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
          environment: { timestamp: now },
        };

        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(true);
      });
    });

    describe('Business Hours Policy', () => {
      it('should allow access during business hours', async () => {
        const policy = BuiltInPolicies.requireBusinessHours({
          timezone: 'America/New_York',
          start: '09:00',
          end: '17:00',
          weekdays: [1, 2, 3, 4, 5], // Mon-Fri
        });

        // Wednesday, 12:00 EST
        const now = new Date('2025-01-15T17:00:00Z');

        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
          environment: { timestamp: now },
        };

        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(true);
        expect(decision.reason).toContain('Within business hours');
      });

      it('should deny access outside business hours', async () => {
        const policy = BuiltInPolicies.requireBusinessHours({
          timezone: 'America/New_York',
          start: '09:00',
          end: '17:00',
          weekdays: [1, 2, 3, 4, 5],
        });

        // Wednesday, 20:00 EST (8 PM)
        const now = new Date('2025-01-15T01:00:00Z');

        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
          environment: { timestamp: now },
        };

        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('Outside business hours');
      });

      it('should deny access on weekends', async () => {
        const policy = BuiltInPolicies.requireBusinessHours({
          timezone: 'America/New_York',
          start: '09:00',
          end: '17:00',
          weekdays: [1, 2, 3, 4, 5],
        });

        // Sunday, 12:00 EST
        const now = new Date('2025-01-19T17:00:00Z');

        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
          environment: { timestamp: now },
        };

        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('Not a business day');
      });
    });
  });

  describe('Enhanced Network Policies', () => {
    describe('IP Ranges (CIDR)', () => {
      it('should allow IP in IPv4 CIDR range', async () => {
        const policy = BuiltInPolicies.requireIPRange('192.168.1.0/24');
        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
          environment: { ip: '192.168.1.50' },
        };

        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(true);
        expect(decision.reason).toContain('is in range');
      });

      it('should deny IP outside IPv4 CIDR range', async () => {
        const policy = BuiltInPolicies.requireIPRange('192.168.1.0/24');
        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
          environment: { ip: '192.168.2.50' },
        };

        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('is not in range');
      });

      it('should support IPv6 CIDR ranges', async () => {
        const policy = BuiltInPolicies.requireIPRange('2001:db8::/32');
        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
          environment: { ip: '2001:db8::1' },
        };

        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(true);
        expect(decision.reason).toContain('is in range');
      });

      it('should deny IPv6 outside range', async () => {
        const policy = BuiltInPolicies.requireIPRange('2001:db8::/32');
        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
          environment: { ip: '2001:db9::1' },
        };

        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(false);
      });

      it('should handle missing IP gracefully', async () => {
        const policy = BuiltInPolicies.requireIPRange('192.168.1.0/24');
        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
        };

        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('not available');
      });

      it('should handle invalid CIDR format', async () => {
        const policy = BuiltInPolicies.requireIPRange('invalid-cidr');
        const context: ExecutionContext = {
          service: { name: 'testService', version: '1.0.0' },
          environment: { ip: '192.168.1.1' },
        };

        const decision = await policy.evaluate(context);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('Invalid');
      });
    });
  });

  describe('Combined Policy Scenarios', () => {
    describe('Multiple RBAC Policies', () => {
      it('should require both role AND permission', async () => {
        const rolePolicy = BuiltInPolicies.requireRole('admin');
        const permPolicy = BuiltInPolicies.requirePermission('users:delete');

        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: ['admin'],
            permissions: ['users:delete'],
          },
          service: { name: 'testService', version: '1.0.0' },
        };

        const roleDecision = await rolePolicy.evaluate(context);
        const permDecision = await permPolicy.evaluate(context);

        expect(roleDecision.allowed).toBe(true);
        expect(permDecision.allowed).toBe(true);
      });
    });

    describe('RBAC + ABAC Combination', () => {
      it('should combine role and resource ownership', async () => {
        const rolePolicy = BuiltInPolicies.requireAnyRole(['admin', 'owner']);
        const ownerPolicy = BuiltInPolicies.requireResourceOwner();

        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: ['owner'],
            permissions: [],
          },
          service: { name: 'testService', version: '1.0.0' },
          resource: {
            id: 'doc1',
            owner: 'user1',
          },
        };

        const roleDecision = await rolePolicy.evaluate(context);
        const ownerDecision = await ownerPolicy.evaluate(context);

        expect(roleDecision.allowed).toBe(true);
        expect(ownerDecision.allowed).toBe(true);
      });
    });

    describe('Resource + Network Policies', () => {
      it('should require owner from specific IP', async () => {
        const ownerPolicy = BuiltInPolicies.requireResourceOwner();
        const ipPolicy = BuiltInPolicies.requireIP(['192.168.1.1']);

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
          environment: {
            ip: '192.168.1.1',
          },
        };

        const ownerDecision = await ownerPolicy.evaluate(context);
        const ipDecision = await ipPolicy.evaluate(context);

        expect(ownerDecision.allowed).toBe(true);
        expect(ipDecision.allowed).toBe(true);
      });
    });

    describe('Time + Role Policies', () => {
      it('should require admin role during business hours', async () => {
        const rolePolicy = BuiltInPolicies.requireRole('admin');
        const timePolicy = BuiltInPolicies.requireBusinessHours({
          timezone: 'UTC',
          start: '09:00',
          end: '17:00',
          weekdays: [1, 2, 3, 4, 5],
        });

        // Wednesday, 12:00 UTC
        const now = new Date('2025-01-15T12:00:00Z');

        const context: ExecutionContext = {
          auth: {
            userId: 'user1',
            roles: ['admin'],
            permissions: [],
          },
          service: { name: 'testService', version: '1.0.0' },
          environment: { timestamp: now },
        };

        const roleDecision = await rolePolicy.evaluate(context);
        const timeDecision = await timePolicy.evaluate(context);

        expect(roleDecision.allowed).toBe(true);
        expect(timeDecision.allowed).toBe(true);
      });
    });
  });
});
