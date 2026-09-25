/**
 * Health Check Types
 *
 * Unified type definitions for the health check system.
 *
 * @module titan/modules/health
 */

/**
 * Health status enumeration
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Result from a single health indicator check
 */
export interface HealthIndicatorResult {
  /**
   * The status of this health indicator
   */
  status: HealthStatus;

  /**
   * Human-readable message describing the health state
   */
  message?: string;

  /**
   * Additional details about the health check
   */
  details?: Record<string, unknown>;

  /**
   * Time taken to perform the health check in milliseconds
   */
  latency?: number;

  /**
   * Timestamp when the check was performed
   */
  timestamp?: Date;

  /**
   * Error information if the check failed
   */
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };
}

/**
 * Overall health check result aggregating all indicators
 */
export interface HealthCheckResult {
  /**
   * Overall health status (worst of all indicators)
   */
  status: HealthStatus;

  /**
   * Map of indicator names to their results
   */
  indicators: Record<string, HealthIndicatorResult>;

  /**
   * Timestamp when the health check was performed
   */
  timestamp: Date;

  /**
   * Total time taken to perform all health checks
   */
  totalLatency?: number;

  /**
   * Version information (optional)
   */
  version?: string;

  /**
   * Uptime in milliseconds (optional)
   */
  uptime?: number;
}

/**
 * Database health indicator options
 */
export interface DatabaseIndicatorOptions {
  /**
   * Query latency threshold for degraded status (ms)
   * @default 100
   */
  latencyDegradedThreshold?: number;

  /**
   * Query latency threshold for unhealthy status (ms)
   * @default 1000
   */
  latencyUnhealthyThreshold?: number;

  /**
   * Custom health check query
   * @default 'SELECT 1'
   */
  healthQuery?: string;

  /**
   * Timeout for health check query (ms)
   * @default 5000
   */
  timeout?: number;
}

/**
 * Redis health indicator options
 */
export interface RedisIndicatorOptions {
  /**
   * Ping latency threshold for degraded status (ms)
   * @default 10
   */
  latencyDegradedThreshold?: number;

  /**
   * Ping latency threshold for unhealthy status (ms)
   * @default 100
   */
  latencyUnhealthyThreshold?: number;

  /**
   * Timeout for health check (ms)
   * @default 5000
   */
  timeout?: number;

  /**
   * Include memory info in health check
   * @default false
   */
  includeMemoryInfo?: boolean;

  /**
   * Memory usage threshold for degraded status (ratio 0-1)
   * @default 0.8
   */
  memoryDegradedThreshold?: number;

  /**
   * Memory usage threshold for unhealthy status (ratio 0-1)
   * @default 0.95
   */
  memoryUnhealthyThreshold?: number;
}

/**
 * Health module configuration options
 */
export interface HealthModuleOptions {
  /**
   * Enable built-in memory indicator
   * @default true
   */
  enableMemoryIndicator?: boolean;

  /**
   * Enable built-in event loop indicator
   * @default true
   */
  enableEventLoopIndicator?: boolean;

  /**
   * Enable built-in disk indicator
   * @default false
   */
  enableDiskIndicator?: boolean;

  /**
   * Enable database health indicator
   * Requires databaseConnection to be provided
   * @default false
   */
  enableDatabaseIndicator?: boolean;

  /**
   * Database connection for health checks
   * Compatible with Kysely, pg, mysql2
   */
  databaseConnection?: {
    execute?(query: string): Promise<unknown>;
    raw?(query: string): { execute(): Promise<unknown> };
    query?(query: string): Promise<unknown>;
  };

  /**
   * Enable Redis health indicator
   * Requires redisClient to be provided
   * @default false
   */
  enableRedisIndicator?: boolean;

  /**
   * Redis client for health checks
   * Compatible with ioredis and node-redis
   */
  redisClient?: {
    ping(): Promise<string>;
    info?(section?: string): Promise<string>;
    status?: string;
    isReady?: boolean;
  };

  /**
   * Default timeout for health checks in milliseconds
   * @default 5000
   */
  timeout?: number;

  /**
   * Enable caching of health check results
   * @default false
   */
  enableCaching?: boolean;

  /**
   * Cache TTL in milliseconds (if caching is enabled)
   * @default 1000
   */
  cacheTtl?: number;

  /**
   * Enable Netron RPC service
   *
   * With `forRootAsync` this is read from the async options themselves, not
   * from what the factory returns: the providers are registered before the
   * factory runs (see `HealthModuleAsyncOptions.enableRpcService`).
   * @default true
   */
  enableRpcService?: boolean;

  /**
   * Application version to include in health responses
   */
  version?: string;

  /**
   * Make the module global
   * @default false
   */
  isGlobal?: boolean;

  /**
   * Custom indicators to register
   */
  indicators?: Array<new (...args: any[]) => IHealthIndicator>;

  /**
   * Memory indicator thresholds
   */
  memoryThresholds?: MemoryThresholds;

  /**
   * Event loop thresholds
   */
  eventLoopThresholds?: EventLoopThresholds;

  /**
   * Disk indicator thresholds
   */
  diskThresholds?: DiskThresholds;

  /**
   * Database indicator options
   */
  databaseOptions?: DatabaseIndicatorOptions;

  /**
   * Redis indicator options
   */
  redisOptions?: RedisIndicatorOptions;
}

/**
 * Async configuration options
 */
export interface HealthModuleAsyncOptions {
  /**
   * Factory function to create options
   */
  useFactory?: (...args: any[]) => Promise<HealthModuleOptions> | HealthModuleOptions;

  /**
   * Dependencies to inject into the factory
   */
  inject?: any[];

  /**
   * Imports required for the factory
   */
  imports?: any[];

  /**
   * Make the module global
   */
  isGlobal?: boolean;

  /**
   * Whether `Health@1.0.0` goes on the wire. Read HERE, when the module is
   * registered — the factory's options arrive after the providers exist, so a
   * flag returned from the factory could never take effect. It never did:
   * daos storage and paysys returned `enableRpcService: false` from their
   * factories («We use our own RPC service») and served `Health@1.0.0.check`
   * to anonymous callers through the public gateway anyway (2026-09-25). A
   * A factory that still returns `false` gets a registered service that
   * answers every call as a missing service would; put the flag here to keep
   * it off the wire altogether.
   * @default true
   */
  enableRpcService?: boolean;
}

/**
 * Memory health indicator thresholds
 */
export interface MemoryThresholds {
  /**
   * Share of the heap LIMIT (`v8.getHeapStatistics().heap_size_limit`) in use
   * that triggers degraded status — not of `heapTotal`, which V8 keeps close
   * to what is in use whatever the pressure
   * @default 0.7 (70%)
   */
  heapDegradedThreshold?: number;

  /**
   * Share of the heap limit in use that triggers unhealthy status
   * @default 0.9 (90%)
   */
  heapUnhealthyThreshold?: number;

  /**
   * RSS memory limit in bytes (optional)
   */
  rssLimit?: number;

  /**
   * External memory limit in bytes (optional)
   */
  externalLimit?: number;
}

/**
 * Event loop health indicator thresholds
 */
export interface EventLoopThresholds {
  /**
   * Event loop lag in ms that triggers degraded status
   * @default 50
   */
  lagDegradedThreshold?: number;

  /**
   * Event loop lag in ms that triggers unhealthy status
   * @default 100
   */
  lagUnhealthyThreshold?: number;

  /**
   * A single delay in ms, anywhere in the window, that reads as a STALL —
   * degraded, because the loop ran nothing for that long. Separate from the
   * lag thresholds, which are read off p99: one stall is one sample in the
   * histogram and does not move a percentile.
   * @default 1000
   */
  stallThreshold?: number;
}

/**
 * Disk health indicator thresholds
 */
export interface DiskThresholds {
  /**
   * Disk usage percentage that triggers degraded status
   * @default 0.8 (80%)
   */
  usageDegradedThreshold?: number;

  /**
   * Disk usage percentage that triggers unhealthy status
   * @default 0.95 (95%)
   */
  usageUnhealthyThreshold?: number;

  /**
   * Path to check disk space for
   * @default '/'
   */
  path?: string;
}

/**
 * Health indicator interface
 */
export interface IHealthIndicator {
  /**
   * Unique name of this health indicator
   */
  readonly name: string;

  /**
   * Perform the health check
   */
  check(): Promise<HealthIndicatorResult>;
}

/**
 * Health service interface
 */
export interface IHealthService {
  /**
   * Register a health indicator
   */
  registerIndicator(indicator: IHealthIndicator): void;

  /**
   * Unregister a health indicator
   */
  unregisterIndicator(name: string): boolean;

  /**
   * Run all health checks
   */
  check(): Promise<HealthCheckResult>;

  /**
   * Run a single health check by name
   */
  checkOne(name: string): Promise<HealthIndicatorResult>;

  /**
   * Check if overall system is healthy
   */
  isHealthy(): Promise<boolean>;

  /**
   * Check if overall system is ready (for Kubernetes readiness probes)
   */
  isReady(): Promise<boolean>;

  /**
   * Check if system is alive (for Kubernetes liveness probes)
   */
  isAlive(): Promise<boolean>;

  /**
   * Get list of registered indicator names
   */
  getIndicators(): string[];
}
