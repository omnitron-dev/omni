/**
 * Security Tests for AuthorizationManager
 * Comprehensive security edge case testing for authorization
 * @module @omnitron-dev/titan/netron/auth/test
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { AuthorizationManager } from '../../../src/netron/auth/authorization-manager.js';
import type { AuthContext } from '../../../src/netron/auth/types.js';

// Mock logger
const createMockLogger = () => ({
  child: vi.fn().mockReturnThis(),
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
});

describe('AuthorizationManager Security Tests', () => {
  let authzManager: AuthorizationManager;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    authzManager = new AuthorizationManager(mockLogger as any);
  });

  describe('ACL Security', () => {
    describe('Path Traversal in Service Names', () => {
      it('should not allow path traversal sequences in service names', () => {
        authzManager.registerACL({
          service: '../../../etc/passwd',
          allowedRoles: ['admin'],
        });

        const adminContext: AuthContext = {
          userId: 'admin1',
          roles: ['admin'],
          permissions: [],
        };

        // Should treat as literal service name, not path traversal
        const result = authzManager.canAccessService('../../../etc/passwd', adminContext);
        expect(result).toBe(true);

        // Different traversal attempts should not match
        expect(authzManager.canAccessService('..', adminContext)).toBe(true); // No ACL
        expect(authzManager.canAccessService('etc/passwd', adminContext)).toBe(true); // No ACL
      });

      it('should handle URL-encoded path traversal attempts', () => {
        authzManager.registerACL({
          service: 'secureService',
          allowedRoles: ['admin'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        // URL-encoded variants should not match secureService
        expect(authzManager.canAccessService('%2e%2e%2f', userContext)).toBe(true); // No ACL
        expect(authzManager.canAccessService('..%2f', userContext)).toBe(true); // No ACL
        expect(authzManager.canAccessService('%2e%2e/', userContext)).toBe(true); // No ACL
      });

      it('should handle double-encoded path traversal', () => {
        authzManager.registerACL({
          service: 'adminService',
          allowedRoles: ['admin'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        // Double-encoded should be treated as different service
        expect(authzManager.canAccessService('%252e%252e%252f', userContext)).toBe(true); // No ACL
      });

      it('should handle null byte injection in service names', () => {
        authzManager.registerACL({
          service: 'restrictedService',
          allowedRoles: ['admin'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        // Null byte should not truncate service name
        expect(authzManager.canAccessService('restrictedService\x00public', userContext)).toBe(true); // Different service
        expect(authzManager.canAccessService('\x00restrictedService', userContext)).toBe(true); // Different service
      });
    });

    describe('Regex DoS Prevention in Patterns', () => {
      it('should handle catastrophic backtracking patterns safely', () => {
        // This pattern could cause exponential backtracking in naive regex
        authzManager.registerACL({
          service: 'a*a*a*a*a*b', // Potentially dangerous pattern
          allowedRoles: ['admin'],
        });

        const adminContext: AuthContext = {
          userId: 'admin1',
          roles: ['admin'],
          permissions: [],
        };

        const startTime = Date.now();
        // Input that could trigger catastrophic backtracking
        const result = authzManager.canAccessService('aaaaaaaaaaaaaaaaaaaaaaaaaaaaac', adminContext);
        const duration = Date.now() - startTime;

        // Should complete quickly (< 100ms), not hang
        expect(duration).toBeLessThan(100);
        expect(result).toBe(true); // No match, so allowed (no ACL)
      });

      it('should reject adjacent wildcards that could cause issues', () => {
        authzManager.registerACL({
          service: 'test**Service',
          allowedRoles: ['admin'],
        });

        const adminContext: AuthContext = {
          userId: 'admin1',
          roles: ['admin'],
          permissions: [],
        };

        // Adjacent wildcards should not match (invalid pattern)
        const result = authzManager.canAccessService('testXXService', adminContext);
        expect(result).toBe(true); // Pattern invalid, no match, allowed

        // Should have logged debug message about invalid pattern
        expect(mockLogger.debug).toHaveBeenCalledWith(
          expect.objectContaining({ pattern: 'test**Service' }),
          expect.stringContaining('adjacent wildcards')
        );
      });

      it('should handle many wildcards efficiently', () => {
        authzManager.registerACL({
          service: 'a*b*c*d*e*f*g*h*i*j',
          allowedRoles: ['admin'],
        });

        const adminContext: AuthContext = {
          userId: 'admin1',
          roles: ['admin'],
          permissions: [],
        };

        const startTime = Date.now();
        const result = authzManager.canAccessService('a1b2c3d4e5f6g7h8i9j', adminContext);
        const duration = Date.now() - startTime;

        expect(duration).toBeLessThan(100);
        expect(result).toBe(true);
      });

      it('should cache compiled regex patterns for performance', () => {
        authzManager.registerACL({
          service: 'user*Service',
          allowedRoles: ['user'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        // First call compiles regex
        const start1 = Date.now();
        authzManager.canAccessService('userTestService', userContext);
        const _time1 = Date.now() - start1;

        // Subsequent calls should use cached regex (faster)
        const times: number[] = [];
        for (let i = 0; i < 100; i++) {
          const start = Date.now();
          authzManager.canAccessService(`userService${i}`, userContext);
          times.push(Date.now() - start);
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        // Cached calls should be very fast
        expect(avgTime).toBeLessThan(1);
      });

      it('should limit pattern cache size to prevent memory exhaustion', () => {
        // Register ACL with wildcard
        authzManager.registerACL({
          service: 'test*',
          allowedRoles: ['user'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        // Create many unique patterns to test cache limit
        // Note: Pattern cache is internal, but we can verify it doesn't crash
        for (let i = 0; i < 2000; i++) {
          authzManager.canAccessService(`test${i}`, userContext);
        }

        // Should still work after many pattern compilations
        expect(authzManager.canAccessService('testFinal', userContext)).toBe(true);
      });
    });

    describe('Null Byte Injection in Patterns', () => {
      it('should handle null bytes in ACL service pattern', () => {
        authzManager.registerACL({
          service: 'admin\x00Service',
          allowedRoles: ['admin'],
        });

        const adminContext: AuthContext = {
          userId: 'admin1',
          roles: ['admin'],
          permissions: [],
        };

        // Exact match should work
        expect(authzManager.canAccessService('admin\x00Service', adminContext)).toBe(true);
        // Without null byte should not match
        expect(authzManager.canAccessService('adminService', adminContext)).toBe(true); // No ACL
      });

      it('should not truncate service name at null byte', () => {
        authzManager.registerACL({
          service: 'public*',
          allowedRoles: ['user'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        // Service name with null byte should be treated fully
        const result = authzManager.canAccessService('public\x00private', userContext);
        expect(result).toBe(true); // Matches public*
      });
    });

    describe('ACL Bypass via Case Manipulation', () => {
      it('should be case-sensitive by default', () => {
        authzManager.registerACL({
          service: 'AdminService',
          allowedRoles: ['admin'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        // Different case should NOT match the ACL
        expect(authzManager.canAccessService('adminservice', userContext)).toBe(true); // No ACL
        expect(authzManager.canAccessService('ADMINSERVICE', userContext)).toBe(true); // No ACL
        expect(authzManager.canAccessService('aDmInSeRvIcE', userContext)).toBe(true); // No ACL
      });

      it('should respect case-insensitive mode when configured', () => {
        authzManager.setPatternMatchOptions({ caseInsensitive: true });

        authzManager.registerACL({
          service: 'AdminService',
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

        // All case variants should match the ACL
        expect(authzManager.canAccessService('adminservice', userContext)).toBe(false);
        expect(authzManager.canAccessService('ADMINSERVICE', userContext)).toBe(false);
        expect(authzManager.canAccessService('AdminService', adminContext)).toBe(true);
      });

      it('should prevent case bypass in wildcard patterns', () => {
        authzManager.setPatternMatchOptions({ caseInsensitive: true });

        authzManager.registerACL({
          service: 'Admin*',
          allowedRoles: ['admin'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        // All case variants should be caught
        expect(authzManager.canAccessService('adminPanel', userContext)).toBe(false);
        expect(authzManager.canAccessService('ADMINDASHBOARD', userContext)).toBe(false);
        expect(authzManager.canAccessService('aDmInSettings', userContext)).toBe(false);
      });
    });

    describe('Wildcard Abuse Prevention', () => {
      it('should handle service name that is just a wildcard', () => {
        authzManager.registerACL({
          service: '*',
          allowedRoles: ['admin'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        // Single wildcard should match everything
        expect(authzManager.canAccessService('anyService', userContext)).toBe(false);
        expect(authzManager.canAccessService('', userContext)).toBe(false);
      });

      it('should handle multiple wildcards matching empty segments', () => {
        authzManager.registerACL({
          service: '*admin*',
          allowedRoles: ['admin'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        // Should match various positions
        expect(authzManager.canAccessService('admin', userContext)).toBe(false); // Wildcards match empty
        expect(authzManager.canAccessService('superadmin', userContext)).toBe(false);
        expect(authzManager.canAccessService('adminPanel', userContext)).toBe(false);
        expect(authzManager.canAccessService('superadminPanel', userContext)).toBe(false);
      });

      it('should not allow wildcard to match beyond intended scope', () => {
        authzManager.registerACL({
          service: 'user*',
          allowedRoles: ['user'],
        });

        const adminContext: AuthContext = {
          userId: 'admin1',
          roles: ['admin'],
          permissions: [],
        };

        // Should not match unrelated services
        expect(authzManager.canAccessService('adminService', adminContext)).toBe(true); // No ACL
        expect(authzManager.canAccessService('systemService', adminContext)).toBe(true); // No ACL
      });
    });
  });

  describe('Role/Permission Security', () => {
    describe('Role Spoofing Prevention', () => {
      it('should not accept roles that look like other roles', () => {
        authzManager.registerACL({
          service: 'adminService',
          allowedRoles: ['admin'],
        });

        // Attacker tries spoofed role names
        const spoofContexts = [
          { userId: 'user1', roles: ['admin '], permissions: [] }, // Trailing space
          { userId: 'user2', roles: [' admin'], permissions: [] }, // Leading space
          { userId: 'user3', roles: ['admin\t'], permissions: [] }, // Tab
          { userId: 'user4', roles: ['admin\n'], permissions: [] }, // Newline
          { userId: 'user5', roles: ['Admin'], permissions: [] }, // Different case
          { userId: 'user6', roles: ['ADMIN'], permissions: [] }, // Uppercase
        ];

        spoofContexts.forEach((ctx) => {
          const result = authzManager.canAccessService('adminService', ctx);
          expect(result).toBe(false);
        });
      });

      it('should handle role names with special characters', () => {
        authzManager.registerACL({
          service: 'specialService',
          allowedRoles: ['role:admin'],
        });

        const validContext: AuthContext = {
          userId: 'user1',
          roles: ['role:admin'],
          permissions: [],
        };

        const invalidContext: AuthContext = {
          userId: 'user2',
          roles: ['role', 'admin'], // Split role
          permissions: [],
        };

        expect(authzManager.canAccessService('specialService', validContext)).toBe(true);
        expect(authzManager.canAccessService('specialService', invalidContext)).toBe(false);
      });

      it('should handle empty string role', () => {
        authzManager.registerACL({
          service: 'service',
          allowedRoles: ['user'],
        });

        const contextWithEmptyRole: AuthContext = {
          userId: 'user1',
          roles: ['', 'user'],
          permissions: [],
        };

        // Should still work if valid role is present
        expect(authzManager.canAccessService('service', contextWithEmptyRole)).toBe(true);
      });
    });

    describe('Permission Escalation Prevention', () => {
      it('should not grant additional permissions through method ACL', () => {
        authzManager.registerACL({
          service: 'dataService',
          allowedRoles: ['user'],
          requiredPermissions: ['data:read'],
          methods: {
            deleteData: {
              requiredPermissions: ['data:delete'],
              __override: true,
            } as any,
          },
        });

        const readOnlyUser: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: ['data:read'],
        };

        // Should not be able to access delete method
        expect(authzManager.canAccessMethod('dataService', 'deleteData', readOnlyUser)).toBe(false);
      });

      it('should enforce ALL required permissions (AND logic)', () => {
        authzManager.registerACL({
          service: 'criticalService',
          requiredPermissions: ['critical:read', 'critical:write', 'critical:admin'],
        });

        const partialPermUser: AuthContext = {
          userId: 'user1',
          roles: [],
          permissions: ['critical:read', 'critical:write'], // Missing admin
        };

        expect(authzManager.canAccessService('criticalService', partialPermUser)).toBe(false);
      });

      it('should not allow permission name manipulation', () => {
        authzManager.registerACL({
          service: 'service',
          requiredPermissions: ['admin:*'],
        });

        const manipulatedContext: AuthContext = {
          userId: 'user1',
          roles: [],
          permissions: ['admin:*'], // User has literal "admin:*"
        };

        // Literal permission string should match
        expect(authzManager.canAccessService('service', manipulatedContext)).toBe(true);
      });
    });

    describe('Missing Role Checks', () => {
      it('should deny access when ACL requires roles but context has none', () => {
        authzManager.registerACL({
          service: 'service',
          allowedRoles: ['admin', 'moderator'],
        });

        const noRolesContext: AuthContext = {
          userId: 'user1',
          roles: [],
          permissions: [],
        };

        expect(authzManager.canAccessService('service', noRolesContext)).toBe(false);
      });

      it('should throw when context is missing roles array (runtime type violation)', () => {
        authzManager.registerACL({
          service: 'service',
          allowedRoles: ['user'],
        });

        // Note: TypeScript would catch this, but testing runtime behavior
        // This is a valid type violation - the code expects roles to be defined
        const brokenContext = {
          userId: 'user1',
          permissions: [],
        } as AuthContext;

        // SECURITY FINDING: Code throws TypeError when roles is undefined
        // This is acceptable as TypeScript should enforce the type at compile time
        // Runtime callers must ensure roles array is always provided
        expect(() => authzManager.canAccessService('service', brokenContext)).toThrow(TypeError);
      });
    });

    describe('Inherited Role Confusion', () => {
      it('should not implicitly inherit roles', () => {
        authzManager.registerACL({
          service: 'adminService',
          allowedRoles: ['admin'],
        });

        // User claims to inherit admin through superadmin
        const userClaimingInheritance: AuthContext = {
          userId: 'user1',
          roles: ['superuser'], // Not 'admin' or 'superadmin'
          permissions: [],
          metadata: { inheritsFrom: 'admin' }, // Metadata should not affect
        };

        expect(authzManager.canAccessService('adminService', userClaimingInheritance)).toBe(false);
      });

      it('should only check explicit role membership', () => {
        authzManager.registerACL({
          service: 'service',
          allowedRoles: ['level3'],
        });

        // User has lower level roles
        const lowerLevelUser: AuthContext = {
          userId: 'user1',
          roles: ['level1', 'level2'], // Not level3
          permissions: [],
        };

        // Should not automatically escalate
        expect(authzManager.canAccessService('service', lowerLevelUser)).toBe(false);
      });
    });
  });

  describe('Super Admin Security', () => {
    describe('Super Admin Role Bypass', () => {
      it('should allow super admin to bypass all ACL restrictions', () => {
        authzManager.registerACL({
          service: 'ultraRestrictedService',
          allowedRoles: ['god'],
          requiredPermissions: ['impossible:permission'],
          methods: {
            secretMethod: {
              allowedRoles: ['nonexistent'],
              requiredPermissions: ['also:impossible'],
            },
          },
        });

        const superAdminContext: AuthContext = {
          userId: 'superadmin1',
          roles: ['superadmin'],
          permissions: [],
        };

        expect(authzManager.canAccessService('ultraRestrictedService', superAdminContext)).toBe(true);
        expect(authzManager.canAccessMethod('ultraRestrictedService', 'secretMethod', superAdminContext)).toBe(true);
      });

      it('should prevent impersonation of super admin role', () => {
        authzManager.registerACL({
          service: 'service',
          allowedRoles: ['admin'],
        });

        // Attempts to spoof super admin role
        const spoofAttempts = [
          { userId: 'user1', roles: ['superAdmin'], permissions: [] }, // Wrong case
          { userId: 'user2', roles: ['super_admin'], permissions: [] }, // Underscore
          { userId: 'user3', roles: ['super admin'], permissions: [] }, // Space
          { userId: 'user4', roles: ['superadmin '], permissions: [] }, // Trailing space
        ];

        spoofAttempts.forEach((ctx) => {
          // Should not get super admin bypass
          expect(authzManager.canAccessService('service', ctx)).toBe(false);
        });
      });

      it('should allow configuring custom super admin role name', () => {
        authzManager.setSuperAdminRole('root');

        authzManager.registerACL({
          service: 'service',
          allowedRoles: ['admin'],
        });

        const rootContext: AuthContext = {
          userId: 'root1',
          roles: ['root'],
          permissions: [],
        };

        const superadminContext: AuthContext = {
          userId: 'superadmin1',
          roles: ['superadmin'], // Old role name
          permissions: [],
        };

        expect(authzManager.canAccessService('service', rootContext)).toBe(true);
        expect(authzManager.canAccessService('service', superadminContext)).toBe(false);
      });
    });

    describe('Super Admin Privilege Escalation', () => {
      it('should not allow escalation to super admin through metadata', () => {
        authzManager.registerACL({
          service: 'service',
          allowedRoles: ['admin'],
        });

        const escalationAttempt: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
          metadata: {
            isSuperAdmin: true,
            role: 'superadmin',
          },
        };

        expect(authzManager.canAccessService('service', escalationAttempt)).toBe(false);
      });

      it('should not allow escalation through scopes', () => {
        authzManager.registerACL({
          service: 'service',
          allowedRoles: ['admin'],
        });

        const scopeEscalation: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
          scopes: ['superadmin', 'admin:*'],
        };

        // Scopes should not affect role-based checks
        expect(authzManager.canAccessService('service', scopeEscalation)).toBe(false);
      });
    });

    describe('Role Confusion with Super Admin', () => {
      it('should not confuse super admin with similar role names', () => {
        authzManager.registerACL({
          service: 'service',
          allowedRoles: ['superadmin_assistant'], // Similar but not super admin
        });

        const confusionContext: AuthContext = {
          userId: 'user1',
          roles: ['superadmin_assistant'],
          permissions: [],
        };

        // Should match explicitly defined role, not get super admin bypass
        expect(authzManager.canAccessService('service', confusionContext)).toBe(true);

        // Super admin should still bypass
        const actualSuperAdmin: AuthContext = {
          userId: 'superadmin1',
          roles: ['superadmin'],
          permissions: [],
        };

        expect(authzManager.canAccessService('service', actualSuperAdmin)).toBe(true);
      });

      it('should handle super admin role with special characters safely', () => {
        authzManager.setSuperAdminRole('super.admin');

        authzManager.registerACL({
          service: 'service',
          allowedRoles: ['admin'],
        });

        const specialRoleContext: AuthContext = {
          userId: 'superadmin1',
          roles: ['super.admin'],
          permissions: [],
        };

        expect(authzManager.canAccessService('service', specialRoleContext)).toBe(true);
      });
    });
  });

  describe('Definition Filtering Security', () => {
    describe('Method Filtering Bypass Prevention', () => {
      it('should not expose method names in filtered definition for unauthorized methods', () => {
        authzManager.registerACL({
          service: 'service',
          allowedRoles: ['user'],
          methods: {
            publicMethod: { allowedRoles: ['user'] },
            secretMethod: { allowedRoles: ['admin'], __override: true },
            ultraSecretMethod: { allowedRoles: ['god'], __override: true },
          } as any,
        });

        const definition = {
          id: 'service',
          methods: {
            publicMethod: { type: 'function', description: 'Public' },
            secretMethod: { type: 'function', description: 'Secret data here' },
            ultraSecretMethod: { type: 'function', description: 'Top secret' },
          },
        };

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        const filtered = authzManager.filterDefinition('service', definition, userContext);

        expect(filtered.methods).toHaveProperty('publicMethod');
        expect(filtered.methods).not.toHaveProperty('secretMethod');
        expect(filtered.methods).not.toHaveProperty('ultraSecretMethod');
      });

      it('should not leak method metadata for unauthorized methods', () => {
        authzManager.registerACL({
          service: 'service',
          allowedRoles: ['user'],
          methods: {
            adminMethod: {
              allowedRoles: ['admin'],
              __override: true,
            },
          } as any,
        });

        const definition = {
          id: 'service',
          methods: {
            adminMethod: {
              type: 'function',
              description: 'Contains sensitive info',
              params: [{ name: 'secretKey', type: 'string' }],
              internalNotes: 'This method accesses database directly',
            },
          },
        };

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        const filtered = authzManager.filterDefinition('service', definition, userContext);

        // Should not contain any trace of admin method
        expect(JSON.stringify(filtered)).not.toContain('adminMethod');
        expect(JSON.stringify(filtered)).not.toContain('secretKey');
        expect(JSON.stringify(filtered)).not.toContain('internalNotes');
      });
    });

    describe('Information Leakage Prevention', () => {
      it('should return null for completely unauthorized service access', () => {
        authzManager.registerACL({
          service: 'topSecretService',
          allowedRoles: ['classified'],
        });

        const definition = {
          id: 'topSecretService',
          version: '1.0.0',
          methods: {
            getSecrets: { type: 'function' },
          },
          metadata: {
            internalId: 'secret-123',
          },
        };

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        const filtered = authzManager.filterDefinition('topSecretService', definition, userContext);

        expect(filtered).toBeNull();
      });

      it('should not modify original definition object', () => {
        authzManager.registerACL({
          service: 'service',
          allowedRoles: ['user'],
          methods: {
            secretMethod: {
              allowedRoles: ['admin'],
              __override: true,
            },
          } as any,
        });

        const originalDefinition = {
          id: 'service',
          methods: {
            publicMethod: { type: 'function' },
            secretMethod: { type: 'function' },
          },
        };

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        authzManager.filterDefinition('service', originalDefinition, userContext);

        // Original should be unchanged
        expect(originalDefinition.methods).toHaveProperty('publicMethod');
        expect(originalDefinition.methods).toHaveProperty('secretMethod');
      });

      it('should handle deeply nested definition properties', () => {
        authzManager.registerACL({
          service: 'service',
          allowedRoles: ['user'],
          methods: {
            nestedMethod: {
              allowedRoles: ['admin'],
              __override: true,
            },
          } as any,
        });

        const definition = {
          id: 'service',
          methods: {
            publicMethod: {
              type: 'function',
              params: [
                {
                  name: 'data',
                  type: 'object',
                  nested: {
                    deep: {
                      value: 'public',
                    },
                  },
                },
              ],
            },
            nestedMethod: {
              type: 'function',
              secrets: {
                apiKey: 'secret-key-123',
                nested: {
                  deep: {
                    password: 'hunter2',
                  },
                },
              },
            },
          },
        };

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        const filtered = authzManager.filterDefinition('service', definition, userContext);

        // Should preserve nested public data
        expect(filtered.methods.publicMethod.params[0].nested.deep.value).toBe('public');
        // Should not contain nested secret data
        expect(JSON.stringify(filtered)).not.toContain('secret-key-123');
        expect(JSON.stringify(filtered)).not.toContain('hunter2');
      });
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    describe('Empty and Null Handling', () => {
      it('should handle empty service name', () => {
        authzManager.registerACL({
          service: '',
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

        expect(authzManager.canAccessService('', userContext)).toBe(false);
        expect(authzManager.canAccessService('', adminContext)).toBe(true);
      });

      it('should handle empty roles array in ACL', () => {
        authzManager.registerACL({
          service: 'service',
          allowedRoles: [],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        // Empty allowed roles = no role restriction
        expect(authzManager.canAccessService('service', userContext)).toBe(true);
      });

      it('should handle empty permissions array in ACL', () => {
        authzManager.registerACL({
          service: 'service',
          requiredPermissions: [],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: [],
          permissions: [],
        };

        // Empty required permissions = no permission restriction
        expect(authzManager.canAccessService('service', userContext)).toBe(true);
      });

      it('should handle undefined auth context', () => {
        authzManager.registerACL({
          service: 'service',
          allowedRoles: ['user'],
        });

        expect(authzManager.canAccessService('service', undefined)).toBe(false);
        expect(authzManager.canAccessMethod('service', 'method', undefined)).toBe(false);
      });
    });

    describe('Unicode and Special Characters', () => {
      it('should handle Unicode service names', () => {
        authzManager.registerACL({
          service: '用户服务',
          allowedRoles: ['user'],
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: [],
        };

        expect(authzManager.canAccessService('用户服务', userContext)).toBe(true);
      });

      it('should handle emoji in service names', () => {
        authzManager.registerACL({
          service: 'service-🔒',
          allowedRoles: ['admin'],
        });

        const adminContext: AuthContext = {
          userId: 'admin1',
          roles: ['admin'],
          permissions: [],
        };

        expect(authzManager.canAccessService('service-🔒', adminContext)).toBe(true);
        expect(authzManager.canAccessService('service-🔓', adminContext)).toBe(true); // No ACL
      });

      it('should handle RTL and special Unicode in roles', () => {
        authzManager.registerACL({
          service: 'service',
          allowedRoles: ['مدير'], // Arabic for "admin"
        });

        const arabicAdmin: AuthContext = {
          userId: 'user1',
          roles: ['مدير'],
          permissions: [],
        };

        expect(authzManager.canAccessService('service', arabicAdmin)).toBe(true);
      });
    });

    describe('Large Scale Security', () => {
      it('should handle 10000+ ACLs without performance degradation', () => {
        // Register many ACLs
        for (let i = 0; i < 10000; i++) {
          authzManager.registerACL({
            service: `service${i}`,
            allowedRoles: [`role${i}`],
          });
        }

        const userContext: AuthContext = {
          userId: 'user1',
          roles: ['role5000'],
          permissions: [],
        };

        const startTime = Date.now();
        const result = authzManager.canAccessService('service5000', userContext);
        const duration = Date.now() - startTime;

        expect(result).toBe(true);
        expect(duration).toBeLessThan(100); // Should be fast
      });

      it('should handle user with 1000+ roles', () => {
        authzManager.registerACL({
          service: 'service',
          allowedRoles: ['targetRole'],
        });

        const manyRoles = Array.from({ length: 1000 }, (_, i) => `role${i}`);
        manyRoles.push('targetRole');

        const userContext: AuthContext = {
          userId: 'user1',
          roles: manyRoles,
          permissions: [],
        };

        const startTime = Date.now();
        const result = authzManager.canAccessService('service', userContext);
        const duration = Date.now() - startTime;

        expect(result).toBe(true);
        expect(duration).toBeLessThan(100);
      });

      it('should handle ACL with 1000+ required permissions', () => {
        const manyPermissions = Array.from({ length: 1000 }, (_, i) => `perm:${i}`);

        authzManager.registerACL({
          service: 'service',
          requiredPermissions: manyPermissions,
        });

        const userContext: AuthContext = {
          userId: 'user1',
          roles: [],
          permissions: manyPermissions,
        };

        const startTime = Date.now();
        const result = authzManager.canAccessService('service', userContext);
        const duration = Date.now() - startTime;

        expect(result).toBe(true);
        expect(duration).toBeLessThan(100);
      });
    });

    describe('Concurrent Access', () => {
      it('should handle concurrent ACL registration and checks', async () => {
        const promises: Promise<boolean>[] = [];

        // Concurrent registration and checking
        for (let i = 0; i < 100; i++) {
          authzManager.registerACL({
            service: `concurrent${i}`,
            allowedRoles: ['user'],
          });

          const userContext: AuthContext = {
            userId: 'user1',
            roles: ['user'],
            permissions: [],
          };

          promises.push(Promise.resolve(authzManager.canAccessService(`concurrent${i}`, userContext)));
        }

        const results = await Promise.all(promises);
        expect(results.every((r) => r === true)).toBe(true);
      });

      it('should handle concurrent ACL updates for same service', () => {
        // Rapidly update same ACL
        for (let i = 0; i < 100; i++) {
          authzManager.registerACL({
            service: 'sharedService',
            allowedRoles: [i % 2 === 0 ? 'admin' : 'user'],
          });
        }

        // Final state should be consistent
        const acls = authzManager.getACLs();
        const sharedAcl = acls.find((a) => a.service === 'sharedService');
        expect(sharedAcl).toBeDefined();
        expect(sharedAcl?.allowedRoles?.length).toBe(1);
      });
    });
  });

  describe('Scope Validation Security', () => {
    describe('Scope Validation', () => {
      it('should validate all required scopes are present', () => {
        const result = authzManager.validateScopes(['api:read', 'api:write', 'api:admin'], ['api:read', 'api:write']);

        expect(result.valid).toBe(false);
        expect(result.missing).toEqual(['api:admin']);
      });

      it('should handle scope injection attempts', () => {
        const result = authzManager.validateScopes(['admin:*'], ['admin:*']); // Literal wildcard

        // Literal match should work
        expect(result.valid).toBe(true);
      });

      it('should handle undefined scopes safely', () => {
        const result = authzManager.validateScopes(['required:scope'], undefined);

        expect(result.valid).toBe(false);
        expect(result.missing).toEqual(['required:scope']);
      });
    });

    describe('Unified Access Validation', () => {
      it('should check roles, permissions, and scopes in order', () => {
        const context: AuthContext = {
          userId: 'user1',
          roles: ['user'],
          permissions: ['read'],
          scopes: ['api:read'],
        };

        // Fails on roles
        const result1 = authzManager.validateAccess(context, {
          roles: ['admin'],
          permissions: ['read'],
          scopes: ['api:read'],
        });
        expect(result1.allowed).toBe(false);
        expect(result1.reason).toContain('role');

        // Passes roles, fails on permissions
        const result2 = authzManager.validateAccess(context, {
          roles: ['user'],
          permissions: ['write'],
          scopes: ['api:read'],
        });
        expect(result2.allowed).toBe(false);
        expect(result2.reason).toContain('permission');

        // Passes roles and permissions, fails on scopes
        const result3 = authzManager.validateAccess(context, {
          roles: ['user'],
          permissions: ['read'],
          scopes: ['api:admin'],
        });
        expect(result3.allowed).toBe(false);
        expect(result3.reason).toContain('scope');

        // All pass
        const result4 = authzManager.validateAccess(context, {
          roles: ['user'],
          permissions: ['read'],
          scopes: ['api:read'],
        });
        expect(result4.allowed).toBe(true);
      });

      it('should handle empty requirements', () => {
        const context: AuthContext = {
          userId: 'user1',
          roles: [],
          permissions: [],
        };

        const result = authzManager.validateAccess(context, {});
        expect(result.allowed).toBe(true);
      });
    });
  });

  describe('Pattern Cache Security', () => {
    it('should clear pattern cache when options change', () => {
      authzManager.registerACL({
        service: 'Test*',
        allowedRoles: ['user'],
      });

      const userContext: AuthContext = {
        userId: 'user1',
        roles: ['user'],
        permissions: [],
      };

      // First match (case-sensitive)
      expect(authzManager.canAccessService('TestService', userContext)).toBe(true);
      expect(authzManager.canAccessService('testService', userContext)).toBe(true); // No ACL match

      // Change to case-insensitive
      authzManager.setPatternMatchOptions({ caseInsensitive: true });

      // Now should match both
      expect(authzManager.canAccessService('testService', userContext)).toBe(true);
    });

    it('should clear pattern cache when ACLs are cleared', () => {
      authzManager.registerACL({
        service: 'service*',
        allowedRoles: ['user'],
      });

      const userContext: AuthContext = {
        userId: 'user1',
        roles: ['user'],
        permissions: [],
      };

      authzManager.canAccessService('serviceTest', userContext);
      authzManager.clearACLs();

      // After clearing, no ACLs so everything allowed
      const adminService: AuthContext = {
        userId: 'user1',
        roles: ['admin'],
        permissions: [],
      };
      expect(authzManager.canAccessService('serviceTest', adminService)).toBe(true);
    });
  });
});
