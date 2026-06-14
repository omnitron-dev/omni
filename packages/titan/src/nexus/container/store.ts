/**
 * Container Store for Nexus DI Container
 *
 * A typed view over the container's shared resolution state, injected into the
 * otherwise-stateless resolution services (NX-9). Before this, those services
 * took the container's internals — the `instances` / `scopedInstances` caches,
 * the `lifecycleManager` — as 5–6 positional arguments on EVERY call, which both
 * obscured each method's real inputs and coupled callers to the exact field
 * layout. The container owns these structures; the store just hands the services
 * stable references to them.
 *
 * Reference safety: the container creates each map once (field initializers) and
 * only ever mutates them (`set`/`delete`/`clear`) — never reassigns — so a
 * reference captured at construction stays valid for the container's lifetime.
 *
 * @internal
 * @since 0.1.0
 */

import type { InjectionToken } from '../types.js';
import type { LifecycleManager } from '../lifecycle.js';
import type { Registration, ModuleProviderInfo } from './types.js';
import type { Dependency } from './injection-plan.js';

/**
 * The container's internal interface for its resolution services: the shared
 * mutable caches it owns, plus the core resolution hook(s) the services call
 * back into. Injecting this once replaces both the state arguments AND the
 * callbacks (e.g. `createInstanceFn`) that were previously threaded through
 * every service method positionally.
 */
export interface ContainerStore {
  /** Singleton instance cache (token → instance). */
  readonly instances: Map<InjectionToken<any>, any>;
  /** Per-scope instance caches (scopeId → token → instance). */
  readonly scopedInstances: Map<string, Map<InjectionToken<any>, any>>;
  /** Lifecycle/event manager for cache-hit and disposal signalling. */
  readonly lifecycleManager: LifecycleManager;
  /**
   * Materialise an instance for a registration (construct + inject deps). This
   * is the recursive hook back into the container; services call it instead of
   * receiving it as a per-call `createInstanceFn` argument.
   */
  createInstance(registration: Registration): any;
  /**
   * Resolve a token to its instance (the container's recursive sync entry
   * point). Services call this instead of receiving a `resolveFn` callback.
   */
  resolve<T>(token: InjectionToken<T>): T;
  /** Resolve a token, returning undefined instead of throwing if absent. */
  resolveOptional<T>(token: InjectionToken<T>): T | undefined;
  /**
   * Resolve a rich injection descriptor (`@Value`/`@InjectAll`/`@InjectConfig`/
   * `@InjectEnv`/`@ConditionalInject`) — the container's data-driven hook.
   */
  resolveDependency(dep: Dependency): unknown;
  /** Stable string key for a token (used for module-membership lookups). */
  getTokenKey(token: InjectionToken<any>): string;
  /** O(1) module-membership info for a token key, if it belongs to a module. */
  getTokenModuleInfo(
    tokenKey: string
  ): { moduleName: string; isGlobal: boolean; isExported: boolean } | undefined;
  /**
   * The module → (tokenKey → provider) index, or undefined when no modules are
   * loaded. A method (not a property) because the container assigns this map
   * lazily, so callers must read it live rather than capture a stale reference.
   */
  getModuleProviders(): Map<string, Map<string, ModuleProviderInfo>> | undefined;
  /** module name → set of imported module names. */
  readonly moduleImports: Map<string, Set<string>>;
  /** The container's registration table (token → registration(s)). */
  readonly registrations: Map<InjectionToken<any>, Registration | Registration[]>;
  /** In-flight async resolutions, keyed by token (parallel-dedup cache). */
  readonly pendingPromises: Map<InjectionToken<any>, Promise<any>>;
  /** The resolved registration for a token, if any (single, not multi-array). */
  getRegistration(token: InjectionToken<any>): Registration | undefined;
  /** The container's recursive async resolution entry point. */
  resolveAsyncInternal<T>(token: InjectionToken<T>): Promise<T>;
  /** Whether a parent container can provide the token (for optional-dep checks). */
  hasInParent(token: InjectionToken<any>): boolean;
}
