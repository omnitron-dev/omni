import { describe, it, expect, beforeEach } from 'vitest';
import { PermissionManager, PermissionError } from '../../../src/security/permissions.js';

describe('PermissionManager', () => {
  let pm: PermissionManager;

  beforeEach(() => {
    pm = new PermissionManager();
  });

  it('should add and check permissions', () => {
    pm.addPermission('config:read');
    expect(pm.hasPermission('config:read')).toBe(true);
    expect(pm.hasPermission('config:write')).toBe(false);
  });

  it('should remove permissions', () => {
    pm.addPermission('config:read');
    pm.removePermission('config:read');
    expect(pm.hasPermission('config:read')).toBe(false);
  });

  it('should check action on resource', () => {
    pm.addPermission('config:read');
    expect(pm.can({ resource: 'config', action: 'read' })).toBe(true);
    expect(pm.can({ resource: 'config', action: 'write' })).toBe(false);
  });

  it('should handle admin permission', () => {
    pm.addPermission('environment:admin');
    expect(pm.hasAdminPermission()).toBe(true);
    expect(pm.hasPermission('config:read')).toBe(true);
  });

  it('should assert permission', () => {
    pm.addPermission('config:read');
    expect(() => pm.assert('config:read')).not.toThrow();
    expect(() => pm.assert('config:write')).toThrow(PermissionError);
  });

  it('should check all permissions', () => {
    pm.addPermission('config:read');
    pm.addPermission('config:write');
    expect(pm.hasAll(['config:read', 'config:write'])).toBe(true);
    expect(pm.hasAll(['config:read', 'secret:read'])).toBe(false);
  });

  it('should check any permission', () => {
    pm.addPermission('config:read');
    expect(pm.hasAny(['config:read', 'secret:read'])).toBe(true);
    expect(pm.hasAny(['secret:read', 'secret:write'])).toBe(false);
  });
});
