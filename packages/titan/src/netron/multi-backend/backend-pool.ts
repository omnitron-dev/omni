/**
 * Backend Pool
 *
 * Manages a pool of backend connections with health monitoring,
 * connection lifecycle management, and automatic reconnection.
 *
 * @module @omnitron-dev/titan/netron/multi-backend
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import { BackendClient } from './backend-client.js';
import type { BackendConfig, BackendStatus, BackendHealth, MultiBackendClientOptions } from './types.js';
import { fallbackLog } from '../../utils/fallback-log.js';

/**
 * Backend pool events
 */
export interface BackendPoolEvents {
  backendAdded: (backendId: string) => void;
  backendRemoved: (backendId: string) => void;
  backendConnect: (backendId: string) => void;
  backendDisconnect: (backendId: string, reason?: string) => void;
  backendHealthChange: (backendId: string, health: BackendHealth) => void;
  backendError: (backendId: string, error: Error) => void;
  healthCheckComplete: (results: Map<string, boolean>) => void;
}

/**
 * Backend Pool
 *
 * Manages multiple backend connections with:
 * - Connection lifecycle management
 * - Health monitoring and checks
 * - Automatic reconnection
 * - Connection statistics
 */
export class BackendPool extends EventEmitter {
  private backends: Map<string, BackendClient>;
  private healthCheckInterval?: NodeJS.Timeout;
  private healthChecksEnabled: boolean;
  private healthCheckIntervalMs: number;
  private unhealthyThreshold: number;
  private healthyThreshold: number;
  private isStarted = false;

  constructor(options?: Partial<MultiBackendClientOptions>) {
    super();
    this.backends = new Map();
    this.healthChecksEnabled = options?.healthChecks !== false;
    this.healthCheckIntervalMs = options?.healthCheckInterval ?? 30000;
    this.unhealthyThreshold = options?.unhealthyThreshold ?? 3;
    this.healthyThreshold = options?.healthyThreshold ?? 2;
  }

  /**
   * Start the pool and connect to all backends
   */
  async start(): Promise<void> {
    if (this.isStarted) return;
    this.isStarted = true;

    // Connect to all backends
    const connectPromises = Array.from(this.backends.values()).map((backend) =>
      backend.connect().catch((error) => {
        fallbackLog('error', `Failed to connect to backend ${backend.id}`, { error: error as Error });
        this.emit('backendError', backend.id, error);
      })
    );

    await Promise.allSettled(connectPromises);

    // Start health checks if enabled
    if (this.healthChecksEnabled) {
      this.startHealthChecks();
    }
  }

  /**
   * Stop the pool and disconnect all backends
   */
  async stop(): Promise<void> {
    if (!this.isStarted) return;
    this.isStarted = false;

    // Stop health checks
    this.stopHealthChecks();

    // Disconnect all backends
    const disconnectPromises = Array.from(this.backends.values()).map((backend) =>
      backend.disconnect().catch((error) => {
        fallbackLog('error', `Failed to disconnect from backend ${backend.id}`, { error: error as Error });
      })
    );

    await Promise.allSettled(disconnectPromises);
  }

  /**
   * Add a backend to the pool
   */
  addBackend(config: BackendConfig): BackendClient {
    if (this.backends.has(config.id)) {
      throw new Error(`Backend ${config.id} already exists in pool`);
    }

    const client = new BackendClient(config, {
      unhealthyThreshold: this.unhealthyThreshold,
      healthyThreshold: this.healthyThreshold,
    });

    // Set up event listeners
    client.on('connect', () => {
      this.emit('backendConnect', config.id);
    });

    client.on('disconnect', (reason: string) => {
      this.emit('backendDisconnect', config.id, reason);
    });

    client.on('healthChange', (health: BackendHealth) => {
      this.emit('backendHealthChange', config.id, health);
    });

    client.on('error', (error: Error) => {
      this.emit('backendError', config.id, error);
    });

    this.backends.set(config.id, client);
    this.emit('backendAdded', config.id);

    // If pool is already started, connect this backend
    if (this.isStarted) {
      client.connect().catch((error) => {
        fallbackLog('error', `Failed to connect to newly added backend ${config.id}`, { error: error as Error });
        this.emit('backendError', config.id, error);
      });
    }

    return client;
  }

  /**
   * Remove a backend from the pool
   */
  async removeBackend(backendId: string): Promise<boolean> {
    const client = this.backends.get(backendId);
    if (!client) return false;

    // Disconnect the client
    await client.disconnect();

    // Remove from pool
    this.backends.delete(backendId);
    this.emit('backendRemoved', backendId);

    return true;
  }

  /**
   * Get a backend by ID
   */
  getBackend(backendId: string): BackendClient | undefined {
    return this.backends.get(backendId);
  }

  /**
   * Get all backends
   */
  getAllBackends(): BackendClient[] {
    return Array.from(this.backends.values());
  }

  /**
   * Get all backend IDs
   */
  getBackendIds(): string[] {
    return Array.from(this.backends.keys());
  }

  /**
   * Get status of all backends
   */
  getBackendStatuses(): BackendStatus[] {
    return Array.from(this.backends.values()).map((b) => b.getStatus());
  }

  /**
   * Get status of a specific backend
   */
  getBackendStatus(backendId: string): BackendStatus | undefined {
    return this.backends.get(backendId)?.getStatus();
  }

  /**
   * Get healthy backends
   */
  getHealthyBackends(): BackendClient[] {
    return Array.from(this.backends.values()).filter((b) => b.isHealthy());
  }

  /**
   * Get connected backends
   */
  getConnectedBackends(): BackendClient[] {
    return Array.from(this.backends.values()).filter((b) => b.isConnected());
  }

  /**
   * Check if any backend is healthy
   */
  hasHealthyBackend(): boolean {
    return this.getHealthyBackends().length > 0;
  }

  /**
   * Get number of backends
   */
  get size(): number {
    return this.backends.size;
  }

  /**
   * Start health checks
   */
  private startHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(() => {
      this.runHealthChecks();
    }, this.healthCheckIntervalMs);

    // Run initial health check
    this.runHealthChecks();
  }

  /**
   * Stop health checks
   */
  private stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }

  /**
   * Run health checks on all backends
   */
  async runHealthChecks(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    const checkPromises = Array.from(this.backends.entries()).map(async ([id, backend]): Promise<[string, boolean]> => {
      try {
        const healthy = await backend.healthCheck();
        return [id, healthy];
      } catch (error) {
        fallbackLog('error', `Health check failed for backend ${id}`, { error: error as Error });
        return [id, false];
      }
    });

    const settledResults = await Promise.all(checkPromises);
    for (const [id, healthy] of settledResults) {
      results.set(id, healthy);
    }

    this.emit('healthCheckComplete', results);
    return results;
  }

  /**
   * Force reconnect a backend
   */
  async reconnectBackend(backendId: string): Promise<void> {
    const client = this.backends.get(backendId);
    if (!client) {
      throw new Error(`Backend ${backendId} not found`);
    }

    await client.disconnect();
    await client.connect();
  }

  /**
   * Force reconnect all backends
   */
  async reconnectAll(): Promise<void> {
    const reconnectPromises = Array.from(this.backends.values()).map(async (backend) => {
      try {
        await backend.disconnect();
        await backend.connect();
      } catch (error) {
        fallbackLog('error', `Failed to reconnect backend ${backend.id}`, { error: error as Error });
        this.emit('backendError', backend.id, error instanceof Error ? error : new Error(String(error)));
      }
    });

    await Promise.allSettled(reconnectPromises);
  }

  /**
   * Update health check interval
   */
  setHealthCheckInterval(intervalMs: number): void {
    this.healthCheckIntervalMs = intervalMs;
    if (this.isStarted && this.healthChecksEnabled) {
      this.startHealthChecks();
    }
  }

  /**
   * Enable or disable health checks
   */
  setHealthChecksEnabled(enabled: boolean): void {
    this.healthChecksEnabled = enabled;
    if (this.isStarted) {
      if (enabled) {
        this.startHealthChecks();
      } else {
        this.stopHealthChecks();
      }
    }
  }

  /**
   * Get pool statistics
   */
  getStatistics(): {
    total: number;
    connected: number;
    healthy: number;
    unhealthy: number;
    degraded: number;
    unknown: number;
  } {
    const statuses = this.getBackendStatuses();

    return {
      total: statuses.length,
      connected: statuses.filter((s) => s.state === 'connected').length,
      healthy: statuses.filter((s) => s.health === 'healthy').length,
      unhealthy: statuses.filter((s) => s.health === 'unhealthy').length,
      degraded: statuses.filter((s) => s.health === 'degraded').length,
      unknown: statuses.filter((s) => s.health === 'unknown').length,
    };
  }

  /**
   * Reset all backend metrics
   */
  resetAllMetrics(): void {
    for (const backend of this.backends.values()) {
      backend.resetMetrics();
    }
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    await this.stop();
    this.backends.clear();
    this.removeAllListeners();
  }
}
