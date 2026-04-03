/**
 * Process Manager Module for Titan Framework
 *
 * Provides process management capabilities:
 * - Process spawning and lifecycle management
 * - Process pools with load balancing
 * - Supervisor patterns with restart policies
 * - Metrics collection and health monitoring
 * - Service proxy for transparent RPC
 *
 * @module @omnitron-dev/titan-pm
 */

// ============================================================================
// Module
// ============================================================================

export {
  ProcessManagerModule,
  PM_CONFIG_TOKEN,
  PM_MANAGER_TOKEN,
  PM_REGISTRY_TOKEN,
  PM_SPAWNER_TOKEN,
  PM_METRICS_TOKEN,
  PM_HEALTH_TOKEN,
  DEFAULT_PM_CONFIG,
} from './pm.module.js';

// ============================================================================
// Core Classes
// ============================================================================

export { ProcessManager } from './process-manager.js';
export { ProcessRegistry } from './process-registry.js';
export { ProcessSpawner, ProcessSpawnerFactory } from './process-spawner.js';
export { ProcessPool } from './process-pool.js';
export { ProcessSupervisor } from './process-supervisor.js';
export { ProcessMetricsCollector } from './process-metrics.js';
export { ProcessHealthChecker } from './process-health.js';

// ============================================================================
// Decorators
// ============================================================================

export {
  // Class decorators
  Process,
  Workflow,
  Actor,

  // Method decorators
  Public,
  Stage,
  Compensate,
  HealthCheck,
  OnShutdown,
  Trace,
  Metric,
  Validate,
  Cache,

  // Supervisor decorators
  Supervisor,
  Child,

  // Resilience decorators
  CircuitBreaker,
  RateLimit,
  Idempotent,

  // Metadata keys (internal — used by worker-runtime and testing)
  PROCESS_METADATA_KEY,
  PROCESS_METHOD_METADATA_KEY,
  SUPERVISOR_METADATA_KEY,
  WORKFLOW_METADATA_KEY,
} from './decorators.js';

// ============================================================================
// Enums
// ============================================================================

export { ProcessStatus, PoolStrategy, SupervisionStrategy, RestartDecision } from './types.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type {
  // Core process types
  IProcessOptions,
  IProcessMetadata,
  IProcessMethodMetadata,
  IProcessInfo,

  // Service proxy
  ServiceProxy,
  IServiceProxyControl,

  // Process pool
  IProcessPoolOptions,
  IProcessPool,

  // Supervisor
  ISupervisorOptions,
  ISupervisorChild,
  ISupervisorConfig,
  ISupervisorChildConfig,

  // Events
  IProcessEvents,

  // Metrics & monitoring
  IProcessMetrics,
  IPoolMetrics,
  ILatencyMetrics,
  IHealthStatus,
  IHealthCheck,

  // Configuration
  IBackoffOptions,
  IRestartPolicy,
  IProcessManager,
  IProcessManagerConfig,
  IProcessManagerModule,

  // Spawner (for testing utilities)
  IProcessSpawner,
  ISpawnOptions,
  IWorkerHandle,
} from './types.js';

// Common types (for testing utilities)
export type { ProcessMethod, AsyncProcessMethod, ServiceMethodMap } from './common-types.js';
