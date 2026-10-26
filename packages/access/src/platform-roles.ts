import { createRoleHierarchy } from './role-hierarchy.js';

/**
 * Optional platform preset. Applications with another role vocabulary use
 * createRoleHierarchy; importing the factory does not configure global state.
 * Security and moderation are separate capabilities, even though their ranks
 * differ. Trusted service identities do not belong to this human hierarchy.
 */
const platformDefinitions = {
  user: { level: 0 },
  moderator: { level: 1, inherits: ['user'] },
  security: { level: 2, inherits: ['user'] },
  admin: { level: 3, inherits: ['moderator', 'security'] },
  superadmin: { level: 4, inherits: ['admin'] },
};
export type PlatformRole = keyof typeof platformDefinitions;
export const PLATFORM_ROLES: readonly PlatformRole[] = Object.freeze(Object.keys(platformDefinitions) as PlatformRole[]);
const platformRoleHierarchy = /* @__PURE__ */ createRoleHierarchy(platformDefinitions);

export const ROLE_PRIORITY = platformRoleHierarchy.priorities;

/** Unknown roles have no authority and return -1. */
export function rolePriority(role: string | null | undefined): number {
  return platformRoleHierarchy.rolePriority(role);
}

export function effectiveLevel(roles: readonly string[] | null | undefined): number {
  return platformRoleHierarchy.effectiveLevel(roles);
}

/** Peers may be visible. Unknown targets are always refused. */
export function canSeeUserWithRole(actorRoles: readonly string[], targetRole: string): boolean {
  return platformRoleHierarchy.canSeeRole(actorRoles, targetRole);
}

/** Requires a strictly higher rank; callers separately enforce ownership. */
export function canModerateUserWithRole(actorRoles: readonly string[], targetRole: string): boolean {
  return platformRoleHierarchy.canModerateRole(actorRoles, targetRole);
}

export function visibleRolesFor(actorRoles: readonly string[], candidateRoles: readonly string[]): string[] {
  return platformRoleHierarchy.visibleRolesFor(actorRoles, candidateRoles);
}

/**
 * Assignment choices include peers. First check canModerateUserWithRole against
 * the target's current role before changing it; this list alone is not a gate.
 */
export function assignableRolesFor(
  actorRoles: readonly string[], candidateRoles: readonly string[], currentTargetRole?: string | null,
): string[] {
  return platformRoleHierarchy.assignableRolesFor(actorRoles, candidateRoles, currentTargetRole);
}

/**
 * Expand the platform preset's claims. The retired `boss` claim remains a
 * user-only compatibility alias; it has no independent rank or assignability.
 * Other unknown claims, including service_role, pass through without rank.
 */
export function expandRoles(platformRole: string): string[] {
  return platformRole === 'boss' ? ['user'] : platformRoleHierarchy.expandRoles(platformRole);
}

export function expandRoleSet(roles: readonly string[]): string[] {
  return [...new Set(roles.flatMap(expandRoles))];
}
