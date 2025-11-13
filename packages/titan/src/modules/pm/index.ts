/**
 * Process Manager Module Exports
 *
 * @packageDocumentation
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
export { MockProcessSpawner } from './mock-process-spawner.js';
export { ProcessPool } from './process-pool.js';
export { ProcessSupervisor } from './process-supervisor.js';
export { ProcessWorkflow } from './process-workflow.js';
export { ProcessMetricsCollector } from './process-metrics.js';
export { ProcessHealthChecker } from './process-health.js';
export { ServiceProxyHandler, StreamingServiceProxyHandler } from './service-proxy.js';

// ============================================================================
// Decorators
// ============================================================================

export {
  // Process decorators
  Process,
  Method,
  Public,
  RateLimit,
  Cache,
  Validate,
  Trace,
  Metric,

  // Supervisor decorators
  Supervisor,
  Child,

  // Workflow decorators
  Workflow,
  Stage,
  Compensate,

  // Actor decorator
  Actor,

  // Resilience decorators
  CircuitBreaker,
  SelfHeal,
  Idempotent,

  // Dependency injection
  InjectProcess,
  Compose,

  // Advanced decorators
  SharedState,
  HealthCheck,
  OnShutdown,
  AdaptiveBitrate,
  GraphQLService,
  DistributedTransaction,
  Saga,
  Step,

  // Metadata keys
  PROCESS_METADATA_KEY,
  PROCESS_METHOD_METADATA_KEY,
  SUPERVISOR_METADATA_KEY,
  WORKFLOW_METADATA_KEY,
  ACTOR_METADATA_KEY,
} from './decorators.js';

// ============================================================================
// Types
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

  // Workflow
  IWorkflowStage,
  IWorkflowContext,
  IStageResult,

  // Events
  IProcessEvents,

  // Metrics & monitoring
  IProcessMetrics,
  IPoolMetrics,
  ILatencyMetrics,
  IHealthStatus,
  IHealthCheck,

  // Advanced features
  IScalingMetrics,
  ISandboxOptions,
  IPermissions,
  IMetricsOptions,
  ITracingOptions,
  ILoggingOptions,
  IClusterOptions,
  IShardingOptions,
  IMultiTenantOptions,
  IServiceMeshOptions,
  IRateLimitOptions,
  ICircuitBreakerOptions,
  IRetryOptions,
  IBulkheadOptions,
  IGeoOptions,
  ICostOptions,
  ICostOptimizationOptions,
  ISelfHealingOptions,
  ISelfHealAction,
  IDebugOptions,
  ICacheOptions,
  IValidationOptions,
  IBackoffOptions,

  // Process Manager
  IProcessManager,
  IProcessManagerConfig,
  IRestartPolicy,
  IProcessManagerModule,
} from './types.js';

// Re-export enums
export { ProcessStatus, PoolStrategy, SupervisionStrategy, RestartDecision } from './types.js';

// ============================================================================
// Enterprise Features
// ============================================================================

export * from './enterprise/index.js';

// ============================================================================
// Testing Utilities
// ============================================================================

export {
  TestProcessManager,
  createTestProcessManager,
  type ITestProcessManagerConfig,
  type IOperationRecord,
} from './testing/test-process-manager.js';

// ============================================================================
// Convenience Functions
// ============================================================================

import type {
  IProcessOptions as ProcessOptions,
  IProcessPoolOptions as PoolOptions,
  ServiceProxy as Proxy,
  IProcessPool as Pool,
} from './types.js';
import { ProcessManager } from './process-manager.js';

/**
 * Create a Process Manager instance with default configuration
 */
export function createProcessManager(logger?: any, config?: any): ProcessManager {
  return new ProcessManager(logger || console, config || {});
}

/**
 * Quick helper to spawn a process
 */
export async function spawnProcess<T>(
  ProcessClass: new (...args: any[]) => T,
  options?: ProcessOptions
): Promise<Proxy<T>> {
  const pm = createProcessManager();
  return pm.spawn(ProcessClass, options);
}

/**
 * Quick helper to create a process pool
 */
export async function createProcessPool<T>(
  ProcessClass: new (...args: any[]) => T,
  options?: PoolOptions
): Promise<Pool<T>> {
  const pm = createProcessManager();
  return pm.pool(ProcessClass, options);
}
