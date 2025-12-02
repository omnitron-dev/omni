/**
 * Scheduler Module - Public API
 *
 * Provides cron, interval, and timeout job scheduling with enterprise features
 * including persistence, metrics, and distributed execution.
 *
 * @example
 * ```typescript
 * import { SchedulerModule, Cron, Interval, CronExpression } from '@omnitron-dev/titan/module/scheduler';
 *
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
// Core Services
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
// Types and Interfaces
// ============================================================================
export {
  SchedulerJobType,
  JobPriority,
  JobStatus,
  CronExpression,
} from './scheduler.interfaces.js';

export type {
  CronExpressionType,
  IBaseJobOptions,
  ICronOptions,
  IIntervalOptions,
  ITimeoutOptions,
  IRetryOptions,
  IScheduledJob,
  IJobExecutionContext,
  IJobExecutionResult,
  ISchedulerConfig,
  ISchedulerMetrics,
  IJobFilterOptions,
  IJobListener,
  ISchedulerModuleOptions,
  ISchedulerModuleAsyncOptions,
  IJobMetadata,
} from './scheduler.interfaces.js';

// ============================================================================
// Persistence (for custom providers)
// ============================================================================
export type { IPersistenceProvider } from './scheduler.persistence.js';
export { InMemoryPersistenceProvider, SchedulerPersistence } from './scheduler.persistence.js';

// Note: Internal classes (SchedulerRegistry, SchedulerExecutor, SchedulerDiscovery)
// are NOT exported as they are implementation details managed by SchedulerService.
