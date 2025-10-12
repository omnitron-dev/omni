/**
 * Scheduler Constants
 */

import { Token, createToken } from '../../nexus/index.js';

import type { IJobListener, ISchedulerConfig } from './scheduler.interfaces.js';

/**
 * Scheduler metadata keys
 */
export const SCHEDULER_METADATA = {
  CRON_JOB: Symbol('scheduler:cron'),
  INTERVAL: Symbol('scheduler:interval'),
  TIMEOUT: Symbol('scheduler:timeout'),
  SCHEDULED_JOB: Symbol('scheduler:job'),
  JOB_OPTIONS: Symbol('scheduler:options'),
} as const;

/**
 * Dependency injection tokens
 */
export const SCHEDULER_CONFIG_TOKEN: Token<ISchedulerConfig> = createToken<ISchedulerConfig>('SCHEDULER_CONFIG');
export const SCHEDULER_SERVICE_TOKEN: Token<any> = createToken('SCHEDULER_SERVICE');
export const SCHEDULER_REGISTRY_TOKEN: Token<any> = createToken('SCHEDULER_REGISTRY');
export const SCHEDULER_EXECUTOR_TOKEN: Token<any> = createToken('SCHEDULER_EXECUTOR');
export const SCHEDULER_PERSISTENCE_TOKEN: Token<any> = createToken('SCHEDULER_PERSISTENCE');
export const SCHEDULER_METRICS_TOKEN: Token<any> = createToken('SCHEDULER_METRICS');
export const SCHEDULER_DISCOVERY_TOKEN: Token<any> = createToken('SCHEDULER_DISCOVERY');
export const SCHEDULER_LISTENERS_TOKEN: Token<IJobListener[]> = createToken<IJobListener[]>('SCHEDULER_LISTENERS');

/**
 * Default configuration
 */
export const DEFAULT_SCHEDULER_CONFIG: ISchedulerConfig = {
  enabled: true,
  timezone: 'UTC',
  persistence: {
    enabled: false,
    provider: 'memory',
  },
  metrics: {
    enabled: true,
    interval: 60000,
    includeDetails: false,
  },
  distributed: {
    enabled: false,
    lockProvider: 'redis',
    lockTTL: 30000,
  },
  retry: {
    maxAttempts: 3,
    delay: 1000,
    backoff: 2,
    maxDelay: 30000,
  },
  maxConcurrent: 10,
  queueSize: 100,
  debug: false,
  shutdownTimeout: 30000,
  healthCheck: {
    enabled: true,
    path: '/health/scheduler',
  },
};

/**
 * Error messages
 */
export const ERROR_MESSAGES = {
  JOB_NOT_FOUND: 'Scheduled job not found',
  JOB_ALREADY_EXISTS: 'Job with this name already exists',
  INVALID_CRON_EXPRESSION: 'Invalid cron expression',
  INVALID_INTERVAL: 'Invalid interval value',
  INVALID_TIMEOUT: 'Invalid timeout value',
  SCHEDULER_NOT_STARTED: 'Scheduler is not started',
  SCHEDULER_ALREADY_STARTED: 'Scheduler is already started',
  JOB_EXECUTION_FAILED: 'Job execution failed',
  JOB_TIMEOUT: 'Job execution timed out',
  PERSISTENCE_ERROR: 'Failed to persist job state',
  LOCK_ACQUISITION_FAILED: 'Failed to acquire job lock',
  INVALID_JOB_TYPE: 'Invalid job type',
  MAX_RETRIES_EXCEEDED: 'Maximum retry attempts exceeded',
} as const;

/**
 * Event names
 */
export const SCHEDULER_EVENTS = {
  JOB_REGISTERED: 'scheduler:job:registered',
  JOB_STARTED: 'scheduler:job:started',
  JOB_COMPLETED: 'scheduler:job:completed',
  JOB_FAILED: 'scheduler:job:failed',
  JOB_RETRYING: 'scheduler:job:retrying',
  JOB_CANCELLED: 'scheduler:job:cancelled',
  JOB_PAUSED: 'scheduler:job:paused',
  JOB_RESUMED: 'scheduler:job:resumed',
  JOB_REMOVED: 'scheduler:job:removed',
  SCHEDULER_STARTED: 'scheduler:started',
  SCHEDULER_STOPPED: 'scheduler:stopped',
  SCHEDULER_ERROR: 'scheduler:error',
  METRICS_UPDATED: 'scheduler:metrics:updated',
} as const;

/**
 * Cron field positions
 */
export const CRON_POSITIONS = {
  SECOND: 0,
  MINUTE: 1,
  HOUR: 2,
  DAY_OF_MONTH: 3,
  MONTH: 4,
  DAY_OF_WEEK: 5,
  YEAR: 6,
} as const;

/**
 * Default job priorities
 */
export const DEFAULT_PRIORITIES = {
  CRON: 2,
  INTERVAL: 2,
  TIMEOUT: 3,
  DELAYED: 2,
  RECURRING: 2,
} as const;
