import { createRoleHierarchy } from '@omnitron-dev/access/roles';

/**
 * Omnitron RBAC Roles
 *
 * Three-tier role hierarchy for the daemon RPC services:
 *   admin    → full access (shutdown, secrets, backup, k8s, config)
 *   operator → operational access (start/stop/restart/scale apps, deploy)
 *   viewer   → read-only access (list, status, logs, metrics, health)
 *
 * The user's role is stored in omnitron_users.role and included in JWT claims.
 * The Netron token validator resolves human roles from the live account and
 * session; JWT role claims cannot preserve revoked privileges. Service
 * decorators then enforce AuthContext.roles.
 */

/** All valid daemon roles, ordered by privilege level (highest first). */
export const ROLES = {
  ADMIN: 'admin',
  OPERATOR: 'operator',
  VIEWER: 'viewer',
} as const;

export type OmnitronRole = (typeof ROLES)[keyof typeof ROLES];

export function isOmnitronRole(value: unknown): value is OmnitronRole {
  return value === 'viewer' || value === 'operator' || value === 'admin';
}

export const ROLE_DESCRIPTIONS = [
  { role: 'viewer', label: 'Viewer', description: 'Read operational status, logs, metrics and health.' },
  { role: 'operator', label: 'Operator', description: 'Viewer access plus application and deployment operations.' },
  { role: 'admin', label: 'Administrator', description: 'Control-plane configuration, accounts, secrets and SSH terminals.' },
] as const;

/** Daemon vocabulary is independent of the optional application platform preset. */
const rolePolicy = createRoleHierarchy({
  viewer: { level: 1 },
  operator: { level: 2, inherits: ['viewer'] },
  admin: { level: 3, inherits: ['operator'] },
});

/**
 * Minimum-rank helper for daemon human roles. Wire gates still use the explicit
 * lists below. Service identity is never inferred from human rank.
 */
export function hasMinimumRole(userRoles: string[], minimumRole: OmnitronRole): boolean {
  return rolePolicy.canSeeRole(userRoles, minimumRole);
}

/** Roles that can view (read-only) — admin + operator + viewer */
export const VIEWER_ROLES: OmnitronRole[] = ['admin', 'operator', 'viewer'];
/** Roles that can operate (start/stop/deploy) — admin + operator */
export const OPERATOR_ROLES: OmnitronRole[] = ['admin', 'operator'];

/**
 * An operator, or another omnitron acting on its own behalf.
 *
 * A master reaches its nodes with a `service_role` token minted from the
 * node's own signing secret — no session, no human. The replication
 * endpoints have always listed the role explicitly; anything else the
 * control plane asks a node to do needs it too, and spelling it out three
 * times is how one of them ends up without it.
 *
 * Measured: `provisionStack` was declared OPERATOR_ROLES, so the master's
 * own credential could not call the method that exists for the master to
 * call — `Missing required role`, from a node that had just authenticated
 * that very credential.
 *
 * Not `OmnitronRole[]`, deliberately. That type is the human hierarchy —
 * admin > operator > viewer — and `service_role` has no place in an
 * ordering: it is not more than an operator or less than one, it is a
 * different kind of principal. Typing it into the hierarchy would make
 * `hasRole('service_role', 'viewer')` a question with an answer.
 */
export const CONTROL_PLANE_ROLES: string[] = ['admin', 'operator', 'service_role'];

/**
 * A read a master may make about a node it drives.
 *
 * `VIEWER_ROLES` is the human hierarchy, and `service_role` is not in it —
 * so a master could TELL a node to provision its infrastructure and could
 * not ASK what it had provisioned. `provisionStack` answered; the read-only
 * `getConnectionInfo` beside it answered `Missing required role`, from a
 * node that had just authenticated the same credential for the strictly more
 * powerful call.
 *
 * The docblock above predicted this exactly — "anything else the control
 * plane asks a node to do needs it too, and spelling it out three times is
 * how one of them ends up without it" — and it happened again on the reading
 * half, which is why the reads now have a name of their own rather than a
 * third hand-written list.
 *
 * Reads that hand out CREDENTIALS are not in here. They belong to
 * `CONTROL_PLANE_ROLES`, where the human tier starts at operator.
 */
export const CONTROL_PLANE_READ_ROLES: string[] = ['admin', 'operator', 'viewer', 'service_role'];
/** Roles that can administer (shutdown, secrets, backup) — admin only */
export const ADMIN_ROLES: OmnitronRole[] = ['admin'];
