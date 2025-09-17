/**
 * Scheduler Interfaces and Types
 */

import type { InjectionToken } from '@omnitron-dev/nexus';

/**
 * Cron expression type
 */
export type CronExpressionType = string | Date;

/**
 * Scheduler job types
 */
export enum SchedulerJobType {
  CRON = 'cron',
  INTERVAL = 'interval',
  TIMEOUT = 'timeout',
  DELAYED = 'delayed',
  RECURRING = 'recurring'
}

/**
 * Job priority levels
 */
export enum JobPriority {
  CRITICAL = 0,
  HIGH = 1,
  NORMAL = 2,
  LOW = 3,
  IDLE = 4
}

/**
 * Job status
 */
export enum JobStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  PAUSED = 'paused',
  RETRYING = 'retrying'
}

/**
 * Cron job options
 */
export interface BaseJobOptions {
  /**
   * Job name
   */
  name?: string;

  /**
   * Job priority
   */
  priority?: JobPriority;

  /**
   * Retry configuration
   */
  retry?: RetryOptions;

  /**
   * Error handler
   */
  onError?: (error: Error) => void | Promise<void>;

  /**
   * Success handler
   */
  onSuccess?: (result: any) => void | Promise<void>;

  /**
   * Whether job is disabled
   */
  disabled?: boolean;

  /**
   * Maximum execution time in milliseconds
   */
  timeout?: number;

  /**
   * Whether to persist job state
   */
  persist?: boolean;

  /**
   * Job metadata
   */
  metadata?: Record<string, any>;

  /**
   * Prevent overlapping executions
   */
  preventOverlap?: boolean;
}

/**
 * Cron job options
 */
export interface CronOptions extends BaseJobOptions {
  /**
   * Timezone for the cron job
   */
  timezone?: string;

  /**
   * UTC offset
   */
  utcOffset?: number;

  /**
   * Start time for the job
   */
  startTime?: Date | string;

  /**
   * End time for the job
   */
  endTime?: Date | string;

  /**
   * Whether to start immediately
   */
  immediate?: boolean;
}

/**
 * Interval job options
 */
export interface IntervalOptions extends BaseJobOptions {
  immediate?: boolean;
}

/**
 * Timeout job options
 */
export interface TimeoutOptions extends BaseJobOptions {
}

/**
 * Retry options
 */
export interface RetryOptions {
  /**
   * Maximum number of retry attempts
   */
  maxAttempts?: number;

  /**
   * Delay between retries in milliseconds
   */
  delay?: number;

  /**
   * Backoff multiplier
   */
  backoff?: number;

  /**
   * Maximum delay between retries
   */
  maxDelay?: number;

  /**
   * Retry condition
   */
  retryIf?: (error: Error) => boolean;
}

/**
 * Scheduled job interface
 */
export interface ScheduledJob {
  /**
   * Unique job ID
   */
  id: string;

  /**
   * Job name
   */
  name: string;

  /**
   * Job type
   */
  type: SchedulerJobType;

  /**
   * Job status
   */
  status: JobStatus;

  /**
   * Target class
   */
  target: any;

  /**
   * Method name
   */
  method: string;

  /**
   * Job options
   */
  options: CronOptions | IntervalOptions | TimeoutOptions;

  /**
   * Cron expression or interval/timeout value
   */
  pattern?: string | number;

  /**
   * Next execution time
   */
  nextExecution?: Date;

  /**
   * Last execution time
   */
  lastExecution?: Date;

  /**
   * Execution count
   */
  executionCount: number;

  /**
   * Failure count
   */
  failureCount: number;

  /**
   * Created timestamp
   */
  createdAt: Date;

  /**
   * Updated timestamp
   */
  updatedAt: Date;

  /**
   * Job instance (internal)
   */
  instance?: any;

  /**
   * Error from last execution
   */
  lastError?: Error;

  /**
   * Result from last execution
   */
  lastResult?: any;

  /**
   * Average execution time
   */
  avgExecutionTime?: number;

  /**
   * Is job running
   */
  isRunning: boolean;

  /**
   * Job dependencies
   */
  dependencies?: string[];
}

/**
 * Job execution context
 */
export interface JobExecutionContext {
  /**
   * Job ID
   */
  jobId: string;

  /**
   * Job name
   */
  jobName: string;

  /**
   * Execution ID
   */
  executionId: string;

  /**
   * Execution timestamp
   */
  timestamp: Date;

  /**
   * Attempt number
   */
  attempt: number;

  /**
   * Job metadata
   */
  metadata?: Record<string, any>;

  /**
   * Previous execution result
   */
  previousResult?: any;

  /**
   * Signal to stop job
   */
  signal?: AbortSignal;
}

/**
 * Job execution result
 */
export interface JobExecutionResult {
  /**
   * Job ID
   */
  jobId: string;

  /**
   * Execution ID
   */
  executionId: string;

  /**
   * Status
   */
  status: 'success' | 'failure' | 'cancelled';

  /**
   * Result data
   */
  result?: any;

  /**
   * Error if failed
   */
  error?: Error;

  /**
   * Execution duration in milliseconds
   */
  duration: number;

  /**
   * Timestamp
   */
  timestamp: Date;

  /**
   * Retry attempt
   */
  attempt?: number;
}

/**
 * Scheduler configuration
 */
export interface SchedulerConfig {
  /**
   * Enable scheduler
   */
  enabled?: boolean;

  /**
   * Default timezone
   */
  timezone?: string;

  /**
   * Enable persistence
   */
  persistence?: {
    enabled: boolean;
    provider?: 'redis' | 'database' | 'memory';
    options?: any;
  };

  /**
   * Enable metrics
   */
  metrics?: {
    enabled: boolean;
    interval?: number;
    includeDetails?: boolean;
  };

  /**
   * Enable distributed mode
   */
  distributed?: {
    enabled: boolean;
    lockProvider?: 'redis' | 'database';
    lockTTL?: number;
    nodeId?: string;
  };

  /**
   * Global retry options
   */
  retry?: RetryOptions;

  /**
   * Maximum concurrent jobs
   */
  maxConcurrent?: number;

  /**
   * Job queue size
   */
  queueSize?: number;

  /**
   * Enable debug logging
   */
  debug?: boolean;

  /**
   * Graceful shutdown timeout
   */
  shutdownTimeout?: number;

  /**
   * Health check endpoint
   */
  healthCheck?: {
    enabled: boolean;
    path?: string;
  };
}

/**
 * Scheduler metrics
 */
export interface SchedulerMetrics {
  /**
   * Total jobs registered
   */
  totalJobs: number;

  /**
   * Active jobs
   */
  activeJobs: number;

  /**
   * Jobs by status
   */
  jobsByStatus: Record<JobStatus, number>;

  /**
   * Jobs by type
   */
  jobsByType: Record<SchedulerJobType, number>;

  /**
   * Total executions
   */
  totalExecutions: number;

  /**
   * Successful executions
   */
  successfulExecutions: number;

  /**
   * Failed executions
   */
  failedExecutions: number;

  /**
   * Average execution time
   */
  avgExecutionTime: number;

  /**
   * Queue size
   */
  queueSize: number;

  /**
   * Uptime in seconds
   */
  uptime: number;

  /**
   * Memory usage
   */
  memoryUsage?: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
  };

  /**
   * Last update timestamp
   */
  timestamp: Date;
}

/**
 * Job filter options
 */
export interface JobFilterOptions {
  /**
   * Filter by status
   */
  status?: JobStatus | JobStatus[];

  /**
   * Filter by type
   */
  type?: SchedulerJobType | SchedulerJobType[];

  /**
   * Filter by name pattern
   */
  namePattern?: string | RegExp;

  /**
   * Filter by priority
   */
  priority?: JobPriority | JobPriority[];

  /**
   * Include disabled jobs
   */
  includeDisabled?: boolean;

  /**
   * Sort order
   */
  sortBy?: 'name' | 'nextExecution' | 'lastExecution' | 'priority' | 'createdAt';

  /**
   * Sort direction
   */
  sortDirection?: 'asc' | 'desc';

  /**
   * Pagination
   */
  limit?: number;
  offset?: number;
}

/**
 * Job listener interface
 */
export interface JobListener {
  onJobStart?(job: ScheduledJob, context: JobExecutionContext): void | Promise<void>;
  onJobComplete?(job: ScheduledJob, result: JobExecutionResult): void | Promise<void>;
  onJobError?(job: ScheduledJob, error: Error, context: JobExecutionContext): void | Promise<void>;
  onJobRetry?(job: ScheduledJob, attempt: number, error: Error): void | Promise<void>;
  onJobCancelled?(job: ScheduledJob, reason?: string): void | Promise<void>;
}

/**
 * Scheduler module options
 */
export interface SchedulerModuleOptions extends SchedulerConfig {
  /**
   * Global job listeners
   */
  listeners?: JobListener[];

  /**
   * Custom job executor
   */
  executor?: InjectionToken<any>;

  /**
   * Custom persistence provider
   */
  persistenceProvider?: InjectionToken<any>;

  /**
   * Custom metrics provider
   */
  metricsProvider?: InjectionToken<any>;
}

/**
 * Scheduler module async options
 */
export interface SchedulerModuleAsyncOptions {
  imports?: any[];
  useFactory?: (...args: any[]) => Promise<SchedulerModuleOptions> | SchedulerModuleOptions;
  inject?: InjectionToken<any>[];
  useExisting?: InjectionToken<SchedulerModuleOptions>;
}

/**
 * Job metadata
 */
export interface JobMetadata {
  type: SchedulerJobType;
  pattern?: string | number;
  options?: CronOptions | IntervalOptions | TimeoutOptions;
  target: any;
  propertyKey: string;
}

/**
 * Predefined cron expressions
 */
export enum CronExpression {
  EVERY_SECOND = '* * * * * *',
  EVERY_5_SECONDS = '*/5 * * * * *',
  EVERY_10_SECONDS = '*/10 * * * * *',
  EVERY_30_SECONDS = '*/30 * * * * *',
  EVERY_MINUTE = '*/1 * * * *',
  EVERY_5_MINUTES = '*/5 * * * *',
  EVERY_10_MINUTES = '*/10 * * * *',
  EVERY_30_MINUTES = '*/30 * * * *',
  EVERY_HOUR = '0 * * * *',
  EVERY_DAY_AT_MIDNIGHT = '0 0 * * *',
  EVERY_DAY_AT_NOON = '0 12 * * *',
  EVERY_WEEK = '0 0 * * 0',
  EVERY_WEEKDAY = '0 0 * * 1-5',
  EVERY_WEEKEND = '0 0 * * 0,6',
  EVERY_1ST_DAY_OF_MONTH = '0 0 1 * *',
  EVERY_LAST_DAY_OF_MONTH = '0 0 L * *',
  EVERY_QUARTER = '0 0 1 */3 *',
  EVERY_YEAR = '0 0 1 1 *'
}