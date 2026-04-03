/**
 * Multi-Backend Client
 *
 * High-level client that manages multiple backend connections with
 * intelligent routing, load balancing, health monitoring, and failover.
 *
 * @module @omnitron-dev/titan/netron/multi-backend
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import { BackendPool } from './backend-pool.js';
import { BackendClient } from './backend-client.js';
import { ServiceRouter } from './service-router.js';
import { TitanError, ErrorCode } from '../../errors/index.js';
import type {
  MultiBackendClientOptions,
  BackendConfig,
  BackendStatus,
  BackendHealth,
  MultiBackendMetrics,
  MultiBackendRequestContext,
  MultiBackendRequestHints,
  ServiceRoute,
  ServiceRouterConfig,
} from './types.js';

/**
 * Multi-backend client events
 */
export interface MultiBackendClientEvents {
  connect: () => void;
  disconnect: () => void;
  backendConnect: (backendId: string) => void;
  backendDisconnect: (backendId: string, reason?: string) => void;
  backendHealthChange: (backendId: string, health: BackendHealth) => void;
  backendError: (backendId: string, error: Error) => void;
  failover: (from: string, to: string, service: string) => void;
  error: (error: Error) => void;
}

/**
 * Circuit breaker state
 */
interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailure?: number;
  lastAttempt?: number;
}

/**
 * Default client options
 */
const DEFAULT_OPTIONS: Required<
  Pick<
    MultiBackendClientOptions,
    | 'defaultTransport'
    | 'timeout'
    | 'healthChecks'
    | 'healthCheckInterval'
    | 'unhealthyThreshold'
    | 'healthyThreshold'
    | 'failover'
    | 'maxFailoverAttempts'
  >
> = {
  defaultTransport: 'http',
  timeout: 30000,
  healthChecks: true,
  healthCheckInterval: 30000,
  unhealthyThreshold: 3,
  healthyThreshold: 2,
  failover: true,
  maxFailoverAttempts: 2,
};

/**
 * Multi-Backend Client
 *
 * Provides a unified interface to multiple backend servers with:
 * - Intelligent service-based routing
 * - Load balancing (round-robin, random, least-connections, weighted)
 * - Health monitoring and automatic failover
 * - Circuit breaker pattern
 * - Connection pooling
 */
export class MultiBackendClient extends EventEmitter {
  private pool: BackendPool;
  private router: ServiceRouter;
  private options: MultiBackendClientOptions & typeof DEFAULT_OPTIONS;
  private circuitBreakers: Map<string, CircuitBreakerState>;
  private totalFailovers = 0;
  private isConnected = false;

  constructor(options: MultiBackendClientOptions) {
    super();

    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    // Initialize components
    this.pool = new BackendPool({
      healthChecks: this.options.healthChecks,
      healthCheckInterval: this.options.healthCheckInterval,
      unhealthyThreshold: this.options.unhealthyThreshold,
      healthyThreshold: this.options.healthyThreshold,
    });

    this.router = new ServiceRouter(this.options.router);
    this.circuitBreakers = new Map();

    // Set up pool event handlers
    this.setupPoolEventHandlers();

    // Initialize backends
    this.initializeBackends(options.backends);
  }

  /**
   * Set up event handlers for the backend pool
   */
  private setupPoolEventHandlers(): void {
    this.pool.on('backendConnect', (backendId: string) => {
      this.emit('backendConnect', backendId);
    });

    this.pool.on('backendDisconnect', (backendId: string, reason: string) => {
      this.emit('backendDisconnect', backendId, reason);
    });

    this.pool.on('backendHealthChange', (backendId: string, health: BackendHealth) => {
      this.emit('backendHealthChange', backendId, health);
    });

    this.pool.on('backendError', (backendId: string, error: Error) => {
      this.emit('backendError', backendId, error);
    });
  }

  /**
   * Initialize backends from configuration
   */
  private initializeBackends(configs: BackendConfig[]): void {
    for (const config of configs) {
      // Apply defaults
      const fullConfig: BackendConfig = {
        ...config,
        transport: config.transport ?? this.options.defaultTransport,
        timeout: config.timeout ?? this.options.timeout,
        headers: { ...this.options.headers, ...config.headers },
      };

      this.pool.addBackend(fullConfig);

      // Initialize circuit breaker if enabled
      if (this.options.circuitBreaker?.enabled) {
        this.circuitBreakers.set(config.id, {
          state: 'closed',
          failures: 0,
        });
      }
    }
  }

  /**
   * Connect to all backends
   */
  async connect(): Promise<void> {
    if (this.isConnected) return;

    await this.pool.start();
    this.isConnected = true;
    this.emit('connect');
  }

  /**
   * Disconnect from all backends
   */
  async disconnect(): Promise<void> {
    if (!this.isConnected) return;

    await this.pool.stop();
    this.isConnected = false;
    this.emit('disconnect');
  }

  /**
   * Invoke a service method with automatic routing and failover
   */
  async invoke<T = unknown>(
    service: string,
    method: string,
    args: unknown[] = [],
    options?: {
      context?: MultiBackendRequestContext;
      hints?: MultiBackendRequestHints;
    }
  ): Promise<T> {
    if (!this.isConnected) {
      throw new TitanError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Multi-backend client is not connected',
      });
    }

    // Get available backends
    const availableBackends = this.pool.getBackendStatuses();
    const healthyBackends = availableBackends.filter((b) => b.health !== 'unhealthy' && this.isCircuitClosed(b.id));

    if (healthyBackends.length === 0) {
      throw new TitanError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'No healthy backends available',
        details: { service, method },
      });
    }

    // Select backend using router
    const selection = this.router.selectBackend(service, healthyBackends, {
      forcedBackendId: options?.context?.backendId,
      clientRegion: this.options.router?.clientRegion,
    });

    if (!selection) {
      throw new TitanError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: `No backend available for service ${service}`,
        details: { service, method },
      });
    }

    // Attempt invocation with failover
    return this.invokeWithFailover<T>(service, method, args, selection, options);
  }

  /**
   * Invoke with automatic failover
   */
  private async invokeWithFailover<T>(
    service: string,
    method: string,
    args: unknown[],
    selection: { backendId: string; alternatives?: string[] },
    options?: {
      context?: MultiBackendRequestContext;
      hints?: MultiBackendRequestHints;
    },
    attempt = 0
  ): Promise<T> {
    const backend = this.pool.getBackend(selection.backendId);
    if (!backend) {
      throw new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: `Backend ${selection.backendId} not found`,
      });
    }

    try {
      // Update connection count for load balancing
      this.router.incrementConnections(selection.backendId);

      const result = await backend.invoke<T>(service, method, args, options);

      // Success - reset circuit breaker
      this.recordSuccess(selection.backendId);

      this.router.decrementConnections(selection.backendId);
      return result;
    } catch (error) {
      this.router.decrementConnections(selection.backendId);

      // Record failure for circuit breaker
      this.recordFailure(selection.backendId);

      // Check if we should failover
      const shouldFailover =
        this.options.failover &&
        !options?.hints?.noFailover &&
        attempt < this.options.maxFailoverAttempts &&
        selection.alternatives &&
        selection.alternatives.length > 0;

      if (shouldFailover) {
        // Find next available backend
        const nextBackendId = selection.alternatives!.find((id) => this.isCircuitClosed(id));

        if (nextBackendId) {
          this.totalFailovers++;
          this.emit('failover', selection.backendId, nextBackendId, service);

          // Remove used backend from alternatives
          const remainingAlternatives = selection.alternatives!.filter((id) => id !== nextBackendId);

          return this.invokeWithFailover<T>(
            service,
            method,
            args,
            { backendId: nextBackendId, alternatives: remainingAlternatives },
            options,
            attempt + 1
          );
        }
      }

      // No more failover options, throw the error
      throw error;
    }
  }

  /**
   * Check if circuit breaker allows requests
   */
  private isCircuitClosed(backendId: string): boolean {
    if (!this.options.circuitBreaker?.enabled) return true;

    const breaker = this.circuitBreakers.get(backendId);
    if (!breaker) return true;

    if (breaker.state === 'closed') return true;

    if (breaker.state === 'half-open') {
      // Allow one request through
      return true;
    }

    // Circuit is open - check if reset timeout has passed
    const resetTimeout = this.options.circuitBreaker.resetTimeout ?? 30000;
    if (breaker.lastFailure && Date.now() - breaker.lastFailure > resetTimeout) {
      // Transition to half-open
      breaker.state = 'half-open';
      return true;
    }

    return false;
  }

  /**
   * Record successful request for circuit breaker
   */
  private recordSuccess(backendId: string): void {
    if (!this.options.circuitBreaker?.enabled) return;

    const breaker = this.circuitBreakers.get(backendId);
    if (!breaker) return;

    // If we were half-open, close the circuit
    if (breaker.state === 'half-open') {
      breaker.state = 'closed';
      breaker.failures = 0;
    }
  }

  /**
   * Record failed request for circuit breaker
   */
  private recordFailure(backendId: string): void {
    if (!this.options.circuitBreaker?.enabled) return;

    const breaker = this.circuitBreakers.get(backendId);
    if (!breaker) return;

    breaker.failures++;
    breaker.lastFailure = Date.now();

    // If we were half-open, re-open the circuit
    if (breaker.state === 'half-open') {
      breaker.state = 'open';
      return;
    }

    // Check if we should open the circuit
    const threshold = this.options.circuitBreaker.threshold ?? 5;
    if (breaker.failures >= threshold) {
      breaker.state = 'open';
    }
  }

  /**
   * Create a service proxy for type-safe method calls
   */
  service<T extends object>(serviceName: string): T {
    return new Proxy({} as T, {
      get:
        (_target, prop: string) =>
        async (...args: unknown[]) =>
          this.invoke(serviceName, prop, args),
    });
  }

  /**
   * Add a backend dynamically
   */
  addBackend(config: BackendConfig): void {
    const fullConfig: BackendConfig = {
      ...config,
      transport: config.transport ?? this.options.defaultTransport,
      timeout: config.timeout ?? this.options.timeout,
      headers: { ...this.options.headers, ...config.headers },
    };

    this.pool.addBackend(fullConfig);

    if (this.options.circuitBreaker?.enabled) {
      this.circuitBreakers.set(config.id, {
        state: 'closed',
        failures: 0,
      });
    }
  }

  /**
   * Remove a backend dynamically
   */
  async removeBackend(backendId: string): Promise<boolean> {
    const removed = await this.pool.removeBackend(backendId);
    if (removed) {
      this.circuitBreakers.delete(backendId);
    }
    return removed;
  }

  /**
   * Add a service route
   */
  addRoute(route: ServiceRoute): void {
    this.router.addRoute(route);
  }

  /**
   * Remove a service route
   */
  removeRoute(serviceName: string): boolean {
    return this.router.removeRoute(serviceName);
  }

  /**
   * Update router configuration
   */
  updateRouterConfig(config: Partial<ServiceRouterConfig>): void {
    this.router.updateConfig(config);
  }

  /**
   * Get all backend statuses
   */
  getBackendStatuses(): BackendStatus[] {
    return this.pool.getBackendStatuses();
  }

  /**
   * Get a specific backend status
   */
  getBackendStatus(backendId: string): BackendStatus | undefined {
    return this.pool.getBackendStatus(backendId);
  }

  /**
   * Get client metrics
   */
  getMetrics(): MultiBackendMetrics {
    const backends = this.pool.getBackendStatuses();

    const totalRequests = backends.reduce((sum, b) => sum + b.requestsSent, 0);
    const totalErrors = backends.reduce((sum, b) => sum + b.errors, 0);

    const latencies = backends.filter((b) => b.avgLatency !== undefined).map((b) => b.avgLatency!);
    const avgLatency = latencies.length > 0 ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length : undefined;

    const circuitBreakerStates: Record<
      string,
      { state: 'closed' | 'open' | 'half-open'; failures: number; lastFailure?: number }
    > = {};
    if (this.options.circuitBreaker?.enabled) {
      for (const [id, breaker] of this.circuitBreakers) {
        circuitBreakerStates[id] = {
          state: breaker.state,
          failures: breaker.failures,
          lastFailure: breaker.lastFailure,
        };
      }
    }

    return {
      totalRequests,
      totalErrors,
      totalFailovers: this.totalFailovers,
      avgLatency,
      backends,
      circuitBreakers: this.options.circuitBreaker?.enabled ? circuitBreakerStates : undefined,
    };
  }

  /**
   * Get backend by ID
   */
  getBackend(backendId: string): BackendClient | undefined {
    return this.pool.getBackend(backendId);
  }

  /**
   * Get all backends
   */
  getAllBackends(): BackendClient[] {
    return this.pool.getAllBackends();
  }

  /**
   * Get healthy backends
   */
  getHealthyBackends(): BackendClient[] {
    return this.pool.getHealthyBackends();
  }

  /**
   * Force health check on all backends
   */
  async healthCheck(): Promise<Map<string, boolean>> {
    return this.pool.runHealthChecks();
  }

  /**
   * Force reconnect a backend
   */
  async reconnectBackend(backendId: string): Promise<void> {
    await this.pool.reconnectBackend(backendId);

    // Reset circuit breaker
    const breaker = this.circuitBreakers.get(backendId);
    if (breaker) {
      breaker.state = 'closed';
      breaker.failures = 0;
    }
  }

  /**
   * Force reconnect all backends
   */
  async reconnectAll(): Promise<void> {
    await this.pool.reconnectAll();

    // Reset all circuit breakers
    for (const breaker of this.circuitBreakers.values()) {
      breaker.state = 'closed';
      breaker.failures = 0;
    }
  }

  /**
   * Reset all metrics
   */
  resetMetrics(): void {
    this.pool.resetAllMetrics();
    this.totalFailovers = 0;
  }

  /**
   * Get pool statistics
   */
  getPoolStatistics(): {
    total: number;
    connected: number;
    healthy: number;
    unhealthy: number;
    degraded: number;
    unknown: number;
  } {
    return this.pool.getStatistics();
  }

  /**
   * Check if client is connected
   */
  isClientConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Check if any backend is available
   */
  hasAvailableBackend(): boolean {
    return this.pool.hasHealthyBackend();
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    await this.disconnect();
    await this.pool.dispose();
    this.circuitBreakers.clear();
    this.removeAllListeners();
  }
}

/**
 * Create a multi-backend client instance
 */
export function createMultiBackendClient(options: MultiBackendClientOptions): MultiBackendClient {
  return new MultiBackendClient(options);
}
