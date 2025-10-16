/**
 * Last-Write-Wins Map (LWW-Map)
 * CRDT implementation for key-value storage with vector clocks
 */

import { VectorClock, VectorClockManager } from './vector-clock.js';

export interface LWWEntry<T> {
  value: T;
  timestamp: number;
  clock: VectorClock;
  deleted?: boolean;
}

export interface LWWMapState<T> {
  entries: Map<string, LWWEntry<T>>;
}

export class LWWMap<T = unknown> {
  private entries: Map<string, LWWEntry<T>>;
  private clockManager: VectorClockManager;

  constructor(nodeId: string) {
    this.entries = new Map();
    this.clockManager = new VectorClockManager(nodeId);
  }

  /**
   * Set a value (local write)
   */
  set(key: string, value: T): void {
    const clock = this.clockManager.increment();
    this.entries.set(key, {
      value,
      timestamp: Date.now(),
      clock,
      deleted: false,
    });
  }

  /**
   * Get a value
   */
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.deleted) {
      return undefined;
    }
    return entry.value;
  }

  /**
   * Check if key exists
   */
  has(key: string): boolean {
    const entry = this.entries.get(key);
    return !!entry && !entry.deleted;
  }

  /**
   * Delete a key (tombstone)
   */
  delete(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry || entry.deleted) {
      return false;
    }

    const clock = this.clockManager.increment();
    this.entries.set(key, {
      ...entry,
      deleted: true,
      timestamp: Date.now(),
      clock,
    });
    return true;
  }

  /**
   * Get all keys (non-deleted)
   */
  keys(): string[] {
    const result: string[] = [];
    for (const [key, entry] of this.entries) {
      if (!entry.deleted) {
        result.push(key);
      }
    }
    return result;
  }

  /**
   * Get all values (non-deleted)
   */
  values(): T[] {
    const result: T[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.deleted) {
        result.push(entry.value);
      }
    }
    return result;
  }

  /**
   * Get all entries (non-deleted)
   */
  entries_list(): Array<[string, T]> {
    const result: Array<[string, T]> = [];
    for (const [key, entry] of this.entries) {
      if (!entry.deleted) {
        result.push([key, entry.value]);
      }
    }
    return result;
  }

  /**
   * Get size (non-deleted entries)
   */
  get size(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (!entry.deleted) {
        count++;
      }
    }
    return count;
  }

  /**
   * Merge with another LWW-Map state
   */
  merge(other: LWWMapState<T>): void {
    for (const [key, otherEntry] of other.entries) {
      const localEntry = this.entries.get(key);

      if (!localEntry) {
        // New entry from other replica
        this.entries.set(key, otherEntry);
        this.clockManager.merge(otherEntry.clock);
      } else {
        // Conflict resolution: compare vector clocks
        const comparison = VectorClockManager.compare(localEntry.clock, otherEntry.clock);

        if (comparison === 'before') {
          // Other entry is newer
          this.entries.set(key, otherEntry);
          this.clockManager.merge(otherEntry.clock);
        } else if (comparison === 'concurrent') {
          // Concurrent writes: use timestamp as tie-breaker
          if (otherEntry.timestamp > localEntry.timestamp) {
            this.entries.set(key, otherEntry);
            this.clockManager.merge(otherEntry.clock);
          } else if (otherEntry.timestamp === localEntry.timestamp) {
            // Same timestamp: use lexicographic comparison of clocks
            const localStr = JSON.stringify(localEntry.clock);
            const otherStr = JSON.stringify(otherEntry.clock);
            if (otherStr > localStr) {
              this.entries.set(key, otherEntry);
              this.clockManager.merge(otherEntry.clock);
            }
          }
        }
        // If 'after' or 'equal', keep local entry
      }
    }
  }

  /**
   * Get internal state for synchronization
   */
  getState(): LWWMapState<T> {
    return {
      entries: new Map(this.entries),
    };
  }

  /**
   * Clear all entries (for testing)
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Get vector clock
   */
  getClock(): VectorClock {
    return this.clockManager.getClock();
  }
}
