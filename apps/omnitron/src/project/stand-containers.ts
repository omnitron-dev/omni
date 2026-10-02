/** Container environment shared by project tools and release probes. */
import { shellEscape } from '../shared/shell-escape.js';

/**
 * Project tools may already consume <PROJECT>_*_CONTAINER variables. Derive
 * that namespace from the registered project, independently of a custom
 * container prefix, so existing tools continue to work without project names
 * in the runtime. The fallback supports the conventional <project>-<stack>
 * prefix for standalone callers; the daemon always supplies projectName.
 */
export function standContainers(prefix: string, projectName?: string): Readonly<Record<string, string>> {
  const namespace = (projectName ?? prefix.replace(/-[^-]+$/, '')).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  if (!/^[A-Z_][A-Z0-9_]*$/.test(namespace)) {
    throw new Error('A project name must produce a valid environment variable namespace');
  }
  return {
    [`${namespace}_PG_CONTAINER`]: `${prefix}-postgres`,
    [`${namespace}_REDIS_CONTAINER`]: `${prefix}-redis`,
    [`${namespace}_GATEWAY_CONTAINER`]: `${prefix}-gateway`,
  };
}

/** The same, as shell assignments to put before a command. */
export function standContainerAssignments(prefix: string, projectName?: string): string {
  return Object.entries(standContainers(prefix, projectName))
    .map(([k, v]) => `${k}=${shellEscape(v)}`)
    .join(' ');
}
