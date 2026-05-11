/**
 * Module-scope tracking for the Nexus DI container.
 *
 * `checkModuleAccess` enforces NestJS-style module encapsulation: a provider
 * can only resolve dependencies declared in modules its parent has explicitly
 * imported (or that are exported / global). To make that decision we need to
 * know "what module is the current resolution chain running on behalf of".
 *
 * The old implementation kept this value on a `__resolvingModule` field
 * mutated DIRECTLY on the resolution context object — saved before each
 * recursive step, restored in a `finally`. The pattern is correct in theory
 * but accidentally fragile in practice:
 *
 *   - Two concurrent async chains that happen to land on the same context
 *     reference (the default AsyncLocalStorage store, or a shared
 *     `defaultContext` fallback) would each clobber the other's value across
 *     an `await` boundary.
 *   - A future caller forgetting the save/restore dance (or a thrown error
 *     escaping the `finally`) silently leaks the value to the surrounding
 *     chain, producing false-positive `forbidden` errors at access checks
 *     for the next resolution that happens to land on the leaked value.
 *
 * AsyncLocalStorage gives us first-class scope isolation: each chain has its
 * own snapshot, mutation is impossible by construction, and exiting a `.run`
 * automatically pops the scope even on uncaught throws.
 *
 * Read with `getResolvingModule()`. Enter a new scope with
 * `runInModuleScope(moduleName, fn)`. Both APIs are intentionally narrow —
 * callers should never reach for `als` directly.
 *
 * @internal
 * @since 0.1.0
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage<string>();

/**
 * Returns the module currently driving resolution, or `undefined` when
 * resolution is happening directly from the main container (no enclosing
 * module-scope frame). Used by `checkModuleAccess` to enforce visibility
 * rules.
 */
export function getResolvingModule(): string | undefined {
  return als.getStore();
}

/**
 * Run `fn` with `moduleName` as the current resolving module.
 *
 * Synchronous shape returns `R`; if `fn` returns a Promise, awaits inside the
 * scope continue to see `moduleName` (AsyncLocalStorage propagates across
 * awaits within the chain). Exiting the call — by return, by throw, or by
 * resolution of the returned Promise — restores the previous scope.
 */
export function runInModuleScope<R>(moduleName: string, fn: () => R): R {
  return als.run(moduleName, fn);
}
