/**
 * QueryCache - Manages query state and caching
 */

import type { NetronError } from '@omnitron-dev/netron-browser';
import type { QueryKey, QueryStatus, QueryFilters, Query } from '../core/types.js';
import { hashQueryKey, matchQueryFilters, timeUtils } from './utils.js';

/**
 * Query cache configuration
 */
export interface QueryCacheConfig {
  /** Maximum number of entries */
  maxEntries?: number;
  /** Default cache time in ms */
  defaultCacheTime?: number;
  /** Enable garbage collection */
  gcEnabled?: boolean;
  /** GC interval in ms */
  gcInterval?: number;
}

/**
 * Internal query state
 */
interface QueryState<TData = unknown, TError = unknown> {
  queryKey: QueryKey;
  queryHash: string;
  data: TData | undefined;
  error: TError | null;
  status: QueryStatus;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
  isInvalidated: boolean;
  fetchStatus: 'idle' | 'fetching' | 'paused';
  observers: Set<() => void>;
  gcTimeout?: ReturnType<typeof setTimeout>;
  promise?: Promise<TData>;
  abortController?: AbortController;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<QueryCacheConfig> = {
  maxEntries: 1000,
  defaultCacheTime: 5 * 60 * 1000, // 5 minutes
  gcEnabled: true,
  gcInterval: 60 * 1000, // 1 minute
};

/**
 * QueryCache
 *
 * Centralized cache for query data with automatic garbage collection,
 * observer management, and cache invalidation.
 */
export class QueryCache {
  private config: Required<QueryCacheConfig>;
  private cache = new Map<string, QueryState>();
  private gcIntervalId?: ReturnType<typeof setInterval>;

  constructor(config?: QueryCacheConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.gcEnabled) {
      this.startGarbageCollection();
    }
  }

  // ============================================================================
  // Core Operations
  // ============================================================================

  /**
   * Get data from cache
   */
  get<T>(queryKey: QueryKey): T | undefined {
    const hash = hashQueryKey(queryKey);
    const state = this.cache.get(hash);
    return state?.data as T | undefined;
  }

  /**
   * Get full query state
   */
  getQuery<T, E = unknown>(queryKey: QueryKey): Query<T, E> | undefined {
    const hash = hashQueryKey(queryKey);
    const state = this.cache.get(hash);

    if (!state) return undefined;

    return {
      queryKey: state.queryKey,
      queryHash: state.queryHash,
      state: {
        data: state.data as T | undefined,
        error: state.error as E | null,
        status: state.status,
        dataUpdatedAt: state.dataUpdatedAt,
        errorUpdatedAt: state.errorUpdatedAt,
        isInvalidated: state.isInvalidated,
      },
    };
  }

  /**
   * Set data in cache
   */
  set<T>(queryKey: QueryKey, data: T): void {
    const hash = hashQueryKey(queryKey);
    const existing = this.cache.get(hash);

    const state: QueryState<T> = {
      queryKey,
      queryHash: hash,
      data,
      error: null,
      status: 'success',
      dataUpdatedAt: timeUtils.now(),
      errorUpdatedAt: existing?.errorUpdatedAt ?? 0,
      isInvalidated: false,
      fetchStatus: 'idle',
      observers: existing?.observers ?? new Set(),
    };

    this.cache.set(hash, state as QueryState);
    this.notifyObservers(hash);
    this.enforceMaxEntries();
  }

  /**
   * Set error in cache
   */
  setError<E>(queryKey: QueryKey, error: E): void {
    const hash = hashQueryKey(queryKey);
    const existing = this.cache.get(hash);

    const state: QueryState = {
      queryKey,
      queryHash: hash,
      data: existing?.data,
      error,
      status: 'error',
      dataUpdatedAt: existing?.dataUpdatedAt ?? 0,
      errorUpdatedAt: timeUtils.now(),
      isInvalidated: false,
      fetchStatus: 'idle',
      observers: existing?.observers ?? new Set(),
    };

    this.cache.set(hash, state);
    this.notifyObservers(hash);
  }

  /**
   * Update query state
   */
  update(queryKey: QueryKey, updater: Partial<QueryState>): void {
    const hash = hashQueryKey(queryKey);
    const existing = this.cache.get(hash);

    if (existing) {
      Object.assign(existing, updater);
      this.notifyObservers(hash);
    }
  }

  /**
   * Check if data is stale
   */
  isStale(queryKey: QueryKey, staleTime?: number): boolean {
    const hash = hashQueryKey(queryKey);
    const state = this.cache.get(hash);

    if (!state) return true;
    if (state.isInvalidated) return true;
    if (staleTime === Infinity) return false;
    if (staleTime === 0) return true;

    const effectiveStaleTime = staleTime ?? 0;
    return timeUtils.isExpired(state.dataUpdatedAt, effectiveStaleTime);
  }

  /**
   * Invalidate query
   */
  invalidate(queryKey: QueryKey): void {
    const hash = hashQueryKey(queryKey);
    const state = this.cache.get(hash);

    if (state) {
      state.isInvalidated = true;
      this.notifyObservers(hash);
    }
  }

  /**
   * Remove query from cache
   */
  remove(queryKey: QueryKey): void {
    const hash = hashQueryKey(queryKey);
    const state = this.cache.get(hash);

    if (state) {
      state.abortController?.abort();
      if (state.gcTimeout) clearTimeout(state.gcTimeout);
      this.cache.delete(hash);
    }
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    for (const state of this.cache.values()) {
      state.abortController?.abort();
      if (state.gcTimeout) clearTimeout(state.gcTimeout);
    }
    this.cache.clear();
  }

  // ============================================================================
  // Query Filtering
  // ============================================================================

  /**
   * Find all queries matching filters
   */
  findAll(filters?: QueryFilters): Query[] {
    const results: Query[] = [];

    for (const state of this.cache.values()) {
      const query: Query = {
        queryKey: state.queryKey,
        queryHash: state.queryHash,
        state: {
          data: state.data,
          error: state.error as NetronError | null,
          status: state.status,
          dataUpdatedAt: state.dataUpdatedAt,
          errorUpdatedAt: state.errorUpdatedAt,
          isInvalidated: state.isInvalidated,
        },
      };

      if (matchQueryFilters(query, filters)) {
        results.push(query);
      }
    }

    return results;
  }

  /**
   * Cancel all queries matching filters
   */
  cancelAll(filters?: QueryFilters): void {
    const queries = this.findAll(filters);
    for (const query of queries) {
      const state = this.cache.get(query.queryHash);
      state?.abortController?.abort();
    }
  }

  // ============================================================================
  // Observer Management
  // ============================================================================

  /**
   * Subscribe to query changes
   */
  subscribe(queryKey: QueryKey, observer: () => void): () => void {
    const hash = hashQueryKey(queryKey);
    let state = this.cache.get(hash);

    if (!state) {
      // Create placeholder state for subscription
      state = {
        queryKey,
        queryHash: hash,
        data: undefined,
        error: null,
        status: 'idle',
        dataUpdatedAt: 0,
        errorUpdatedAt: 0,
        isInvalidated: false,
        fetchStatus: 'idle',
        observers: new Set(),
      };
      this.cache.set(hash, state);
    }

    state.observers.add(observer);

    // Cancel GC timer when observers exist
    if (state.gcTimeout) {
      clearTimeout(state.gcTimeout);
      state.gcTimeout = undefined;
    }

    return () => {
      state!.observers.delete(observer);
      this.scheduleGC(hash);
    };
  }

  /**
   * Notify all observers of a query
   */
  private notifyObservers(hash: string): void {
    const state = this.cache.get(hash);
    state?.observers.forEach((observer) => {
      try {
        observer();
      } catch (error) {
        console.error('Error in query observer:', error);
      }
    });
  }

  // ============================================================================
  // Fetch State Management
  // ============================================================================

  /**
   * Start fetching
   */
  startFetch(queryKey: QueryKey): AbortController {
    const hash = hashQueryKey(queryKey);
    const state = this.cache.get(hash);

    // Abort any existing fetch
    state?.abortController?.abort();

    const controller = new AbortController();

    if (state) {
      state.fetchStatus = 'fetching';
      state.abortController = controller;
      if (state.status === 'idle') {
        state.status = 'loading';
      }
      this.notifyObservers(hash);
    }

    return controller;
  }

  /**
   * End fetching
   */
  endFetch(queryKey: QueryKey): void {
    const hash = hashQueryKey(queryKey);
    const state = this.cache.get(hash);

    if (state) {
      state.fetchStatus = 'idle';
      state.abortController = undefined;
      this.notifyObservers(hash);
    }
  }

  /**
   * Check if query is currently fetching
   */
  isFetching(queryKey: QueryKey): boolean {
    const hash = hashQueryKey(queryKey);
    const state = this.cache.get(hash);
    return state?.fetchStatus === 'fetching';
  }

  /**
   * Get or create a fetch promise for deduplication
   *
   * If there's an in-flight promise for this queryKey, return it.
   * Otherwise, create a new promise from fetchFn and store it.
   * The promise reference is cleaned up when settled.
   */
  getOrCreateFetch<T>(queryKey: QueryKey, fetchFn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const hash = hashQueryKey(queryKey);
    let state = this.cache.get(hash);

    // If there's an existing in-flight promise, return it
    if (state?.promise && state.fetchStatus === 'fetching') {
      return state.promise as Promise<T>;
    }

    // Create state if it doesn't exist
    if (!state) {
      state = {
        queryKey,
        queryHash: hash,
        data: undefined,
        error: null,
        status: 'loading',
        dataUpdatedAt: 0,
        errorUpdatedAt: 0,
        isInvalidated: false,
        fetchStatus: 'fetching',
        observers: new Set(),
      };
      this.cache.set(hash, state);
    } else {
      // Update existing state to fetching
      state.fetchStatus = 'fetching';
      if (state.status === 'idle') {
        state.status = 'loading';
      }
    }

    // Create abort controller for this fetch
    state.abortController?.abort();
    const controller = new AbortController();
    state.abortController = controller;

    // Create the promise and store it
    const promise = fetchFn(controller.signal)
      .then((data) => {
        // Only update if this is still the current fetch (not aborted/replaced)
        const currentState = this.cache.get(hash);
        if (currentState?.promise === promise) {
          currentState.data = data;
          currentState.error = null;
          currentState.status = 'success';
          currentState.dataUpdatedAt = timeUtils.now();
          currentState.isInvalidated = false;
          currentState.fetchStatus = 'idle';
          currentState.promise = undefined;
          currentState.abortController = undefined;
          this.notifyObservers(hash);
        }
        return data;
      })
      .catch((error) => {
        // Only update if this is still the current fetch
        const currentState = this.cache.get(hash);
        if (currentState?.promise === promise) {
          currentState.error = error;
          currentState.status = 'error';
          currentState.errorUpdatedAt = timeUtils.now();
          currentState.fetchStatus = 'idle';
          currentState.promise = undefined;
          currentState.abortController = undefined;
          this.notifyObservers(hash);
        }
        throw error;
      });

    state.promise = promise as Promise<unknown>;
    this.notifyObservers(hash);

    return promise;
  }

  /**
   * Get the in-flight promise for a query, if any
   */
  getInFlightPromise<T>(queryKey: QueryKey): Promise<T> | undefined {
    const hash = hashQueryKey(queryKey);
    const state = this.cache.get(hash);
    if (state?.promise && state.fetchStatus === 'fetching') {
      return state.promise as Promise<T>;
    }
    return undefined;
  }

  // ============================================================================
  // Garbage Collection
  // ============================================================================

  /**
   * Schedule GC for a query
   */
  private scheduleGC(hash: string): void {
    if (!this.config.gcEnabled) return;

    const state = this.cache.get(hash);
    if (!state || state.observers.size > 0) return;

    // Clear existing timer
    if (state.gcTimeout) {
      clearTimeout(state.gcTimeout);
    }

    // Schedule GC
    state.gcTimeout = setTimeout(() => {
      // Double-check no observers before removing
      if (state.observers.size === 0) {
        this.cache.delete(hash);
      }
    }, this.config.defaultCacheTime);
  }

  /**
   * Start periodic garbage collection
   */
  private startGarbageCollection(): void {
    this.gcIntervalId = setInterval(() => {
      this.runGarbageCollection();
    }, this.config.gcInterval);
  }

  /**
   * Run garbage collection
   */
  private runGarbageCollection(): void {
    for (const [hash, state] of this.cache.entries()) {
      // Skip if has observers
      if (state.observers.size > 0) continue;

      // Remove if cache time expired
      const lastUpdate = Math.max(state.dataUpdatedAt, state.errorUpdatedAt);
      if (timeUtils.isExpired(lastUpdate, this.config.defaultCacheTime)) {
        this.cache.delete(hash);
      }
    }
  }

  /**
   * Enforce maximum entries limit
   */
  private enforceMaxEntries(): void {
    if (this.cache.size <= this.config.maxEntries) return;

    // Find oldest entries without observers
    const entries = Array.from(this.cache.entries())
      .filter(([_, state]) => state.observers.size === 0)
      .sort((a, b) => {
        const aTime = Math.max(a[1].dataUpdatedAt, a[1].errorUpdatedAt);
        const bTime = Math.max(b[1].dataUpdatedAt, b[1].errorUpdatedAt);
        return aTime - bTime;
      });

    // Remove oldest entries until under limit
    const toRemove = this.cache.size - this.config.maxEntries;
    for (let i = 0; i < toRemove && i < entries.length; i++) {
      const [hash, state] = entries[i]!;
      if (state.gcTimeout) clearTimeout(state.gcTimeout);
      this.cache.delete(hash);
    }
  }

  // ============================================================================
  // SSR Support
  // ============================================================================

  /**
   * Dehydrate cache for SSR
   */
  dehydrate(): Array<{ queryKey: QueryKey; queryHash: string; state: Query['state'] }> {
    return Array.from(this.cache.values())
      .filter((state) => state.status === 'success')
      .map((state) => ({
        queryKey: state.queryKey,
        queryHash: state.queryHash,
        state: {
          data: state.data,
          error: state.error as NetronError | null,
          status: state.status,
          dataUpdatedAt: state.dataUpdatedAt,
          errorUpdatedAt: state.errorUpdatedAt,
          isInvalidated: state.isInvalidated,
        },
      }));
  }

  /**
   * Hydrate cache from SSR
   */
  hydrate(queries: Array<{ queryKey: QueryKey; queryHash: string; state: Query['state'] }>): void {
    for (const { queryKey, queryHash, state } of queries) {
      // Don't overwrite existing data
      if (this.cache.has(queryHash)) continue;

      this.cache.set(queryHash, {
        queryKey,
        queryHash,
        data: state.data,
        error: state.error,
        status: state.status,
        dataUpdatedAt: state.dataUpdatedAt,
        errorUpdatedAt: state.errorUpdatedAt,
        isInvalidated: state.isInvalidated,
        fetchStatus: 'idle',
        observers: new Set(),
      });
    }
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Destroy the cache
   */
  destroy(): void {
    if (this.gcIntervalId) {
      clearInterval(this.gcIntervalId);
    }
    this.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxEntries: number;
    observerCount: number;
    fetchingCount: number;
  } {
    let observerCount = 0;
    let fetchingCount = 0;

    for (const state of this.cache.values()) {
      observerCount += state.observers.size;
      if (state.fetchStatus === 'fetching') fetchingCount++;
    }

    return {
      size: this.cache.size,
      maxEntries: this.config.maxEntries,
      observerCount,
      fetchingCount,
    };
  }
}
