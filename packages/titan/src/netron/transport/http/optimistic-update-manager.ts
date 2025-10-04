/**
 * Optimistic Update Manager for immediate UI updates
 * Provides optimistic updates with automatic rollback on failure
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';

/**
 * Optimistic update entry
 */
interface OptimisticUpdate<T = any> {
  id: string;
  key: string;
  originalValue: T;
  optimisticValue: T;
  mutator: () => Promise<T>;
  timestamp: number;
  status: 'pending' | 'committed' | 'rolled-back';
  retries?: number;
  error?: Error;
}

/**
 * Update options
 */
export interface OptimisticUpdateOptions {
  /** Maximum time to wait for mutation to complete (ms) */
  timeout?: number;
  /** Whether to retry on failure */
  retry?: boolean;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Retry delay in ms */
  retryDelay?: number;
  /** Whether to keep optimistic value on error */
  keepOnError?: boolean;
  /** Custom rollback handler */
  onRollback?: (key: string, originalValue: any, error: Error) => void;
}

/**
 * Cache provider interface
 */
export interface CacheProvider {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  delete(key: string): void;
}

/**
 * Update statistics
 */
export interface OptimisticUpdateStats {
  totalUpdates: number;
  pendingUpdates: number;
  committedUpdates: number;
  rolledBackUpdates: number;
  averageCommitTime: number;
  failureRate: number;
}

/**
 * Optimistic Update Manager
 * Handles optimistic updates with automatic rollback on failure
 */
export class OptimisticUpdateManager extends EventEmitter {
  private updates = new Map<string, OptimisticUpdate>();
  private optimisticCache = new Map<string, any>();
  private updateQueue = new Map<string, OptimisticUpdate[]>();

  // Statistics
  private stats = {
    totalUpdates: 0,
    committedUpdates: 0,
    rolledBackUpdates: 0,
    commitTimes: [] as number[]
  };

  constructor(
    private cache?: CacheProvider,
    private defaultOptions: OptimisticUpdateOptions = {}
  ) {
    super();

    // Set default options
    this.defaultOptions = {
      timeout: 30000,
      retry: true,
      maxRetries: 2,
      retryDelay: 1000,
      keepOnError: false,
      ...defaultOptions
    };
  }

  /**
   * Perform an optimistic mutation
   */
  async mutate<T>(
    key: string,
    mutator: () => Promise<T>,
    optimisticUpdate?: (current: T | undefined) => T,
    options: OptimisticUpdateOptions = {}
  ): Promise<T> {
    const opts = { ...this.defaultOptions, ...options };
    const updateId = `${key}-${Date.now()}-${Math.random()}`;
    const startTime = Date.now();

    // Get current value
    const currentValue = this.getValue<T>(key);

    // Apply optimistic update if provided
    let optimisticValue: T | undefined;
    if (optimisticUpdate) {
      optimisticValue = optimisticUpdate(currentValue);
      this.applyOptimisticUpdate(key, optimisticValue);
    }

    // Create update entry
    const update: OptimisticUpdate<T> = {
      id: updateId,
      key,
      originalValue: currentValue!,
      optimisticValue: optimisticValue!,
      mutator,
      timestamp: startTime,
      status: 'pending',
      retries: 0
    };

    this.updates.set(updateId, update);
    this.addToQueue(key, update);
    this.stats.totalUpdates++;

    this.emit('update-started', {
      updateId,
      key,
      optimisticValue
    });

    try {
      // Execute mutation with timeout
      const result = await this.executeMutation<T>(update, opts);

      // Commit the update
      this.commitUpdate(updateId, result);

      // Update statistics
      const commitTime = Date.now() - startTime;
      this.updateStatistics(commitTime);

      this.emit('update-committed', {
        updateId,
        key,
        value: result,
        duration: commitTime
      });

      return result;
    } catch (error: any) {
      // Handle failure
      await this.handleFailure(update, error, opts);
      throw error;
    } finally {
      // Clean up
      this.removeFromQueue(key, updateId);
      this.updates.delete(updateId);
    }
  }

  /**
   * Execute mutation with timeout and retry
   */
  private async executeMutation<T>(
    update: OptimisticUpdate<T>,
    options: OptimisticUpdateOptions
  ): Promise<T> {
    const attemptMutation = async (): Promise<T> => {
      // Create timeout promise
      const timeoutPromise = new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error('Mutation timeout')), options.timeout);
      });

      // Race between mutation and timeout
      return Promise.race([
        update.mutator(),
        timeoutPromise
      ]);
    };

    let lastError: Error | undefined;
    const maxAttempts = options.retry ? (options.maxRetries || 0) + 1 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await attemptMutation();
      } catch (error: any) {
        lastError = error;
        update.retries = attempt;

        if (attempt < maxAttempts - 1) {
          // Emit retry event
          this.emit('update-retry', {
            updateId: update.id,
            key: update.key,
            attempt: attempt + 1,
            error
          });

          // Wait before retry
          await this.delay(options.retryDelay || 1000);
        }
      }
    }

    throw lastError!;
  }

  /**
   * Apply optimistic update to cache
   */
  private applyOptimisticUpdate<T>(key: string, value: T): void {
    // Store in optimistic cache
    this.optimisticCache.set(key, value);

    // Update external cache if provided
    if (this.cache) {
      this.cache.set(key, value);
    }

    // Notify listeners
    this.emit('optimistic-update', { key, data: value });
  }

  /**
   * Commit an update
   */
  private commitUpdate<T>(updateId: string, value: T): void {
    const update = this.updates.get(updateId);
    if (!update) return;

    update.status = 'committed';

    // Update caches with real value
    this.optimisticCache.set(update.key, value);
    if (this.cache) {
      this.cache.set(update.key, value);
    }

    this.stats.committedUpdates++;
  }

  /**
   * Handle mutation failure
   */
  private async handleFailure(
    update: OptimisticUpdate,
    error: Error,
    options: OptimisticUpdateOptions
  ): Promise<void> {
    update.status = 'rolled-back';
    update.error = error;

    // Rollback optimistic update unless keepOnError is true
    if (!options.keepOnError) {
      await this.rollback(update.key, update.originalValue);
    }

    this.stats.rolledBackUpdates++;

    // Call custom rollback handler
    if (options.onRollback) {
      options.onRollback(update.key, update.originalValue, error);
    }

    this.emit('update-rolled-back', {
      updateId: update.id,
      key: update.key,
      originalValue: update.originalValue,
      error
    });
  }

  /**
   * Rollback an optimistic update
   */
  private async rollback<T>(key: string, originalValue: T): Promise<void> {
    // Check if there are other pending updates for this key
    const queue = this.updateQueue.get(key) || [];
    const hasPendingUpdates = queue.some(u => u.status === 'pending');

    if (!hasPendingUpdates) {
      // No pending updates, restore original value
      if (originalValue !== undefined) {
        this.optimisticCache.set(key, originalValue);
        if (this.cache) {
          this.cache.set(key, originalValue);
        }
      } else {
        // Original value was undefined, remove from cache
        this.optimisticCache.delete(key);
        if (this.cache) {
          this.cache.delete(key);
        }
      }

      this.emit('optimistic-rollback', { key, data: originalValue });
    }
    // If there are pending updates, keep the optimistic value
  }

  /**
   * Get current value for a key
   */
  private getValue<T>(key: string): T | undefined {
    // Check optimistic cache first
    if (this.optimisticCache.has(key)) {
      return this.optimisticCache.get(key);
    }

    // Check external cache
    if (this.cache) {
      return this.cache.get<T>(key);
    }

    return undefined;
  }

  /**
   * Add update to queue for a key
   */
  private addToQueue(key: string, update: OptimisticUpdate): void {
    const queue = this.updateQueue.get(key) || [];
    queue.push(update);
    this.updateQueue.set(key, queue);
  }

  /**
   * Remove update from queue
   */
  private removeFromQueue(key: string, updateId: string): void {
    const queue = this.updateQueue.get(key);
    if (queue) {
      const index = queue.findIndex(u => u.id === updateId);
      if (index >= 0) {
        queue.splice(index, 1);
      }

      if (queue.length === 0) {
        this.updateQueue.delete(key);
      }
    }
  }

  /**
   * Update statistics
   */
  private updateStatistics(commitTime: number): void {
    this.stats.commitTimes.push(commitTime);

    // Keep only last 100 commit times
    if (this.stats.commitTimes.length > 100) {
      this.stats.commitTimes.shift();
    }
  }

  /**
   * Get current value with optimistic updates applied
   */
  get<T>(key: string): T | undefined {
    return this.getValue<T>(key);
  }

  /**
   * Check if there are pending updates for a key
   */
  hasPendingUpdates(key: string): boolean {
    const queue = this.updateQueue.get(key) || [];
    return queue.some(u => u.status === 'pending');
  }

  /**
   * Get pending updates for a key
   */
  getPendingUpdates(key?: string): OptimisticUpdate[] {
    if (key) {
      return (this.updateQueue.get(key) || []).filter(u => u.status === 'pending');
    }

    // Get all pending updates
    const allPending: OptimisticUpdate[] = [];
    for (const queue of this.updateQueue.values()) {
      allPending.push(...queue.filter(u => u.status === 'pending'));
    }
    return allPending;
  }

  /**
   * Cancel a pending update
   */
  async cancel(updateId: string): Promise<void> {
    const update = this.updates.get(updateId);
    if (!update || update.status !== 'pending') {
      return;
    }

    // Rollback the optimistic update
    await this.rollback(update.key, update.originalValue);

    // Remove from tracking
    this.removeFromQueue(update.key, updateId);
    this.updates.delete(updateId);

    this.emit('update-cancelled', {
      updateId,
      key: update.key
    });
  }

  /**
   * Cancel all pending updates
   */
  async cancelAll(): Promise<void> {
    const pendingUpdates = this.getPendingUpdates();

    for (const update of pendingUpdates) {
      await this.cancel(update.id);
    }
  }

  /**
   * Get statistics
   */
  getStatistics(): OptimisticUpdateStats {
    const avgCommitTime = this.stats.commitTimes.length > 0
      ? this.stats.commitTimes.reduce((a, b) => a + b, 0) / this.stats.commitTimes.length
      : 0;

    const failureRate = this.stats.totalUpdates > 0
      ? this.stats.rolledBackUpdates / this.stats.totalUpdates
      : 0;

    return {
      totalUpdates: this.stats.totalUpdates,
      pendingUpdates: this.getPendingUpdates().length,
      committedUpdates: this.stats.committedUpdates,
      rolledBackUpdates: this.stats.rolledBackUpdates,
      averageCommitTime: avgCommitTime,
      failureRate
    };
  }

  /**
   * Reset all statistics
   */
  resetStatistics(): void {
    this.stats = {
      totalUpdates: 0,
      committedUpdates: 0,
      rolledBackUpdates: 0,
      commitTimes: []
    };
  }

  /**
   * Clear all optimistic values
   */
  clearOptimisticCache(): void {
    this.optimisticCache.clear();

    this.emit('cache-cleared');
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Destroy the manager
   */
  async destroy(): Promise<void> {
    await this.cancelAll();
    this.clearOptimisticCache();
    this.removeAllListeners();
  }
}