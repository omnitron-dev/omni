/**
 * Scheduler Persistence Comprehensive Tests
 * Tests job state persistence, recovery, and storage providers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SchedulerPersistence,
  InMemoryPersistenceProvider,
} from '../src/scheduler.persistence.js';
import type { IPersistenceProvider } from '../src/scheduler.persistence.js';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import { JobStatus, SchedulerJobType } from '../src/scheduler.interfaces.js';
import type {
  ISchedulerConfig,
  IScheduledJob,
  IJobExecutionResult,
} from '../src/scheduler.interfaces.js';

describe('Scheduler Persistence', () => {
  describe('InMemoryPersistenceProvider', () => {
    let provider: InMemoryPersistenceProvider;
    let mockJob: IScheduledJob;

    beforeEach(() => {
      provider = new InMemoryPersistenceProvider();
      mockJob = {
        id: 'test-job-1',
        name: 'test-job',
        type: SchedulerJobType.CRON,
        status: JobStatus.PENDING,
        target: { execute: () => {} },
        method: 'execute',
        options: { timezone: 'UTC' },
        pattern: '0 0 * * *',
        executionCount: 0,
        failureCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        isRunning: false,
      };
    });

    it('should save and load job', async () => {
      await provider.saveJob(mockJob);
      const loaded = await provider.loadJob(mockJob.id);

      expect(loaded).toBeDefined();
      expect(loaded?.id).toBe(mockJob.id);
      expect(loaded?.name).toBe(mockJob.name);
    });

    it('should return null for non-existent job', async () => {
      const loaded = await provider.loadJob('non-existent');
      expect(loaded).toBeNull();
    });

    it('should load all jobs', async () => {
      const job2 = { ...mockJob, id: 'test-job-2', name: 'job2' };

      await provider.saveJob(mockJob);
      await provider.saveJob(job2);

      const jobs = await provider.loadAllJobs();
      expect(jobs).toHaveLength(2);
    });

    it('should delete job', async () => {
      await provider.saveJob(mockJob);
      await provider.deleteJob(mockJob.id);

      const loaded = await provider.loadJob(mockJob.id);
      expect(loaded).toBeNull();
    });

    it('should save execution result', async () => {
      const result: IJobExecutionResult = {
        jobId: mockJob.id,
        executionId: 'exec-1',
        status: 'success',
        result: 'test result',
        duration: 100,
        timestamp: new Date(),
      };

      await provider.saveExecutionResult(result);

      const history = await provider.loadExecutionHistory(mockJob.id, 10);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject(result);
    });

    it('should limit execution history to last 100 entries', async () => {
      const results: IJobExecutionResult[] = [];

      for (let i = 0; i < 150; i++) {
        results.push({
          jobId: mockJob.id,
          executionId: `exec-${i}`,
          status: 'success',
          duration: 100,
          timestamp: new Date(),
        });
      }

      for (const result of results) {
        await provider.saveExecutionResult(result);
      }

      const history = await provider.loadExecutionHistory(mockJob.id, 200);
      expect(history.length).toBeLessThanOrEqual(100);
    });

    it('should load limited execution history', async () => {
      for (let i = 0; i < 20; i++) {
        await provider.saveExecutionResult({
          jobId: mockJob.id,
          executionId: `exec-${i}`,
          status: 'success',
          duration: 100,
          timestamp: new Date(),
        });
      }

      const history = await provider.loadExecutionHistory(mockJob.id, 5);
      expect(history).toHaveLength(5);
    });

    it('should clear all data', async () => {
      await provider.saveJob(mockJob);
      await provider.saveExecutionResult({
        jobId: mockJob.id,
        executionId: 'exec-1',
        status: 'success',
        duration: 100,
        timestamp: new Date(),
      });

      await provider.clear();

      const jobs = await provider.loadAllJobs();
      const history = await provider.loadExecutionHistory(mockJob.id);

      expect(jobs).toHaveLength(0);
      expect(history).toHaveLength(0);
    });

    it('should not include job instance in saved state', async () => {
      const jobWithInstance = { ...mockJob, instance: { someData: 'test' } };

      await provider.saveJob(jobWithInstance);
      const loaded = await provider.loadJob(jobWithInstance.id);

      expect(loaded?.instance).toBeUndefined();
    });

    it('should delete execution history when deleting job', async () => {
      await provider.saveJob(mockJob);
      await provider.saveExecutionResult({
        jobId: mockJob.id,
        executionId: 'exec-1',
        status: 'success',
        duration: 100,
        timestamp: new Date(),
      });

      await provider.deleteJob(mockJob.id);

      const history = await provider.loadExecutionHistory(mockJob.id);
      expect(history).toHaveLength(0);
    });
  });

  describe('SchedulerPersistence Service', () => {
    let persistence: SchedulerPersistence;
    let mockJob: IScheduledJob;

    beforeEach(() => {
      mockJob = {
        id: 'test-job-1',
        name: 'test-job',
        type: SchedulerJobType.CRON,
        status: JobStatus.PENDING,
        target: { execute: () => {} },
        method: 'execute',
        options: {},
        pattern: '0 0 * * *',
        executionCount: 0,
        failureCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        isRunning: false,
      };
    });

    describe('With Persistence Disabled', () => {
      beforeEach(() => {
        const config: ISchedulerConfig = {
          persistence: { enabled: false },
        };
        persistence = new SchedulerPersistence(config);
      });

      it('should not persist when disabled', async () => {
        await persistence.saveJob(mockJob);
        const loaded = await persistence.loadJob(mockJob.id);

        expect(loaded).toBeNull();
      });

      it('should return empty array when loading all jobs', async () => {
        const jobs = await persistence.loadAllJobs();
        expect(jobs).toHaveLength(0);
      });

      it('should not save execution results when disabled', async () => {
        await persistence.saveExecutionResult({
          jobId: mockJob.id,
          executionId: 'exec-1',
          status: 'success',
          duration: 100,
          timestamp: new Date(),
        });

        const history = await persistence.loadExecutionHistory(mockJob.id);
        expect(history).toHaveLength(0);
      });
    });

    describe('With Persistence Enabled', () => {
      beforeEach(() => {
        const config: ISchedulerConfig = {
          persistence: {
            enabled: true,
            provider: new InMemoryPersistenceProvider(),
          },
        };
        persistence = new SchedulerPersistence(config);
      });

      afterEach(async () => {
        await persistence.destroy();
      });

      it('should save and load job', async () => {
        await persistence.saveJob(mockJob);
        const loaded = await persistence.loadJob(mockJob.id);

        expect(loaded).toBeDefined();
        expect(loaded?.name).toBe(mockJob.name);
      });

      it('should load all jobs', async () => {
        const job2 = { ...mockJob, id: 'job-2', name: 'job2' };

        await persistence.saveJob(mockJob);
        await persistence.saveJob(job2);

        const jobs = await persistence.loadAllJobs();
        expect(jobs).toHaveLength(2);
      });

      it('should delete job', async () => {
        await persistence.saveJob(mockJob);
        await persistence.deleteJob(mockJob.id);

        const loaded = await persistence.loadJob(mockJob.id);
        expect(loaded).toBeNull();
      });

      it('should save execution results', async () => {
        const result: IJobExecutionResult = {
          jobId: mockJob.id,
          executionId: 'exec-1',
          status: 'success',
          result: { data: 'test' },
          duration: 150,
          timestamp: new Date(),
        };

        await persistence.saveExecutionResult(result);
        const history = await persistence.loadExecutionHistory(mockJob.id);

        expect(history).toHaveLength(1);
        expect(history[0].executionId).toBe('exec-1');
      });

      it('should load execution history with limit', async () => {
        for (let i = 0; i < 15; i++) {
          await persistence.saveExecutionResult({
            jobId: mockJob.id,
            executionId: `exec-${i}`,
            status: 'success',
            duration: 100,
            timestamp: new Date(),
          });
        }

        const history = await persistence.loadExecutionHistory(mockJob.id, 5);
        expect(history.length).toBeLessThanOrEqual(5);
      });

      it('should clear all persisted data', async () => {
        await persistence.saveJob(mockJob);
        await persistence.clear();

        const jobs = await persistence.loadAllJobs();
        expect(jobs).toHaveLength(0);
      });

      it('should export state', async () => {
        await persistence.saveJob(mockJob);

        const state = await persistence.exportState();

        expect(state.jobs).toHaveLength(1);
        expect(state.timestamp).toBeInstanceOf(Date);
      });

      it('should import state', async () => {
        const state = {
          jobs: [mockJob],
        };

        await persistence.importState(state);
        const loaded = await persistence.loadJob(mockJob.id);

        expect(loaded).toBeDefined();
      });

      it('should handle errors gracefully', async () => {
        // Force an error by using a job with invalid data
        const invalidJob: any = null;

        await expect(persistence.saveJob(invalidJob)).resolves.not.toThrow();
      });
    });

    describe('SC-6: provider failures surface to the logger (no silent swallow)', () => {
      // A provider whose every operation rejects — stands in for a Redis/DB
      // backend that is down or erroring.
      const explode = (): Promise<never> => Promise.reject(new Error('provider down'));
      const failingProvider: IPersistenceProvider = {
        saveJob: explode,
        loadJob: explode,
        loadAllJobs: explode,
        deleteJob: explode,
        saveExecutionResult: explode,
        loadExecutionHistory: explode,
        clear: explode,
      };

      let warn: ReturnType<typeof vi.fn>;
      let svc: SchedulerPersistence;

      beforeEach(() => {
        warn = vi.fn();
        const logger = { warn } as unknown as ILogger;
        const config: ISchedulerConfig = {
          persistence: { enabled: true, provider: failingProvider },
        };
        svc = new SchedulerPersistence(config, logger);
      });

      it('logs (and does not throw) when a delete fails — the SC-11 leak path', async () => {
        await expect(svc.deleteJob('job-x')).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        const [obj, msg] = warn.mock.calls[0];
        expect(obj).toMatchObject({ jobId: 'job-x' });
        expect((obj as any).error).toBeInstanceOf(Error);
        expect(String(msg)).toMatch(/delete/i);
      });

      it('logs a failed save instead of swallowing it', async () => {
        await expect(svc.saveJob({ id: 'j1', name: 'n1' } as any)).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][1])).toMatch(/persist job/i);
      });

      it('logs a load failure and still returns the safe fallback', async () => {
        await expect(svc.loadAllJobs()).resolves.toEqual([]);
        await expect(svc.loadJob('j1')).resolves.toBeNull();
        expect(warn).toHaveBeenCalledTimes(2);
      });

      it('no logger bound (standalone) → still no throw', async () => {
        const standalone = new SchedulerPersistence({
          persistence: { enabled: true, provider: failingProvider },
        });
        await expect(standalone.deleteJob('j1')).resolves.toBeUndefined();
        await expect(standalone.loadAllJobs()).resolves.toEqual([]);
      });
    });

    describe('Autosave', () => {
      it('should setup autosave when persistence is enabled', () => {
        const config: ISchedulerConfig = {
          persistence: {
            enabled: true,
            provider: new InMemoryPersistenceProvider(),
          },
        };

        const persistenceWithAutosave = new SchedulerPersistence(config);

        expect(persistenceWithAutosave).toBeDefined();
        persistenceWithAutosave.destroy();
      });
    });
  });
});
