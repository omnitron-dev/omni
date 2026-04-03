/**
 * Multi-Backend Client Types
 *
 * Type definitions for the multi-backend routing system that enables
 * isomorphic usage between browser and Node.js/Bun environments.
 *
 * @module @omnitron-dev/titan/netron/multi-backend
 */

import type { ConnectionState } from '../transport/types.js';

/**
 * Transport type for backend connections
 */
export type TransportType = 'http' | 'websocket';

/**
 * Backend health status
 */
export type BackendHealth = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

/**
 * Load balancing strategy
 */
export type LoadBalancingStrategy = 'round-robin' | 'random' | 'least-connections' | 'weighted';

/**
 * Backend configuration for connecting to a Netron server
 */
export interface BackendConfig {
  /**
   * Unique identifier for this backend
   */
  id: string;

  /**
   * Base URL for the backend server
   */
  url: string;

  /**
   * Preferred transport type
   * @default 'http'
   */
  transport?: TransportType;

  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  timeout?: number;

  /**
   * Custom headers to include in requests
   */
  headers?: Record<string, string>;

  /**
   * Weight for weighted load balancing (higher = more traffic)
   * @default 1
   */
  weight?: number;

  /**
   * Services provided by this backend (for service-based routing)
   */
  services?: string[];

  /**
   * Region/zone for locality-aware routing
   */
  region?: string;

  /**
   * Enable WebSocket for this backend
   * @default false
   */
  websocket?: {
    /**
     * WebSocket protocols
     */
    protocols?: string | string[];

    /**
     * Enable automatic reconnection
     * @default true
     */
    reconnect?: boolean;

    /**
     * Reconnection interval in milliseconds
     * @default 1000
     */
    reconnectInterval?: number;

    /**
     * Maximum reconnection attempts
     * @default Infinity
     */
    maxReconnectAttempts?: number;
  };

  /**
   * HTTP-specific options
   */
  http?: {
    /**
     * Enable request retry
     * @default false
     */
    retry?: boolean;

    /**
     * Maximum retry attempts
     * @default 3
     */
    maxRetries?: number;
  };
}

/**
 * Backend status information
 */
export interface BackendStatus {
  /**
   * Backend identifier
   */
  id: string;

  /**
   * Backend URL
   */
  url: string;

  /**
   * Current health status
   */
  health: BackendHealth;

  /**
   * Connection state
   */
  state: ConnectionState | 'connected' | 'disconnected' | 'connecting' | 'reconnecting' | 'failed';

  /**
   * Current active connections
   */
  activeConnections: number;

  /**
   * Total requests sent
   */
  requestsSent: number;

  /**
   * Total responses received
   */
  responsesReceived: number;

  /**
   * Total errors
   */
  errors: number;

  /**
   * Average latency in milliseconds
   */
  avgLatency?: number;

  /**
   * Last health check timestamp
   */
  lastHealthCheck?: number;

  /**
   * Last successful request timestamp
   */
  lastSuccess?: number;

  /**
   * Last error timestamp
   */
  lastError?: number;

  /**
   * Services available on this backend
   */
  services: string[];

  /**
   * Backend region
   */
  region?: string;
}

/**
 * Service routing rule
 */
export interface ServiceRoute {
  /**
   * Service name or pattern (supports wildcards)
   */
  service: string;

  /**
   * Target backend IDs
   */
  backends: string[];

  /**
   * Load balancing strategy for this service
   */
  strategy?: LoadBalancingStrategy;

  /**
   * Fallback backend IDs if primary backends are unavailable
   */
  fallback?: string[];
}

/**
 * Service router configuration
 */
export interface ServiceRouterConfig {
  /**
   * Service routing rules
   */
  routes: ServiceRoute[];

  /**
   * Default backend IDs for unmatched services
   */
  defaultBackends?: string[];

  /**
   * Default load balancing strategy
   * @default 'round-robin'
   */
  defaultStrategy?: LoadBalancingStrategy;

  /**
   * Enable locality-aware routing
   * @default false
   */
  localityAware?: boolean;

  /**
   * Client region for locality-aware routing
   */
  clientRegion?: string;
}

/**
 * Multi-backend client options
 */
export interface MultiBackendClientOptions {
  /**
   * Backend configurations
   */
  backends: BackendConfig[];

  /**
   * Service router configuration
   */
  router?: ServiceRouterConfig;

  /**
   * Default transport type
   * @default 'http'
   */
  defaultTransport?: TransportType;

  /**
   * Global request timeout in milliseconds
   * @default 30000
   */
  timeout?: number;

  /**
   * Global custom headers
   */
  headers?: Record<string, string>;

  /**
   * Enable health checks
   * @default true
   */
  healthChecks?: boolean;

  /**
   * Health check interval in milliseconds
   * @default 30000
   */
  healthCheckInterval?: number;

  /**
   * Number of consecutive failures before marking backend unhealthy
   * @default 3
   */
  unhealthyThreshold?: number;

  /**
   * Number of consecutive successes before marking backend healthy
   * @default 2
   */
  healthyThreshold?: number;

  /**
   * Enable automatic failover
   * @default true
   */
  failover?: boolean;

  /**
   * Maximum failover attempts
   * @default 2
   */
  maxFailoverAttempts?: number;

  /**
   * Circuit breaker configuration
   */
  circuitBreaker?: {
    /**
     * Enable circuit breaker
     * @default false
     */
    enabled?: boolean;

    /**
     * Error threshold before opening circuit
     * @default 5
     */
    threshold?: number;

    /**
     * Time window for error tracking in milliseconds
     * @default 60000
     */
    window?: number;

    /**
     * Time before attempting to close circuit in milliseconds
     * @default 30000
     */
    resetTimeout?: number;
  };
}

/**
 * Request context for multi-backend calls
 */
export interface MultiBackendRequestContext {
  /**
   * Force specific backend for this request
   */
  backendId?: string;

  /**
   * Request trace ID
   */
  traceId?: string;

  /**
   * Request span ID
   */
  spanId?: string;

  /**
   * User ID for request context
   */
  userId?: string;

  /**
   * Custom metadata
   */
  metadata?: Record<string, unknown>;

  /**
   * Request headers
   */
  headers?: Record<string, string>;
}

/**
 * Request hints for multi-backend calls
 */
export interface MultiBackendRequestHints {
  /**
   * Request timeout override
   */
  timeout?: number;

  /**
   * Enable caching for this request
   */
  cacheable?: boolean;

  /**
   * Request priority
   */
  priority?: 'high' | 'normal' | 'low';

  /**
   * Disable failover for this request
   */
  noFailover?: boolean;
}

/**
 * Multi-backend client metrics
 */
export interface MultiBackendMetrics {
  /**
   * Total requests across all backends
   */
  totalRequests: number;

  /**
   * Total errors across all backends
   */
  totalErrors: number;

  /**
   * Total failovers performed
   */
  totalFailovers: number;

  /**
   * Average latency across all backends
   */
  avgLatency?: number;

  /**
   * Per-backend metrics
   */
  backends: BackendStatus[];

  /**
   * Circuit breaker states
   */
  circuitBreakers?: Record<
    string,
    {
      state: 'closed' | 'open' | 'half-open';
      failures: number;
      lastFailure?: number;
    }
  >;
}

/**
 * Backend selection result
 */
export interface BackendSelection {
  /**
   * Selected backend ID
   */
  backendId: string;

  /**
   * Reason for selection
   */
  reason: 'route' | 'default' | 'fallback' | 'failover' | 'forced';

  /**
   * Alternative backends if primary fails
   */
  alternatives?: string[];
}

/**
 * Connection metrics for individual backends
 */
export interface ConnectionMetrics {
  /**
   * Connection ID
   */
  id: string;

  /**
   * Backend URL
   */
  url: string;

  /**
   * Connection state
   */
  state: ConnectionState | 'connected' | 'disconnected' | 'connecting' | 'reconnecting' | 'failed';

  /**
   * Transport type
   */
  transport: TransportType;

  /**
   * Connected timestamp
   */
  connectedAt?: number;

  /**
   * Disconnected timestamp
   */
  disconnectedAt?: number;

  /**
   * Total requests sent
   */
  requestsSent: number;

  /**
   * Total responses received
   */
  responsesReceived: number;

  /**
   * Total errors
   */
  errors: number;

  /**
   * Average latency in milliseconds
   */
  avgLatency?: number;
}
