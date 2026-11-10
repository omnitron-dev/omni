import type { IEcosystemAppEntry, IEcosystemConfig } from '../config/types.js';

/**
 * Strip the `${project}/${stack}/` prefix from a handle key (or
 * leave a bare name untouched). Used to identify "the same physical
 * app under any registration form" so duplicate registrations from
 * stack mode + bare-name RPC paths can be deduplicated.
 *
 * Examples:
 *   effectiveAppName('omni/dev/payments') === 'payments'
 *   effectiveAppName('payments')           === 'payments'
 *   effectiveAppName('a/b/c/payments')     === 'payments'  (last segment)
 */
export function effectiveAppName(key: string): string {
  const idx = key.lastIndexOf('/');
  return idx >= 0 ? key.slice(idx + 1) : key;
}

/**
 * Auto-promote a bare `entry.name` to canonical `${project}/${stack}/${name}`
 * form when the env carries OMNITRON_PROJECT + OMNITRON_STACK. The stack-mode
 * boot path (ProjectService.startStack) already prefixes the name explicitly;
 * this helper closes every other entry point that could otherwise register a
 * bare-name handle which then becomes invisible to the stack-prefix-based
 * UI lookup (ProjectService.toStackInfo filters on `${project}/${stack}/`).
 *
 * Idempotent: if the entry already looks namespaced (or env lacks the keys),
 * the input is returned unchanged. An entry qualified under a DIFFERENT
 * project/stack is preserved too — that's operator intent (cross-project
 * administrative run), not a bug.
 */
export function ensureNamespacedEntry(entry: IEcosystemAppEntry): IEcosystemAppEntry {
  const project = entry.env?.['OMNITRON_PROJECT'];
  const stack = entry.env?.['OMNITRON_STACK'];
  if (!project || !stack) return entry;
  const canonicalPrefix = `${project}/${stack}/`;
  if (entry.name.startsWith(canonicalPrefix)) return entry;
  if (entry.name.includes('/')) return entry;
  return { ...entry, name: `${canonicalPrefix}${entry.name}` };
}

/** An exact address always wins. Only an unqualified request may match a basename. */
export function registeredAppName(requested: string, names: Iterable<string>): string | undefined {
  const matches: string[] = [];
  for (const name of names) {
    if (name === requested) return name;
    if (effectiveAppName(name) === requested) matches.push(name);
  }
  if (matches.length > 1) throw new Error("App name '" + requested + "' is ambiguous — multiple matches: " +
    matches.join(', ') + '. Use the full canonical name.');
  return matches[0];
}

export function withDefaultStack(entry: IEcosystemAppEntry, config: IEcosystemConfig): IEcosystemAppEntry {
  if (!config.project || entry.name.includes('/') || (entry.env?.['OMNITRON_PROJECT'] && entry.env?.['OMNITRON_STACK'])) return entry;
  const stacks = Object.keys(config.stacks ?? {});
  const stack = stacks.includes('dev') ? 'dev' : stacks[0];
  return stack ? { ...entry, env: { ...entry.env, OMNITRON_PROJECT: config.project, OMNITRON_STACK: stack } } : entry;
}

/** Expand declared identities before lookup, so a bare declaration cannot satisfy another stack's address. */
export function configuredStartEntry(requested: string, config: IEcosystemConfig): IEcosystemAppEntry | undefined {
  const entries = config.apps.map(entry => ensureNamespacedEntry(withDefaultStack(entry, config)));
  const name = registeredAppName(requested, entries.map(entry => entry.name));
  return name === undefined ? undefined : entries.find(entry => entry.name === name);
}
