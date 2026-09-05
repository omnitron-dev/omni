/**
 * Omnitron RBAC Roles
 *
 * Three-tier role hierarchy for the daemon RPC services:
 *   admin    → full access (shutdown, secrets, backup, k8s, config)
 *   operator → operational access (start/stop/restart/scale apps, deploy)
 *   viewer   → read-only access (list, status, logs, metrics, health)
 *
 * The user's role is stored in omnitron_users.role and included in JWT claims.
 * The Netron auth middleware extracts roles from the JWT payload and sets
 * them in AuthContext.roles — service decorators then enforce access.
 */

/** All valid daemon roles, ordered by privilege level (highest first). */
export const ROLES = {
  ADMIN: 'admin',
  OPERATOR: 'operator',
  VIEWER: 'viewer',
} as const;

export type OmnitronRole = (typeof ROLES)[keyof typeof ROLES];

/** Role hierarchy: admin > operator > viewer */
const ROLE_HIERARCHY: Record<string, number> = {
  admin: 3,
  operator: 2,
  viewer: 1,
};

/**
 * Check if a user's roles satisfy the minimum required role.
 * Uses hierarchical comparison: admin satisfies operator, operator satisfies viewer, etc.
 */
/**
 * Whether any of `userRoles` ranks at or above `minimumRole`.
 *
 * NOT on the request path, and deliberately kept: `@Public({ auth: { roles }})`
 * takes an explicit list, and the three lists below are what every method
 * declares. This function is the only place the rank order is written down,
 * which makes it useful for reading — and a trap for anyone who assumes the
 * wire enforces a minimum. It does not: it enforces membership of a list.
 *
 * The difference shows when a role is added. `service_role` — named on
 * `OmnitronSync`'s methods — has no entry in ROLE_HIERARCHY, so it ranks 0
 * here, and it is absent from all three lists, so it is permitted nowhere.
 * Both answers happen to be safe; neither is a decision anyone made.
 */
export function hasMinimumRole(userRoles: string[], minimumRole: OmnitronRole): boolean {
  const requiredLevel = ROLE_HIERARCHY[minimumRole] ?? 0;
  return userRoles.some((role) => (ROLE_HIERARCHY[role] ?? 0) >= requiredLevel);
}

/** Roles that can view (read-only) — admin + operator + viewer */
export const VIEWER_ROLES: OmnitronRole[] = ['admin', 'operator', 'viewer'];
/** Roles that can operate (start/stop/deploy) — admin + operator */
export const OPERATOR_ROLES: OmnitronRole[] = ['admin', 'operator'];
/** Roles that can administer (shutdown, secrets, backup) — admin only */
export const ADMIN_ROLES: OmnitronRole[] = ['admin'];
