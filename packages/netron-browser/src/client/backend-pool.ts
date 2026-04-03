/**
 * Backend Pool - Connection Pool Manager
 *
 * Manages a pool of backend connections with:
 * - Lazy initialization of connections
 * - Connection lifecycle management
 * - Health monitoring per backend
 * - Connection state tracking
 *
 * @module client/backend-pool
 */

import { BackendClient, type BackendClientOptions } from './backend-client.js';
import type { BackendConfig, BackendPoolEntry, MultiBackendMetrics } from '../types/multi-backend.js';
import { ConnectionState, type ConnectionMetrics } from '../types/index.js';
import { AuthenticationClient } from '../auth/client.js';
import type { AuthOptions } from '../auth/types.js';
import type { IMiddlewareManager } from '../middleware/types.js';

/**
 * Options for creating a BackendPool
 */
export interface BackendPoolOptions {
  /**
   * Base URL for the API gateway
   */
  baseUrl: string;

  /**
   * Backend configurations keyed by backend name
   */
  backends: Record<string, BackendConfig>;

  /**
   * Shared authentication client
   */
  auth?: AuthenticationClient;

  /**
   * Shared middleware manager
   */
  middleware?: IMiddlewareManager;

  /**
   * Default timeout for all backends
   */
  defaultTimeout?: number;

  /**
   * Default headers for all backends
   */
  defaultHeaders?: Record<string, string>;

  /**
   * Health check interval in milliseconds
   * @default 30000 (30 seconds)
   */
  healthCheckInterval?: number;

  /**
   * Enable automatic health checks
   * @default false
   */
  enableHealthChecks?: boolean;
}

/**
 * Backend Pool implementation
 *
 * Manages multiple backend connections efficiently with lazy initialization
 * and optional health monitoring.
 *
 * @example
 * ```typescript
 * const pool = new BackendPool({
 *   baseUrl: 'https://api.example.com',
 *   backends: {
 *     core: { path: '/core' },
 *     storage: { path: '/storage' },
 *   },
 * });
 *
 * // Lazy initialization - client created on first access
 * const coreBackend = pool.get('core');
 * await coreBackend.connect();
 * ```
 */
export class BackendPool {
  private baseUrl: string;
  private backendConfigs: Map<string, BackendConfig>;
  private backendClients: Map<string, BackendClient>;
  private poolEntries: Map<string, BackendPoolEntry>;
  private auth?: AuthenticationClient;
  private middleware?: IMiddlewareManager;
  private defaultTimeout: number;
  private defaultHeaders: Record<string, string>;
  private healthCheckInterval: number;
  private healthCheckTimer?: ReturnType<typeof setInterval>;
  private enableHealthChecks: boolean;

  constructor(options: BackendPoolOptions) {
    this.baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl.slice(0, -1) : options.baseUrl;
    this.backendConfigs = new Map(Object.entries(options.backends));
    this.backendClients = new Map();
    this.poolEntries = new Map();
    this.auth = options.auth;
    this.middleware = options.middleware;
    this.defaultTimeout = options.defaultTimeout || 30000;
    this.defaultHeaders = options.defaultHeaders || {};
    this.healthCheckInterval = options.healthCheckInterval || 30000;
    this.enableHealthChecks = options.enableHealthChecks || false;

    // Initialize pool entries
    for (const [name, config] of this.backendConfigs) {
      this.poolEntries.set(name, {
        name,
        config,
        connected: false,
        healthy: true,
      });
    }

    // Start health checks if enabled
    if (this.enableHealthChecks) {
      this.startHealthChecks();
    }
  }

  /**
   * Get a backend client by name
   *
   * Creates the client lazily on first access.
   *
   * @param name - Backend name
   * @returns Backend client instance
   * @throws Error if backend not found
   */
  get(name: string): BackendClient {
    // Check if client already exists
    let client = this.backendClients.get(name);
    if (client) {
      return client;
    }

    // Get config
    const config = this.backendConfigs.get(name);
    if (!config) {
      throw new Error(`Backend '${name}' not found in pool`);
    }

    // Resolve per-backend auth (overrides shared auth)
    let backendAuth: AuthenticationClient | undefined;
    if (config.auth) {
      backendAuth =
        config.auth instanceof AuthenticationClient
          ? config.auth
          : new AuthenticationClient(config.auth as AuthOptions);
    }

    // Create new client
    const options: BackendClientOptions = {
      name,
      config,
      baseUrl: this.baseUrl,
      auth: backendAuth || this.auth,
      middleware: this.middleware,
      defaultTimeout: this.defaultTimeout,
      defaultHeaders: this.defaultHeaders,
    };

    client = new BackendClient(options);
    this.backendClients.set(name, client);

    return client;
  }

  /**
   * Check if a backend exists in the pool
   *
   * @param name - Backend name
   * @returns true if backend exists
   */
  has(name: string): boolean {
    return this.backendConfigs.has(name);
  }

  /**
   * Get all backend names
   *
   * @returns Array of backend names
   */
  getNames(): string[] {
    return Array.from(this.backendConfigs.keys());
  }

  /**
   * Connect to a specific backend
   *
   * @param name - Backend name
   */
  async connect(name: string): Promise<void> {
    const client = this.get(name);
    await client.connect();

    const entry = this.poolEntries.get(name);
    if (entry) {
      entry.connected = true;
      entry.healthy = true;
    }
  }

  /**
   * Connect to all backends
   */
  async connectAll(): Promise<void> {
    const connectPromises = Array.from(this.backendConfigs.keys()).map((name) => this.connect(name));
    await Promise.all(connectPromises);
  }

  /**
   * Disconnect from a specific backend
   *
   * @param name - Backend name
   */
  async disconnect(name: string): Promise<void> {
    const client = this.backendClients.get(name);
    if (client) {
      await client.disconnect();

      const entry = this.poolEntries.get(name);
      if (entry) {
        entry.connected = false;
      }
    }
  }

  /**
   * Disconnect from all backends
   */
  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.backendClients.keys()).map((name) => this.disconnect(name));
    await Promise.all(disconnectPromises);
  }

  /**
   * Check if a specific backend is connected
   *
   * @param name - Backend name
   * @returns true if connected
   */
  isConnected(name: string): boolean {
    const client = this.backendClients.get(name);
    return client?.isConnected() || false;
  }

  /**
   * Check if all backends are connected
   *
   * @returns true if all backends are connected
   */
  allConnected(): boolean {
    for (const name of this.backendConfigs.keys()) {
      if (!this.isConnected(name)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get metrics for a specific backend
   *
   * @param name - Backend name
   * @returns Connection metrics
   */
  getMetrics(name: string): ConnectionMetrics {
    const client = this.backendClients.get(name);
    if (client) {
      return client.getMetrics();
    }

    const config = this.backendConfigs.get(name);
    return {
      id: name,
      url: config ? `${this.baseUrl}${config.path}` : this.baseUrl,
      state: ConnectionState.DISCONNECTED,
      transport: config?.transport || 'http',
      requestsSent: 0,
      responsesReceived: 0,
      errors: 0,
    };
  }

  /**
   * Get aggregated metrics for all backends
   *
   * @returns Aggregated multi-backend metrics
   */
  getAggregatedMetrics(): MultiBackendMetrics {
    const backends: Record<string, ConnectionMetrics> = {};
    let totalRequestsSent = 0;
    let totalResponsesReceived = 0;
    let totalErrors = 0;
    let totalLatency = 0;
    let latencyCount = 0;

    for (const name of this.backendConfigs.keys()) {
      const metrics = this.getMetrics(name);
      backends[name] = metrics;
      totalRequestsSent += metrics.requestsSent;
      totalResponsesReceived += metrics.responsesReceived;
      totalErrors += metrics.errors;

      if (metrics.avgLatency !== undefined) {
        totalLatency += metrics.avgLatency;
        latencyCount++;
      }
    }

    return {
      backends,
      totalRequestsSent,
      totalResponsesReceived,
      totalErrors,
      avgLatency: latencyCount > 0 ? totalLatency / latencyCount : 0,
    };
  }

  /**
   * Get pool entry information for a backend
   *
   * @param name - Backend name
   * @returns Pool entry or undefined
   */
  getPoolEntry(name: string): BackendPoolEntry | undefined {
    return this.poolEntries.get(name);
  }

  /**
   * Get all pool entries
   *
   * @returns Array of pool entries
   */
  getAllPoolEntries(): BackendPoolEntry[] {
    return Array.from(this.poolEntries.values());
  }

  /**
   * Perform health check on a specific backend
   *
   * @param name - Backend name
   * @returns true if healthy
   */
  async checkHealth(name: string): Promise<boolean> {
    const entry = this.poolEntries.get(name);
    if (!entry) {
      return false;
    }

    try {
      const client = this.backendClients.get(name);
      if (!client) {
        entry.healthy = false;
        entry.lastHealthCheck = Date.now();
        return false;
      }

      // Check connection status
      const isConnected = client.isConnected();
      entry.healthy = isConnected;
      entry.lastHealthCheck = Date.now();

      return isConnected;
    } catch {
      entry.healthy = false;
      entry.lastHealthCheck = Date.now();
      return false;
    }
  }

  /**
   * Perform health check on all backends
   *
   * @returns Map of backend names to health status
   */
  async checkAllHealth(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    const healthChecks = Array.from(this.backendConfigs.keys()).map(async (name) => {
      const healthy = await this.checkHealth(name);
      results.set(name, healthy);
    });

    await Promise.all(healthChecks);
    return results;
  }

  /**
   * Get list of healthy backends
   *
   * @returns Array of healthy backend names
   */
  getHealthyBackends(): string[] {
    return Array.from(this.poolEntries.values())
      .filter((entry) => entry.healthy)
      .map((entry) => entry.name);
  }

  /**
   * Get list of unhealthy backends
   *
   * @returns Array of unhealthy backend names
   */
  getUnhealthyBackends(): string[] {
    return Array.from(this.poolEntries.values())
      .filter((entry) => !entry.healthy)
      .map((entry) => entry.name);
  }

  /**
   * Start periodic health checks
   */
  startHealthChecks(): void {
    if (this.healthCheckTimer) {
      return;
    }

    this.healthCheckTimer = setInterval(async () => {
      await this.checkAllHealth();
    }, this.healthCheckInterval);
  }

  /**
   * Stop periodic health checks
   */
  stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  /**
   * Add a new backend to the pool
   *
   * @param name - Backend name
   * @param config - Backend configuration
   */
  addBackend(name: string, config: BackendConfig): void {
    if (this.backendConfigs.has(name)) {
      throw new Error(`Backend '${name}' already exists in pool`);
    }

    this.backendConfigs.set(name, config);
    this.poolEntries.set(name, {
      name,
      config,
      connected: false,
      healthy: true,
    });
  }

  /**
   * Remove a backend from the pool
   *
   * @param name - Backend name
   */
  async removeBackend(name: string): Promise<void> {
    // Disconnect if connected
    const client = this.backendClients.get(name);
    if (client) {
      await client.destroy();
      this.backendClients.delete(name);
    }

    this.backendConfigs.delete(name);
    this.poolEntries.delete(name);
  }

  /**
   * Update backend configuration
   *
   * @param name - Backend name
   * @param config - New configuration
   */
  async updateBackend(name: string, config: BackendConfig): Promise<void> {
    if (!this.backendConfigs.has(name)) {
      throw new Error(`Backend '${name}' not found in pool`);
    }

    // Remove existing client
    const existingClient = this.backendClients.get(name);
    if (existingClient) {
      await existingClient.destroy();
      this.backendClients.delete(name);
    }

    // Update config
    this.backendConfigs.set(name, config);
    this.poolEntries.set(name, {
      name,
      config,
      connected: false,
      healthy: true,
    });
  }

  /**
   * Destroy all backends and release resources
   */
  async destroy(): Promise<void> {
    // Stop health checks
    this.stopHealthChecks();

    // Destroy all clients
    const destroyPromises = Array.from(this.backendClients.values()).map((client) => client.destroy());
    await Promise.all(destroyPromises);

    // Clear maps
    this.backendClients.clear();
    this.backendConfigs.clear();
    this.poolEntries.clear();
  }
}
