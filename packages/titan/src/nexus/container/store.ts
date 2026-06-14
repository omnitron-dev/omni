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

/**
 * Shared, mutable resolution state owned by a single container instance.
 */
export interface ContainerStore {
  /** Singleton instance cache (token → instance). */
  readonly instances: Map<InjectionToken<any>, any>;
  /** Per-scope instance caches (scopeId → token → instance). */
  readonly scopedInstances: Map<string, Map<InjectionToken<any>, any>>;
  /** Lifecycle/event manager for cache-hit and disposal signalling. */
  readonly lifecycleManager: LifecycleManager;
}
