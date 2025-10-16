/**
 * Conflict Resolver
 * Resolves conflicts when merging distributed changes
 */

import { VectorClockManager } from '../crdt/vector-clock.js';
import { Change } from './change-tracker.js';

export interface ConflictResolution {
  winner: Change;
  loser: Change;
  strategy: ConflictStrategy;
  reason: string;
}

export type ConflictStrategy =
  | 'last-write-wins'
  | 'vector-clock'
  | 'custom'
  | 'manual';

export interface ConflictResolverOptions {
  defaultStrategy?: ConflictStrategy;
  customResolver?: (local: Change, remote: Change) => Change;
}

export class ConflictResolver {
  private readonly options: Required<
    Omit<ConflictResolverOptions, 'customResolver'>
  > & {
    customResolver?: (local: Change, remote: Change) => Change;
  };
  private resolutions: ConflictResolution[];

  constructor(options: ConflictResolverOptions = {}) {
    this.options = {
      defaultStrategy: options.defaultStrategy ?? 'vector-clock',
      customResolver: options.customResolver,
    };
    this.resolutions = [];
  }

  /**
   * Resolve conflict between two changes
   */
  resolve(
    local: Change,
    remote: Change,
    strategy?: ConflictStrategy,
  ): ConflictResolution {
    const resolveStrategy = strategy ?? this.options.defaultStrategy;

    let resolution: ConflictResolution;

    switch (resolveStrategy) {
      case 'last-write-wins':
        resolution = this.resolveByTimestamp(local, remote);
        break;

      case 'vector-clock':
        resolution = this.resolveByVectorClock(local, remote);
        break;

      case 'custom':
        if (!this.options.customResolver) {
          throw new Error('Custom resolver not configured');
        }
        resolution = this.resolveByCustom(local, remote);
        break;

      case 'manual':
        resolution = {
          winner: local,
          loser: remote,
          strategy: 'manual',
          reason: 'Manual resolution required',
        };
        break;

      default:
        resolution = this.resolveByVectorClock(local, remote);
    }

    this.resolutions.push(resolution);
    return resolution;
  }

  /**
   * Resolve by timestamp (Last-Write-Wins)
   */
  private resolveByTimestamp(local: Change, remote: Change): ConflictResolution {
    if (local.timestamp > remote.timestamp) {
      return {
        winner: local,
        loser: remote,
        strategy: 'last-write-wins',
        reason: 'Local change is newer by timestamp',
      };
    } else if (remote.timestamp > local.timestamp) {
      return {
        winner: remote,
        loser: local,
        strategy: 'last-write-wins',
        reason: 'Remote change is newer by timestamp',
      };
    } else {
      // Same timestamp - use node ID as tie-breaker
      if (local.nodeId > remote.nodeId) {
        return {
          winner: local,
          loser: remote,
          strategy: 'last-write-wins',
          reason: 'Same timestamp, local node ID is greater',
        };
      } else {
        return {
          winner: remote,
          loser: local,
          strategy: 'last-write-wins',
          reason: 'Same timestamp, remote node ID is greater',
        };
      }
    }
  }

  /**
   * Resolve by vector clock (causality)
   */
  private resolveByVectorClock(local: Change, remote: Change): ConflictResolution {
    const comparison = VectorClockManager.compare(local.clock, remote.clock);

    switch (comparison) {
      case 'before':
        return {
          winner: remote,
          loser: local,
          strategy: 'vector-clock',
          reason: 'Remote change happened after local (causally)',
        };

      case 'after':
        return {
          winner: local,
          loser: remote,
          strategy: 'vector-clock',
          reason: 'Local change happened after remote (causally)',
        };

      case 'concurrent':
        // Concurrent changes - fall back to timestamp
        return this.resolveByTimestamp(local, remote);

      case 'equal':
        return {
          winner: local,
          loser: remote,
          strategy: 'vector-clock',
          reason: 'Changes are identical',
        };
    }
  }

  /**
   * Resolve using custom resolver
   */
  private resolveByCustom(local: Change, remote: Change): ConflictResolution {
    const winner = this.options.customResolver!(local, remote);
    const loser = winner === local ? remote : local;

    return {
      winner,
      loser,
      strategy: 'custom',
      reason: 'Custom resolution logic applied',
    };
  }

  /**
   * Resolve multiple conflicts
   */
  resolveMultiple(
    conflicts: Array<{ local: Change; remote: Change }>,
    strategy?: ConflictStrategy,
  ): ConflictResolution[] {
    return conflicts.map((conflict) =>
      this.resolve(conflict.local, conflict.remote, strategy),
    );
  }

  /**
   * Get resolution history
   */
  getResolutions(): ConflictResolution[] {
    return [...this.resolutions];
  }

  /**
   * Get resolution statistics
   */
  getStats(): {
    total: number;
    byStrategy: Record<ConflictStrategy, number>;
  } {
    const byStrategy: Record<string, number> = {};

    for (const resolution of this.resolutions) {
      byStrategy[resolution.strategy] = (byStrategy[resolution.strategy] || 0) + 1;
    }

    return {
      total: this.resolutions.length,
      byStrategy: byStrategy as Record<ConflictStrategy, number>,
    };
  }

  /**
   * Clear resolution history
   */
  clearHistory(): void {
    this.resolutions = [];
  }

  /**
   * Detect conflicts in a list of changes
   */
  static detectConflicts(changes: Change[]): Array<{
    key: string;
    conflicts: Change[];
  }> {
    const keyMap = new Map<string, Change[]>();

    // Group changes by key
    for (const change of changes) {
      const existing = keyMap.get(change.key) || [];
      existing.push(change);
      keyMap.set(change.key, existing);
    }

    // Find keys with multiple changes
    const conflicts: Array<{ key: string; conflicts: Change[] }> = [];

    for (const [key, keyChanges] of keyMap) {
      if (keyChanges.length > 1) {
        // Check if they're actually conflicting (concurrent)
        const hasConcurrent = keyChanges.some((a, i) =>
          keyChanges.slice(i + 1).some((b) => {
            const comparison = VectorClockManager.compare(a.clock, b.clock);
            return comparison === 'concurrent';
          }),
        );

        if (hasConcurrent) {
          conflicts.push({ key, conflicts: keyChanges });
        }
      }
    }

    return conflicts;
  }
}
