/**
 * Config Sync Service — Configuration Replication for Cluster Mode
 *
 * Pull-based configuration synchronization between leader and followers:
 *
 * 1. Leader stores config hash in fleet registry metadata
 * 2. Followers compare their config hash with leader's on heartbeat
 * 3. If different → follower requests full config from leader
 * 4. Config applied via orchestrator.reloadConfig()
 *
 * Uses SHA-256 hash of serialized config for change detection.
 * No external dependencies — uses Node.js native crypto.
 */

import { createHash } from 'node:crypto';
import type { IEcosystemConfig } from '../config/types.js';

// =============================================================================
// Types
// =============================================================================

export interface ConfigSyncState {
  /** SHA-256 hash of the current config */
  hash: string;
  /** Timestamp of last config update */
  lastUpdated: number;
  /** Number of times config was synced from leader */
  syncCount: number;
  /** Whether this node is in sync with leader */
  inSync: boolean;
}

// =============================================================================
// Service
// =============================================================================

export class ConfigSyncService {
  private currentHash: string;
  private lastUpdated = Date.now();
  private syncCount = 0;
  private inSync = true;
  private checkTimer: NodeJS.Timeout | null = null;

  constructor(
    private config: IEcosystemConfig,
    private readonly logger: { info: (...args: any[]) => void; warn: (...args: any[]) => void; debug: (...args: any[]) => void }
  ) {
    this.currentHash = ConfigSyncService.computeHash(config);
  }

  // ===========================================================================
  // Hash Computation
  // ===========================================================================

  /**
   * Compute SHA-256 hash of a serialized config.
   * Deterministic serialization: sort keys, strip functions.
   */
  static computeHash(config: IEcosystemConfig): string {
    // Strip non-serializable fields (functions, hooks, etc.)
    const serializable = JSON.stringify(config, (_key, value) => {
      if (typeof value === 'function') return undefined;
      return value;
    });
    return createHash('sha256').update(serializable).digest('hex');
  }

  /**
   * Get the current config hash.
   */
  getConfigHash(): string {
    return this.currentHash;
  }

  /**
   * Get the current config (for leader to serve to followers).
   */
  getConfig(): IEcosystemConfig {
    return this.config;
  }

  /**
   * Get sync state for monitoring.
   */
  getState(): ConfigSyncState {
    return {
      hash: this.currentHash,
      lastUpdated: this.lastUpdated,
      syncCount: this.syncCount,
      inSync: this.inSync,
    };
  }

  // ===========================================================================
  // Leader Operations
  // ===========================================================================

  /**
   * Update the config (leader-side). Recomputes hash.
   * Called when the leader's config changes (e.g., via hot-reload).
   */
  updateConfig(newConfig: IEcosystemConfig): void {
    this.config = newConfig;
    this.currentHash = ConfigSyncService.computeHash(newConfig);
    this.lastUpdated = Date.now();
    this.logger.info(
      { hash: this.currentHash.slice(0, 12) },
      'Config updated — new hash computed'
    );
  }

  // ===========================================================================
  // Follower Operations
  // ===========================================================================

  /**
   * Check if our config matches the leader's hash.
   * Called on each heartbeat from leader.
   *
   * @returns true if configs match, false if sync is needed
   */
  checkSync(leaderHash: string): boolean {
    const match = this.currentHash === leaderHash;
    this.inSync = match;
    if (!match) {
      this.logger.info(
        { local: this.currentHash.slice(0, 12), leader: leaderHash.slice(0, 12) },
        'Config hash mismatch — sync required'
      );
    }
    return match;
  }

  /**
   * Apply config received from leader.
   * Called after pulling config from leader when hashes don't match.
   *
   * @returns The new config for the orchestrator to reload
   */
  applyConfig(leaderConfig: IEcosystemConfig): IEcosystemConfig {
    const newHash = ConfigSyncService.computeHash(leaderConfig);

    this.config = leaderConfig;
    this.currentHash = newHash;
    this.lastUpdated = Date.now();
    this.syncCount++;
    this.inSync = true;

    this.logger.info(
      { hash: newHash.slice(0, 12), syncCount: this.syncCount },
      'Config synced from leader'
    );

    return leaderConfig;
  }

  // ===========================================================================
  // Periodic Sync Check (Follower)
  // ===========================================================================

  /**
   * Start periodic config sync checks (follower mode).
   * Compares config hash with leader on a timer.
   *
   * @param checkFn Function that returns the leader's config hash (via RPC)
   * @param pullFn Function that pulls the full config from leader (via RPC)
   * @param applyFn Function called when config changes to reload orchestrator
   * @param intervalMs Check interval (default: 30s)
   */
  startPeriodicSync(
    checkFn: () => Promise<string | null>,
    pullFn: () => Promise<IEcosystemConfig | null>,
    applyFn: (config: IEcosystemConfig) => Promise<void>,
    intervalMs = 30_000
  ): void {
    if (this.checkTimer) return;

    this.checkTimer = setInterval(async () => {
      try {
        const leaderHash = await checkFn();
        if (!leaderHash) return; // Leader unreachable

        if (!this.checkSync(leaderHash)) {
          // Hash mismatch — pull full config
          const leaderConfig = await pullFn();
          if (leaderConfig) {
            const newConfig = this.applyConfig(leaderConfig);
            await applyFn(newConfig);
          }
        }
      } catch (err) {
        this.logger.warn(
          { error: (err as Error).message },
          'Config sync check failed'
        );
      }
    }, intervalMs);
    this.checkTimer.unref();

    this.logger.info({ intervalMs }, 'Config sync periodic check started');
  }

  /**
   * Stop periodic config sync checks.
   */
  stopPeriodicSync(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }
}
