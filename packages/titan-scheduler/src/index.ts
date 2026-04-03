/**
 * Scheduler Module for Titan Framework
 *
 * Provides cron, interval, and timeout job scheduling with enterprise features
 * including persistence, metrics, and distributed execution.
 *
 * @module @omnitron-dev/titan/module/scheduler
 *
 * @example
 * ```typescript
 * import {
 *   SchedulerModule,
 *   SchedulerService,
 *   Cron,
 *   Interval,
 *   Schedulable,
 *   CronExpression,
 *   SCHEDULER_SERVICE_TOKEN
 * } from '@omnitron-dev/titan/module/scheduler';
 *
 * // Configure module
 * @Module({
 *   imports: [SchedulerModule.forRoot({ enableMetrics: true })]
 * })
 * class AppModule {}
 *
 * // Use decorators for scheduled tasks
 * @Injectable()
 * @Schedulable()
 * class MyTasks {
 *   @Cron(CronExpression.EVERY_HOUR)
 *   async hourlyTask() { }
 *
 *   @Interval(30000)
 *   async pollingTask() { }
 * }
 * ```
 */

// ============================================================================
// Module
// ============================================================================

export { SchedulerModule } from './scheduler.module.js';

// ============================================================================
// Services
// ============================================================================

export { SchedulerService } from './scheduler.service.js';
export { SchedulerMetricsService } from './scheduler.metrics.js';

// ============================================================================
// Decorators
// ============================================================================

export {
  Cron,
  Interval,
  Timeout,
  Schedulable,
  getScheduledJobs,
  getCronMetadata,
  getIntervalMetadata,
  getTimeoutMetadata,
} from './scheduler.decorators.js';

// ============================================================================
// Tokens (for DI)
// ============================================================================

export {
  SCHEDULER_CONFIG_TOKEN,
  SCHEDULER_SERVICE_TOKEN,
  SCHEDULER_REGISTRY_TOKEN,
  SCHEDULER_EXECUTOR_TOKEN,
  SCHEDULER_PERSISTENCE_TOKEN,
  SCHEDULER_METRICS_TOKEN,
  SCHEDULER_DISCOVERY_TOKEN,
  SCHEDULER_LISTENERS_TOKEN,
  SCHEDULER_METADATA,
  DEFAULT_SCHEDULER_CONFIG,
  SCHEDULER_EVENTS,
} from './scheduler.constants.js';

// ============================================================================
// Enums
// ============================================================================

export { SchedulerJobType, JobPriority, JobStatus, CronExpression } from './scheduler.interfaces.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type {
  // Expression types
  CronExpressionType,

  // Job options
  IBaseJobOptions,
  ICronOptions,
  IIntervalOptions,
  ITimeoutOptions,
  IRetryOptions,

  // Job types
  IScheduledJob,
  IJobExecutionContext,
  IJobExecutionResult,
  IJobMetadata,
  IJobFilterOptions,
  IJobListener,

  // Configuration
  ISchedulerConfig,
  ISchedulerMetrics,

  // Module options
  ISchedulerModuleOptions,
  ISchedulerModuleAsyncOptions,
} from './scheduler.interfaces.js';

// ============================================================================
// Persistence Providers
// ============================================================================

export { InMemoryPersistenceProvider, SchedulerPersistence } from './scheduler.persistence.js';

export type { IPersistenceProvider } from './scheduler.persistence.js';

// ============================================================================
// Persistence Provider Implementations (optional)
// ============================================================================

export { RedisPersistenceProvider, DatabasePersistenceProvider } from './persistence/index.js';

export type { IKeyValueStore } from './persistence/index.js';

// Note: Internal classes (SchedulerRegistry, SchedulerExecutor, SchedulerDiscovery)
// are NOT exported as they are implementation details managed by SchedulerService.
