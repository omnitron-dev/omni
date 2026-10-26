/** A project's role rank and explicitly inherited capabilities. */
export interface RoleDefinition {
  /** Non-negative integer used for visibility, moderation and assignment. */
  readonly level: number;
  /** Roles included in token expansion. Rank alone does not imply inheritance. */
  readonly inherits?: readonly string[];
  /** False keeps this role out of assignment choices. Defaults to true. */
  readonly assignable?: boolean;
}

/** Browser-safe policy shared by token issuers, verifiers and user interfaces. */
export interface RoleHierarchy {
  readonly priorities: Readonly<Record<string, number>>;
  rolePriority(role: string | null | undefined): number;
  effectiveLevel(roles: readonly string[] | null | undefined): number;
  canSeeRole(actorRoles: readonly string[], targetRole: string): boolean;
  canModerateRole(actorRoles: readonly string[], targetRole: string): boolean;
  visibleRolesFor(actorRoles: readonly string[], candidates: readonly string[]): string[];
  assignableRolesFor(
    actorRoles: readonly string[], candidates: readonly string[], currentRole?: string | null,
  ): string[];
  expandRoles(role: string): string[];
  expandRoleSet(roles: readonly string[]): string[];
}

/**
 * Create an isolated, immutable role policy. Unknown roles have no rank and
 * cannot be viewed, moderated or assigned through these helpers. Expansion
 * preserves unknown claims for applications that also use independent roles;
 * preserving a claim never establishes its authority or service identity.
 *
 * Inheritance is explicit and must be acyclic. Use the same definition for
 * issuance, verification and UI affordances; enforce decisions on the server.
 */
export function createRoleHierarchy(definitions: Readonly<Record<string, RoleDefinition>>): RoleHierarchy {
  const roles = new Map<string, { level: number; inherits: readonly string[]; assignable: boolean }>();
  for (const [name, definition] of Object.entries(definitions)) {
    if (!name || name.trim() !== name) throw new Error('Role names must be non-empty and trimmed');
    if (!definition || !Number.isSafeInteger(definition.level) || definition.level < 0) {
      throw new Error(`Role "${name}" needs a non-negative safe integer level`);
    }
    if (definition.inherits !== undefined && !Array.isArray(definition.inherits)) {
      throw new Error(`Role "${name}" inherits must be an array of role names`);
    }
    if (definition.assignable !== undefined && typeof definition.assignable !== 'boolean') {
      throw new Error(`Role "${name}" assignable must be a boolean`);
    }
    roles.set(name, {
      level: definition.level,
      inherits: [...(definition.inherits ?? [])],
      assignable: definition.assignable ?? true,
    });
  }
  if (roles.size === 0) throw new Error('A role hierarchy needs at least one role');

  const expansions = new Map<string, readonly string[]>();
  const visiting = new Set<string>();
  const expand = (name: string): readonly string[] => {
    const cached = expansions.get(name);
    if (cached) return cached;
    const definition = roles.get(name);
    if (!definition) throw new Error(`Unknown inherited role "${name}"`);
    if (visiting.has(name)) throw new Error(`Role inheritance cycle at "${name}"`);
    visiting.add(name);
    const result = new Set<string>();
    for (const parent of definition.inherits) {
      for (const role of expand(parent)) result.add(role);
    }
    result.add(name);
    visiting.delete(name);
    const ordered = Object.freeze([...result]);
    expansions.set(name, ordered);
    return ordered;
  };
  for (const name of roles.keys()) expand(name);

  const rolePriority = (role: string | null | undefined): number =>
    role == null ? -1 : (roles.get(role)?.level ?? -1);
  const effectiveLevel = (claims: readonly string[] | null | undefined): number => {
    let level = -1;
    for (const role of claims ?? []) level = Math.max(level, rolePriority(role));
    return level;
  };
  const canSeeRole = (actor: readonly string[], target: string): boolean => {
    const targetLevel = rolePriority(target);
    return targetLevel >= 0 && effectiveLevel(actor) >= targetLevel;
  };
  const canModerateRole = (actor: readonly string[], target: string): boolean => {
    const targetLevel = rolePriority(target);
    return targetLevel >= 0 && effectiveLevel(actor) > targetLevel;
  };
  const expandRoles = (role: string): string[] => [...(expansions.get(role) ?? [role])];
  return Object.freeze({
    priorities: Object.freeze(Object.assign(Object.create(null) as Record<string, number>,
      Object.fromEntries([...roles].map(([name, role]) => [name, role.level])))),
    rolePriority,
    effectiveLevel,
    canSeeRole,
    canModerateRole,
    visibleRolesFor: (actor: readonly string[], candidates: readonly string[]) =>
      candidates.filter(role => canSeeRole(actor, role)),
    assignableRolesFor: (actor: readonly string[], candidates: readonly string[], currentRole?: string | null) =>
      candidates.filter(role => role !== currentRole && roles.get(role)?.assignable === true && canSeeRole(actor, role)),
    expandRoles,
    expandRoleSet: (claims: readonly string[]) => [...new Set(claims.flatMap(expandRoles))],
  });
}
