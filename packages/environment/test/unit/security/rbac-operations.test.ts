import { describe, it, expect, beforeEach } from 'vitest';
import { RBAC } from '../../../src/security/rbac.js';
import { Policy, PolicyContext } from '../../../src/types/operations.js';

describe('RBAC Operations', () => {
  let rbac: RBAC;

  beforeEach(() => {
    rbac = new RBAC();
  });

  describe('grantRole', () => {
    it('should grant role to user without registration', () => {
      rbac.grantRole('user1', 'developer');
      const roles = rbac.getUserRoles('user1');
      expect(roles).toContain('developer');
    });

    it('should grant role to registered user', () => {
      rbac.registerUser({ id: 'user1', roles: [] });
      rbac.grantRole('user1', 'developer');
      const roles = rbac.getUserRoles('user1');
      expect(roles).toContain('developer');
    });

    it('should not duplicate roles', () => {
      rbac.grantRole('user1', 'developer');
      rbac.grantRole('user1', 'developer');
      const roles = rbac.getUserRoles('user1');
      expect(roles.filter((r) => r === 'developer')).toHaveLength(1);
    });

    it('should grant multiple roles to same user', () => {
      rbac.grantRole('user1', 'developer');
      rbac.grantRole('user1', 'operator');
      const roles = rbac.getUserRoles('user1');
      expect(roles).toContain('developer');
      expect(roles).toContain('operator');
    });
  });

  describe('revokeRole', () => {
    it('should revoke role from user', () => {
      rbac.registerUser({ id: 'user1', roles: ['developer'] });
      rbac.revokeRole('user1', 'developer');
      const user = rbac.getUser('user1');
      expect(user?.roles).not.toContain('developer');
    });

    it('should throw error when revoking from non-existent user', () => {
      expect(() => rbac.revokeRole('nonexistent', 'developer')).toThrow('User not found');
    });

    it('should handle revoking non-existent role gracefully', () => {
      rbac.registerUser({ id: 'user1', roles: ['viewer'] });
      rbac.revokeRole('user1', 'developer');
      const user = rbac.getUser('user1');
      expect(user?.roles).toEqual(['viewer']);
    });
  });

  describe('getUserRoles', () => {
    it('should return empty array for non-existent user', () => {
      const roles = rbac.getUserRoles('nonexistent');
      expect(roles).toEqual([]);
    });

    it('should return all roles for user', () => {
      rbac.grantRole('user1', 'developer');
      rbac.grantRole('user1', 'operator');
      const roles = rbac.getUserRoles('user1');
      expect(roles).toHaveLength(2);
      expect(roles).toContain('developer');
      expect(roles).toContain('operator');
    });

    it('should return roles from registered user', () => {
      rbac.registerUser({ id: 'user1', roles: ['admin', 'developer'] });
      const roles = rbac.getUserRoles('user1');
      expect(roles).toContain('admin');
      expect(roles).toContain('developer');
    });
  });

  describe('checkPermission', () => {
    it('should allow admin access to any resource', async () => {
      rbac.registerUser({ id: 'admin1', roles: ['admin'] });
      const hasPermission = await rbac.checkPermission('admin1', 'write', '/config/app');
      expect(hasPermission).toBe(true);
    });

    it('should allow developer to read config', async () => {
      rbac.registerUser({ id: 'dev1', roles: ['developer'] });
      const hasPermission = await rbac.checkPermission('dev1', 'read', '/config/app');
      expect(hasPermission).toBe(true);
    });

    it('should allow developer to write config', async () => {
      rbac.registerUser({ id: 'dev1', roles: ['developer'] });
      const hasPermission = await rbac.checkPermission('dev1', 'write', '/config/app');
      expect(hasPermission).toBe(true);
    });

    it('should deny viewer write access', async () => {
      rbac.registerUser({ id: 'viewer1', roles: ['viewer'] });
      const hasPermission = await rbac.checkPermission('viewer1', 'write', '/config/app');
      expect(hasPermission).toBe(false);
    });

    it('should allow viewer read access', async () => {
      rbac.registerUser({ id: 'viewer1', roles: ['viewer'] });
      const hasPermission = await rbac.checkPermission('viewer1', 'read', '/config/app');
      expect(hasPermission).toBe(true);
    });

    it('should deny access for non-existent user', async () => {
      const hasPermission = await rbac.checkPermission('nonexistent', 'read', '/config/app');
      expect(hasPermission).toBe(false);
    });

    it('should check permission for task execution', async () => {
      rbac.registerUser({ id: 'operator1', roles: ['operator'] });
      const hasPermission = await rbac.checkPermission('operator1', 'execute', '/task/deploy');
      expect(hasPermission).toBe(true);
    });

    it('should check permission for target execution', async () => {
      rbac.registerUser({ id: 'operator1', roles: ['operator'] });
      const hasPermission = await rbac.checkPermission('operator1', 'execute', '/target/prod');
      expect(hasPermission).toBe(true);
    });

    it('should check permission with path patterns', async () => {
      rbac.registerUser({ id: 'dev1', roles: ['developer'] });
      const hasPermission = await rbac.checkPermission('dev1', 'read', '/environment/staging');
      expect(hasPermission).toBe(true);
    });

    it('should handle permission for multiple roles', async () => {
      rbac.grantRole('user1', 'developer');
      rbac.grantRole('user1', 'operator');
      const hasPermission = await rbac.checkPermission('user1', 'execute', '/task/build');
      expect(hasPermission).toBe(true);
    });
  });
});

describe('ABAC Operations', () => {
  let rbac: RBAC;

  beforeEach(() => {
    rbac = new RBAC();
  });

  describe('definePolicy', () => {
    it('should define a new policy', () => {
      const policy: Policy = {
        effect: 'allow',
        principal: { roles: ['developer'] },
        resource: { paths: ['/config/*'] },
        actions: ['read', 'write'],
      };
      rbac.definePolicy('dev-config-access', policy);
      const retrieved = rbac.getPolicy('dev-config-access');
      expect(retrieved).toEqual(policy);
    });

    it('should overwrite existing policy with same name', () => {
      const policy1: Policy = {
        effect: 'allow',
        principal: { roles: ['developer'] },
        resource: { paths: ['/config/*'] },
        actions: ['read'],
      };
      const policy2: Policy = {
        effect: 'deny',
        principal: { roles: ['developer'] },
        resource: { paths: ['/config/*'] },
        actions: ['write'],
      };
      rbac.definePolicy('dev-policy', policy1);
      rbac.definePolicy('dev-policy', policy2);
      const retrieved = rbac.getPolicy('dev-policy');
      expect(retrieved).toEqual(policy2);
    });
  });

  describe('evaluatePolicy - Basic', () => {
    it('should allow when all conditions match', async () => {
      rbac.grantRole('user1', 'developer');
      const policy: Policy = {
        effect: 'allow',
        principal: { roles: ['developer'] },
        resource: { paths: ['/config/*'] },
        actions: ['read'],
      };
      rbac.definePolicy('test-policy', policy);

      const context: PolicyContext = {
        principal: { id: 'user1' },
        resource: { path: '/config/app.json' },
        action: 'read',
      };

      const result = await rbac.evaluatePolicy('test-policy', context);
      expect(result).toBe(true);
    });

    it('should deny when role does not match', async () => {
      rbac.grantRole('user1', 'viewer');
      const policy: Policy = {
        effect: 'allow',
        principal: { roles: ['developer'] },
        resource: { paths: ['/config/*'] },
        actions: ['read'],
      };
      rbac.definePolicy('test-policy', policy);

      const context: PolicyContext = {
        principal: { id: 'user1' },
        resource: { path: '/config/app.json' },
        action: 'read',
      };

      const result = await rbac.evaluatePolicy('test-policy', context);
      expect(result).toBe(false);
    });

    it('should deny when action does not match', async () => {
      rbac.grantRole('user1', 'developer');
      const policy: Policy = {
        effect: 'allow',
        principal: { roles: ['developer'] },
        resource: { paths: ['/config/*'] },
        actions: ['read'],
      };
      rbac.definePolicy('test-policy', policy);

      const context: PolicyContext = {
        principal: { id: 'user1' },
        resource: { path: '/config/app.json' },
        action: 'write',
      };

      const result = await rbac.evaluatePolicy('test-policy', context);
      expect(result).toBe(false);
    });

    it('should deny when path does not match', async () => {
      rbac.grantRole('user1', 'developer');
      const policy: Policy = {
        effect: 'allow',
        principal: { roles: ['developer'] },
        resource: { paths: ['/config/*'] },
        actions: ['read'],
      };
      rbac.definePolicy('test-policy', policy);

      const context: PolicyContext = {
        principal: { id: 'user1' },
        resource: { path: '/secrets/api-key' },
        action: 'read',
      };

      const result = await rbac.evaluatePolicy('test-policy', context);
      expect(result).toBe(false);
    });

    it('should throw error for non-existent policy', async () => {
      const context: PolicyContext = {
        principal: { id: 'user1' },
        resource: { path: '/config/app.json' },
        action: 'read',
      };

      await expect(rbac.evaluatePolicy('nonexistent', context)).rejects.toThrow('Policy not found');
    });
  });

  describe('evaluatePolicy - Wildcards', () => {
    it('should match path with wildcard', async () => {
      rbac.grantRole('user1', 'developer');
      const policy: Policy = {
        effect: 'allow',
        principal: { roles: ['developer'] },
        resource: { paths: ['/config/*'] },
        actions: ['read'],
      };
      rbac.definePolicy('test-policy', policy);

      const context: PolicyContext = {
        principal: { id: 'user1' },
        resource: { path: '/config/database.json' },
        action: 'read',
      };

      const result = await rbac.evaluatePolicy('test-policy', context);
      expect(result).toBe(true);
    });

    it('should match nested path with double wildcard', async () => {
      rbac.grantRole('user1', 'developer');
      const policy: Policy = {
        effect: 'allow',
        principal: { roles: ['developer'] },
        resource: { paths: ['/config/**'] },
        actions: ['read'],
      };
      rbac.definePolicy('test-policy', policy);

      const context: PolicyContext = {
        principal: { id: 'user1' },
        resource: { path: '/config/prod/database.json' },
        action: 'read',
      };

      const result = await rbac.evaluatePolicy('test-policy', context);
      expect(result).toBe(true);
    });
  });

  describe('evaluatePolicy - Exclusions', () => {
    it('should exclude specified paths', async () => {
      rbac.grantRole('user1', 'developer');
      const policy: Policy = {
        effect: 'allow',
        principal: { roles: ['developer'] },
        resource: {
          paths: ['/config/*'],
          exclude: ['/config/secrets.json'],
        },
        actions: ['read'],
      };
      rbac.definePolicy('test-policy', policy);

      const context: PolicyContext = {
        principal: { id: 'user1' },
        resource: { path: '/config/secrets.json' },
        action: 'read',
      };

      const result = await rbac.evaluatePolicy('test-policy', context);
      expect(result).toBe(false);
    });

    it('should allow non-excluded paths', async () => {
      rbac.grantRole('user1', 'developer');
      const policy: Policy = {
        effect: 'allow',
        principal: { roles: ['developer'] },
        resource: {
          paths: ['/config/*'],
          exclude: ['/config/secrets.json'],
        },
        actions: ['read'],
      };
      rbac.definePolicy('test-policy', policy);

      const context: PolicyContext = {
        principal: { id: 'user1' },
        resource: { path: '/config/app.json' },
        action: 'read',
      };

      const result = await rbac.evaluatePolicy('test-policy', context);
      expect(result).toBe(true);
    });
  });

  describe('evaluatePolicy - Attributes', () => {
    it('should match principal attributes', async () => {
      rbac.grantRole('user1', 'developer');
      const policy: Policy = {
        effect: 'allow',
        principal: {
          roles: ['developer'],
          attributes: { department: 'engineering' },
        },
        resource: { paths: ['/config/*'] },
        actions: ['read'],
      };
      rbac.definePolicy('test-policy', policy);

      const context: PolicyContext = {
        principal: { id: 'user1', department: 'engineering' },
        resource: { path: '/config/app.json' },
        action: 'read',
      };

      const result = await rbac.evaluatePolicy('test-policy', context);
      expect(result).toBe(true);
    });

    it('should deny when attributes do not match', async () => {
      rbac.grantRole('user1', 'developer');
      const policy: Policy = {
        effect: 'allow',
        principal: {
          roles: ['developer'],
          attributes: { department: 'engineering' },
        },
        resource: { paths: ['/config/*'] },
        actions: ['read'],
      };
      rbac.definePolicy('test-policy', policy);

      const context: PolicyContext = {
        principal: { id: 'user1', department: 'sales' },
        resource: { path: '/config/app.json' },
        action: 'read',
      };

      const result = await rbac.evaluatePolicy('test-policy', context);
      expect(result).toBe(false);
    });
  });

  describe('evaluatePolicy - Resource Types', () => {
    it('should match resource type', async () => {
      rbac.grantRole('user1', 'developer');
      const policy: Policy = {
        effect: 'allow',
        principal: { roles: ['developer'] },
        resource: { paths: ['/config/*'], types: ['json'] },
        actions: ['read'],
      };
      rbac.definePolicy('test-policy', policy);

      const context: PolicyContext = {
        principal: { id: 'user1' },
        resource: { path: '/config/app.json', type: 'json' },
        action: 'read',
      };

      const result = await rbac.evaluatePolicy('test-policy', context);
      expect(result).toBe(true);
    });

    it('should deny when resource type does not match', async () => {
      rbac.grantRole('user1', 'developer');
      const policy: Policy = {
        effect: 'allow',
        principal: { roles: ['developer'] },
        resource: { paths: ['/config/*'], types: ['json'] },
        actions: ['read'],
      };
      rbac.definePolicy('test-policy', policy);

      const context: PolicyContext = {
        principal: { id: 'user1' },
        resource: { path: '/config/app.yaml', type: 'yaml' },
        action: 'read',
      };

      const result = await rbac.evaluatePolicy('test-policy', context);
      expect(result).toBe(false);
    });
  });

  describe('evaluatePolicy - Conditions', () => {
    it('should evaluate equals condition', async () => {
      rbac.grantRole('user1', 'developer');
      const policy: Policy = {
        effect: 'allow',
        principal: { roles: ['developer'] },
        resource: { paths: ['/config/*'] },
        actions: ['write'],
        conditions: {
          and: [{ attribute: 'context.time', operator: 'equals', value: 'business-hours' }],
        },
      };
      rbac.definePolicy('test-policy', policy);

      const context: PolicyContext = {
        principal: { id: 'user1' },
        resource: { path: '/config/app.json' },
        action: 'write',
        context: { time: 'business-hours' },
      };

      const result = await rbac.evaluatePolicy('test-policy', context);
      expect(result).toBe(true);
    });

    it('should evaluate in condition', async () => {
      rbac.grantRole('user1', 'developer');
      const policy: Policy = {
        effect: 'allow',
        principal: { roles: ['developer'] },
        resource: { paths: ['/config/*'] },
        actions: ['write'],
        conditions: {
          and: [
            {
              attribute: 'principal.region',
              operator: 'in',
              value: ['us-east', 'us-west'],
            },
          ],
        },
      };
      rbac.definePolicy('test-policy', policy);

      const context: PolicyContext = {
        principal: { id: 'user1', region: 'us-east' },
        resource: { path: '/config/app.json' },
        action: 'write',
      };

      const result = await rbac.evaluatePolicy('test-policy', context);
      expect(result).toBe(true);
    });

    it('should evaluate greaterThan condition', async () => {
      rbac.grantRole('user1', 'developer');
      const policy: Policy = {
        effect: 'allow',
        principal: { roles: ['developer'] },
        resource: { paths: ['/config/*'] },
        actions: ['write'],
        conditions: {
          and: [{ attribute: 'principal.level', operator: 'greaterThan', value: 5 }],
        },
      };
      rbac.definePolicy('test-policy', policy);

      const context: PolicyContext = {
        principal: { id: 'user1', level: 10 },
        resource: { path: '/config/app.json' },
        action: 'write',
      };

      const result = await rbac.evaluatePolicy('test-policy', context);
      expect(result).toBe(true);
    });

    it('should evaluate matches condition', async () => {
      rbac.grantRole('user1', 'developer');
      const policy: Policy = {
        effect: 'allow',
        principal: { roles: ['developer'] },
        resource: { paths: ['/config/*'] },
        actions: ['read'],
        conditions: {
          and: [{ attribute: 'principal.email', operator: 'matches', value: '.*@company\\.com$' }],
        },
      };
      rbac.definePolicy('test-policy', policy);

      const context: PolicyContext = {
        principal: { id: 'user1', email: 'user@company.com' },
        resource: { path: '/config/app.json' },
        action: 'read',
      };

      const result = await rbac.evaluatePolicy('test-policy', context);
      expect(result).toBe(true);
    });

    it('should evaluate exists condition', async () => {
      rbac.grantRole('user1', 'developer');
      const policy: Policy = {
        effect: 'allow',
        principal: { roles: ['developer'] },
        resource: { paths: ['/config/*'] },
        actions: ['read'],
        conditions: {
          and: [{ attribute: 'principal.verified', operator: 'exists' }],
        },
      };
      rbac.definePolicy('test-policy', policy);

      const context: PolicyContext = {
        principal: { id: 'user1', verified: true },
        resource: { path: '/config/app.json' },
        action: 'read',
      };

      const result = await rbac.evaluatePolicy('test-policy', context);
      expect(result).toBe(true);
    });

    it('should evaluate OR conditions', async () => {
      rbac.grantRole('user1', 'developer');
      const policy: Policy = {
        effect: 'allow',
        principal: { roles: ['developer'] },
        resource: { paths: ['/config/*'] },
        actions: ['read'],
        conditions: {
          or: [
            { attribute: 'principal.level', operator: 'greaterThan', value: 10 },
            { attribute: 'principal.admin', operator: 'equals', value: true },
          ],
        },
      };
      rbac.definePolicy('test-policy', policy);

      const context: PolicyContext = {
        principal: { id: 'user1', level: 5, admin: true },
        resource: { path: '/config/app.json' },
        action: 'read',
      };

      const result = await rbac.evaluatePolicy('test-policy', context);
      expect(result).toBe(true);
    });

    it('should evaluate NOT condition', async () => {
      rbac.grantRole('user1', 'developer');
      const policy: Policy = {
        effect: 'allow',
        principal: { roles: ['developer'] },
        resource: { paths: ['/config/*'] },
        actions: ['read'],
        conditions: {
          not: { attribute: 'principal.suspended', operator: 'equals', value: true },
        },
      };
      rbac.definePolicy('test-policy', policy);

      const context: PolicyContext = {
        principal: { id: 'user1', suspended: false },
        resource: { path: '/config/app.json' },
        action: 'read',
      };

      const result = await rbac.evaluatePolicy('test-policy', context);
      expect(result).toBe(true);
    });

    it('should deny when condition fails', async () => {
      rbac.grantRole('user1', 'developer');
      const policy: Policy = {
        effect: 'allow',
        principal: { roles: ['developer'] },
        resource: { paths: ['/config/*'] },
        actions: ['write'],
        conditions: {
          and: [{ attribute: 'principal.level', operator: 'greaterThan', value: 10 }],
        },
      };
      rbac.definePolicy('test-policy', policy);

      const context: PolicyContext = {
        principal: { id: 'user1', level: 5 },
        resource: { path: '/config/app.json' },
        action: 'write',
      };

      const result = await rbac.evaluatePolicy('test-policy', context);
      expect(result).toBe(false);
    });
  });

  describe('evaluatePolicy - Deny Effect', () => {
    it('should return false (deny) when effect is deny and conditions match', async () => {
      rbac.grantRole('user1', 'developer');
      const policy: Policy = {
        effect: 'deny',
        principal: { roles: ['developer'] },
        resource: { paths: ['/secrets/*'] },
        actions: ['write'],
      };
      rbac.definePolicy('test-policy', policy);

      const context: PolicyContext = {
        principal: { id: 'user1' },
        resource: { path: '/secrets/api-key' },
        action: 'write',
      };

      const result = await rbac.evaluatePolicy('test-policy', context);
      expect(result).toBe(false); // Deny access
    });

    it('should return true when deny policy conditions do not match', async () => {
      rbac.grantRole('user1', 'viewer');
      const policy: Policy = {
        effect: 'deny',
        principal: { roles: ['developer'] },
        resource: { paths: ['/secrets/*'] },
        actions: ['write'],
      };
      rbac.definePolicy('test-policy', policy);

      const context: PolicyContext = {
        principal: { id: 'user1' },
        resource: { path: '/secrets/api-key' },
        action: 'write',
      };

      const result = await rbac.evaluatePolicy('test-policy', context);
      expect(result).toBe(true); // Policy doesn't apply, so no explicit deny
    });
  });

  describe('Policy Management', () => {
    it('should get all policies', () => {
      const policy1: Policy = {
        effect: 'allow',
        principal: { roles: ['developer'] },
        resource: { paths: ['/config/*'] },
        actions: ['read'],
      };
      const policy2: Policy = {
        effect: 'deny',
        principal: { roles: ['viewer'] },
        resource: { paths: ['/secrets/*'] },
        actions: ['write'],
      };

      rbac.definePolicy('policy1', policy1);
      rbac.definePolicy('policy2', policy2);

      const allPolicies = rbac.getAllPolicies();
      expect(allPolicies.size).toBe(2);
      expect(allPolicies.get('policy1')).toEqual(policy1);
      expect(allPolicies.get('policy2')).toEqual(policy2);
    });

    it('should delete a policy', () => {
      const policy: Policy = {
        effect: 'allow',
        principal: { roles: ['developer'] },
        resource: { paths: ['/config/*'] },
        actions: ['read'],
      };

      rbac.definePolicy('test-policy', policy);
      expect(rbac.getPolicy('test-policy')).toBeDefined();

      const deleted = rbac.deletePolicy('test-policy');
      expect(deleted).toBe(true);
      expect(rbac.getPolicy('test-policy')).toBeUndefined();
    });

    it('should return false when deleting non-existent policy', () => {
      const deleted = rbac.deletePolicy('nonexistent');
      expect(deleted).toBe(false);
    });
  });
});
