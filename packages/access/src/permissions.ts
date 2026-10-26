/**
 * Application-defined permission keys, scope metadata and matching rules.
 * Keys use dot-separated names chosen by the application, for example
 * `workspace.documents.edit`. A full wildcard grants every key; a suffix
 * wildcard grants descendants only; a concrete key also grants descendants.
 * Matching does not infer tenant ownership, role membership or scope. Callers
 * select the applicable registry and granted keys at the enforcement boundary.
 */

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

/** Scope under which a permission is enforced. */
export type PermissionScope = string;

/** Severity bucket — used by the admin UI to highlight risky perms. */
export type PermissionRisk = 'low' | 'medium' | 'high' | 'critical';

/**
 * One row in an application-owned registry. Scope is descriptive metadata;
 * the type parameter preserves a project's vocabulary across its catalog.
 */
export interface PermissionDefinition<Scope extends PermissionScope = PermissionScope> {
  /** Canonical dot-separated identifier — see grammar above. */
  key: string;
  /** Where the permission is enforced. */
  scope: Scope;
  /** Top-level grouping for UI rendering. */
  domain: string;
  /** Sub-grouping within a domain (e.g. 'Users', 'Roles'). */
  category: string;
  /** Short human-readable label. */
  label: string;
  /** Longer description shown on hover / detail. */
  description: string;
  /** Risk bucket — informational, never affects matching. */
  risk: PermissionRisk;
}

// ---------------------------------------------------------------------------
// MATCHING
// ---------------------------------------------------------------------------

/**
 * Hierarchical grants include descendants (`documents` grants `documents.read`).
 * Explicit grants require an exact key or a suffix wildcard. Explicit mode also
 * preserves the transport convention that `documents.*` matches `documents.`.
 */
export type PermissionMatchMode = 'hierarchical' | 'explicit';

/** Compare one grant without allocating an index. Colons have no special meaning. */
export function permissionGrants(
  granted: string, required: string, mode: PermissionMatchMode = 'hierarchical',
): boolean {
  if (granted === '*' || granted === required) return true;
  if (granted.endsWith('.*')) {
    const prefix = granted.slice(0, -1);
    return required.startsWith(prefix) && (mode === 'explicit' || required.length > prefix.length);
  }
  return mode === 'hierarchical' && required.startsWith(`${granted}.`);
}

/** True if any grant authorises a single key. For repeated checks, compile once. */
export function hasPermission(
  granted: readonly string[], required: string, mode: PermissionMatchMode = 'hierarchical',
): boolean {
  return granted.some(grant => permissionGrants(grant, required, mode));
}

/**
 * Snapshot a grant set for repeated checks. Exact lookup is constant time; prefix
 * lookups depend on the required key's dot boundaries, not the number of grants.
 * No regex, global cache, token parsing or mutable caller state is retained.
 * Rebuild the checker when the authenticated principal's grants change.
 */
export function createPermissionChecker(
  granted: readonly string[], mode: PermissionMatchMode = 'hierarchical',
): (required: string) => boolean {
  const keys = new Set(granted);
  if (keys.has('*')) return () => true;
  return required => {
    if (keys.has(required)) return true;
    for (let dot = required.indexOf('.'); dot !== -1; dot = required.indexOf('.', dot + 1)) {
      const prefix = required.slice(0, dot);
      if (mode === 'hierarchical' && !prefix.endsWith('.*') && keys.has(prefix)) return true;
      if ((mode === 'explicit' || dot < required.length - 1) && keys.has(`${prefix}.*`)) return true;
    }
    return false;
  };
}

/** Empty requirements are satisfied; compile only once for the whole decision. */
export function hasAllPermissions(
  granted: readonly string[], required: readonly string[], mode: PermissionMatchMode = 'hierarchical',
): boolean {
  return required.every(createPermissionChecker(granted, mode));
}

/** An empty requirement list cannot provide a matching alternative. */
export function hasAnyPermission(
  granted: readonly string[], required: readonly string[], mode: PermissionMatchMode = 'hierarchical',
): boolean {
  return required.some(createPermissionChecker(granted, mode));
}

// ---------------------------------------------------------------------------
// VALIDATION
// ---------------------------------------------------------------------------

/**
 * Is a grant recognised by the selected registry? The full wildcard is
 * accepted; a suffix wildcard needs a registered descendant. Concrete keys
 * must exist in the registry. Call this before persisting role grants.
 *
 * Pass the registry restricted to the right scope to enforce that
 * a platform role can't be granted an org-only key or vice versa.
 */
export function isValidPermissionKey(key: string, registry: ReadonlyArray<PermissionDefinition>): boolean {
  if (key === '*') return true;
  if (key.endsWith('.*')) {
    // Wildcard is valid iff at least one concrete key lives under it.
    const prefix = key.slice(0, -1);
    return registry.some((d) => d.key.startsWith(prefix));
  }
  return registry.some((d) => d.key === key);
}

/**
 * Replace wildcard entries with registered keys, retaining concrete grants
 * verbatim. For the complete effective set, including hierarchical descendants,
 * use resolvePermissions. Enforcement uses permissionGrants directly.
 */
export function expandWildcards(
  granted: ReadonlyArray<string>,
  registry: ReadonlyArray<PermissionDefinition>,
): string[] {
  const out = new Set<string>();
  for (const g of granted) {
    if (g === '*') {
      for (const d of registry) out.add(d.key);
    } else if (g.endsWith('.*')) {
      const prefix = g.slice(0, -1);
      for (const d of registry) {
        if (d.key.startsWith(prefix)) out.add(d.key);
      }
    } else {
      out.add(g);
    }
  }
  return Array.from(out);
}

// ---------------------------------------------------------------------------
// FACTORY
// ---------------------------------------------------------------------------

/**
 * Convenience factory used by the per-domain catalog files
 * (`permissions.ts`, `org-permissions.ts`) so each entry stays a
 * single-line declaration. Risk defaults to 'low'.
 */
export function definePermission<const Scope extends PermissionScope>(
  key: string,
  scope: Scope,
  domain: string,
  category: string,
  label: string,
  description: string,
  risk: PermissionRisk = 'low',
): PermissionDefinition<Scope> {
  return { key, scope, domain, category, label, description, risk };
}

/** Registered keys authorised by the grants, in registry order without duplicates. */
export function resolvePermissions(
  granted: readonly string[],
  registry: ReadonlyArray<Pick<PermissionDefinition, 'key'>>,
  mode: PermissionMatchMode = 'hierarchical',
): string[] {
  const allows = createPermissionChecker(granted, mode);
  return [...new Set(registry.filter(({ key }) => allows(key)).map(({ key }) => key))];
}
