/**
 * Scheduler Decorators Comprehensive Tests
 * Tests decorator functionality, metadata storage, and discovery
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  Cron,
  Interval,
  Timeout,
  Schedulable,
  getScheduledJobs,
  getCronMetadata,
  getIntervalMetadata,
  getTimeoutMetadata
} from '../../../src/modules/scheduler/scheduler.decorators.js';
import { CronExpression, JobPriority } from '../../../src/modules/scheduler/scheduler.interfaces.js';
import { SCHEDULER_METADATA } from '../../../src/modules/scheduler/scheduler.constants.js';

describe('Scheduler Decorators', () => {
  describe('@Cron', () => {
    it('should decorate method with cron metadata', () => {
      class TestService {
        @Cron(CronExpression.EVERY_MINUTE)
        execute() {}
      }

      const service = new TestService();
      const metadata = getCronMetadata(service, 'execute');

      expect(metadata).toBeDefined();
      expect(metadata?.type).toBe('cron');
      expect(metadata?.pattern).toBe(CronExpression.EVERY_MINUTE);
    });

    it('should store cron options', () => {
      class TestService {
        @Cron(CronExpression.EVERY_HOUR, {
          timezone: 'America/New_York',
          priority: JobPriority.HIGH,
        })
        task() {}
      }

      const service = new TestService();
      const metadata = getCronMetadata(service, 'task');

      expect(metadata?.options).toMatchObject({
        timezone: 'America/New_York',
        priority: JobPriority.HIGH,
      });
    });

    it('should store job in scheduled jobs array', () => {
      class TestService {
        @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
        dailyTask() {}
      }

      const jobs = getScheduledJobs(TestService);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].propertyKey).toBe('dailyTask');
    });

    it('should handle multiple cron jobs in same class', () => {
      class MultiTaskService {
        @Cron(CronExpression.EVERY_MINUTE)
        task1() {}

        @Cron(CronExpression.EVERY_HOUR)
        task2() {}

        @Cron(CronExpression.EVERY_DAY_AT_NOON)
        task3() {}
      }

      const jobs = getScheduledJobs(MultiTaskService);
      expect(jobs).toHaveLength(3);
    });

    it('should accept string cron expressions', () => {
      class TestService {
        @Cron('*/5 * * * *')
        everyFiveMinutes() {}
      }

      const service = new TestService();
      const metadata = getCronMetadata(service, 'everyFiveMinutes');

      expect(metadata?.pattern).toBe('*/5 * * * *');
    });

    it('should store disabled option', () => {
      class TestService {
        @Cron(CronExpression.EVERY_MINUTE, { disabled: true })
        disabledTask() {}
      }

      const service = new TestService();
      const metadata = getCronMetadata(service, 'disabledTask');

      expect(metadata?.options.disabled).toBe(true);
    });
  });

  describe('@Interval', () => {
    it('should decorate method with interval metadata', () => {
      class TestService {
        @Interval(5000)
        execute() {}
      }

      const service = new TestService();
      const metadata = getIntervalMetadata(service, 'execute');

      expect(metadata).toBeDefined();
      expect(metadata?.type).toBe('interval');
      expect(metadata?.pattern).toBe(5000);
    });

    it('should store interval options', () => {
      class TestService {
        @Interval(10000, {
          immediate: true,
          priority: JobPriority.CRITICAL,
        })
        task() {}
      }

      const service = new TestService();
      const metadata = getIntervalMetadata(service, 'task');

      expect(metadata?.options).toMatchObject({
        immediate: true,
        priority: JobPriority.CRITICAL,
      });
    });

    it('should throw error for non-positive interval', () => {
      expect(() => {
        class TestService {
          @Interval(0)
          invalidTask() {}
        }
      }).toThrow();
    });

    it('should throw error for negative interval', () => {
      expect(() => {
        class TestService {
          @Interval(-1000)
          negativeTask() {}
        }
      }).toThrow();
    });

    it('should handle multiple interval jobs', () => {
      class MultiIntervalService {
        @Interval(1000)
        fast() {}

        @Interval(60000)
        slow() {}
      }

      const jobs = getScheduledJobs(MultiIntervalService);
      expect(jobs).toHaveLength(2);
    });

    it('should allow custom metadata', () => {
      class TestService {
        @Interval(5000, {
          metadata: { description: 'Updates cache', category: 'maintenance' },
        })
        updateCache() {}
      }

      const service = new TestService();
      const metadata = getIntervalMetadata(service, 'updateCache');

      expect(metadata?.options.metadata).toEqual({
        description: 'Updates cache',
        category: 'maintenance',
      });
    });
  });

  describe('@Timeout', () => {
    it('should decorate method with timeout metadata', () => {
      class TestService {
        @Timeout(5000)
        execute() {}
      }

      const service = new TestService();
      const metadata = getTimeoutMetadata(service, 'execute');

      expect(metadata).toBeDefined();
      expect(metadata?.type).toBe('timeout');
      expect(metadata?.pattern).toBe(5000);
    });

    it('should store timeout options', () => {
      class TestService {
        @Timeout(3000, {
          priority: JobPriority.LOW,
        })
        task() {}
      }

      const service = new TestService();
      const metadata = getTimeoutMetadata(service, 'task');

      expect(metadata?.options).toMatchObject({
        priority: JobPriority.LOW,
      });
    });

    it('should allow zero timeout', () => {
      class TestService {
        @Timeout(0)
        immediateTask() {}
      }

      const service = new TestService();
      const metadata = getTimeoutMetadata(service, 'immediateTask');

      expect(metadata?.pattern).toBe(0);
    });

    it('should throw error for negative timeout', () => {
      expect(() => {
        class TestService {
          @Timeout(-1000)
          invalidTask() {}
        }
      }).toThrow();
    });

    it('should handle multiple timeout jobs', () => {
      class MultiTimeoutService {
        @Timeout(1000)
        shortTimeout() {}

        @Timeout(60000)
        longTimeout() {}
      }

      const jobs = getScheduledJobs(MultiTimeoutService);
      expect(jobs).toHaveLength(2);
    });
  });

  describe('@Schedulable', () => {
    it('should mark class as schedulable', () => {
      @Schedulable()
      class TestService {
        @Cron(CronExpression.EVERY_MINUTE)
        task() {}
      }

      const metadata = Reflect.getMetadata(SCHEDULER_METADATA.JOB_OPTIONS, TestService);
      expect(metadata).toBe(true);
    });

    it('should work with multiple scheduled methods', () => {
      @Schedulable()
      class SchedulableService {
        @Cron(CronExpression.EVERY_HOUR)
        hourly() {}

        @Interval(5000)
        periodic() {}

        @Timeout(10000)
        delayed() {}
      }

      const jobs = getScheduledJobs(SchedulableService);
      expect(jobs).toHaveLength(3);
    });
  });

  describe('getScheduledJobs', () => {
    it('should return empty array for class without scheduled jobs', () => {
      class PlainService {
        regularMethod() {}
      }

      const jobs = getScheduledJobs(PlainService);
      expect(jobs).toHaveLength(0);
    });

    it('should return all scheduled jobs from class', () => {
      class MixedService {
        @Cron(CronExpression.EVERY_MINUTE)
        cronJob() {}

        regularMethod() {}

        @Interval(5000)
        intervalJob() {}

        @Timeout(10000)
        timeoutJob() {}
      }

      const jobs = getScheduledJobs(MixedService);
      expect(jobs).toHaveLength(3);
    });

    it('should preserve property names', () => {
      class TestService {
        @Cron(CronExpression.EVERY_HOUR)
        myCustomJobName() {}
      }

      const jobs = getScheduledJobs(TestService);
      expect(jobs[0].propertyKey).toBe('myCustomJobName');
    });

    it('should handle inheritance', () => {
      class BaseService {
        @Cron(CronExpression.EVERY_MINUTE)
        baseTask() {}
      }

      class DerivedService extends BaseService {
        @Interval(5000)
        derivedTask() {}
      }

      const baseJobs = getScheduledJobs(BaseService);
      const derivedJobs = getScheduledJobs(DerivedService);

      expect(baseJobs).toHaveLength(1);
      expect(derivedJobs).toHaveLength(1);
    });
  });

  describe('Mixed Decorators', () => {
    it('should handle all decorator types together', () => {
      @Schedulable()
      class CompleteService {
        @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
          timezone: 'UTC',
          priority: JobPriority.HIGH,
        })
        dailyCleanup() {}

        @Interval(30000, {
          immediate: true,
        })
        healthCheck() {}

        @Timeout(5000)
        startupTask() {}
      }

      const jobs = getScheduledJobs(CompleteService);
      
      expect(jobs).toHaveLength(3);
      
      const cronJob = jobs.find(j => j.propertyKey === 'dailyCleanup');
      const intervalJob = jobs.find(j => j.propertyKey === 'healthCheck');
      const timeoutJob = jobs.find(j => j.propertyKey === 'startupTask');

      expect(cronJob?.metadata.type).toBe('cron');
      expect(intervalJob?.metadata.type).toBe('interval');
      expect(timeoutJob?.metadata.type).toBe('timeout');
    });

    it('should preserve all metadata across multiple jobs', () => {
      class DetailedService {
        @Cron(CronExpression.EVERY_MINUTE, {
          name: 'minute-task',
          priority: JobPriority.HIGH,
          timeout: 5000,
        })
        minuteTask() {}

        @Interval(10000, {
          name: 'interval-task',
          immediate: true,
          preventOverlap: true,
        })
        intervalTask() {}
      }

      const jobs = getScheduledJobs(DetailedService);

      expect(jobs).toHaveLength(2);
      expect(jobs[0].metadata.options.name).toBeDefined();
      expect(jobs[1].metadata.options.name).toBeDefined();
    });
  });

  describe('Metadata Helpers', () => {
    it('should return undefined for non-decorated method', () => {
      class TestService {
        regularMethod() {}
      }

      const service = new TestService();
      const cronMeta = getCronMetadata(service, 'regularMethod');
      const intervalMeta = getIntervalMetadata(service, 'regularMethod');
      const timeoutMeta = getTimeoutMetadata(service, 'regularMethod');

      expect(cronMeta).toBeUndefined();
      expect(intervalMeta).toBeUndefined();
      expect(timeoutMeta).toBeUndefined();
    });

    it('should return correct metadata for each decorator type', () => {
      class TestService {
        @Cron(CronExpression.EVERY_HOUR)
        cronMethod() {}

        @Interval(5000)
        intervalMethod() {}

        @Timeout(10000)
        timeoutMethod() {}
      }

      const service = new TestService();

      expect(getCronMetadata(service, 'cronMethod')).toBeDefined();
      expect(getIntervalMetadata(service, 'intervalMethod')).toBeDefined();
      expect(getTimeoutMetadata(service, 'timeoutMethod')).toBeDefined();
    });
  });
});
