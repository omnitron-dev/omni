import { describe, expect, it } from 'vitest';
import { createRoleHierarchy, type RoleDefinition } from './role-hierarchy.js';
import {
  assignableRolesFor, canModerateUserWithRole, canSeeUserWithRole,
  effectiveLevel, expandRoleSet, expandRoles, rolePriority, visibleRolesFor,
} from './platform-roles.js';
import { definePermission, resolvePermissions, type PermissionDefinition } from './permissions.js';

describe('application-owned role hierarchies', () => {
  const editorial = createRoleHierarchy({
    reader: { level: 0 },
    author: { level: 10, inherits: ['reader'] },
    reviewer: { level: 20, inherits: ['reader'] },
    editor: { level: 30, inherits: ['author', 'reviewer'] },
    owner: { level: 40, inherits: ['editor'], assignable: false },
  });

  it('separates rank from capability inheritance and deduplicates diamond inheritance', () => {
    expect(editorial.canModerateRole(['reviewer'], 'author')).toBe(true);
    expect(editorial.expandRoles('reviewer')).toEqual(['reader', 'reviewer']);
    expect(editorial.expandRoles('editor')).toEqual(['reader', 'author', 'reviewer', 'editor']);
    expect(editorial.expandRoleSet(['author', 'editor', 'auditor'])).toEqual([
      'reader', 'author', 'reviewer', 'editor', 'auditor',
    ]);
    expect(editorial.rolePriority('auditor')).toBe(-1);
  });

  it('allows visible peers while refusing horizontal mutations and nonassignable roles', () => {
    expect(editorial.canSeeRole(['editor'], 'editor')).toBe(true);
    expect(editorial.canModerateRole(['editor'], 'editor')).toBe(false);
    expect(editorial.visibleRolesFor(['owner'], ['reader', 'owner', 'root'])).toEqual(['reader', 'owner']);
    expect(editorial.assignableRolesFor(['owner'], ['reader', 'owner', 'editor'], 'reader')).toEqual(['editor']);
  });

  it('isolates two projects that reuse a role name with different meanings', () => {
    const automation = createRoleHierarchy({
      reader: { level: 50 },
      deployer: { level: 100, inherits: ['reader'] },
    });
    expect(automation.rolePriority('reader')).toBe(50);
    expect(editorial.rolePriority('reader')).toBe(0);
    expect(automation.expandRoles('deployer')).toEqual(['reader', 'deployer']);
    expect(editorial.rolePriority('deployer')).toBe(-1);
    expect(automation.rolePriority('editor')).toBe(-1);
  });

  it('takes a snapshot and never leaks mutable expansion arrays', () => {
    const definitions = { reader: { level: 0 }, editor: { level: 1, inherits: ['reader'] } };
    const policy = createRoleHierarchy(definitions);
    definitions.reader.level = 100;
    definitions.editor.inherits.length = 0;
    policy.expandRoles('editor').push('owner');
    expect(policy.rolePriority('reader')).toBe(0);
    expect(policy.expandRoles('editor')).toEqual(['reader', 'editor']);
    expect(Object.isFrozen(policy.priorities)).toBe(true);
  });

  it.each(['unknown', '', 'constructor', '__proto__', 'toString', 'service_role'])(
    'refuses unregistered role %j at every hierarchy gate', target => {
      expect(editorial.rolePriority(target)).toBe(-1);
      for (const actor of [[], ['unknown'], ['owner']]) {
        expect(editorial.canSeeRole(actor, target)).toBe(false);
        expect(editorial.canModerateRole(actor, target)).toBe(false);
        expect(editorial.visibleRolesFor(actor, [target])).toEqual([]);
        expect(editorial.assignableRolesFor(actor, [target])).toEqual([]);
      }
    },
  );

  it('allows prototype-shaped role names only when explicitly defined', () => {
    const policy = createRoleHierarchy(JSON.parse('{"__proto__":{"level":0},"constructor":{"level":1}}'));
    expect(policy.canModerateRole(['constructor'], '__proto__')).toBe(true);
    expect(policy.rolePriority('toString')).toBe(-1);
  });

  it('rejects cycles, missing inherited roles and invalid ranks during construction', () => {
    expect(() => createRoleHierarchy({ a: { level: 0, inherits: ['b'] }, b: { level: 1, inherits: ['a'] } })).toThrow(/cycle/);
    expect(() => createRoleHierarchy({ a: { level: 0, inherits: ['missing'] } })).toThrow(/Unknown inherited/);
    expect(() => createRoleHierarchy({})).toThrow(/at least one/);
    expect(() => createRoleHierarchy({ ' ': { level: 0 } })).toThrow(/names/);
    for (const level of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createRoleHierarchy({ reader: { level } })).toThrow(/integer level/);
    }
    expect(() => createRoleHierarchy({ reader: { level: 0, inherits: 'reader' } as unknown as RoleDefinition })).toThrow(/inherits/);
  });
});

describe('compatible platform preset', () => {
  it('keeps the existing five roles, service claims and retired user alias', () => {
    expect(expandRoles('superadmin')).toEqual(['user', 'moderator', 'security', 'admin', 'superadmin']);
    expect(expandRoles('security')).toEqual(['user', 'security']);
    expect(expandRoles('boss')).toEqual(['user']);
    expect(expandRoles('service_role')).toEqual(['service_role']);
    expect(expandRoleSet(['boss', 'security', 'admin'])).toEqual(['user', 'security', 'moderator', 'admin']);
    expect(rolePriority('boss')).toBe(-1);
    expect(rolePriority('service_role')).toBe(-1);
    expect(effectiveLevel(['admin', 'service_role'])).toBe(3);
    expect(assignableRolesFor(['admin'], ['user', 'admin', 'superadmin', 'service_role'])).toEqual(['user', 'admin']);
  });

  it.each(['unknown', '', 'boss', 'service_role', 'constructor', '__proto__'])(
    'does not turn an unknown target %j into a low-privilege account', target => {
      expect(canSeeUserWithRole([], target)).toBe(false);
      expect(canSeeUserWithRole(['superadmin'], target)).toBe(false);
      expect(canModerateUserWithRole(['admin'], target)).toBe(false);
      expect(visibleRolesFor(['superadmin'], ['user', target])).toEqual(['user']);
    },
  );
});

describe('application-owned permission catalogs', () => {
  it('retains a custom scope type and resolves hierarchical grants in registry order', () => {
    const edit = definePermission('workspace.documents.edit', 'workspace', 'documents', 'content', 'Edit', 'Edit a document');
    const typed: PermissionDefinition<'workspace'> = edit;
    expect(typed.scope).toBe('workspace');
    const registry = [
      edit,
      definePermission('workspace.documents.read', 'workspace', 'documents', 'content', 'Read', 'Read a document'),
      definePermission('workspace.billing.read', 'billing', 'billing', 'account', 'Read', 'Read billing'),
      edit,
    ];
    expect(resolvePermissions(['workspace.documents'], registry)).toEqual(['workspace.documents.edit', 'workspace.documents.read']);
    expect(resolvePermissions(['workspace.documents.*', 'missing'], registry)).toEqual(['workspace.documents.edit', 'workspace.documents.read']);
    expect(resolvePermissions([], registry)).toEqual([]);
  });
});
