/**
 * Shared @xec-sh/ops and @xec-sh/core dynamic loaders.
 *
 * Centralises the lazy-import + caching pattern so every service that
 * uses xec packages shares a single module resolution.
 */

let _xecOps: typeof import('@xec-sh/ops') | null | undefined;
let _xecCore: typeof import('@xec-sh/core') | null | undefined;

/**
 * Lazily load `@xec-sh/ops`. Returns `null` when the package is not installed.
 * The result is cached after the first call.
 */
export async function loadXecOps(): Promise<typeof import('@xec-sh/ops') | null> {
  if (_xecOps !== undefined) return _xecOps;
  try {
    _xecOps = await import('@xec-sh/ops');
    return _xecOps;
  } catch {
    _xecOps = null;
    return null;
  }
}

/**
 * Lazily load `@xec-sh/core`. Returns `null` when the package is not installed.
 * The result is cached after the first call.
 */
export async function loadXecCore(): Promise<typeof import('@xec-sh/core') | null> {
  if (_xecCore !== undefined) return _xecCore;
  try {
    _xecCore = await import('@xec-sh/core');
    return _xecCore;
  } catch {
    _xecCore = null;
    return null;
  }
}
