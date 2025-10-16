/**
 * Change Tracker
 * Tracks and propagates configuration changes
 */

import { EventEmitter } from 'events';
import { VectorClock, VectorClockManager } from '../crdt/vector-clock.js';

export interface Change {
  id: string;
  key: string;
  value: unknown;
  operation: 'set' | 'delete';
  timestamp: number;
  clock: VectorClock;
  nodeId: string;
}

export interface ChangeFilter {
  since?: VectorClock;
  keys?: string[];
  operations?: Array<'set' | 'delete'>;
  nodeId?: string;
}

export interface ChangeTrackerOptions {
  nodeId: string;
  maxHistorySize?: number;
  enableCompression?: boolean;
}

export class ChangeTracker extends EventEmitter {
  private readonly nodeId: string;
  private readonly options: Required<ChangeTrackerOptions>;
  private changes: Map<string, Change>;
  private changeHistory: Change[];
  private clockManager: VectorClockManager;
  private changeCounter: number;

  constructor(options: ChangeTrackerOptions) {
    super();
    this.nodeId = options.nodeId;
    this.options = {
      nodeId: options.nodeId,
      maxHistorySize: options.maxHistorySize ?? 1000,
      enableCompression: options.enableCompression ?? true,
    };
    this.changes = new Map();
    this.changeHistory = [];
    this.clockManager = new VectorClockManager(this.nodeId);
    this.changeCounter = 0;
  }

  /**
   * Track a new change
   */
  track(key: string, value: unknown, operation: 'set' | 'delete' = 'set'): Change {
    const clock = this.clockManager.increment();
    const changeId = `${this.nodeId}-${++this.changeCounter}`;

    const change: Change = {
      id: changeId,
      key,
      value,
      operation,
      timestamp: Date.now(),
      clock,
      nodeId: this.nodeId,
    };

    // Store latest change for each key
    this.changes.set(key, change);

    // Add to history
    this.changeHistory.push(change);

    // Limit history size
    if (this.changeHistory.length > this.options.maxHistorySize) {
      this.changeHistory.shift();
    }

    // Emit event
    this.emit('change', change);

    return change;
  }

  /**
   * Get changes since a vector clock
   */
  getChangesSince(since?: VectorClock): Change[] {
    if (!since) {
      return [...this.changeHistory];
    }

    return this.changeHistory.filter((change) => {
      const comparison = VectorClockManager.compare(since, change.clock);
      return comparison === 'before' || comparison === 'concurrent';
    });
  }

  /**
   * Get changes matching filter
   */
  getChanges(filter: ChangeFilter): Change[] {
    let results = this.changeHistory;

    // Filter by vector clock
    if (filter.since) {
      results = results.filter((change) => {
        const comparison = VectorClockManager.compare(filter.since!, change.clock);
        return comparison === 'before' || comparison === 'concurrent';
      });
    }

    // Filter by keys
    if (filter.keys && filter.keys.length > 0) {
      const keySet = new Set(filter.keys);
      results = results.filter((change) => keySet.has(change.key));
    }

    // Filter by operations
    if (filter.operations && filter.operations.length > 0) {
      const opSet = new Set(filter.operations);
      results = results.filter((change) => opSet.has(change.operation));
    }

    // Filter by node
    if (filter.nodeId) {
      results = results.filter((change) => change.nodeId === filter.nodeId);
    }

    return results;
  }

  /**
   * Get latest change for a key
   */
  getLatestChange(key: string): Change | undefined {
    return this.changes.get(key);
  }

  /**
   * Get all latest changes (one per key)
   */
  getLatestChanges(): Change[] {
    return Array.from(this.changes.values());
  }

  /**
   * Apply remote changes
   */
  applyRemoteChanges(changes: Change[]): void {
    for (const change of changes) {
      // Merge vector clock
      this.clockManager.merge(change.clock);

      // Check if we need to update
      const existing = this.changes.get(change.key);

      if (!existing) {
        // New key
        this.changes.set(change.key, change);
        this.changeHistory.push(change);
      } else {
        // Compare clocks
        const comparison = VectorClockManager.compare(existing.clock, change.clock);

        if (comparison === 'before') {
          // Remote is newer
          this.changes.set(change.key, change);
          this.changeHistory.push(change);
        } else if (comparison === 'concurrent') {
          // Concurrent - use timestamp
          if (change.timestamp > existing.timestamp) {
            this.changes.set(change.key, change);
            this.changeHistory.push(change);
          }
        }
        // If 'after' or 'equal', keep existing
      }
    }

    // Limit history
    while (this.changeHistory.length > this.options.maxHistorySize) {
      this.changeHistory.shift();
    }

    this.emit('remote-changes-applied', changes);
  }

  /**
   * Get current vector clock
   */
  getClock(): VectorClock {
    return this.clockManager.getClock();
  }

  /**
   * Get change count
   */
  getChangeCount(): number {
    return this.changeHistory.length;
  }

  /**
   * Get unique key count
   */
  getKeyCount(): number {
    return this.changes.size;
  }

  /**
   * Clear all changes
   */
  clear(): void {
    this.changes.clear();
    this.changeHistory = [];
    this.emit('cleared');
  }

  /**
   * Compress history (remove intermediate changes for same key)
   */
  compress(): void {
    if (!this.options.enableCompression) return;

    const keyMap = new Map<string, Change>();

    // Keep only latest change for each key
    for (const change of this.changeHistory) {
      keyMap.set(change.key, change);
    }

    // Rebuild history with only latest changes
    this.changeHistory = Array.from(keyMap.values()).sort((a, b) => a.timestamp - b.timestamp);

    this.emit('compressed', {
      before: this.changeHistory.length,
      after: keyMap.size,
    });
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalChanges: number;
    uniqueKeys: number;
    nodeId: string;
    clock: VectorClock;
  } {
    return {
      totalChanges: this.changeHistory.length,
      uniqueKeys: this.changes.size,
      nodeId: this.nodeId,
      clock: this.getClock(),
    };
  }
}
