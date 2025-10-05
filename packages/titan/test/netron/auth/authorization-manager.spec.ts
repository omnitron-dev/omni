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
          },
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
  });
});
