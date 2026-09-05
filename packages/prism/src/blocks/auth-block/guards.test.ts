/**
 * The predicates behind "can this person see this".
 *
 * `hasRole` and `hasPermission` are exported from the package root and used
 * to hide and show interface. They fail quietly by construction: a wrong
 * `true` shows a control the user should not have, and a wrong `false` hides
 * one they need, and neither throws.
 *
 * `hasPermission(user, [])` returned `true` before these tests existed — for
 * any user holding at least one permission. The default strategy is `all`,
 * and `[].every()` is `true`: a vacuous truth that reads as "every
 * requirement is met" and means "no requirement was checked". An empty list
 * is not exotic — it is what `permissions.filter(...)` produces when nothing
 * matches, and what a config key set to `[]` produces.
 */

import { describe, it, expect } from 'vitest';

import { hasRole, hasPermission, createConditionalRender } from './guards.js';
import type { AuthUser } from './types.js';

const user = (roles: string[] = [], permissions: string[] = []) =>
  ({ id: 'u1', roles, permissions }) as unknown as AuthUser;

describe('hasRole', () => {
  it('is true when the user holds the role', () => {
    expect(hasRole(user(['admin']), 'admin')).toBe(true);
  });

  it('is false when they do not', () => {
    expect(hasRole(user(['viewer']), 'admin')).toBe(false);
  });

  it('defaults to any-of for a list', () => {
    expect(hasRole(user(['viewer']), ['admin', 'viewer'])).toBe(true);
  });

  it('requires all of them when asked', () => {
    expect(hasRole(user(['viewer']), ['admin', 'viewer'], 'all')).toBe(false);
    expect(hasRole(user(['admin', 'viewer']), ['admin', 'viewer'], 'all')).toBe(true);
  });

  it('grants nothing for an empty requirement, under either strategy', () => {
    // `[].every()` is true. Under `all` that reads as "all requirements met"
    // and means "none were checked".
    expect(hasRole(user(['admin']), [])).toBe(false);
    expect(hasRole(user(['admin']), [], 'all')).toBe(false);
  });

  it('grants nothing to a user with no roles', () => {
    for (const u of [user([]), user(undefined as never), null, undefined]) {
      expect(hasRole(u as AuthUser, 'admin')).toBe(false);
    }
  });
});

describe('hasPermission', () => {
  it('is true when the user holds the permission', () => {
    expect(hasPermission(user([], ['users:read']), 'users:read')).toBe(true);
  });

  it('defaults to all-of for a list — the opposite of hasRole', () => {
    // The asymmetry is deliberate (one of these roles, but all of these
    // permissions) and easy to misread, so it is pinned rather than assumed.
    expect(hasPermission(user([], ['users:read']), ['users:read', 'users:write'])).toBe(false);
    expect(hasPermission(user([], ['users:read', 'users:write']), ['users:read', 'users:write'])).toBe(true);
  });

  it('accepts any-of when asked', () => {
    expect(hasPermission(user([], ['users:read']), ['users:read', 'users:write'], 'any')).toBe(true);
  });

  it('grants nothing for an empty requirement', () => {
    // The defect: this returned true for every user with at least one
    // permission, because the default strategy is `all`.
    expect(hasPermission(user([], ['users:read']), [])).toBe(false);
    expect(hasPermission(user([], ['users:read']), [], 'any')).toBe(false);
  });

  it('grants nothing to a user with no permissions', () => {
    expect(hasPermission(user([], []), 'users:read')).toBe(false);
    expect(hasPermission(null, 'users:read')).toBe(false);
  });
});

describe('createConditionalRender', () => {
  const { canRender } = createConditionalRender(user(['admin'], ['users:read']));

  it('renders when every stated requirement is met', () => {
    expect(canRender({ roles: ['admin'] })).toBe(true);
    expect(canRender({ permissions: ['users:read'] })).toBe(true);
    expect(canRender({ roles: ['admin'], permissions: ['users:read'] })).toBe(true);
  });

  it('withholds when any stated requirement is not', () => {
    expect(canRender({ roles: ['superuser'] })).toBe(false);
    expect(canRender({ roles: ['admin'], permissions: ['users:write'] })).toBe(false);
  });

  it('treats an absent requirement as no requirement — unlike the predicates', () => {
    // Deliberately the opposite reading of an empty list, and correct for
    // this shape: `canRender({})` means "no gate", while
    // `hasPermission(user, [])` means "check these — there are none", which
    // cannot be satisfied. Both are pinned so the difference is visible.
    expect(canRender({})).toBe(true);
    expect(canRender({ roles: [] })).toBe(true);
    expect(canRender({ permissions: [] })).toBe(true);
  });
});
