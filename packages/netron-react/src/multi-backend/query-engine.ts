/**
 * MultiBackendQueryEngine — owns the QueryCache + MutationCache
 * for an app wired via `<MultiBackendProvider>`, presenting the
 * narrow `NetronReactClient` interface that the data-fetching
 * hooks (`useQuery`, `useMutation`, `useInfiniteQuery`,
 * `useBackendQuery`, `useBackendMutation`, …) call into.
 *
 * Why this exists: `<NetronProvider>` ships a full `NetronReact-
 * Client` that bundles connection + cache + auth. `<MultiBackend-
 * Provider>` instead receives a `MultiBackendClient` from
 * `@omnitron-dev/netron-browser` that knows how to invoke services
 * across multiple backends but has no cache of its own. Before
 * this engine landed, mounting `useQuery` underneath `<MultiBackend-
 * Provider>` threw `useNetronClient must be used within a
 * NetronProvider` — the multi-backend hooks were effectively
 * unusable without nesting two providers and double-instantiating
 * the cache.
 *
 * The engine is a focused adapter, not a copy of NetronReactClient:
 *   - Holds the single shared QueryCache + MutationCache for the
 *     app, so every component (single-backend or multi-backend)
 *     reads/writes the same store.
 *   - Provides `getQueryCache()` / `getMutationCache()` /
 *     `invalidateQueries()` / `on('reconnect', …)` — the exact
 *     contract `useQuery` + `useMutation` consume.
 *   - Stays transport-agnostic: connection lifecycle still lives
 *     on the wrapped `IMultiBackendClient`, and reconnect events
 *     are forwarded from there.
 *
 * `MultiBackendProvider` instantiates one per mount and parks it
 * in `NetronContext` so downstream hooks read it via the standard
 * `useNetronClient()` path — no special-case branches in the
 * hooks themselves.
 */

import { QueryCache } from '../cache/query-cache.js';
import { MutationCache } from '../cache/mutation-cache.js';
import type { QueryFilters } from '../core/types.js';
import type { IMultiBackendClient, BackendSchema } from '@omnitron-dev/netron-browser';
import type { NetronReactClient } from '../core/client.js';

export interface MultiBackendQueryEngineConfig {
  /** Soft cap on cached entries before LRU eviction kicks in. */
  maxEntries?: number;
  /** Default GC duration for un-observed entries, in ms. */
  defaultCacheTime?: number;
}

/** Minimal event handler signature compatible with
 *  `NetronReactClient.on()` — only `reconnect` is consumed by the
 *  hooks today, but keep the type loose for forward-compat. */
type EngineEvent = 'reconnect';
type EventHandler = () => void;

/**
 * Cache + lifecycle facade behind `<MultiBackendProvider>`. The
 * surface it exposes deliberately mirrors `NetronReactClient` for
 * the subset of methods the data-fetching hooks read, so the
 * hooks themselves can stay client-agnostic.
 */
export class MultiBackendQueryEngine<T extends BackendSchema = BackendSchema> {
  readonly multiClient: IMultiBackendClient<T>;
  private readonly queryCache: QueryCache;
  private readonly mutationCache: MutationCache;
  private readonly listeners = new Map<EngineEvent, Set<EventHandler>>();
  private readonly transportUnsubs: Array<() => void> = [];

  constructor(multiClient: IMultiBackendClient<T>, config: MultiBackendQueryEngineConfig = {}) {
    this.multiClient = multiClient;
    this.queryCache = new QueryCache({
      maxEntries: config.maxEntries ?? 1000,
      defaultCacheTime: config.defaultCacheTime ?? 5 * 60 * 1000,
    });
    this.mutationCache = new MutationCache();
    this.wireTransportEvents();
  }

  // --------------------------------------------------------------------
  // Cache accessors — required by useQuery / useMutation
  // --------------------------------------------------------------------

  getQueryCache(): QueryCache {
    return this.queryCache;
  }

  getMutationCache(): MutationCache {
    return this.mutationCache;
  }

  /**
   * Mark queries stale + drop their cached data so the next
   * mount fires a fresh fetch. Used by `useMutation`'s
   * `invalidateQueries` option and by callers that need to flush
   * data after an external write.
   */
  async invalidateQueries(filters?: QueryFilters): Promise<void> {
    const queries = this.queryCache.findAll(filters);
    for (const query of queries) {
      this.queryCache.invalidate(query.queryKey);
    }
  }

  /**
   * Read data directly out of the cache. Returns `undefined` for
   * unknown keys. Mirrors TanStack's `queryClient.getQueryData()` —
   * useful for optimistic-update flows where the caller wants a
   * snapshot before applying an in-flight mutation.
   */
  getQueryData<T>(queryKey: import('../core/types.js').QueryKey): T | undefined {
    return this.queryCache.get<T>(queryKey);
  }

  /**
   * Write a value into the cache, marking the entry as `success`
   * with a fresh `dataUpdatedAt`. Notifies every observer of the
   * key. Mirrors TanStack's `queryClient.setQueryData()` — useful
   * for optimistic updates and for post-mutation cache priming.
   *
   * Accepts either a direct value or an updater `(prev) => next`
   * to match TanStack's ergonomics for in-place patches.
   */
  setQueryData<T>(
    queryKey: import('../core/types.js').QueryKey,
    updater: T | ((prev: T | undefined) => T),
  ): void {
    const prev = this.queryCache.get<T>(queryKey);
    const data = typeof updater === 'function'
      ? (updater as (prev: T | undefined) => T)(prev)
      : updater;
    this.queryCache.set(queryKey, data);
  }

  /**
   * Cancel any in-flight fetches that match the given filter.
   * Mirrors TanStack's `queryClient.cancelQueries()` — typical use
   * is to pre-empt a refetch that's about to overwrite an
   * optimistic write.
   */
  async cancelQueries(filters?: QueryFilters): Promise<void> {
    this.queryCache.cancelAll(filters);
  }

  // --------------------------------------------------------------------
  // Lifecycle events — required by useQuery (`refetchOnReconnect`)
  // --------------------------------------------------------------------

  /**
   * Subscribe to engine-level lifecycle events. The hook layer
   * only listens for `'reconnect'` today; when any backend in the
   * multi-backend pool fires its own reconnect event, we
   * re-broadcast here so every cached query can revalidate.
   */
  on(event: EngineEvent, handler: EventHandler): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return () => {
      this.listeners.get(event)?.delete(handler);
    };
  }

  off(event: EngineEvent, handler: EventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event: EngineEvent): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        fn();
      } catch {
        /* listener exceptions don't propagate */
      }
    }
  }

  /**
   * Bridge transport-level reconnect events from every backend in
   * the pool to a single engine-level signal. The hook layer
   * stays oblivious to which backend reconnected; from its
   * perspective "any reconnect" is enough to revalidate stale
   * queries.
   *
   * `IMultiBackendClient.on('reconnect', …)` aggregates per-
   * backend WS reconnects (HTTP-only backends are silently
   * skipped — they have no reconnect semantic). If the client
   * implementation predates the event API we degrade gracefully:
   * the engine still works, just without auto-reconnect refetch.
   */
  private wireTransportEvents(): void {
    const candidate = this.multiClient as unknown as {
      on?: (event: 'reconnect' | 'disconnect', handler: (backend: string) => void) => (() => void) | void;
    };
    if (typeof candidate.on !== 'function') return;
    const unsub = candidate.on('reconnect', () => this.emit('reconnect'));
    if (typeof unsub === 'function') {
      this.transportUnsubs.push(unsub);
    }
  }

  /**
   * Tear down everything we created — cache, mutation store,
   * listeners. Called by `MultiBackendProvider` on unmount.
   */
  destroy(): void {
    this.queryCache.destroy();
    this.mutationCache.clear();
    this.listeners.clear();
    for (const unsub of this.transportUnsubs) {
      try {
        unsub();
      } catch {
        /* ignore */
      }
    }
    this.transportUnsubs.length = 0;
  }
}

/**
 * Cast helper — `NetronContext` is typed against
 * `NetronReactClient`, but the engine implements the same narrow
 * contract the hooks read. We cast at the provider boundary so
 * downstream `useNetronClient()` returns a useable value without
 * loosening the public type.
 */
export function asNetronReactClient(
  engine: MultiBackendQueryEngine<BackendSchema>,
): NetronReactClient {
  return engine as unknown as NetronReactClient;
}
