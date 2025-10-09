/**
 * Tests for AuthorizationManager
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AuthorizationManager } from '../../../src/netron/auth/authorization-manager.js';
import type { AuthContext, ServiceACL } from '../../../src/netron/auth/types.js';

describe('AuthorizationManager', () => {
  let authzManager: AuthorizationManager;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      child: jest.fn().mockReturnThis(),
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    };

    authzManager = new AuthorizationManager(mockLogger);
  });

  describe('registerACL', () => {
    it('should register a new ACL', () => {
      const acl: ServiceACL = {
        service: 'testService',
        allowedRoles: ['admin'],
        requiredPermissions: ['test:read'],
      };

      authzManager.registerACL(acl);

      const acls = authzManager.getACLs();
      expect(acls).toHaveLength(1);
      expect(acls[0]).toEqual(acl);
    });

    it('should update existing ACL for same service', () => {
      const acl1: ServiceACL = {
        service: 'testService',
        allowedRoles: ['admin'],
      };

      const acl2: ServiceACL = {
        service: 'testService',
        allowedRoles: ['user'],
        requiredPermissions: ['test:read'],
      };

      authzManager.registerACL(acl1);
      authzManager.registerACL(acl2);

      const acls = authzManager.getACLs();
      expect(acls).toHaveLength(1);
      expect(acls[0]).toEqual(acl2);
    });
  });

  describe('registerACLs', () => {
    it('should register multiple ACLs', () => {
      const acls: ServiceACL[] = [
        { service: 'service1', allowedRoles: ['admin'] },
        { service: 'service2', allowedRoles: ['user'] },
      ];

      authzManager.registerACLs(acls);

      expect(authzManager.getACLs()).toHaveLength(2);
    });
  });

  describe('canAccessService', () => {
    it('should allow access when no ACL defined', () => {
      const authContext: AuthContext = {
        userId: 'user123',
        roles: [],
        permissions: [],
      };

      const result = authzManager.canAccessService('testService', authContext);
      expect(result).toBe(true);
    });

    it('should deny access when ACL exists but no auth context', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['admin'],
      });

      const result = authzManager.canAccessService('testService');
      expect(result).toBe(false);
    });

    it('should allow access when user has required role', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['admin', 'user'],
      });

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      const result = authzManager.canAccessService('testService', authContext);
      expect(result).toBe(true);
    });

    it('should deny access when user lacks required role', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['admin'],
      });

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      const result = authzManager.canAccessService('testService', authContext);
      expect(result).toBe(false);
    });

    it('should allow access when user has all required permissions', () => {
      authzManager.registerACL({
        service: 'testService',
        requiredPermissions: ['test:read', 'test:write'],
      });

      const authContext: AuthContext = {
        userId: 'user123',
        roles: [],
        permissions: ['test:read', 'test:write', 'test:delete'],
      };

      const result = authzManager.canAccessService('testService', authContext);
      expect(result).toBe(true);
    });

    it('should deny access when user lacks required permission', () => {
      authzManager.registerACL({
        service: 'testService',
        requiredPermissions: ['test:read', 'test:write'],
      });

      const authContext: AuthContext = {
        userId: 'user123',
        roles: [],
        permissions: ['test:read'],
      };

      const result = authzManager.canAccessService('testService', authContext);
      expect(result).toBe(false);
    });

    it('should check both roles and permissions', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['admin'],
        requiredPermissions: ['test:read'],
      });

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['admin'],
        permissions: ['test:read'],
      };

      const result = authzManager.canAccessService('testService', authContext);
      expect(result).toBe(true);
    });

    it('should match wildcard service patterns', () => {
      authzManager.registerACL({
        service: 'test*',
        allowedRoles: ['admin'],
      });

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['admin'],
        permissions: [],
      };

      const result = authzManager.canAccessService('testService', authContext);
      expect(result).toBe(true);
    });
  });

  describe('canAccessMethod', () => {
    it('should allow access when no ACL defined', () => {
      const authContext: AuthContext = {
        userId: 'user123',
        roles: [],
        permissions: [],
      };

      const result = authzManager.canAccessMethod(
        'testService',
        'testMethod',
        authContext,
      );
      expect(result).toBe(true);
    });

    it('should deny access when service access denied', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['admin'],
      });

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      const result = authzManager.canAccessMethod(
        'testService',
        'testMethod',
        authContext,
      );
      expect(result).toBe(false);
    });

    it('should allow access when service allowed and no method ACL', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['user'],
      });

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      const result = authzManager.canAccessMethod(
        'testService',
        'testMethod',
        authContext,
      );
      expect(result).toBe(true);
    });

    it('should check method-specific ACL', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['user'],
        methods: {
          deleteMethod: {
            allowedRoles: ['admin'],
            __override: true, // Override to require only admin role
          } as any,
        },
      });

      const userContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      // User can access service but not delete method
      expect(authzManager.canAccessMethod('testService', 'readMethod', userContext)).toBe(
        true,
      );
      expect(authzManager.canAccessMethod('testService', 'deleteMethod', userContext)).toBe(
        false,
      );

      const adminContext: AuthContext = {
        userId: 'admin123',
        roles: ['user', 'admin'],
        permissions: [],
      };

      // Admin can access both
      expect(authzManager.canAccessMethod('testService', 'deleteMethod', adminContext)).toBe(
        true,
      );
    });

    it('should check method-specific permissions', () => {
      authzManager.registerACL({
        service: 'testService',
        methods: {
          deleteMethod: {
            requiredPermissions: ['test:delete'],
          },
        },
      });

      const authContext: AuthContext = {
        userId: 'user123',
        roles: [],
        permissions: ['test:delete'],
      };

      const result = authzManager.canAccessMethod(
        'testService',
        'deleteMethod',
        authContext,
      );
      expect(result).toBe(true);
    });
  });

  describe('filterDefinition', () => {
    it('should return null when user has no service access', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['admin'],
      });

      const definition = {
        id: 'test',
        methods: {
          method1: {},
          method2: {},
        },
      };

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      const result = authzManager.filterDefinition('testService', definition, authContext);
      expect(result).toBeNull();
    });

    it('should return full definition when no method restrictions', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['user'],
      });

      const definition = {
        id: 'test',
        methods: {
          method1: { type: 'function' },
          method2: { type: 'function' },
        },
      };

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      const result = authzManager.filterDefinition('testService', definition, authContext);
      expect(result).toEqual(definition);
    });

    it('should filter methods based on access', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['user'],
        methods: {
          adminMethod: {
            allowedRoles: ['admin'],
            __override: true, // Override to require only admin role
          } as any,
        },
      });

      const definition = {
        id: 'test',
        methods: {
          publicMethod: { type: 'function' },
          adminMethod: { type: 'function' },
        },
      };

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      const result = authzManager.filterDefinition('testService', definition, authContext);

      expect(result.methods).toHaveProperty('publicMethod');
      expect(result.methods).not.toHaveProperty('adminMethod');
    });

    it('should not mutate original definition', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['user'],
        methods: {
          adminMethod: {
            allowedRoles: ['admin'],
            __override: true, // Override to require only admin role
          } as any,
        },
      });

      const definition = {
        id: 'test',
        methods: {
          publicMethod: { type: 'function' },
          adminMethod: { type: 'function' },
        },
      };

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      authzManager.filterDefinition('testService', definition, authContext);

      // Original should still have both methods
      expect(definition.methods).toHaveProperty('publicMethod');
      expect(definition.methods).toHaveProperty('adminMethod');
    });
  });

  describe('clearACLs', () => {
    it('should clear all registered ACLs', () => {
      authzManager.registerACLs([
        { service: 'service1', allowedRoles: ['admin'] },
        { service: 'service2', allowedRoles: ['user'] },
      ]);

      expect(authzManager.getACLs()).toHaveLength(2);

      authzManager.clearACLs();

      expect(authzManager.getACLs()).toHaveLength(0);
    });
  });

  describe('wildcard pattern matching', () => {
    it('should match exact service names', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['admin'],
      });

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['admin'],
        permissions: [],
      };

      expect(authzManager.canAccessService('testService', authContext)).toBe(true);
      expect(authzManager.canAccessService('otherService', authContext)).toBe(true); // No ACL
    });

    it('should match prefix wildcard patterns', () => {
      authzManager.registerACL({
        service: 'admin*',
        allowedRoles: ['admin'],
      });

      const adminContext: AuthContext = {
        userId: 'admin123',
        roles: ['admin'],
        permissions: [],
      };

      const userContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      expect(authzManager.canAccessService('adminService', adminContext)).toBe(true);
      expect(authzManager.canAccessService('adminPanel', adminContext)).toBe(true);
      expect(authzManager.canAccessService('userService', adminContext)).toBe(true); // No ACL

      expect(authzManager.canAccessService('adminService', userContext)).toBe(false);
    });

    it('should match suffix wildcard patterns', () => {
      authzManager.registerACL({
        service: '*Service',
        allowedRoles: ['user'],
      });

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      expect(authzManager.canAccessService('testService', authContext)).toBe(true);
      expect(authzManager.canAccessService('userService', authContext)).toBe(true);
      expect(authzManager.canAccessService('adminPanel', authContext)).toBe(true); // No ACL
    });

    it('should match middle wildcard patterns', () => {
      authzManager.registerACL({
        service: 'test*Service',
        allowedRoles: ['user'],
      });

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      expect(authzManager.canAccessService('testUserService', authContext)).toBe(true);
      expect(authzManager.canAccessService('testAdminService', authContext)).toBe(true);
      expect(authzManager.canAccessService('userService', authContext)).toBe(true); // No ACL
    });

    it('should match multiple wildcards in pattern', () => {
      authzManager.registerACL({
        service: 'user*Service*v1',
        allowedRoles: ['user'],
      });

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      expect(authzManager.canAccessService('userAuthServiceApiV1', authContext)).toBe(true);
      expect(authzManager.canAccessService('userServiceV1', authContext)).toBe(true);
      expect(authzManager.canAccessService('userService', authContext)).toBe(true); // No ACL
    });
  });

  describe('super admin bypass', () => {
    it('should allow super admin to bypass all ACL checks', () => {
      authzManager.registerACL({
        service: 'restrictedService',
        allowedRoles: ['admin'],
        requiredPermissions: ['restricted:access'],
      });

      const superAdminContext: AuthContext = {
        userId: 'superadmin123',
        roles: ['superadmin'],
        permissions: [],
      };

      expect(authzManager.canAccessService('restrictedService', superAdminContext)).toBe(true);
    });

    it('should allow super admin to access any method', () => {
      authzManager.registerACL({
        service: 'restrictedService',
        allowedRoles: ['admin'],
        methods: {
          deleteAll: {
            allowedRoles: ['god'],
          },
        },
      });

      const superAdminContext: AuthContext = {
        userId: 'superadmin123',
        roles: ['superadmin'],
        permissions: [],
      };

      expect(
        authzManager.canAccessMethod('restrictedService', 'deleteAll', superAdminContext),
      ).toBe(true);
    });

    it('should allow configuring super admin role', () => {
      authzManager.setSuperAdminRole('root');

      authzManager.registerACL({
        service: 'restrictedService',
        allowedRoles: ['admin'],
      });

      const rootContext: AuthContext = {
        userId: 'root123',
        roles: ['root'],
        permissions: [],
      };

      expect(authzManager.canAccessService('restrictedService', rootContext)).toBe(true);
      expect(authzManager.getSuperAdminRole()).toBe('root');
    });

    it('should not bypass ACL for non-super-admin users', () => {
      authzManager.registerACL({
        service: 'restrictedService',
        allowedRoles: ['admin'],
      });

      const userContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      expect(authzManager.canAccessService('restrictedService', userContext)).toBe(false);
    });
  });

  describe('service with both roles AND permissions', () => {
    it('should require both role and permissions when both specified', () => {
      authzManager.registerACL({
        service: 'restrictedService',
        allowedRoles: ['admin'],
        requiredPermissions: ['restricted:read', 'restricted:write'],
      });

      // User with role but not permissions
      const hasRoleNoPerms: AuthContext = {
        userId: 'user1',
        roles: ['admin'],
        permissions: ['restricted:read'],
      };

      // User with permissions but not role
      const hasPermsNoRole: AuthContext = {
        userId: 'user2',
        roles: ['user'],
        permissions: ['restricted:read', 'restricted:write'],
      };

      // User with both
      const hasBoth: AuthContext = {
        userId: 'user3',
        roles: ['admin'],
        permissions: ['restricted:read', 'restricted:write'],
      };

      expect(authzManager.canAccessService('restrictedService', hasRoleNoPerms)).toBe(false);
      expect(authzManager.canAccessService('restrictedService', hasPermsNoRole)).toBe(false);
      expect(authzManager.canAccessService('restrictedService', hasBoth)).toBe(true);
    });
  });

  describe('ACL update and removal', () => {
    it('should replace existing ACL when re-registered', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['admin'],
      });

      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['user'],
      });

      const acls = authzManager.getACLs();
      expect(acls).toHaveLength(1);
      expect(acls[0].allowedRoles).toEqual(['user']);
    });

    it('should remove ACL by service name', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['admin'],
      });

      const removed = authzManager.removeACL('testService');
      expect(removed).toBe(true);
      expect(authzManager.getACLs()).toHaveLength(0);
    });

    it('should return false when removing non-existent ACL', () => {
      const removed = authzManager.removeACL('nonExistentService');
      expect(removed).toBe(false);
    });
  });

  describe('multiple overlapping ACLs', () => {
    it('should use most specific ACL (exact match over wildcard)', () => {
      // More specific ACL registered first
      authzManager.registerACL({
        service: 'userService',
        allowedRoles: ['user'],
      });

      // Less specific wildcard
      authzManager.registerACL({
        service: 'user*',
        allowedRoles: ['admin'],
      });

      const userContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      // Should match exact 'userService' ACL requiring 'user' role
      expect(authzManager.canAccessService('userService', userContext)).toBe(true);

      // Should match 'user*' wildcard requiring 'admin' role
      const adminContext: AuthContext = {
        userId: 'admin123',
        roles: ['admin'],
        permissions: [],
      };

      expect(authzManager.canAccessService('userAuthService', adminContext)).toBe(true);
    });
  });

  describe('method ACL inheritance', () => {
    it('should inherit service ACL when method has no ACL', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['user'],
      });

      const userContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      expect(authzManager.canAccessMethod('testService', 'anyMethod', userContext)).toBe(true);
    });

    it('should extend service ACL with method ACL by default', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['user'],
        methods: {
          restrictedMethod: {
            allowedRoles: ['admin'],
          },
        },
      });

      const userContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      const adminContext: AuthContext = {
        userId: 'admin123',
        roles: ['user', 'admin'], // Has both roles
        permissions: [],
      };

      const justAdminContext: AuthContext = {
        userId: 'admin456',
        roles: ['admin'], // Only admin, lacks service access
        permissions: [],
      };

      // User has service access and merged method access (user OR admin role)
      expect(authzManager.canAccessMethod('testService', 'restrictedMethod', userContext)).toBe(
        true,
      );
      // Admin with both roles can access
      expect(authzManager.canAccessMethod('testService', 'restrictedMethod', adminContext)).toBe(
        true,
      );
      // Admin without user role cannot access (no service access)
      expect(
        authzManager.canAccessMethod('testService', 'restrictedMethod', justAdminContext),
      ).toBe(false);
    });

    it('should override service ACL when __override flag is set', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['user'],
        methods: {
          adminOnlyMethod: {
            allowedRoles: ['admin'],
            __override: true,
          } as any,
        },
      });

      const userContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      const adminContext: AuthContext = {
        userId: 'admin123',
        roles: ['admin'],
        permissions: [],
      };

      // With override, only admin role is required (service role ignored)
      expect(authzManager.canAccessMethod('testService', 'adminOnlyMethod', userContext)).toBe(
        false,
      );
      expect(authzManager.canAccessMethod('testService', 'adminOnlyMethod', adminContext)).toBe(
        true,
      );
    });

    it('should work with method ACL without service ACL', () => {
      authzManager.registerACL({
        service: 'testService',
        methods: {
          restrictedMethod: {
            allowedRoles: ['admin'],
          },
        },
      });

      const userContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      const adminContext: AuthContext = {
        userId: 'admin123',
        roles: ['admin'],
        permissions: [],
      };

      // Anyone can access service, but only admin can access method
      expect(authzManager.canAccessMethod('testService', 'publicMethod', userContext)).toBe(true);
      expect(authzManager.canAccessMethod('testService', 'restrictedMethod', userContext)).toBe(
        false,
      );
      expect(authzManager.canAccessMethod('testService', 'restrictedMethod', adminContext)).toBe(
        true,
      );
    });
  });

  describe('user with multiple roles', () => {
    it('should allow access if user has any of the required roles', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['admin', 'moderator'],
      });

      const userWithOneRole: AuthContext = {
        userId: 'user1',
        roles: ['moderator', 'user'],
        permissions: [],
      };

      const userWithOtherRole: AuthContext = {
        userId: 'user2',
        roles: ['admin', 'user'],
        permissions: [],
      };

      const userWithNoRole: AuthContext = {
        userId: 'user3',
        roles: ['user', 'guest'],
        permissions: [],
      };

      expect(authzManager.canAccessService('testService', userWithOneRole)).toBe(true);
      expect(authzManager.canAccessService('testService', userWithOtherRole)).toBe(true);
      expect(authzManager.canAccessService('testService', userWithNoRole)).toBe(false);
    });
  });

  describe('user with partial permissions', () => {
    it('should require all permissions to be present', () => {
      authzManager.registerACL({
        service: 'testService',
        requiredPermissions: ['read', 'write', 'delete'],
      });

      const userWithAllPerms: AuthContext = {
        userId: 'user1',
        roles: [],
        permissions: ['read', 'write', 'delete', 'extra'],
      };

      const userWithSomePerms: AuthContext = {
        userId: 'user2',
        roles: [],
        permissions: ['read', 'write'],
      };

      expect(authzManager.canAccessService('testService', userWithAllPerms)).toBe(true);
      expect(authzManager.canAccessService('testService', userWithSomePerms)).toBe(false);
    });
  });

  describe('anonymous user access', () => {
    it('should deny access when ACL exists and no auth context', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['user'],
      });

      expect(authzManager.canAccessService('testService')).toBe(false);
      expect(authzManager.canAccessService('testService', undefined)).toBe(false);
    });

    it('should allow access when no ACL exists and no auth context', () => {
      expect(authzManager.canAccessService('publicService')).toBe(true);
      expect(authzManager.canAccessService('publicService', undefined)).toBe(true);
    });
  });

  describe('filter definition edge cases', () => {
    it('should handle nested method definitions', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['user'],
        methods: {
          adminMethod: {
            allowedRoles: ['admin'],
          },
        },
      });

      const definition = {
        id: 'test',
        methods: {
          publicMethod: {
            type: 'function',
            params: [{ name: 'id', type: 'string' }],
            returns: { type: 'object' },
          },
          adminMethod: {
            type: 'function',
            params: [],
            returns: { type: 'void' },
          },
        },
      };

      const userContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      const result = authzManager.filterDefinition('testService', definition, userContext);

      expect(result.methods.publicMethod).toBeDefined();
      expect(result.methods.publicMethod.params).toHaveLength(1);
      expect(result.methods.adminMethod).toBeDefined(); // User role inherited
    });

    it('should return full definition when no auth context and no ACL', () => {
      const definition = {
        id: 'test',
        methods: {
          method1: {},
          method2: {},
        },
      };

      const result = authzManager.filterDefinition('publicService', definition);
      expect(result).toEqual(definition);
    });

    it('should handle empty definition object', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['user'],
      });

      const emptyDef = {};

      const userContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      const result = authzManager.filterDefinition('testService', emptyDef, userContext);
      expect(result).toEqual(emptyDef);
    });
  });

  describe('case sensitivity and unicode', () => {
    it('should be case-sensitive by default', () => {
      authzManager.registerACL({
        service: 'TestService',
        allowedRoles: ['admin'],
      });

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['admin'],
        permissions: [],
      };

      expect(authzManager.canAccessService('TestService', authContext)).toBe(true);
      expect(authzManager.canAccessService('testservice', authContext)).toBe(true); // No ACL
    });

    it('should support case-insensitive matching when configured', () => {
      authzManager.setPatternMatchOptions({ caseInsensitive: true });

      authzManager.registerACL({
        service: 'TestService',
        allowedRoles: ['admin'],
      });

      const adminContext: AuthContext = {
        userId: 'admin123',
        roles: ['admin'],
        permissions: [],
      };

      const userContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      expect(authzManager.canAccessService('testservice', adminContext)).toBe(true);
      expect(authzManager.canAccessService('TESTSERVICE', adminContext)).toBe(true);
      expect(authzManager.canAccessService('TestService', adminContext)).toBe(true);
      expect(authzManager.canAccessService('testservice', userContext)).toBe(false);
    });

    it('should support Unicode service names', () => {
      authzManager.registerACL({
        service: '用户服务',
        allowedRoles: ['user'],
      });

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      expect(authzManager.canAccessService('用户服务', authContext)).toBe(true);
    });

    it('should support Unicode in wildcard patterns', () => {
      authzManager.registerACL({
        service: '用户*',
        allowedRoles: ['user'],
      });

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      expect(authzManager.canAccessService('用户服务', authContext)).toBe(true);
      expect(authzManager.canAccessService('用户管理', authContext)).toBe(true);
    });
  });

  describe('edge case coverage', () => {
    it('should deny method access when method ACL exists but no auth context', () => {
      authzManager.registerACL({
        service: 'testService',
        methods: {
          protectedMethod: {
            allowedRoles: ['admin'],
          },
        },
      });

      // No auth context
      expect(authzManager.canAccessMethod('testService', 'protectedMethod')).toBe(false);
    });

    it('should handle method with permissions in override mode', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['user'],
        requiredPermissions: ['service:read'],
        methods: {
          writeMethod: {
            requiredPermissions: ['service:write'],
            __override: true,
          } as any,
        },
      });

      const hasServicePerms: AuthContext = {
        userId: 'user1',
        roles: ['user'],
        permissions: ['service:read'],
      };

      const hasMethodPerms: AuthContext = {
        userId: 'user2',
        roles: ['admin'], // Different role, no service access without override
        permissions: ['service:write'],
      };

      // Without override, needs both service and method perms
      // With override, only method perms needed
      expect(authzManager.canAccessMethod('testService', 'writeMethod', hasServicePerms)).toBe(
        false,
      );
      expect(authzManager.canAccessMethod('testService', 'writeMethod', hasMethodPerms)).toBe(true);
    });

    it('should handle method with both roles and permissions inheritance', () => {
      authzManager.registerACL({
        service: 'testService',
        allowedRoles: ['user'],
        requiredPermissions: ['service:read'],
        methods: {
          writeMethod: {
            allowedRoles: ['admin'],
            requiredPermissions: ['service:write'],
          },
        },
      });

      const userWithReadOnly: AuthContext = {
        userId: 'user1',
        roles: ['user'],
        permissions: ['service:read'],
      };

      const userWithBoth: AuthContext = {
        userId: 'user2',
        roles: ['user', 'admin'],
        permissions: ['service:read', 'service:write'],
      };

      const userWithWriteNoRead: AuthContext = {
        userId: 'user3',
        roles: ['user', 'admin'],
        permissions: ['service:write'], // Missing service:read
      };

      // User needs both service perms and method perms (merged)
      expect(authzManager.canAccessMethod('testService', 'writeMethod', userWithReadOnly)).toBe(
        false,
      );
      expect(authzManager.canAccessMethod('testService', 'writeMethod', userWithBoth)).toBe(true);
      expect(
        authzManager.canAccessMethod('testService', 'writeMethod', userWithWriteNoRead),
      ).toBe(false);
    });

    it('should reject patterns with adjacent wildcards', () => {
      authzManager.registerACL({
        service: 'test**Service',
        allowedRoles: ['user'],
      });

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      // Adjacent wildcards should not match (invalid pattern)
      expect(authzManager.canAccessService('testService', authContext)).toBe(true); // No match, allowed
      expect(authzManager.canAccessService('testXXService', authContext)).toBe(true); // No match, allowed
    });
  });

  describe('performance with large number of ACLs', () => {
    it('should handle 1000+ ACLs efficiently', () => {
      const startTime = Date.now();

      // Register 1000 ACLs
      for (let i = 0; i < 1000; i++) {
        authzManager.registerACL({
          service: `service${i}`,
          allowedRoles: [`role${i}`],
        });
      }

      const registrationTime = Date.now() - startTime;

      // Test access check performance
      const checkStartTime = Date.now();

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['role500'],
        permissions: [],
      };

      // Should find exact match quickly
      const result = authzManager.canAccessService('service500', authContext);
      expect(result).toBe(true);

      const checkTime = Date.now() - checkStartTime;

      // Registration and check should be fast
      expect(registrationTime).toBeLessThan(1000); // < 1 second for 1000 ACLs
      expect(checkTime).toBeLessThan(100); // < 100ms for single check

      expect(authzManager.getACLs()).toHaveLength(1000);
    });

    it('should handle 100+ methods in definition efficiently', () => {
      authzManager.registerACL({
        service: 'largeService',
        allowedRoles: ['user'],
        methods: Object.fromEntries(
          Array.from({ length: 100 }, (_, i) => [
            `method${i}`,
            {
              allowedRoles: i % 2 === 0 ? ['user'] : ['admin'],
            },
          ]),
        ),
      });

      const definition = {
        id: 'large',
        methods: Object.fromEntries(
          Array.from({ length: 100 }, (_, i) => [`method${i}`, { type: 'function' }]),
        ),
      };

      const userContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      const startTime = Date.now();
      const result = authzManager.filterDefinition('largeService', definition, userContext);
      const filterTime = Date.now() - startTime;

      // Should filter quickly
      expect(filterTime).toBeLessThan(100); // < 100ms

      // Should have all methods (user role inherited)
      expect(Object.keys(result.methods)).toHaveLength(100);
    });
  });
});
