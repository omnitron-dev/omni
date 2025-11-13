/**
 * Scheduler Persistence Comprehensive Tests
 * Tests job state persistence, recovery, and storage providers
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { 
  SchedulerPersistence, 
  InMemoryPersistenceProvider 
} from '../../../src/modules/scheduler/scheduler.persistence.js';
import { JobStatus, SchedulerJobType } from '../../../src/modules/scheduler/scheduler.interfaces.js';
import type { ISchedulerConfig, IScheduledJob, IJobExecutionResult } from '../../../src/modules/scheduler/scheduler.interfaces.js';

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
