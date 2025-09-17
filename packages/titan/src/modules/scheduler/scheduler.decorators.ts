/**
 * Scheduler Decorators
 */

import 'reflect-metadata';

import {
  SCHEDULER_METADATA
} from './scheduler.constants';

import type {
  CronOptions,
  JobMetadata,
  TimeoutOptions,
  CronExpression,
  IntervalOptions,
  SchedulerJobType
} from './scheduler.interfaces';

/**
 * Schedule a cron job
 */
export function Cron(expression: CronExpression, options?: CronOptions): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata: JobMetadata = {
      type: 'cron' as SchedulerJobType,
      pattern: expression.toString(),
      options: options || {},
      target: target.constructor,
      propertyKey: propertyKey.toString()
    };

    Reflect.defineMetadata(
      SCHEDULER_METADATA.CRON_JOB,
      metadata,
      target,
      propertyKey
    );

    // Also store in array for discovery
    const existingJobs = Reflect.getMetadata(
      SCHEDULER_METADATA.SCHEDULED_JOB,
      target.constructor
    ) || [];

    existingJobs.push({
      propertyKey,
      metadata
    });

    Reflect.defineMetadata(
      SCHEDULER_METADATA.SCHEDULED_JOB,
      existingJobs,
      target.constructor
    );

    return descriptor;
  };
}

/**
 * Schedule an interval job
 */
export function Interval(milliseconds: number, options?: IntervalOptions): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    if (milliseconds <= 0) {
      throw new Error('Interval must be greater than 0');
    }

    const metadata: JobMetadata = {
      type: 'interval' as SchedulerJobType,
      pattern: milliseconds,
      options: options || {},
      target: target.constructor,
      propertyKey: propertyKey.toString()
    };

    Reflect.defineMetadata(
      SCHEDULER_METADATA.INTERVAL,
      metadata,
      target,
      propertyKey
    );

    // Also store in array for discovery
    const existingJobs = Reflect.getMetadata(
      SCHEDULER_METADATA.SCHEDULED_JOB,
      target.constructor
    ) || [];

    existingJobs.push({
      propertyKey,
      metadata
    });

    Reflect.defineMetadata(
      SCHEDULER_METADATA.SCHEDULED_JOB,
      existingJobs,
      target.constructor
    );

    return descriptor;
  };
}

/**
 * Schedule a timeout job
 */
export function Timeout(milliseconds: number, options?: TimeoutOptions): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    if (milliseconds < 0) {
      throw new Error('Timeout must be non-negative');
    }

    const metadata: JobMetadata = {
      type: 'timeout' as SchedulerJobType,
      pattern: milliseconds,
      options: options || {},
      target: target.constructor,
      propertyKey: propertyKey.toString()
    };

    Reflect.defineMetadata(
      SCHEDULER_METADATA.TIMEOUT,
      metadata,
      target,
      propertyKey
    );

    // Also store in array for discovery
    const existingJobs = Reflect.getMetadata(
      SCHEDULER_METADATA.SCHEDULED_JOB,
      target.constructor
    ) || [];

    existingJobs.push({
      propertyKey,
      metadata
    });

    Reflect.defineMetadata(
      SCHEDULER_METADATA.SCHEDULED_JOB,
      existingJobs,
      target.constructor
    );

    return descriptor;
  };
}

/**
 * Mark a class as schedulable (optional, for explicit marking)
 */
export function Schedulable(): ClassDecorator {
  return (target: any) => {
    Reflect.defineMetadata(SCHEDULER_METADATA.JOB_OPTIONS, true, target);
    return target;
  };
}

/**
 * Helper to extract all scheduled jobs from a class
 */
export function getScheduledJobs(target: any): Array<{ propertyKey: string | symbol; metadata: JobMetadata }> {
  return Reflect.getMetadata(SCHEDULER_METADATA.SCHEDULED_JOB, target) || [];
}

/**
 * Helper to get cron job metadata
 */
export function getCronMetadata(target: any, propertyKey: string | symbol): JobMetadata | undefined {
  return Reflect.getMetadata(SCHEDULER_METADATA.CRON_JOB, target, propertyKey);
}

/**
 * Helper to get interval metadata
 */
export function getIntervalMetadata(target: any, propertyKey: string | symbol): JobMetadata | undefined {
  return Reflect.getMetadata(SCHEDULER_METADATA.INTERVAL, target, propertyKey);
}

/**
 * Helper to get timeout metadata
 */
export function getTimeoutMetadata(target: any, propertyKey: string | symbol): JobMetadata | undefined {
  return Reflect.getMetadata(SCHEDULER_METADATA.TIMEOUT, target, propertyKey);
}