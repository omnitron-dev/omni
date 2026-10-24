/**
 * Permission Engine — single source of truth for permission shape
 * and matching across the platform and organisation scopes.
 *
 * Before this module existed, two parallel systems lived in the
 * codebase: one matcher in `shared/permissions.ts` (simple `.*`
 * wildcard) and another inlined into `dynamic-policy.service.ts`
 * (wildcard segment walk + hierarchical prefix). They had subtly
 * different semantics and drifted over time. The unified rule
 * below captures the union of both behaviours so a single call
 * works regardless of whether the gate is platform- or org-scoped.
 *
 * The canonical permission grammar is:
 *
 *     <scope>.<resource>[.<action>][.<sub>]
 *
 *     scope    = 'admin' | 'site' | 'commerce' | 'org'
 *     resource = users | shops | employees | …
 *     action   = list | view | create | edit | delete | …
 *
 * Wildcards:
 *
 *     '*'                 — grants everything (reserved for owners
 *                           and superadmin)
 *     'admin.*'           — grants every key under `admin.`
 *     'admin.users.*'     — grants every key under `admin.users.`
 *
 * Hierarchical prefix grant: a granted key without a trailing star
 * also grants every key one level below it. So `'org.employees'`
 * grants `'org.employees.view'`. This is the semantics the org
 * policy engine has always relied on; it is now applied uniformly
 * to platform checks too.
 */

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

/** Scope under which a permission is enforced. */
export type PermissionScope = 'platform' | 'org';

/** Severity bucket — used by the admin UI to highlight risky perms. */
export type PermissionRisk = 'low' | 'medium' | 'high' | 'critical';

/**
 * One row in the permission registry. Identical shape for platform
 * and organisation permissions — only `scope` differs.
 */
export interface PermissionDefinition {
  /** Canonical dot-separated identifier — see grammar above. */
  key: string;
  /** Where the permission is enforced. */
  scope: PermissionScope;
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
 * Does the `granted` key authorise the `required` key?
 *
 * Returns `true` when:
 *   - granted === '*'                          (full wildcard)
 *   - granted === required                     (exact match)
 *   - granted ends in '.*' and required starts with the prefix
 *   - granted is an ancestor prefix of required (hierarchical grant)
 */
export function permissionGrants(granted: string, required: string): boolean {
  if (granted === '*') return true;
  if (granted === required) return true;

  // Suffix wildcard: 'admin.users.*' grants 'admin.users.ban'
  if (granted.endsWith('.*')) {
    const prefix = granted.slice(0, -1); // 'admin.users.'
    return required.startsWith(prefix) && required.length > prefix.length;
  }

  // Hierarchical prefix grant: 'org.employees' grants 'org.employees.invite'
  return required.startsWith(`${granted}.`);
}

/** True if any granted entry authorises `required`. */
export function hasPermission(granted: ReadonlyArray<string>, required: string): boolean {
  if (granted.length === 0) return false;
  for (const g of granted) {
    if (permissionGrants(g, required)) return true;
  }
  return false;
}

/** True if every entry in `required` is authorised by some granted entry. */
export function hasAllPermissions(
  granted: ReadonlyArray<string>,
  required: ReadonlyArray<string>,
): boolean {
  for (const r of required) {
    if (!hasPermission(granted, r)) return false;
  }
  return true;
}

/** True if at least one entry in `required` is authorised. */
export function hasAnyPermission(
  granted: ReadonlyArray<string>,
  required: ReadonlyArray<string>,
): boolean {
  for (const r of required) {
    if (hasPermission(granted, r)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// VALIDATION
// ---------------------------------------------------------------------------

/**
 * Is `key` syntactically a valid permission string against the
 * given registry? Wildcards are always considered valid; concrete
 * keys must exist in the registry. Used by `createRole` /
 * `updateRole` validation to refuse typos before they get persisted.
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
 * Expand wildcard entries to the concrete keys they grant — used
 * for DISPLAY only. Matching never expands; it goes directly
 * through {@link permissionGrants}.
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
export function definePermission(
  key: string,
  scope: PermissionScope,
  domain: string,
  category: string,
  label: string,
  description: string,
  risk: PermissionRisk = 'low',
): PermissionDefinition {
  return { key, scope, domain, category, label, description, risk };
}
