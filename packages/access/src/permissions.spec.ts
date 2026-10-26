import { describe, expect, it } from 'vitest';
import { createPermissionChecker, hasAllPermissions, hasAnyPermission, permissionGrants } from './permissions.js';

describe('permission policy compilation', () => {
  const segments = ['', 'read', 'reader', '*', 'a:b', '__proto__'];
  const keys = [...new Set([...segments, ...segments.flatMap(a => segments.flatMap(b => [
    `${a}.${b}`, `${a}.${b}.read`, `${a}.${b}.*`,
  ]))])];

  it.each(['explicit', 'hierarchical'] as const)('agrees with single-grant matching in %s mode', mode => {
    // Exhaustively include empty segments, literal wildcards and prefix collisions.
    for (const grant of keys) {
      const compiled = createPermissionChecker([grant], mode);
      for (const required of keys) {
        expect(compiled(required), `${mode}: ${grant} -> ${required}`).toBe(permissionGrants(grant, required, mode));
      }
    }
    const grants = keys.filter((_, i) => i % 7 === 0 && keys[i] !== '*');
    const compiled = createPermissionChecker(grants, mode);
    for (const required of keys) {
      expect(compiled(required)).toBe(grants.some(grant => permissionGrants(grant, required, mode)));
    }
  });

  it('keeps explicit transport grants distinct from hierarchical application grants', () => {
    expect(createPermissionChecker(['documents'], 'explicit')('documents.read')).toBe(false);
    expect(createPermissionChecker(['documents'], 'hierarchical')('documents.read')).toBe(true);
    expect(createPermissionChecker(['documents.*'], 'explicit')('documents.')).toBe(true);
    expect(createPermissionChecker(['documents.*'], 'hierarchical')('documents.')).toBe(false);
    expect(createPermissionChecker(['documents:read'])('documents:read:all')).toBe(false);
    expect(createPermissionChecker(['documents.read'])('documents.reader')).toBe(false);
  });

  it('snapshots authority without sharing mutable grants across principals', () => {
    const grants = ['documents.read'];
    const before = createPermissionChecker(grants);
    grants.push('*');
    expect(before('billing.write')).toBe(false);
    expect(createPermissionChecker(grants)('billing.write')).toBe(true);
    expect(createPermissionChecker([])('billing.write')).toBe(false);
  });

  it('defines empty and mixed requirement lists consistently', () => {
    expect(hasAllPermissions([], [])).toBe(true);
    expect(hasAnyPermission(['*'], [])).toBe(false);
    expect(hasAllPermissions(['documents.*'], ['documents.read', 'documents.edit'])).toBe(true);
    expect(hasAnyPermission(['documents.read'], ['billing.read', 'documents.read'])).toBe(true);
    expect(hasAllPermissions(['documents'], ['documents.read'], 'explicit')).toBe(false);
  });
});
