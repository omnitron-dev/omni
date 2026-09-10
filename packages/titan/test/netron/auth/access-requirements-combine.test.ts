/**
 * How `roles`, `permissions` and `scopes` combine.
 *
 * `validateAccessRequirements` is the single implementation behind both
 * `AuthorizationManager.validateAccess` and the wire/HTTP
 * `enforceMethodAuthorization` path — the divergence between those two was
 * the root of SEC-1, and this is what keeps them from drifting again.
 *
 * The rules are easy to state and easy to get wrong in the other direction,
 * which is why they are pinned rather than merely documented:
 *
 *   roles       ANY-of, flat membership, NO hierarchy
 *   permissions ALL-of, wildcard-aware
 *   scopes      ALL-of
 *   and the three are ANDed with each other
 *
 * The AND between roles and permissions is the one that costs people time. A
 * role list narrower than the set of roles an application grants a permission
 * to silently revokes that grant — the permission still reads as held and the
 * call still fails — and a machine caller carrying roles but no `permissions`
 * claim can never satisfy a `permissions` requirement however privileged its
 * role. Both of those were live defects in a downstream application before
 * the rule was written down on `@Public`.
 */

import { describe, it, expect } from 'vitest';

import { validateAccessRequirements } from '../../../src/netron/auth/utils.js';

const ctx = (roles: string[] = [], permissions: string[] = [], scopes: string[] = []) => ({
  roles,
  permissions,
  scopes,
});

describe('roles', () => {
  it('are ANY-of', () => {
    expect(validateAccessRequirements(ctx(['editor']), { roles: ['admin', 'editor'] }).allowed).toBe(true);
  });

  it('are flat — no hierarchy is implied', () => {
    // A caller presenting only the "higher" role does not satisfy a gate that
    // names the lower one. An application with a hierarchy must expand it
    // when it builds the AuthContext; Netron will not.
    const verdict = validateAccessRequirements(ctx(['superadmin']), { roles: ['user'] });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('Missing required role');
  });

  it('report which ones were missing', () => {
    const verdict = validateAccessRequirements(ctx(['user']), { roles: ['admin', 'moderator'] });
    expect(verdict.details?.['missingRoles']).toEqual(['admin', 'moderator']);
  });
});

describe('permissions', () => {
  it('are ALL-of', () => {
    expect(
      validateAccessRequirements(ctx([], ['a.read']), { permissions: ['a.read', 'a.write'] }).allowed,
    ).toBe(false);
    expect(
      validateAccessRequirements(ctx([], ['a.read', 'a.write']), { permissions: ['a.read', 'a.write'] })
        .allowed,
    ).toBe(true);
  });

  it('are wildcard-aware on the GRANTED side', () => {
    expect(validateAccessRequirements(ctx([], ['a.*']), { permissions: ['a.read'] }).allowed).toBe(true);
  });
});

describe('the AND between them', () => {
  it('refuses a caller holding the permission but not the role', () => {
    // The shape that silently revokes an application's own grant: the
    // permission is held, the role list is narrower, the call fails.
    const verdict = validateAccessRequirements(ctx(['security'], ['admin.audit.view']), {
      roles: ['moderator'],
      permissions: ['admin.audit.view'],
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('Missing required role');
  });

  it('refuses a caller holding the role but carrying no permissions at all', () => {
    // A machine caller: roles from its token, no `permissions` claim. It can
    // never pass a permission requirement, however privileged the role.
    const verdict = validateAccessRequirements(ctx(['admin']), {
      roles: ['admin'],
      permissions: ['admin.users.list'],
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('Missing required permissions');
    expect(verdict.details?.['missingPermissions']).toEqual(['admin.users.list']);
  });

  it('admits only a caller satisfying both', () => {
    expect(
      validateAccessRequirements(ctx(['admin'], ['admin.users.list']), {
        roles: ['admin'],
        permissions: ['admin.users.list'],
      }).allowed,
    ).toBe(true);
  });
});

describe('an empty requirement', () => {
  it('checks nothing rather than refusing everything', () => {
    expect(validateAccessRequirements(ctx(), {}).allowed).toBe(true);
    expect(validateAccessRequirements(ctx(), { roles: [], permissions: [] }).allowed).toBe(true);
  });
});

describe('scopes', () => {
  it('are ALL-of and ANDed with the rest', () => {
    expect(
      validateAccessRequirements(ctx(['user'], [], ['read']), {
        roles: ['user'],
        scopes: ['read', 'write'],
      }).allowed,
    ).toBe(false);
  });
});
