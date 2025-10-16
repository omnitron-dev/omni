/**
 * Merge Algorithm for CRDTs
 * Provides utilities for merging distributed state
 */

import { VectorClockManager } from './vector-clock.js';
import { LWWMap, LWWMapState } from './lww-map.js';

export interface MergeResult<T = unknown> {
  success: boolean;
  conflicts: ConflictInfo[];
  merged: T;
}

export interface ConflictInfo {
  key: string;
  localValue: unknown;
  remoteValue: unknown;
  resolution: 'local' | 'remote' | 'merged';
  reason: string;
}

export class MergeAlgorithm {
  /**
   * Merge two LWW-Maps
   */
  static mergeLWWMaps<T>(
    local: LWWMap<T>,
    remote: LWWMapState<T>,
  ): MergeResult<LWWMap<T>> {
    const conflicts: ConflictInfo[] = [];
    const localState = local.getState();

    // Detect conflicts before merging
    for (const [key, remoteEntry] of remote.entries) {
      const localEntry = localState.entries.get(key);

      if (localEntry) {
        const comparison = VectorClockManager.compare(localEntry.clock, remoteEntry.clock);

        if (comparison === 'concurrent') {
          conflicts.push({
            key,
            localValue: localEntry.value,
            remoteValue: remoteEntry.value,
            resolution:
              remoteEntry.timestamp > localEntry.timestamp ? 'remote' : 'local',
            reason: 'Concurrent modification resolved by timestamp',
          });
        }
      }
    }

    // Perform the merge
    local.merge(remote);

    return {
      success: true,
      conflicts,
      merged: local,
    };
  }

  /**
   * Three-way merge for complex objects
   */
  static threeWayMerge<T extends Record<string, unknown>>(
    base: T,
    local: T,
    remote: T,
  ): MergeResult<T> {
    const merged: Record<string, unknown> = { ...base };
    const conflicts: ConflictInfo[] = [];

    const allKeys = new Set([
      ...Object.keys(base),
      ...Object.keys(local),
      ...Object.keys(remote),
    ]);

    for (const key of allKeys) {
      const baseValue = base[key];
      const localValue = local[key];
      const remoteValue = remote[key];

      // No conflict if values are the same
      if (localValue === remoteValue) {
        merged[key] = localValue;
        continue;
      }

      // Local only change
      if (localValue !== baseValue && remoteValue === baseValue) {
        merged[key] = localValue;
        continue;
      }

      // Remote only change
      if (remoteValue !== baseValue && localValue === baseValue) {
        merged[key] = remoteValue;
        continue;
      }

      // Both changed - conflict
      if (localValue !== baseValue && remoteValue !== baseValue) {
        conflicts.push({
          key,
          localValue,
          remoteValue,
          resolution: 'remote', // Default to remote
          reason: 'Both local and remote modified, using remote value',
        });
        merged[key] = remoteValue;
      }
    }

    return {
      success: conflicts.length === 0,
      conflicts,
      merged: merged as T,
    };
  }

  /**
   * Merge with conflict resolution strategy
   */
  static mergeWithStrategy<T extends Record<string, unknown>>(
    local: T,
    remote: T,
    strategy: 'local-wins' | 'remote-wins' | 'newest-wins' = 'remote-wins',
    timestamps?: { local: number; remote: number },
  ): MergeResult<T> {
    const merged: Record<string, unknown> = {};
    const conflicts: ConflictInfo[] = [];

    const allKeys = new Set([...Object.keys(local), ...Object.keys(remote)]);

    for (const key of allKeys) {
      const localValue = local[key];
      const remoteValue = remote[key];

      if (localValue === remoteValue) {
        merged[key] = localValue;
        continue;
      }

      // Handle missing values
      if (localValue === undefined) {
        merged[key] = remoteValue;
        continue;
      }
      if (remoteValue === undefined) {
        merged[key] = localValue;
        continue;
      }

      // Conflict - apply strategy
      let resolution: 'local' | 'remote' = 'remote';
      let reason = '';

      switch (strategy) {
        case 'local-wins':
          resolution = 'local';
          merged[key] = localValue;
          reason = 'Local-wins strategy';
          break;

        case 'remote-wins':
          resolution = 'remote';
          merged[key] = remoteValue;
          reason = 'Remote-wins strategy';
          break;

        case 'newest-wins':
          if (timestamps) {
            if (timestamps.local > timestamps.remote) {
              resolution = 'local';
              merged[key] = localValue;
              reason = 'Local is newer';
            } else {
              resolution = 'remote';
              merged[key] = remoteValue;
              reason = 'Remote is newer';
            }
          } else {
            resolution = 'remote';
            merged[key] = remoteValue;
            reason = 'Newest-wins strategy without timestamps, defaulting to remote';
          }
          break;
      }

      conflicts.push({
        key,
        localValue,
        remoteValue,
        resolution,
        reason,
      });
    }

    return {
      success: conflicts.length === 0,
      conflicts,
      merged: merged as T,
    };
  }

  /**
   * Deep merge objects recursively
   */
  static deepMerge<T extends Record<string, unknown>>(
    target: T,
    source: T,
  ): T {
    const result: Record<string, unknown> = { ...target };

    for (const key in source) {
      const targetValue = target[key];
      const sourceValue = source[key];

      if (
        targetValue &&
        sourceValue &&
        typeof targetValue === 'object' &&
        typeof sourceValue === 'object' &&
        !Array.isArray(targetValue) &&
        !Array.isArray(sourceValue)
      ) {
        result[key] = this.deepMerge(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>,
        );
      } else {
        result[key] = sourceValue;
      }
    }

    return result as T;
  }
}
