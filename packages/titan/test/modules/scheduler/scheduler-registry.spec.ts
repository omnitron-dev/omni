/**
 * Scheduler Registry Comprehensive Tests
 * Tests job registration, query, filtering, and state management
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { SchedulerRegistry } from '../../../src/modules/scheduler/scheduler.registry.js';
import { SCHEDULER_EVENTS } from '../../../src/modules/scheduler/scheduler.constants.js';
import { JobStatus, SchedulerJobType, JobPriority } from '../../../src/modules/scheduler/scheduler.interfaces.js';
import type { ISchedulerConfig } from '../../../src/modules/scheduler/scheduler.interfaces.js';

describe('Scheduler Registry', () => {
  let registry: SchedulerRegistry;

  const config: ISchedulerConfig = {
    enabled: true,
  };

  beforeEach(() => {
    registry = new SchedulerRegistry(config);
  });

  describe('Job Registration', () => {
    it('should register a new job', () => {
      const job = registry.registerJob(
        'test-job',
        SchedulerJobType.CRON,
        '0 0 * * *',
        {},
        'execute',
        {}
      );

      expect(job).toBeDefined();
      expect(job.name).toBe('test-job');
      expect(job.type).toBe(SchedulerJobType.CRON);
      expect(job.id).toBeDefined();
      expect(job.status).toBe(JobStatus.PENDING);
    });

    it('should throw error when registering duplicate job', () => {
      registry.registerJob('duplicate', SchedulerJobType.CRON, '* * * * *', {}, 'run', {});
      
      expect(() => {
        registry.registerJob('duplicate', SchedulerJobType.CRON, '* * * * *', {}, 'run', {});
      }).toThrow();
    });

    it('should generate unique job IDs', () => {
      const job1 = registry.registerJob('job1', SchedulerJobType.INTERVAL, 1000, {}, 'run', {});
      const job2 = registry.registerJob('job2', SchedulerJobType.INTERVAL, 1000, {}, 'run', {});

      expect(job1.id).not.toBe(job2.id);
    });

    it('should emit JOB_REGISTERED event', () => {
      const handler = jest.fn();
      registry.on(SCHEDULER_EVENTS.JOB_REGISTERED, handler);

      const job = registry.registerJob('event-job', SchedulerJobType.TIMEOUT, 5000, {}, 'run', {});

      expect(handler).toHaveBeenCalledWith(job);
    });

    it('should set timestamps on registration', () => {
      const job = registry.registerJob('timestamp-job', SchedulerJobType.CRON, '* * * * *', {}, 'run', {});

      expect(job.createdAt).toBeInstanceOf(Date);
      expect(job.updatedAt).toBeInstanceOf(Date);
    });

    it('should initialize counters to zero', () => {
      const job = registry.registerJob('counter-job', SchedulerJobType.INTERVAL, 1000, {}, 'run', {});

      expect(job.executionCount).toBe(0);
      expect(job.failureCount).toBe(0);
      expect(job.isRunning).toBe(false);
    });
  });

  describe('Job Retrieval', () => {
    beforeEach(() => {
      registry.registerJob('cron1', SchedulerJobType.CRON, '* * * * *', {}, 'run', {});
      registry.registerJob('interval1', SchedulerJobType.INTERVAL, 1000, {}, 'run', {});
      registry.registerJob('timeout1', SchedulerJobType.TIMEOUT, 5000, {}, 'run', {});
    });

    it('should get job by name', () => {
      const job = registry.getJob('cron1');
      
      expect(job).toBeDefined();
      expect(job?.name).toBe('cron1');
    });

    it('should return undefined for non-existent job', () => {
      const job = registry.getJob('non-existent');
      
      expect(job).toBeUndefined();
    });

    it('should check if job exists', () => {
      expect(registry.hasJob('cron1')).toBe(true);
      expect(registry.hasJob('non-existent')).toBe(false);
    });

    it('should get all jobs', () => {
      const jobs = registry.getAllJobs();
      
      expect(jobs).toHaveLength(3);
    });

    it('should get cron jobs', () => {
      const cronJobs = registry.getCronJobs();
      
      expect(cronJobs).toHaveLength(1);
      expect(cronJobs[0].name).toBe('cron1');
    });

    it('should get interval jobs', () => {
      const intervals = registry.getIntervals();
      
      expect(intervals).toHaveLength(1);
      expect(intervals[0].name).toBe('interval1');
    });

    it('should get timeout jobs', () => {
      const timeouts = registry.getTimeouts();
      
      expect(timeouts).toHaveLength(1);
      expect(timeouts[0].name).toBe('timeout1');
    });

    it('should get jobs by type', () => {
      const cronJobs = registry.getJobsByType(SchedulerJobType.CRON);
      
      expect(cronJobs).toHaveLength(1);
      expect(cronJobs[0].type).toBe(SchedulerJobType.CRON);
    });

    it('should get jobs by status', () => {
      const pendingJobs = registry.getJobsByStatus(JobStatus.PENDING);
      
      expect(pendingJobs).toHaveLength(3);
    });
  });

  describe('Job Status Management', () => {
    let jobName: string;

    beforeEach(() => {
      const job = registry.registerJob('status-job', SchedulerJobType.CRON, '* * * * *', {}, 'run', {});
      jobName = job.name;
    });

    it('should update job status', () => {
      registry.updateJobStatus(jobName, JobStatus.RUNNING);
      
      const job = registry.getJob(jobName);
      expect(job?.status).toBe(JobStatus.RUNNING);
    });

    it('should throw error when updating non-existent job', () => {
      expect(() => {
        registry.updateJobStatus('non-existent', JobStatus.RUNNING);
      }).toThrow();
    });

    it('should update status index when status changes', () => {
      registry.updateJobStatus(jobName, JobStatus.RUNNING);
      
      const runningJobs = registry.getJobsByStatus(JobStatus.RUNNING);
      expect(runningJobs).toHaveLength(1);
      
      const pendingJobs = registry.getJobsByStatus(JobStatus.PENDING);
      expect(pendingJobs).toHaveLength(0);
    });

    it('should update timestamp on status change', () => {
      const job = registry.getJob(jobName);
      const originalUpdatedAt = job?.updatedAt;
      
      // Wait a bit to ensure timestamp changes
      setTimeout(() => {
        registry.updateJobStatus(jobName, JobStatus.RUNNING);
        const updatedJob = registry.getJob(jobName);
        
        expect(updatedJob?.updatedAt).not.toEqual(originalUpdatedAt);
      }, 10);
    });
  });

  describe('Job Execution Tracking', () => {
    let jobName: string;

    beforeEach(() => {
      const job = registry.registerJob('exec-job', SchedulerJobType.INTERVAL, 1000, {}, 'run', {});
      jobName = job.name;
    });

    it('should update last execution time', () => {
      const now = new Date();
      registry.updateJobExecution(jobName, { lastExecution: now });
      
      const job = registry.getJob(jobName);
      expect(job?.lastExecution).toEqual(now);
    });

    it('should increment execution count', () => {
      registry.updateJobExecution(jobName, { lastExecution: new Date() });
      registry.updateJobExecution(jobName, { lastExecution: new Date() });
      
      const job = registry.getJob(jobName);
      expect(job?.executionCount).toBe(2);
    });

    it('should update next execution time', () => {
      const future = new Date(Date.now() + 60000);
      registry.updateJobExecution(jobName, { nextExecution: future });
      
      const job = registry.getJob(jobName);
      expect(job?.nextExecution).toEqual(future);
    });

    it('should store last result', () => {
      registry.updateJobExecution(jobName, { lastResult: { data: 'test' } });
      
      const job = registry.getJob(jobName);
      expect(job?.lastResult).toEqual({ data: 'test' });
    });

    it('should store last error and increment failure count', () => {
      const error = new Error('Test error');
      registry.updateJobExecution(jobName, { lastError: error });
      
      const job = registry.getJob(jobName);
      expect(job?.lastError).toBe(error);
      expect(job?.failureCount).toBe(1);
    });

    it('should calculate average execution time', () => {
      registry.updateJobExecution(jobName, { lastExecution: new Date(), executionTime: 100 });
      registry.updateJobExecution(jobName, { lastExecution: new Date(), executionTime: 200 });
      registry.updateJobExecution(jobName, { lastExecution: new Date(), executionTime: 300 });
      
      const job = registry.getJob(jobName);
      expect(job?.avgExecutionTime).toBe(200);
    });

    it('should mark job as running', () => {
      registry.markJobRunning(jobName, true);
      
      const job = registry.getJob(jobName);
      expect(job?.isRunning).toBe(true);
    });

    it('should unmark job as running', () => {
      registry.markJobRunning(jobName, true);
      registry.markJobRunning(jobName, false);
      
      const job = registry.getJob(jobName);
      expect(job?.isRunning).toBe(false);
    });
  });

  describe('Job Removal', () => {
    it('should remove job by name', () => {
      registry.registerJob('removable', SchedulerJobType.TIMEOUT, 1000, {}, 'run', {});
      
      const removed = registry.removeJob('removable');
      
      expect(removed).toBe(true);
      expect(registry.hasJob('removable')).toBe(false);
    });

    it('should return false when removing non-existent job', () => {
      const removed = registry.removeJob('non-existent');
      
      expect(removed).toBe(false);
    });

    it('should emit JOB_REMOVED event', () => {
      const handler = jest.fn();
      registry.on(SCHEDULER_EVENTS.JOB_REMOVED, handler);
      
      const job = registry.registerJob('remove-event', SchedulerJobType.CRON, '* * * * *', {}, 'run', {});
      registry.removeJob('remove-event');
      
      expect(handler).toHaveBeenCalledWith(job);
    });

    it('should remove from type and status indexes', () => {
      registry.registerJob('indexed', SchedulerJobType.CRON, '* * * * *', {}, 'run', {});
      registry.removeJob('indexed');
      
      const cronJobs = registry.getCronJobs();
      expect(cronJobs.find(j => j.name === 'indexed')).toBeUndefined();
    });
  });

  describe('Job Filtering', () => {
    beforeEach(() => {
      registry.registerJob('cron-high', SchedulerJobType.CRON, '* * * * *', {}, 'run', {
        priority: JobPriority.HIGH,
      });
      registry.registerJob('cron-low', SchedulerJobType.CRON, '0 0 * * *', {}, 'run', {
        priority: JobPriority.LOW,
        disabled: true,
      });
      registry.registerJob('interval-normal', SchedulerJobType.INTERVAL, 1000, {}, 'run', {
        priority: JobPriority.NORMAL,
      });
      
      // Update some statuses
      registry.updateJobStatus('cron-high', JobStatus.RUNNING);
    });

    it('should filter by status', () => {
      const runningJobs = registry.findJobs({ status: JobStatus.RUNNING });
      
      expect(runningJobs).toHaveLength(1);
      expect(runningJobs[0].name).toBe('cron-high');
    });

    it('should filter by multiple statuses', () => {
      const jobs = registry.findJobs({ 
        status: [JobStatus.RUNNING, JobStatus.PENDING] 
      });
      
      expect(jobs.length).toBeGreaterThan(1);
    });

    it('should filter by type', () => {
      const cronJobs = registry.findJobs({ type: SchedulerJobType.CRON });
      
      expect(cronJobs).toHaveLength(2);
    });

    it('should filter by multiple types', () => {
      const jobs = registry.findJobs({ 
        type: [SchedulerJobType.CRON, SchedulerJobType.INTERVAL] 
      });
      
      expect(jobs).toHaveLength(3);
    });

    it('should filter by name pattern (string)', () => {
      const jobs = registry.findJobs({ namePattern: 'cron' });
      
      expect(jobs).toHaveLength(2);
      expect(jobs.every(j => j.name.includes('cron'))).toBe(true);
    });

    it('should filter by name pattern (regex)', () => {
      const jobs = registry.findJobs({ namePattern: /^cron-/ });
      
      expect(jobs).toHaveLength(2);
    });

    it('should filter by priority', () => {
      const highPriorityJobs = registry.findJobs({ priority: JobPriority.HIGH });
      
      expect(highPriorityJobs).toHaveLength(1);
      expect(highPriorityJobs[0].name).toBe('cron-high');
    });

    it('should exclude disabled jobs by default', () => {
      const jobs = registry.findJobs({ type: SchedulerJobType.CRON });
      
      expect(jobs.length).toBeLessThan(2);
      expect(jobs.find(j => j.options.disabled)).toBeUndefined();
    });

    it('should include disabled jobs when specified', () => {
      const jobs = registry.findJobs({ 
        type: SchedulerJobType.CRON,
        includeDisabled: true 
      });
      
      expect(jobs).toHaveLength(2);
    });

    it('should sort by name', () => {
      const jobs = registry.findJobs({ 
        sortBy: 'name',
        includeDisabled: true 
      });
      
      expect(jobs[0].name).toBe('cron-high');
      expect(jobs[jobs.length - 1].name).toBe('interval-normal');
    });

    it('should sort by priority', () => {
      const jobs = registry.findJobs({ 
        sortBy: 'priority',
        includeDisabled: true 
      });
      
      const priorities = jobs.map((j: any) => j.options.priority || JobPriority.NORMAL);
      expect(priorities[0]).toBeLessThanOrEqual(priorities[priorities.length - 1]);
    });

    it('should sort descending', () => {
      const jobs = registry.findJobs({ 
        sortBy: 'name',
        sortDirection: 'desc',
        includeDisabled: true 
      });
      
      expect(jobs[0].name).toBe('interval-normal');
    });

    it('should paginate results', () => {
      const page1 = registry.findJobs({ 
        limit: 1,
        offset: 0,
        includeDisabled: true 
      });
      const page2 = registry.findJobs({ 
        limit: 1,
        offset: 1,
        includeDisabled: true 
      });
      
      expect(page1).toHaveLength(1);
      expect(page2).toHaveLength(1);
      expect(page1[0].name).not.toBe(page2[0].name);
    });

    it('should combine multiple filters', () => {
      const jobs = registry.findJobs({
        type: SchedulerJobType.CRON,
        status: JobStatus.RUNNING,
        priority: JobPriority.HIGH,
      });
      
      expect(jobs).toHaveLength(1);
      expect(jobs[0].name).toBe('cron-high');
    });
  });

  describe('Job Instance Storage', () => {
    it('should store job instance', () => {
      const job = registry.registerJob('instance-job', SchedulerJobType.CRON, '* * * * *', {}, 'run', {});
      const instance = { some: 'data' };
      
      registry.setJobInstance('instance-job', instance);
      
      const retrievedInstance = registry.getJobInstance('instance-job');
      expect(retrievedInstance).toBe(instance);
    });

    it('should return undefined for non-existent job instance', () => {
      const instance = registry.getJobInstance('non-existent');
      
      expect(instance).toBeUndefined();
    });
  });

  describe('Registry Statistics', () => {
    beforeEach(() => {
      registry.registerJob('job1', SchedulerJobType.CRON, '* * * * *', {}, 'run', {});
      registry.registerJob('job2', SchedulerJobType.INTERVAL, 1000, {}, 'run', {});
      registry.registerJob('job3', SchedulerJobType.TIMEOUT, 5000, {}, 'run', {});
      
      registry.updateJobStatus('job1', JobStatus.RUNNING);
      registry.updateJobStatus('job2', JobStatus.COMPLETED);
    });

    it('should get total job count', () => {
      expect(registry.getJobCount()).toBe(3);
    });

    it('should get job count by type', () => {
      expect(registry.getJobCountByType(SchedulerJobType.CRON)).toBe(1);
      expect(registry.getJobCountByType(SchedulerJobType.INTERVAL)).toBe(1);
      expect(registry.getJobCountByType(SchedulerJobType.TIMEOUT)).toBe(1);
    });

    it('should get job count by status', () => {
      expect(registry.getJobCountByStatus(JobStatus.RUNNING)).toBe(1);
      expect(registry.getJobCountByStatus(JobStatus.COMPLETED)).toBe(1);
      expect(registry.getJobCountByStatus(JobStatus.PENDING)).toBe(1);
    });
  });

  describe('Registry Clear', () => {
    it('should clear all jobs', () => {
      registry.registerJob('job1', SchedulerJobType.CRON, '* * * * *', {}, 'run', {});
      registry.registerJob('job2', SchedulerJobType.INTERVAL, 1000, {}, 'run', {});
      
      registry.clear();
      
      expect(registry.getJobCount()).toBe(0);
      expect(registry.getAllJobs()).toHaveLength(0);
    });

    it('should clear type indexes', () => {
      registry.registerJob('job1', SchedulerJobType.CRON, '* * * * *', {}, 'run', {});
      
      registry.clear();
      
      expect(registry.getCronJobs()).toHaveLength(0);
    });

    it('should clear status indexes', () => {
      registry.registerJob('job1', SchedulerJobType.CRON, '* * * * *', {}, 'run', {});
      
      registry.clear();
      
      expect(registry.getJobsByStatus(JobStatus.PENDING)).toHaveLength(0);
    });
  });

  describe('Event Handling', () => {
    it('should support custom events', () => {
      const handler = jest.fn();
      const customEvent = 'custom:test:event';
      
      registry.on(customEvent, handler);
      registry.emit(customEvent, { data: 'test' });
      
      expect(handler).toHaveBeenCalledWith({ data: 'test' });
    });

    it('should support multiple handlers for same event', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      
      registry.on('test:event', handler1);
      registry.on('test:event', handler2);
      registry.emit('test:event', {});
      
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should unsubscribe from events', () => {
      const handler = jest.fn();
      
      registry.on('test:event', handler);
      registry.off('test:event', handler);
      registry.emit('test:event', {});
      
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
