import { describe, expect, it } from 'vitest';
import { expandRoles, canModerateUserWithRole, assignableRolesFor, permissionGrants, hasAllPermissions, isValidPermissionKey, definePermission } from './index.js';
describe('shared SAMPLE access policy', () => {
  it('separates security and moderation capability while preserving admin inheritance', () => {
    expect(expandRoles('admin')).toEqual(['user','moderator','security','admin']);
    expect(expandRoles('security')).toEqual(['user','security']);
    expect(expandRoles('service_role')).toEqual(['service_role']);
    expect(expandRoles('boss')).toEqual(['user']);
    expect(canModerateUserWithRole(['admin'],'admin')).toBe(false);
    expect(canModerateUserWithRole(['admin'],'security')).toBe(true);
    expect(assignableRolesFor(['user'],['root','admin','service_role'],'user')).toEqual([]);
  });
  it('only matches full permission boundaries and validates against the selected scope', () => {
    expect(permissionGrants('admin.users','admin.users.edit')).toBe(true);
    expect(permissionGrants('admin.user','admin.users.edit')).toBe(false);
    expect(permissionGrants('admin.users.*','admin.users')).toBe(false);
    expect(permissionGrants('admin.users.*','admin.users.edit')).toBe(true);
    expect(hasAllPermissions([],['admin.users.edit'])).toBe(false);
    const registry=[definePermission('site.profile.edit','platform','account','profile','Edit','Edit own profile')];
    expect(isValidPermissionKey('admin.*',registry)).toBe(false);
    expect(isValidPermissionKey('site.*',registry)).toBe(true);
  });
});
