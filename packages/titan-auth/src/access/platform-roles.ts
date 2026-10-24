/**
 * Role-hierarchy primitives — single source of truth.
 *
 * Pure, side-effect-free, browser-safe. Imported by:
 *   - Backend services (apps/main/users.service.ts)
 *   - Backend repositories (apps/main/database/repositories/user.repository.ts)
 *   - the users row rule in apps/main/modules/rbac/ROW-RULES.md (the RLS
 *     schema itself no longer carries it — the plugin does not execute a
 *     row-based policy on this codebase's query path)
 *   - Frontend admin UI (apps/portal/src/pages/admin/users.tsx)
 *
 * Keeping the constants and predicates in ONE module is the
 * invariant: a JS/TS-side tier check on the portal MUST agree
 * with the SQL CASE expression the repository builds and the
 * RLS policy the database enforces, otherwise the UI would
 * surface actions the backend silently rejects (or hide actions
 * the backend would have permitted — a confusing UX bug).
 *
 * Hierarchy (lowest → highest):
 *   user (0) < moderator (1) < security (2) < admin (3) < superadmin (4)
 *
 * `boss` was removed in migration 113 — it duplicated `user`'s
 * platform grants verbatim, and org-owner authority lives in the
 * `owner` org-role-template assignment (employees.roleIds[]), not
 * in the platform role.
 *
 * Visibility:  actor >= target  → can SEE  (peers see each other)
 * Moderation:  actor >  target  → can MODIFY (no horizontal mutations)
 */

export const ROLE_PRIORITY: Readonly<Record<string, number>> = Object.freeze({
  user: 0,
  moderator: 1,
  security: 2,
  admin: 3,
  superadmin: 4,
});

/**
 * Numeric priority of `role`. Unknown roles map to `-1` — guards
 * against future role additions misspelled in JWT claims.
 */
export function rolePriority(role: string | null | undefined): number {
  if (!role) return -1;
  return ROLE_PRIORITY[role] ?? -1;
}

/** Highest priority among a role set. Empty / null → -1. */
export function effectiveLevel(roles: readonly string[] | null | undefined): number {
  if (!roles || roles.length === 0) return -1;
  let max = -1;
  for (const r of roles) {
    const p = ROLE_PRIORITY[r];
    if (p !== undefined && p > max) max = p;
  }
  return max;
}

/**
 * Visibility test (peers included): `actor.level >= target.level`.
 * Admin sees peer admins; superadmin sees peer superadmins.
 */
export function canSeeUserWithRole(actorRoles: readonly string[], targetRole: string): boolean {
  return effectiveLevel(actorRoles) >= rolePriority(targetRole);
}

/**
 * Moderation test (no horizontal mutations): `actor.level > target.level`.
 * An admin cannot ban a peer admin — only a superadmin can. Self-edit is
 * handled by callers; this predicate is purely about hierarchy.
 */
export function canModerateUserWithRole(actorRoles: readonly string[], targetRole: string): boolean {
  return effectiveLevel(actorRoles) > rolePriority(targetRole);
}

/**
 * Filter a list of role names down to those the actor may VIEW.
 * Peer-inclusive (uses `canSeeUserWithRole` rule: `actor.level >=
 * candidate.level`). Used by anything that *displays* roles to the
 * caller — filter dropdowns, the /admin/roles list, role-tag
 * caches — so an admin never sees `superadmin` as an option.
 *
 * Pure: returned array preserves input order; the source array is
 * untouched.
 */
export function visibleRolesFor(
  actorRoles: readonly string[],
  candidateRoles: readonly string[],
): string[] {
  const level = effectiveLevel(actorRoles);
  return candidateRoles.filter((r) => rolePriority(r) <= level);
}

/**
 * Filter a list of role names down to those the actor may ASSIGN
 * to a target. Peer-inclusive rule: `actor.level >= candidate.level`.
 * An admin (level 3) can assign anything up to and including
 * `admin` — so admin → admin promotion (and superadmin → superadmin
 * bootstrap) works through the same code path.
 *
 * The "no horizontal mutation" guardrail still holds, but it lives
 * elsewhere: `canModerateUserWithRole(actor, target.currentRole)`
 * (strict `>`) gates *whether the actor may touch this user at
 * all* before the role change is even considered. So:
 *
 *   - admin can PROMOTE a user → admin                (allowed)
 *   - admin can DEMOTE  a peer admin → user           (BLOCKED by
 *     the target-tier gate in `assertCanModerate`, not here)
 *   - superadmin → superadmin bootstrap               (allowed)
 *   - moderator can PROMOTE user → moderator          (allowed)
 *
 * Optional `currentTargetRole` strips the target's current role
 * from the result so the "Change Role" select doesn't show the
 * already-selected option as a change.
 *
 * Pure: returned array preserves input order.
 */
export function assignableRolesFor(
  actorRoles: readonly string[],
  candidateRoles: readonly string[],
  currentTargetRole?: string | null,
): string[] {
  const level = effectiveLevel(actorRoles);
  return candidateRoles.filter(
    // An UNKNOWN role is unassignable, not universally assignable.
    //
    // `rolePriority` maps anything outside the hierarchy to -1, and the
    // comparison below is `level >= priority`. So before this line every
    // unrecognised string was assignable by EVERYONE — the less the gate
    // understood a role, the more freely it handed it out. An admin was
    // refused 'superadmin' (4 > 3) and granted 'service_role', which is
    // strictly stronger: it is the S2S tier, and on sample it made the holder
    // a service principal on all six backends.
    //
    // The gate exists to answer "may this actor assign this role". For a
    // role it cannot place in the hierarchy the honest answer is no.
    (r) => r !== currentTargetRole && rolePriority(r) >= 0 && level >= rolePriority(r),
  );
}

/**
 * Expand a single platform role into the full set of effective
 * roles per the hierarchy. Admins are ALSO users; superadmins are
 * admins+users; etc.
 *
 * Why this lives here (not on the auth service):
 *
 * The hierarchy is a SYSTEM-WIDE INVARIANT that needs to hold at
 * BOTH ends of the auth boundary:
 *
 *   - Mint side (auth.service.createAccessToken) bakes the
 *     expanded set into the JWT `roles[]` claim so every consumer
 *     reads the full hierarchy without re-deriving it.
 *   - Validate side (shared-session.validateToken) re-applies the
 *     expansion DEFENSIVELY so any JWT entering the system —
 *     legacy tokens with only the singular `role` claim, service-
 *     to-service tokens minted by callers that forgot to expand,
 *     test fixtures, etc. — also surfaces with the full set.
 *
 * Without the validate-side fallback, a stale or alternate JWT
 * minted with `role: 'admin'` only would reach the netron auth
 * gate carrying just `['admin']`. A `@Public({ roles: ['user'] })`
 * RPC would then reject with "Missing required role" because the
 * gate does flat `roles.includes('user')` — no hierarchy.
 *
 * Special-casing:
 *   - `service_role` is intentionally NOT expanded. It's a
 *     side-channel for trusted backend-to-backend calls and
 *     shouldn't implicitly grant user-tier permissions.
 *   - Unknown roles pass through verbatim (forward-compat for
 *     roles added later than the hierarchy table).
 */
export function expandRoles(platformRole: string): string[] {
  switch (platformRole) {
    case 'superadmin':
      return ['user', 'moderator', 'security', 'admin', 'superadmin'];
    case 'admin':
      return ['user', 'moderator', 'security', 'admin'];
    case 'security':
      return ['user', 'security'];
    case 'moderator':
      return ['user', 'moderator'];
    case 'user':
      return ['user'];
    case 'service_role':
      return ['service_role'];
    // `boss` (legacy): treat as plain user. Stale JWT tokens minted
    // pre-migration-113 will pass through here harmlessly until they
    // expire; the underlying users row was already demoted in 113.
    case 'boss':
      return ['user'];
    default:
      return [platformRole];
  }
}

/**
 * Apply `expandRoles` over a set of roles, de-duplicating the
 * union. Used by the JWT-validate path so a token carrying any
 * mix of roles (singular `role`, partial `roles[]`, etc.) lands
 * with the full effective set.
 */
export function expandRoleSet(roles: readonly string[]): string[] {
  if (roles.length === 0) return [];
  const seen = new Set<string>();
  for (const role of roles) {
    for (const expanded of expandRoles(role)) seen.add(expanded);
  }
  return Array.from(seen);
}
