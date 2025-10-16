import { describe, it, expect, beforeEach } from 'vitest';
import { RBAC } from '../../../src/security/rbac.js';

describe('RBAC', () => {
  let rbac: RBAC;

  beforeEach(() => {
    rbac = new RBAC();
  });

  it('should have default roles', () => {
    expect(rbac.getRole('admin')).toBeDefined();
    expect(rbac.getRole('developer')).toBeDefined();
    expect(rbac.getRole('operator')).toBeDefined();
    expect(rbac.getRole('viewer')).toBeDefined();
  });

  it('should define custom role', () => {
    rbac.defineRole({
      name: 'custom',
      permissions: ['config:read'],
    });
    expect(rbac.getRole('custom')).toBeDefined();
  });

  it('should register and get user', () => {
    rbac.registerUser({ id: 'user1', roles: ['viewer'] });
    expect(rbac.getUser('user1')).toBeDefined();
  });

  it('should assign role to user', () => {
    rbac.registerUser({ id: 'user1', roles: [] });
    rbac.assignRole('user1', 'developer');
    const user = rbac.getUser('user1');
    expect(user?.roles).toContain('developer');
  });

  it('should get user permissions from roles', () => {
    rbac.registerUser({ id: 'user1', roles: ['viewer'] });
    const permissions = rbac.getUserPermissions('user1');
    expect(permissions).toContain('config:read');
  });

  it('should grant direct permission to user', () => {
    rbac.registerUser({ id: 'user1', roles: [] });
    rbac.grantPermission('user1', 'secret:read');
    expect(rbac.hasPermission('user1', 'secret:read')).toBe(true);
  });

  it('should get permission manager for user', () => {
    rbac.registerUser({ id: 'user1', roles: ['developer'] });
    const pm = rbac.getPermissionManager('user1');
    expect(pm.hasPermission('config:read')).toBe(true);
  });

  it('should revoke role from user', () => {
    rbac.registerUser({ id: 'user1', roles: ['developer'] });
    rbac.revokeRole('user1', 'developer');
    const user = rbac.getUser('user1');
    expect(user?.roles).not.toContain('developer');
  });
});
