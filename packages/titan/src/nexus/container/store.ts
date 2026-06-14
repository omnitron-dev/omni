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
import type { Registration } from './types.js';

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
}
