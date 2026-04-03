/**
 * MutationCache - Manages mutation state and optimistic updates
 */

import type { MutationStatus } from '../core/types.js';
import { generateId, timeUtils } from './utils.js';

/**
 * Mutation entry in cache
 */
export interface MutationEntry<TData = unknown, TError = unknown, TVariables = unknown, TContext = unknown> {
  id: string;
  mutationKey?: readonly unknown[];
  status: MutationStatus;
  data: TData | undefined;
  error: TError | null;
  variables: TVariables | undefined;
  context: TContext | undefined;
  submittedAt: number;
  settledAt?: number;
  isPaused: boolean;
}

/**
 * Mutation observer callback
 */
type MutationObserver = () => void;

/**
 * MutationCache
 *
 * Manages mutation state including optimistic updates,
 * retry queues, and mutation history.
 */
export class MutationCache {
  private mutations = new Map<string, MutationEntry>();
  private mutationsByKey = new Map<string, Set<string>>();
  private observers = new Map<string, Set<MutationObserver>>();
  private globalObservers = new Set<MutationObserver>();

  // ============================================================================
  // Core Operations
  // ============================================================================

  /**
   * Create a new mutation entry
   */
  create<TData, TError, TVariables, TContext>(options?: {
    mutationKey?: readonly unknown[];
    variables?: TVariables;
  }): string {
    const id = generateId();

    const entry: MutationEntry<TData, TError, TVariables, TContext> = {
      id,
      mutationKey: options?.mutationKey,
      status: 'idle',
      data: undefined,
      error: null,
      variables: options?.variables,
      context: undefined,
      submittedAt: 0,
      isPaused: false,
    };

    this.mutations.set(id, entry as MutationEntry);

    // Index by key
    if (options?.mutationKey) {
      const keyHash = JSON.stringify(options.mutationKey);
      if (!this.mutationsByKey.has(keyHash)) {
        this.mutationsByKey.set(keyHash, new Set());
      }
      this.mutationsByKey.get(keyHash)!.add(id);
    }

    this.notifyObservers(id);
    return id;
  }

  /**
   * Get mutation by ID
   */
  get<TData = unknown, TError = unknown, TVariables = unknown, TContext = unknown>(
    id: string
  ): MutationEntry<TData, TError, TVariables, TContext> | undefined {
    return this.mutations.get(id) as MutationEntry<TData, TError, TVariables, TContext> | undefined;
  }

  /**
   * Get mutations by key
   */
  getByKey(mutationKey: readonly unknown[]): MutationEntry[] {
    const keyHash = JSON.stringify(mutationKey);
    const ids = this.mutationsByKey.get(keyHash);

    if (!ids) return [];

    return Array.from(ids)
      .map((id) => this.mutations.get(id))
      .filter((entry): entry is MutationEntry => entry !== undefined);
  }

  /**
   * Update mutation state
   */
  update<TData, TError, TVariables, TContext>(
    id: string,
    updates: Partial<MutationEntry<TData, TError, TVariables, TContext>>
  ): void {
    const entry = this.mutations.get(id);
    if (!entry) return;

    Object.assign(entry, updates);

    // Update settled timestamp
    if (updates.status === 'success' || updates.status === 'error') {
      entry.settledAt = timeUtils.now();
    }

    this.notifyObservers(id);
  }

  /**
   * Start mutation
   */
  start<TVariables>(id: string, variables: TVariables): void {
    this.update(id, {
      status: 'loading',
      variables,
      submittedAt: timeUtils.now(),
      error: null,
    });
  }

  /**
   * Complete mutation with success
   */
  success<TData, TContext>(id: string, data: TData, context?: TContext): void {
    this.update(id, {
      status: 'success',
      data,
      context,
      error: null,
    });
  }

  /**
   * Complete mutation with error
   */
  failure<TError>(id: string, error: TError): void {
    this.update(id, {
      status: 'error',
      error,
    });
  }

  /**
   * Reset mutation to idle
   */
  reset(id: string): void {
    this.update(id, {
      status: 'idle',
      data: undefined,
      error: null,
      variables: undefined,
      context: undefined,
      submittedAt: 0,
      settledAt: undefined,
    });
  }

  /**
   * Remove mutation
   */
  remove(id: string): void {
    const entry = this.mutations.get(id);
    if (!entry) return;

    // Remove from key index
    if (entry.mutationKey) {
      const keyHash = JSON.stringify(entry.mutationKey);
      this.mutationsByKey.get(keyHash)?.delete(id);
    }

    this.mutations.delete(id);
    this.observers.delete(id);
    this.notifyGlobalObservers();
  }

  /**
   * Clear all mutations
   */
  clear(): void {
    this.mutations.clear();
    this.mutationsByKey.clear();
    this.observers.clear();
    this.notifyGlobalObservers();
  }

  // ============================================================================
  // Filtering
  // ============================================================================

  /**
   * Get all mutations
   */
  getAll(): MutationEntry[] {
    return Array.from(this.mutations.values());
  }

  /**
   * Get mutations by status
   */
  getByStatus(status: MutationStatus): MutationEntry[] {
    return this.getAll().filter((entry) => entry.status === status);
  }

  /**
   * Get pending mutations (loading)
   */
  getPending(): MutationEntry[] {
    return this.getByStatus('loading');
  }

  /**
   * Get paused mutations
   */
  getPaused(): MutationEntry[] {
    return this.getAll().filter((entry) => entry.isPaused);
  }

  // ============================================================================
  // Observer Management
  // ============================================================================

  /**
   * Subscribe to mutation changes
   */
  subscribe(id: string, observer: MutationObserver): () => void {
    if (!this.observers.has(id)) {
      this.observers.set(id, new Set());
    }
    this.observers.get(id)!.add(observer);

    return () => {
      this.observers.get(id)?.delete(observer);
    };
  }

  /**
   * Subscribe to all mutation changes
   */
  subscribeAll(observer: MutationObserver): () => void {
    this.globalObservers.add(observer);

    return () => {
      this.globalObservers.delete(observer);
    };
  }

  /**
   * Notify observers for a mutation
   */
  private notifyObservers(id: string): void {
    this.observers.get(id)?.forEach((observer) => {
      try {
        observer();
      } catch (error) {
        console.error('Error in mutation observer:', error);
      }
    });
    this.notifyGlobalObservers();
  }

  /**
   * Notify global observers
   */
  private notifyGlobalObservers(): void {
    this.globalObservers.forEach((observer) => {
      try {
        observer();
      } catch (error) {
        console.error('Error in global mutation observer:', error);
      }
    });
  }

  // ============================================================================
  // Pause/Resume (for offline support)
  // ============================================================================

  /**
   * Pause a mutation
   */
  pause(id: string): void {
    this.update(id, { isPaused: true });
  }

  /**
   * Resume a mutation
   */
  resume(id: string): void {
    this.update(id, { isPaused: false });
  }

  /**
   * Pause all mutations
   */
  pauseAll(): void {
    for (const id of this.mutations.keys()) {
      this.pause(id);
    }
  }

  /**
   * Resume all paused mutations
   */
  resumeAll(): void {
    for (const entry of this.mutations.values()) {
      if (entry.isPaused) {
        this.resume(entry.id);
      }
    }
  }

  // ============================================================================
  // SSR Support
  // ============================================================================

  /**
   * Dehydrate mutations for SSR
   */
  dehydrate(): Array<{ mutationKey?: readonly unknown[]; state: unknown }> {
    // Only dehydrate paused mutations (for offline persistence)
    return this.getPaused().map((entry) => ({
      mutationKey: entry.mutationKey,
      state: {
        status: entry.status,
        variables: entry.variables,
        submittedAt: entry.submittedAt,
      },
    }));
  }

  /**
   * Hydrate mutations from SSR
   */
  hydrate(mutations: Array<{ mutationKey?: readonly unknown[]; state: unknown }>): void {
    for (const { mutationKey, state } of mutations) {
      const id = this.create({ mutationKey });
      const typedState = state as { status?: MutationStatus; variables?: unknown; submittedAt?: number };
      this.update(id, {
        status: typedState.status ?? 'idle',
        variables: typedState.variables,
        submittedAt: typedState.submittedAt ?? 0,
        isPaused: true,
      });
    }
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * Get mutation statistics
   */
  getStats(): {
    total: number;
    idle: number;
    loading: number;
    success: number;
    error: number;
    paused: number;
  } {
    const all = this.getAll();
    return {
      total: all.length,
      idle: all.filter((m) => m.status === 'idle').length,
      loading: all.filter((m) => m.status === 'loading').length,
      success: all.filter((m) => m.status === 'success').length,
      error: all.filter((m) => m.status === 'error').length,
      paused: all.filter((m) => m.isPaused).length,
    };
  }
}
