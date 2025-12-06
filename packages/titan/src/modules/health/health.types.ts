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
   * Enable HTTP endpoints
   * @default false
   */
  enableHttpEndpoints?: boolean;

  /**
   * HTTP endpoint base path
   * @default '/health'
   */
  httpBasePath?: string;

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
}

/**
 * Memory health indicator thresholds
 */
export interface MemoryThresholds {
  /**
   * Heap usage percentage that triggers degraded status
   * @default 0.7 (70%)
   */
  heapDegradedThreshold?: number;

  /**
   * Heap usage percentage that triggers unhealthy status
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

/**
 * HTTP response format for health endpoints
 */
export interface HealthHttpResponse {
  status: HealthStatus;
  info?: Record<string, HealthIndicatorResult>;
  error?: Record<string, HealthIndicatorResult>;
  details?: Record<string, HealthIndicatorResult>;
}
