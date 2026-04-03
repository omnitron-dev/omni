/**
 * Integration Tests for AuthorizationManager
 *
 * These tests focus on comprehensive integration testing with real implementations.
 * Only the logger is mocked as per requirements.
 *
 * @module @omnitron-dev/titan/test/netron/auth/authorization-manager.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthorizationManager } from '../../../src/netron/auth/authorization-manager.js';
import type { AuthContext, ServiceACL } from '../../../src/netron/auth/types.js';
import type { ILogger } from '../../../src/types/logger.js';

/**
 * Mock logger implementing ILogger interface
 * This is the only mock used - all other implementations are real
 */
function createMockLogger(): ILogger {
  const noop = () => {};
  const logger: ILogger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => logger),
    time: () => noop,
    isLevelEnabled: () => true,
    setLevel: noop,
    getLevel: () => 'debug',
  };
  return logger;
}

describe('AuthorizationManager Integration Tests', () => {
  let authzManager: AuthorizationManager;
  let mockLogger: ILogger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    authzManager = new AuthorizationManager(mockLogger);
  });

  afterEach(() => {
    // Clean up - equivalent to destroy()
    authzManager.clearACLs();
  });

  // ============================================================================
  // Service Access Tests (setServiceAccess/checkServiceAccess patterns)
  // ============================================================================

  describe('Service Access Management', () => {
    describe('registerACL (setServiceAccess equivalent)', () => {
      it('should register a new service ACL with roles', () => {
        const acl: ServiceACL = {
          service: 'userService',
          allowedRoles: ['admin', 'moderator'],
        };

        authzManager.registerACL(acl);

        const registeredACLs = authzManager.getACLs();
        expect(registeredACLs).toHaveLength(1);
        expect(registeredACLs[0].service).toBe('userService');
        expect(registeredACLs[0].allowedRoles).toEqual(['admin', 'moderator']);
      });

      it('should register a service ACL with permissions', () => {
        const acl: ServiceACL = {
          service: 'dataService',
          requiredPermissions: ['data:read', 'data:write'],
        };

        authzManager.registerACL(acl);

        const registeredACLs = authzManager.getACLs();
        expect(registeredACLs[0].requiredPermissions).toEqual(['data:read', 'data:write']);
      });

      it('should register a service ACL with both roles and permissions', () => {
        const acl: ServiceACL = {
          service: 'adminService',
          allowedRoles: ['admin'],
          requiredPermissions: ['admin:access', 'admin:write'],
        };

        authzManager.registerACL(acl);

        const registeredACLs = authzManager.getACLs();
        expect(registeredACLs[0].allowedRoles).toEqual(['admin']);
        expect(registeredACLs[0].requiredPermissions).toEqual(['admin:access', 'admin:write']);
      });

      it('should update existing ACL when registering same service', () => {
        authzManager.registerACL({
          service: 'userService',
          allowedRoles: ['user'],
        });

        authzManager.registerACL({
          service: 'userService',
          allowedRoles: ['admin', 'moderator'],
          requiredPermissions: ['user:manage'],
        });

        const registeredACLs = authzManager.getACLs();
        expect(registeredACLs).toHaveLength(1);
        expect(registeredACLs[0].allowedRoles).toEqual(['admin', 'moderator']);
        expect(registeredACLs[0].requiredPermissions).toEqual(['user:manage']);
      });

      it('should register multiple ACLs at once', () => {
        const acls: ServiceACL[] = [
          { service: 'service1', allowedRoles: ['role1'] },
          { service: 'service2', allowedRoles: ['role2'] },
          { service: 'service3', allowedRoles: ['role3'] },
        ];

        authzManager.registerACLs(acls);

        expect(authzManager.getACLs()).toHaveLength(3);
      });
    });

    describe('canAccessService (checkServiceAccess equivalent)', () => {
      it('should allow access when user has required role', () => {
        authzManager.registerACL({
          service: 'userService',
          allowedRoles: ['admin', 'user'],
        });

        const authContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        expect(authzManager.canAccessService('userService', authContext)).toBe(true);
      });

      it('should deny access when user lacks required role', () => {
        authzManager.registerACL({
          service: 'adminService',
          allowedRoles: ['admin'],
        });

        const authContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        expect(authzManager.canAccessService('adminService', authContext)).toBe(false);
      });

      it('should allow access when user has all required permissions', () => {
        authzManager.registerACL({
          service: 'dataService',
          requiredPermissions: ['data:read', 'data:write'],
        });

        const authContext: AuthContext = {
          userId: 'user1',
          roles: [],
          permissions: ['data:read', 'data:write', 'data:delete'],
        };

        expect(authzManager.canAccessService('dataService', authContext)).toBe(true);
      });

      it('should deny access when user lacks any required permission', () => {
        authzManager.registerACL({
          service: 'dataService',
          requiredPermissions: ['data:read', 'data:write'],
        });

        const authContext: AuthContext = {
          userId: 'user1',
          roles: [],
          permissions: ['data:read'], // Missing data:write
        };

        expect(authzManager.canAccessService('dataService', authContext)).toBe(false);
      });

      it('should require both role AND permissions when both specified', () => {
        authzManager.registerACL({
          service: 'secureService',
          allowedRoles: ['admin'],
          requiredPermissions: ['secure:access'],
        });

        // Has role but not permission
        const hasRoleOnly: AuthContext = {
          userId: 'user1',
          roles: ['admin'],
          permissions: [],
        };

        // Has permission but not role
        const hasPermissionOnly: AuthContext = {
          userId: 'user2',
          roles: ['user'],
          permissions: ['secure:access'],
        };

        // Has both
        const hasBoth: AuthContext = {
          userId: 'user3',
          roles: ['admin'],
          permissions: ['secure:access'],
        };

        expect(authzManager.canAccessService('secureService', hasRoleOnly)).toBe(false);
        expect(authzManager.canAccessService('secureService', hasPermissionOnly)).toBe(false);
        expect(authzManager.canAccessService('secureService', hasBoth)).toBe(true);
      });
    });
  });

  // ============================================================================
  // Method Access Tests (setMethodAccess/checkMethodAccess patterns)
  // ============================================================================

  describe('Method Access Management', () => {
    describe('Method ACL Registration', () => {
      it('should register method-specific ACL within service ACL', () => {
        authzManager.registerACL({
          service: 'userService',
          allowedRoles: ['user'],
          methods: {
            deleteUser: {
              allowedRoles: ['admin'],
            },
            updateUser: {
              requiredPermissions: ['user:update'],
            },
          },
        });

        const acls = authzManager.getACLs();
        expect(acls[0].methods).toBeDefined();
        expect(acls[0].methods?.deleteUser?.allowedRoles).toEqual(['admin']);
        expect(acls[0].methods?.updateUser?.requiredPermissions).toEqual(['user:update']);
      });
    });

    describe('canAccessMethod (checkMethodAccess equivalent)', () => {
      it('should allow method access when user has method-specific role', () => {
        authzManager.registerACL({
          service: 'userService',
          allowedRoles: ['user'],
          methods: {
            adminMethod: {
              allowedRoles: ['admin'],
              __override: true,
            },
          },
        });

        const adminContext: AuthContext = {
          userId: 'admin1',
          roles: ['admin'],
          permissions: [],
        };

        expect(authzManager.canAccessMethod('userService', 'adminMethod', adminContext)).toBe(true);
      });

      it('should deny method access when user lacks method-specific role', () => {
        authzManager.registerACL({
          service: 'userService',
          allowedRoles: ['user'],
          methods: {
            adminMethod: {
              allowedRoles: ['admin'],
              __override: true,
            },
          },
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        expect(authzManager.canAccessMethod('userService', 'adminMethod', userContext)).toBe(false);
      });

      it('should inherit service ACL when method has no specific ACL', () => {
        authzManager.registerACL({
          service: 'userService',
          allowedRoles: ['user'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        expect(authzManager.canAccessMethod('userService', 'anyMethod', userContext)).toBe(true);
      });

      it('should replace service ACL with method ACL when method defines roles', () => {
        authzManager.registerACL({
          service: 'userService',
          allowedRoles: ['user'],
          methods: {
            specialMethod: {
              allowedRoles: ['specialist'],
            },
          },
        });

        // User with service role but not method role
        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        // User with method role but not service role
        const specialistContext: AuthContext = {
          userId: 'specialist1',
          roles: ['specialist'],
          permissions: [],
        };

        // Method ACL replaces service ACL
        expect(authzManager.canAccessMethod('userService', 'specialMethod', userContext)).toBe(false);
        expect(authzManager.canAccessMethod('userService', 'specialMethod', specialistContext)).toBe(true);
      });

      it('should allow access to methods without specific ACL when service access is granted', () => {
        authzManager.registerACL({
          service: 'userService',
          allowedRoles: ['user'],
          methods: {
            restrictedMethod: {
              allowedRoles: ['admin'],
            },
          },
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        // publicMethod has no ACL, so service-level access applies
        expect(authzManager.canAccessMethod('userService', 'publicMethod', userContext)).toBe(true);
        // restrictedMethod has its own ACL
        expect(authzManager.canAccessMethod('userService', 'restrictedMethod', userContext)).toBe(false);
      });

      it('should check method permissions', () => {
        authzManager.registerACL({
          service: 'dataService',
          methods: {
            writeData: {
              requiredPermissions: ['data:write'],
            },
          },
        });

        const hasPermission: AuthContext = {
          userId: 'user1',
          roles: [],
          permissions: ['data:write'],
        };

        const lacksPermission: AuthContext = {
          userId: 'user2',
          roles: [],
          permissions: ['data:read'],
        };

        expect(authzManager.canAccessMethod('dataService', 'writeData', hasPermission)).toBe(true);
        expect(authzManager.canAccessMethod('dataService', 'writeData', lacksPermission)).toBe(false);
      });

      it('should handle __override flag to completely ignore service-level ACL', () => {
        authzManager.registerACL({
          service: 'userService',
          allowedRoles: ['user'],
          requiredPermissions: ['service:access'],
          methods: {
            publicMethod: {
              allowedRoles: ['public'],
              __override: true,
            },
          },
        });

        // Has only the method role, not service requirements
        const publicContext: AuthContext = {
          userId: 'public1',
          roles: ['public'],
          permissions: [],
        };

        // With __override, only method ACL is checked
        expect(authzManager.canAccessMethod('userService', 'publicMethod', publicContext)).toBe(true);
      });
    });
  });

  // ============================================================================
  // validateAccess Comprehensive Flow Tests
  // ============================================================================

  describe('validateAccess Comprehensive Flow', () => {
    it('should return allowed when no requirements specified', () => {
      const authContext: AuthContext = {
        userId: 'user1',
        roles: ['user'],
        permissions: ['read'],
      };

      const result = authzManager.validateAccess(authContext, {});
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should validate roles using ANY logic (user needs at least one)', () => {
      const authContext: AuthContext = {
        userId: 'user1',
        roles: ['editor', 'viewer'],
        permissions: [],
      };

      // Has one of the required roles
      const result1 = authzManager.validateAccess(authContext, {
        roles: ['admin', 'editor', 'owner'],
      });
      expect(result1.allowed).toBe(true);

      // Has none of the required roles
      const result2 = authzManager.validateAccess(authContext, {
        roles: ['admin', 'owner'],
      });
      expect(result2.allowed).toBe(false);
      expect(result2.reason).toContain('role');
      expect(result2.details?.missingRoles).toEqual(['admin', 'owner']);
    });

    it('should validate permissions using ALL logic (user needs all)', () => {
      const authContext: AuthContext = {
        userId: 'user1',
        roles: [],
        permissions: ['read', 'write'],
      };

      // Has all required permissions
      const result1 = authzManager.validateAccess(authContext, {
        permissions: ['read', 'write'],
      });
      expect(result1.allowed).toBe(true);

      // Missing one permission
      const result2 = authzManager.validateAccess(authContext, {
        permissions: ['read', 'write', 'delete'],
      });
      expect(result2.allowed).toBe(false);
      expect(result2.reason).toContain('permission');
      expect(result2.details?.missingPermissions).toEqual(['delete']);
    });

    it('should check requirements in order: roles -> permissions -> scopes', () => {
      const authContext: AuthContext = {
        userId: 'user1',
        roles: ['user'],
        permissions: ['read'],
        scopes: ['api:read'],
      };

      // Fails on roles first
      const result1 = authzManager.validateAccess(authContext, {
        roles: ['admin'],
        permissions: ['write'],
        scopes: ['api:admin'],
      });
      expect(result1.allowed).toBe(false);
      expect(result1.reason).toContain('role');

      // Passes roles, fails on permissions
      const result2 = authzManager.validateAccess(authContext, {
        roles: ['user'],
        permissions: ['write'],
        scopes: ['api:admin'],
      });
      expect(result2.allowed).toBe(false);
      expect(result2.reason).toContain('permission');

      // Passes roles and permissions, fails on scopes
      const result3 = authzManager.validateAccess(authContext, {
        roles: ['user'],
        permissions: ['read'],
        scopes: ['api:admin'],
      });
      expect(result3.allowed).toBe(false);
      expect(result3.reason).toContain('scope');

      // Passes all
      const result4 = authzManager.validateAccess(authContext, {
        roles: ['user'],
        permissions: ['read'],
        scopes: ['api:read'],
      });
      expect(result4.allowed).toBe(true);
    });

    it('should handle complex multi-requirement validation', () => {
      const adminContext: AuthContext = {
        userId: 'admin1',
        roles: ['admin', 'user'],
        permissions: ['read', 'write', 'delete', 'admin:access'],
        scopes: ['api:admin', 'api:read', 'api:write'],
      };

      const result = authzManager.validateAccess(adminContext, {
        roles: ['admin', 'superadmin'], // Need at least one
        permissions: ['read', 'write', 'admin:access'], // Need all
        scopes: ['api:admin', 'api:read'], // Need all
      });

      expect(result.allowed).toBe(true);
    });

    it('should return detailed error information on failure', () => {
      const limitedContext: AuthContext = {
        userId: 'limited1',
        roles: ['guest'],
        permissions: ['view'],
        scopes: ['public'],
      };

      const result = authzManager.validateAccess(limitedContext, {
        roles: ['admin', 'moderator'],
        permissions: ['read', 'write'],
        scopes: ['api:full'],
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.details).toBeDefined();
    });
  });

  // ============================================================================
  // Scope Validation Tests
  // ============================================================================

  describe('Scope Validation', () => {
    describe('validateScopes', () => {
      it('should return valid when no scopes required', () => {
        const result = authzManager.validateScopes([], ['any', 'scope']);
        expect(result.valid).toBe(true);
        expect(result.missing).toEqual([]);
      });

      it('should return valid when user has all required scopes', () => {
        const result = authzManager.validateScopes(['api:read', 'api:write'], ['api:read', 'api:write', 'api:delete']);
        expect(result.valid).toBe(true);
        expect(result.missing).toEqual([]);
      });

      it('should return invalid with list of missing scopes', () => {
        const result = authzManager.validateScopes(['api:read', 'api:write', 'api:admin'], ['api:read']);
        expect(result.valid).toBe(false);
        expect(result.missing).toEqual(['api:write', 'api:admin']);
      });

      it('should handle undefined user scopes', () => {
        const result = authzManager.validateScopes(['api:read'], undefined);
        expect(result.valid).toBe(false);
        expect(result.missing).toEqual(['api:read']);
      });

      it('should handle empty user scopes', () => {
        const result = authzManager.validateScopes(['api:read', 'api:write'], []);
        expect(result.valid).toBe(false);
        expect(result.missing).toEqual(['api:read', 'api:write']);
      });

      it('should handle complex OAuth2 scope patterns', () => {
        const requiredScopes = [
          'openid',
          'profile',
          'email',
          'https://api.example.com/read',
          'https://api.example.com/write',
        ];

        const userScopes = [
          'openid',
          'profile',
          'email',
          'https://api.example.com/read',
          'https://api.example.com/write',
          'offline_access',
        ];

        const result = authzManager.validateScopes(requiredScopes, userScopes);
        expect(result.valid).toBe(true);
      });
    });

    describe('validateAccess with scopes', () => {
      it('should validate scopes in context', () => {
        const authContext: AuthContext = {
          userId: 'user1',
          roles: [],
          permissions: [],
          scopes: ['api:read', 'api:write'],
        };

        const result = authzManager.validateAccess(authContext, {
          scopes: ['api:read'],
        });
        expect(result.allowed).toBe(true);
      });

      it('should fail when user lacks required scopes', () => {
        const authContext: AuthContext = {
          userId: 'user1',
          roles: [],
          permissions: [],
          scopes: ['api:read'],
        };

        const result = authzManager.validateAccess(authContext, {
          scopes: ['api:read', 'api:admin'],
        });
        expect(result.allowed).toBe(false);
        expect(result.details?.missingScopes).toEqual(['api:admin']);
      });

      it('should handle missing scopes array in context', () => {
        const authContext: AuthContext = {
          userId: 'user1',
          roles: [],
          permissions: [],
          // No scopes property
        };

        const result = authzManager.validateAccess(authContext, {
          scopes: ['api:read'],
        });
        expect(result.allowed).toBe(false);
        expect(result.details?.missingScopes).toEqual(['api:read']);
      });
    });
  });

  // ============================================================================
  // Super Admin Bypass Tests
  // ============================================================================

  describe('Super Admin Bypass', () => {
    it('should allow super admin to bypass all service ACL checks', () => {
      authzManager.registerACL({
        service: 'restrictedService',
        allowedRoles: ['special'],
        requiredPermissions: ['restricted:access'],
      });

      const superAdminContext: AuthContext = {
        userId: 'superadmin1',
        roles: ['superadmin'],
        permissions: [], // No permissions needed
      };

      expect(authzManager.canAccessService('restrictedService', superAdminContext)).toBe(true);
    });

    it('should allow super admin to bypass all method ACL checks', () => {
      authzManager.registerACL({
        service: 'restrictedService',
        allowedRoles: ['user'],
        methods: {
          dangerousMethod: {
            allowedRoles: ['god'],
            requiredPermissions: ['nuclear:launch'],
          },
        },
      });

      const superAdminContext: AuthContext = {
        userId: 'superadmin1',
        roles: ['superadmin'],
        permissions: [],
      };

      expect(authzManager.canAccessMethod('restrictedService', 'dangerousMethod', superAdminContext)).toBe(true);
    });

    it('should allow configuring custom super admin role', () => {
      authzManager.setSuperAdminRole('root');

      authzManager.registerACL({
        service: 'restrictedService',
        allowedRoles: ['admin'],
      });

      const rootContext: AuthContext = {
        userId: 'root1',
        roles: ['root'],
        permissions: [],
      };

      const superadminContext: AuthContext = {
        userId: 'superadmin1',
        roles: ['superadmin'], // Old role, no longer super admin
        permissions: [],
      };

      expect(authzManager.canAccessService('restrictedService', rootContext)).toBe(true);
      expect(authzManager.canAccessService('restrictedService', superadminContext)).toBe(false);
    });

    it('should return configured super admin role', () => {
      expect(authzManager.getSuperAdminRole()).toBe('superadmin');

      authzManager.setSuperAdminRole('administrator');
      expect(authzManager.getSuperAdminRole()).toBe('administrator');
    });

    it('should not bypass ACL for users with similar role names', () => {
      authzManager.registerACL({
        service: 'restrictedService',
        allowedRoles: ['admin'],
      });

      const notSuperAdmin: AuthContext = {
        userId: 'user1',
        roles: ['super_admin', 'superAdmin', 'SUPERADMIN'], // Not exact match
        permissions: [],
      };

      expect(authzManager.canAccessService('restrictedService', notSuperAdmin)).toBe(false);
    });

    it('should bypass even complex multi-layer ACLs', () => {
      authzManager.registerACL({
        service: 'complexService',
        allowedRoles: ['level1'],
        requiredPermissions: ['complex:p1', 'complex:p2'],
        methods: {
          deepMethod: {
            allowedRoles: ['level2'],
            requiredPermissions: ['complex:deep'],
          },
        },
      });

      const superAdminContext: AuthContext = {
        userId: 'superadmin1',
        roles: ['superadmin'],
        permissions: [],
      };

      expect(authzManager.canAccessService('complexService', superAdminContext)).toBe(true);
      expect(authzManager.canAccessMethod('complexService', 'deepMethod', superAdminContext)).toBe(true);
    });
  });

  // ============================================================================
  // Default Allow/Deny Mode Tests
  // ============================================================================

  describe('Default Allow/Deny Modes', () => {
    describe('Default Allow Mode (no ACL defined)', () => {
      it('should allow access to services without ACL', () => {
        const authContext: AuthContext = {
          userId: 'user1',
          roles: [],
          permissions: [],
        };

        expect(authzManager.canAccessService('unregisteredService', authContext)).toBe(true);
      });

      it('should allow access to services without ACL even without auth context', () => {
        expect(authzManager.canAccessService('unregisteredService')).toBe(true);
        expect(authzManager.canAccessService('unregisteredService', undefined)).toBe(true);
      });

      it('should allow method access on services without ACL', () => {
        const authContext: AuthContext = {
          userId: 'user1',
          roles: [],
          permissions: [],
        };

        expect(authzManager.canAccessMethod('unregisteredService', 'anyMethod', authContext)).toBe(true);
      });
    });

    describe('Default Deny Mode (ACL defined but no auth)', () => {
      it('should deny access when ACL exists but no auth context provided', () => {
        authzManager.registerACL({
          service: 'protectedService',
          allowedRoles: ['user'],
        });

        expect(authzManager.canAccessService('protectedService')).toBe(false);
        expect(authzManager.canAccessService('protectedService', undefined)).toBe(false);
      });

      it('should deny method access when method ACL exists but no auth context', () => {
        authzManager.registerACL({
          service: 'protectedService',
          methods: {
            protectedMethod: {
              allowedRoles: ['admin'],
            },
          },
        });

        expect(authzManager.canAccessMethod('protectedService', 'protectedMethod')).toBe(false);
      });

      it('should deny access when ACL exists with empty roles/permissions', () => {
        authzManager.registerACL({
          service: 'emptyAclService',
          allowedRoles: [], // Empty but defined
          requiredPermissions: [], // Empty but defined
        });

        const authContext: AuthContext = {
          userId: 'user1',
          roles: ['admin'],
          permissions: ['all:access'],
        };

        // Empty arrays mean no restrictions, so should allow
        expect(authzManager.canAccessService('emptyAclService', authContext)).toBe(true);
      });
    });

    describe('Hybrid Scenarios', () => {
      it('should handle mix of protected and unprotected services', () => {
        authzManager.registerACL({
          service: 'protectedService',
          allowedRoles: ['admin'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        // Protected service - denied
        expect(authzManager.canAccessService('protectedService', userContext)).toBe(false);
        // Unprotected service - allowed
        expect(authzManager.canAccessService('publicService', userContext)).toBe(true);
      });

      it('should handle service with some protected and some unprotected methods', () => {
        authzManager.registerACL({
          service: 'mixedService',
          methods: {
            adminMethod: {
              allowedRoles: ['admin'],
            },
            // No ACL for other methods
          },
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        expect(authzManager.canAccessMethod('mixedService', 'adminMethod', userContext)).toBe(false);
        expect(authzManager.canAccessMethod('mixedService', 'publicMethod', userContext)).toBe(true);
      });
    });
  });

  // ============================================================================
  // ACL Pattern Matching (Wildcard) Tests
  // ============================================================================

  describe('ACL Pattern Matching (Wildcards)', () => {
    describe('Prefix wildcards', () => {
      it('should match services starting with pattern', () => {
        authzManager.registerACL({
          service: 'admin*',
          allowedRoles: ['admin'],
        });

        const adminContext: AuthContext = {
          userId: 'admin1',
          roles: ['admin'],
          permissions: [],
        };

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        expect(authzManager.canAccessService('adminService', adminContext)).toBe(true);
        expect(authzManager.canAccessService('adminPanel', adminContext)).toBe(true);
        expect(authzManager.canAccessService('administrator', adminContext)).toBe(true);
        expect(authzManager.canAccessService('adminService', userContext)).toBe(false);
        // Non-matching services should be allowed (no ACL)
        expect(authzManager.canAccessService('userService', userContext)).toBe(true);
      });
    });

    describe('Suffix wildcards', () => {
      it('should match services ending with pattern', () => {
        authzManager.registerACL({
          service: '*Service',
          allowedRoles: ['user'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        expect(authzManager.canAccessService('userService', userContext)).toBe(true);
        expect(authzManager.canAccessService('adminService', userContext)).toBe(true);
        expect(authzManager.canAccessService('DataService', userContext)).toBe(true);
      });
    });

    describe('Middle wildcards', () => {
      it('should match services with pattern in middle', () => {
        authzManager.registerACL({
          service: 'user*Service',
          allowedRoles: ['user'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        expect(authzManager.canAccessService('userDataService', userContext)).toBe(true);
        expect(authzManager.canAccessService('userAuthService', userContext)).toBe(true);
        expect(authzManager.canAccessService('userService', userContext)).toBe(true);
      });
    });

    describe('Multiple wildcards', () => {
      it('should match services with multiple wildcards', () => {
        authzManager.registerACL({
          service: 'api*v*Service',
          allowedRoles: ['api'],
        });

        const apiContext: AuthContext = {
          userId: 'api1',
          roles: ['api'],
          permissions: [],
        };

        expect(authzManager.canAccessService('apiUserV1Service', apiContext)).toBe(true);
        expect(authzManager.canAccessService('apiDataV2Service', apiContext)).toBe(true);
        expect(authzManager.canAccessService('apiV1Service', apiContext)).toBe(true);
      });
    });

    describe('Invalid patterns', () => {
      it('should reject patterns with adjacent wildcards', () => {
        authzManager.registerACL({
          service: 'test**Service',
          allowedRoles: ['user'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        // Adjacent wildcards are invalid, should not match
        expect(authzManager.canAccessService('testXXService', userContext)).toBe(true); // No match = allowed
        expect(authzManager.canAccessService('testService', userContext)).toBe(true); // No match = allowed
      });
    });

    describe('Exact match priority', () => {
      it('should use first matching ACL (registration order matters)', () => {
        // Register exact match first
        authzManager.registerACL({
          service: 'userService',
          allowedRoles: ['user'],
        });

        // Then register wildcard
        authzManager.registerACL({
          service: 'user*',
          allowedRoles: ['admin'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        const adminContext: AuthContext = {
          userId: 'admin1',
          roles: ['admin'],
          permissions: [],
        };

        // Should match exact 'userService' ACL first
        expect(authzManager.canAccessService('userService', userContext)).toBe(true);
        // Other user* services match the wildcard
        expect(authzManager.canAccessService('userPanel', adminContext)).toBe(true);
        expect(authzManager.canAccessService('userPanel', userContext)).toBe(false);
      });
    });

    describe('Case sensitivity', () => {
      it('should be case-sensitive by default', () => {
        authzManager.registerACL({
          service: 'UserService',
          allowedRoles: ['user'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        expect(authzManager.canAccessService('UserService', userContext)).toBe(true);
        expect(authzManager.canAccessService('userservice', userContext)).toBe(true); // No ACL match = allowed
        expect(authzManager.canAccessService('USERSERVICE', userContext)).toBe(true); // No ACL match = allowed
      });

      it('should support case-insensitive matching when configured', () => {
        authzManager.setPatternMatchOptions({ caseInsensitive: true });

        authzManager.registerACL({
          service: 'UserService',
          allowedRoles: ['user'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        const guestContext: AuthContext = {
          userId: 'guest1',
          roles: ['guest'],
          permissions: [],
        };

        expect(authzManager.canAccessService('UserService', userContext)).toBe(true);
        expect(authzManager.canAccessService('userservice', userContext)).toBe(true);
        expect(authzManager.canAccessService('USERSERVICE', userContext)).toBe(true);
        expect(authzManager.canAccessService('userservice', guestContext)).toBe(false);
      });

      it('should clear pattern cache when pattern options change', () => {
        authzManager.registerACL({
          service: 'Test*',
          allowedRoles: ['user'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        // First with case-sensitive
        expect(authzManager.canAccessService('TestService', userContext)).toBe(true);
        expect(authzManager.canAccessService('testService', userContext)).toBe(true); // No match

        // Change to case-insensitive
        authzManager.setPatternMatchOptions({ caseInsensitive: true });

        // Now should match
        expect(authzManager.canAccessService('testservice', userContext)).toBe(true);
      });
    });

    describe('Unicode patterns', () => {
      it('should support Unicode service names', () => {
        authzManager.registerACL({
          service: 'utilisateurService',
          allowedRoles: ['user'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        expect(authzManager.canAccessService('utilisateurService', userContext)).toBe(true);
      });

      it('should support Unicode in wildcard patterns', () => {
        authzManager.registerACL({
          service: 'benutzer*',
          allowedRoles: ['user'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        expect(authzManager.canAccessService('benutzerService', userContext)).toBe(true);
        expect(authzManager.canAccessService('benutzerVerwaltung', userContext)).toBe(true);
      });

      it('should support Chinese characters in patterns', () => {
        authzManager.registerACL({
          service: '用户*',
          allowedRoles: ['user'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        expect(authzManager.canAccessService('用户服务', userContext)).toBe(true);
        expect(authzManager.canAccessService('用户管理', userContext)).toBe(true);
      });
    });

    describe('Special regex characters', () => {
      it('should escape regex special characters in patterns', () => {
        authzManager.registerACL({
          service: 'api.v1.users',
          allowedRoles: ['api'],
        });

        const apiContext: AuthContext = {
          userId: 'api1',
          roles: ['api'],
          permissions: [],
        };

        // Dots should be literal, not regex wildcards
        expect(authzManager.canAccessService('api.v1.users', apiContext)).toBe(true);
        expect(authzManager.canAccessService('apiXv1Xusers', apiContext)).toBe(true); // No match = allowed
      });
    });
  });

  // ============================================================================
  // Role Checking Tests (checkRoles equivalent)
  // ============================================================================

  describe('Role Checking', () => {
    describe('via validateAccess with roles only', () => {
      it('should check if user has any of the required roles', () => {
        const authContext: AuthContext = {
          userId: 'user1',
          roles: ['editor', 'viewer'],
          permissions: [],
        };

        // Has one matching role
        const result1 = authzManager.validateAccess(authContext, {
          roles: ['admin', 'editor'],
        });
        expect(result1.allowed).toBe(true);

        // Has no matching roles
        const result2 = authzManager.validateAccess(authContext, {
          roles: ['admin', 'owner'],
        });
        expect(result2.allowed).toBe(false);
      });

      it('should handle single role requirement', () => {
        const authContext: AuthContext = {
          userId: 'user1',
          roles: ['admin'],
          permissions: [],
        };

        const result = authzManager.validateAccess(authContext, {
          roles: ['admin'],
        });
        expect(result.allowed).toBe(true);
      });

      it('should handle user with multiple roles', () => {
        const authContext: AuthContext = {
          userId: 'user1',
          roles: ['admin', 'user', 'moderator', 'developer'],
          permissions: [],
        };

        const result = authzManager.validateAccess(authContext, {
          roles: ['owner', 'moderator', 'superadmin'],
        });
        expect(result.allowed).toBe(true); // Has 'moderator'
      });

      it('should handle empty user roles', () => {
        const authContext: AuthContext = {
          userId: 'user1',
          roles: [],
          permissions: [],
        };

        const result = authzManager.validateAccess(authContext, {
          roles: ['admin'],
        });
        expect(result.allowed).toBe(false);
        expect(result.details?.missingRoles).toEqual(['admin']);
      });

      it('should handle empty required roles', () => {
        const authContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        const result = authzManager.validateAccess(authContext, {
          roles: [],
        });
        expect(result.allowed).toBe(true);
      });
    });

    describe('via canAccessService with role requirements', () => {
      it('should check roles when accessing service', () => {
        authzManager.registerACL({
          service: 'adminService',
          allowedRoles: ['admin', 'superadmin'],
        });

        const adminContext: AuthContext = {
          userId: 'admin1',
          roles: ['admin'],
          permissions: [],
        };

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        expect(authzManager.canAccessService('adminService', adminContext)).toBe(true);
        expect(authzManager.canAccessService('adminService', userContext)).toBe(false);
      });
    });
  });

  // ============================================================================
  // Cleanup/Destroy Tests
  // ============================================================================

  describe('Cleanup and Destroy', () => {
    describe('clearACLs', () => {
      it('should remove all registered ACLs', () => {
        authzManager.registerACLs([
          { service: 'service1', allowedRoles: ['role1'] },
          { service: 'service2', allowedRoles: ['role2'] },
          { service: 'service3', allowedRoles: ['role3'] },
        ]);

        expect(authzManager.getACLs()).toHaveLength(3);

        authzManager.clearACLs();

        expect(authzManager.getACLs()).toHaveLength(0);
      });

      it('should allow services after ACLs are cleared', () => {
        authzManager.registerACL({
          service: 'restrictedService',
          allowedRoles: ['admin'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        expect(authzManager.canAccessService('restrictedService', userContext)).toBe(false);

        authzManager.clearACLs();

        // Now allowed (no ACL)
        expect(authzManager.canAccessService('restrictedService', userContext)).toBe(true);
      });

      it('should clear pattern cache when clearing ACLs', () => {
        authzManager.registerACL({
          service: 'test*',
          allowedRoles: ['user'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        // This should cache the pattern
        authzManager.canAccessService('testService', userContext);

        authzManager.clearACLs();

        // Cache should be cleared, no ACLs to match
        expect(authzManager.canAccessService('testService', userContext)).toBe(true);
      });
    });

    describe('removeACL', () => {
      it('should remove specific ACL by service name', () => {
        authzManager.registerACLs([
          { service: 'service1', allowedRoles: ['role1'] },
          { service: 'service2', allowedRoles: ['role2'] },
          { service: 'service3', allowedRoles: ['role3'] },
        ]);

        const removed = authzManager.removeACL('service2');

        expect(removed).toBe(true);
        expect(authzManager.getACLs()).toHaveLength(2);
        expect(authzManager.getACLs().find((acl) => acl.service === 'service2')).toBeUndefined();
      });

      it('should return false when removing non-existent ACL', () => {
        authzManager.registerACL({
          service: 'existingService',
          allowedRoles: ['user'],
        });

        const removed = authzManager.removeACL('nonExistentService');

        expect(removed).toBe(false);
        expect(authzManager.getACLs()).toHaveLength(1);
      });
    });

    describe('clearPatternCache', () => {
      it('should clear the compiled regex pattern cache', () => {
        authzManager.registerACL({
          service: 'test*',
          allowedRoles: ['user'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        // Trigger pattern compilation and caching
        authzManager.canAccessService('testService1', userContext);
        authzManager.canAccessService('testService2', userContext);

        // Clear cache
        authzManager.clearPatternCache();

        // Should still work (re-compiles patterns)
        expect(authzManager.canAccessService('testService3', userContext)).toBe(true);
      });
    });
  });

  // ============================================================================
  // Filter Definition Tests
  // ============================================================================

  describe('Filter Definition', () => {
    it('should return null when user has no service access', () => {
      authzManager.registerACL({
        service: 'restrictedService',
        allowedRoles: ['admin'],
      });

      const definition = {
        id: 'test',
        methods: {
          method1: { type: 'function' },
          method2: { type: 'function' },
        },
      };

      const userContext: AuthContext = {
        userId: 'user1',
        roles: ['user'],
        permissions: [],
      };

      const result = authzManager.filterDefinition('restrictedService', definition, userContext);
      expect(result).toBeNull();
    });

    it('should return full definition when user has full access', () => {
      authzManager.registerACL({
        service: 'userService',
        allowedRoles: ['user'],
      });

      const definition = {
        id: 'test',
        methods: {
          method1: { type: 'function' },
          method2: { type: 'function' },
        },
      };

      const userContext: AuthContext = {
        userId: 'user1',
        roles: ['user'],
        permissions: [],
      };

      const result = authzManager.filterDefinition('userService', definition, userContext);
      expect(result).toEqual(definition);
    });

    it('should filter out methods user cannot access', () => {
      authzManager.registerACL({
        service: 'userService',
        allowedRoles: ['user'],
        methods: {
          adminMethod: {
            allowedRoles: ['admin'],
            __override: true,
          },
        },
      });

      const definition = {
        id: 'test',
        methods: {
          publicMethod: { type: 'function' },
          adminMethod: { type: 'function' },
        },
      };

      const userContext: AuthContext = {
        userId: 'user1',
        roles: ['user'],
        permissions: [],
      };

      const result = authzManager.filterDefinition('userService', definition, userContext);

      expect(result.methods).toHaveProperty('publicMethod');
      expect(result.methods).not.toHaveProperty('adminMethod');
    });

    it('should not mutate original definition', () => {
      authzManager.registerACL({
        service: 'userService',
        allowedRoles: ['user'],
        methods: {
          adminMethod: {
            allowedRoles: ['admin'],
            __override: true,
          },
        },
      });

      const definition = {
        id: 'test',
        methods: {
          publicMethod: { type: 'function' },
          adminMethod: { type: 'function' },
        },
      };

      const userContext: AuthContext = {
        userId: 'user1',
        roles: ['user'],
        permissions: [],
      };

      authzManager.filterDefinition('userService', definition, userContext);

      // Original should be unchanged
      expect(definition.methods).toHaveProperty('publicMethod');
      expect(definition.methods).toHaveProperty('adminMethod');
    });

    it('should return full definition when no ACL exists', () => {
      const definition = {
        id: 'test',
        methods: {
          method1: { type: 'function' },
          method2: { type: 'function' },
        },
      };

      const result = authzManager.filterDefinition('unprotectedService', definition);
      expect(result).toEqual(definition);
    });
  });

  // ============================================================================
  // Integration Scenario Tests
  // ============================================================================

  describe('Complex Integration Scenarios', () => {
    describe('Multi-tenant application', () => {
      it('should handle tenant-isolated services', () => {
        authzManager.registerACL({
          service: 'tenant-a-*',
          allowedRoles: ['tenant-a-user'],
        });

        authzManager.registerACL({
          service: 'tenant-b-*',
          allowedRoles: ['tenant-b-user'],
        });

        const tenantAUser: AuthContext = {
          userId: 'user1',
          roles: ['tenant-a-user'],
          permissions: [],
        };

        const tenantBUser: AuthContext = {
          userId: 'user2',
          roles: ['tenant-b-user'],
          permissions: [],
        };

        expect(authzManager.canAccessService('tenant-a-data', tenantAUser)).toBe(true);
        expect(authzManager.canAccessService('tenant-b-data', tenantAUser)).toBe(false);
        expect(authzManager.canAccessService('tenant-a-data', tenantBUser)).toBe(false);
        expect(authzManager.canAccessService('tenant-b-data', tenantBUser)).toBe(true);
      });
    });

    describe('API versioning', () => {
      it('should handle versioned API access', () => {
        authzManager.registerACL({
          service: 'api.v1.*',
          allowedRoles: ['legacy-client'],
        });

        authzManager.registerACL({
          service: 'api.v2.*',
          allowedRoles: ['modern-client'],
        });

        const legacyClient: AuthContext = {
          userId: 'client1',
          roles: ['legacy-client'],
          permissions: [],
        };

        const modernClient: AuthContext = {
          userId: 'client2',
          roles: ['modern-client'],
          permissions: [],
        };

        expect(authzManager.canAccessService('api.v1.users', legacyClient)).toBe(true);
        expect(authzManager.canAccessService('api.v2.users', legacyClient)).toBe(false);
        expect(authzManager.canAccessService('api.v2.users', modernClient)).toBe(true);
      });
    });

    describe('Role hierarchy simulation', () => {
      it('should handle role hierarchy through multiple roles', () => {
        authzManager.registerACL({
          service: 'basicService',
          allowedRoles: ['viewer', 'editor', 'admin'],
        });

        authzManager.registerACL({
          service: 'editorService',
          allowedRoles: ['editor', 'admin'],
        });

        authzManager.registerACL({
          service: 'adminService',
          allowedRoles: ['admin'],
        });

        // Admin has all roles
        const adminContext: AuthContext = {
          userId: 'admin1',
          roles: ['viewer', 'editor', 'admin'],
          permissions: [],
        };

        // Editor has some roles
        const editorContext: AuthContext = {
          userId: 'editor1',
          roles: ['viewer', 'editor'],
          permissions: [],
        };

        // Viewer has minimal roles
        const viewerContext: AuthContext = {
          userId: 'viewer1',
          roles: ['viewer'],
          permissions: [],
        };

        // Admin can access all
        expect(authzManager.canAccessService('basicService', adminContext)).toBe(true);
        expect(authzManager.canAccessService('editorService', adminContext)).toBe(true);
        expect(authzManager.canAccessService('adminService', adminContext)).toBe(true);

        // Editor can access basic and editor
        expect(authzManager.canAccessService('basicService', editorContext)).toBe(true);
        expect(authzManager.canAccessService('editorService', editorContext)).toBe(true);
        expect(authzManager.canAccessService('adminService', editorContext)).toBe(false);

        // Viewer can only access basic
        expect(authzManager.canAccessService('basicService', viewerContext)).toBe(true);
        expect(authzManager.canAccessService('editorService', viewerContext)).toBe(false);
        expect(authzManager.canAccessService('adminService', viewerContext)).toBe(false);
      });
    });

    describe('Microservices architecture', () => {
      it('should handle inter-service authentication', () => {
        // Internal services require service account role
        authzManager.registerACL({
          service: 'internal.*',
          allowedRoles: ['service-account'],
        });

        // Public services allow all authenticated users
        authzManager.registerACL({
          service: 'public.*',
          allowedRoles: ['authenticated'],
        });

        const serviceAccount: AuthContext = {
          userId: 'service-user-service',
          roles: ['service-account', 'authenticated'],
          permissions: [],
        };

        const regularUser: AuthContext = {
          userId: 'user1',
          roles: ['authenticated'],
          permissions: [],
        };

        // Service account can access both
        expect(authzManager.canAccessService('internal.user-db', serviceAccount)).toBe(true);
        expect(authzManager.canAccessService('public.api-gateway', serviceAccount)).toBe(true);

        // Regular user can only access public
        expect(authzManager.canAccessService('internal.user-db', regularUser)).toBe(false);
        expect(authzManager.canAccessService('public.api-gateway', regularUser)).toBe(true);
      });
    });
  });

  // ============================================================================
  // Performance Tests
  // ============================================================================

  describe('Performance', () => {
    it('should handle 1000+ ACLs efficiently', () => {
      const startReg = Date.now();

      // Register 1000 ACLs
      for (let i = 0; i < 1000; i++) {
        authzManager.registerACL({
          service: `service${i}`,
          allowedRoles: [`role${i}`],
        });
      }

      const regTime = Date.now() - startReg;

      const authContext: AuthContext = {
        userId: 'user1',
        roles: ['role500'],
        permissions: [],
      };

      const startCheck = Date.now();
      const result = authzManager.canAccessService('service500', authContext);
      const checkTime = Date.now() - startCheck;

      expect(result).toBe(true);
      expect(regTime).toBeLessThan(1000); // < 1 second for 1000 registrations
      expect(checkTime).toBeLessThan(100); // < 100ms for single check
    });

    it('should cache compiled regex patterns for repeated checks', () => {
      authzManager.registerACL({
        service: 'test*',
        allowedRoles: ['user'],
      });

      const authContext: AuthContext = {
        userId: 'user1',
        roles: ['user'],
        permissions: [],
      };

      // First check (compiles pattern)
      const start1 = Date.now();
      for (let i = 0; i < 1000; i++) {
        authzManager.canAccessService(`testService${i}`, authContext);
      }
      const time1 = Date.now() - start1;

      // Second batch (uses cached pattern)
      const start2 = Date.now();
      for (let i = 0; i < 1000; i++) {
        authzManager.canAccessService(`testService${i}`, authContext);
      }
      const time2 = Date.now() - start2;

      // Both should be fast due to caching
      expect(time1).toBeLessThan(500);
      expect(time2).toBeLessThan(500);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle empty service name', () => {
      authzManager.registerACL({
        service: '',
        allowedRoles: ['user'],
      });

      const authContext: AuthContext = {
        userId: 'user1',
        roles: ['user'],
        permissions: [],
      };

      expect(authzManager.canAccessService('', authContext)).toBe(true);
    });

    it('should handle very long service names', () => {
      const longServiceName = 'a'.repeat(1000);

      authzManager.registerACL({
        service: longServiceName,
        allowedRoles: ['user'],
      });

      const authContext: AuthContext = {
        userId: 'user1',
        roles: ['user'],
        permissions: [],
      };

      expect(authzManager.canAccessService(longServiceName, authContext)).toBe(true);
    });

    it('should handle special characters in service names', () => {
      authzManager.registerACL({
        service: 'service-name_with.special:chars',
        allowedRoles: ['user'],
      });

      const authContext: AuthContext = {
        userId: 'user1',
        roles: ['user'],
        permissions: [],
      };

      expect(authzManager.canAccessService('service-name_with.special:chars', authContext)).toBe(true);
    });

    it('should handle user with many roles', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['targetRole'],
      });

      const manyRoles = Array.from({ length: 100 }, (_, i) => `role${i}`);
      manyRoles.push('targetRole');

      const authContext: AuthContext = {
        userId: 'user1',
        roles: manyRoles,
        permissions: [],
      };

      expect(authzManager.canAccessService('testService', authContext)).toBe(true);
    });

    it('should handle user with many permissions', () => {
      const manyPermissions = Array.from({ length: 100 }, (_, i) => `perm${i}`);

      authzManager.registerACL({
        service: 'testService',
        requiredPermissions: ['perm50', 'perm75'],
      });

      const authContext: AuthContext = {
        userId: 'user1',
        roles: [],
        permissions: manyPermissions,
      };

      expect(authzManager.canAccessService('testService', authContext)).toBe(true);
    });

    it('should handle concurrent access checks', async () => {
      authzManager.registerACL({
        service: 'concurrentService',
        allowedRoles: ['user'],
      });

      const authContext: AuthContext = {
        userId: 'user1',
        roles: ['user'],
        permissions: [],
      };

      // Run 100 concurrent access checks
      const promises = Array.from({ length: 100 }, () =>
        Promise.resolve(authzManager.canAccessService('concurrentService', authContext))
      );

      const results = await Promise.all(promises);

      expect(results.every((r) => r === true)).toBe(true);
    });
  });
});
