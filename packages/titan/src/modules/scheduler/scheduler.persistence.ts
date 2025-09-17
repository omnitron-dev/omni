/**
 * Scheduler Persistence
 *
 * Handles job state persistence and recovery
 */

import { Inject, Optional, Injectable } from '@omnitron-dev/nexus';

import {
  SCHEDULER_CONFIG_TOKEN
} from './scheduler.constants';

import type {
  ScheduledJob,
  SchedulerConfig,
  JobExecutionResult
} from './scheduler.interfaces';

/**
 * Interface for persistence providers
 */
export interface PersistenceProvider {
  saveJob(job: ScheduledJob): Promise<void>;
  loadJob(id: string): Promise<ScheduledJob | null>;
  loadAllJobs(): Promise<ScheduledJob[]>;
  deleteJob(id: string): Promise<void>;
  saveExecutionResult(result: JobExecutionResult): Promise<void>;
  loadExecutionHistory(jobId: string, limit?: number): Promise<JobExecutionResult[]>;
  clear(): Promise<void>;
}

/**
 * In-memory persistence provider (default)
 */
export class InMemoryPersistenceProvider implements PersistenceProvider {
  private jobs: Map<string, ScheduledJob> = new Map();
  private executionHistory: Map<string, JobExecutionResult[]> = new Map();

  async saveJob(job: ScheduledJob): Promise<void> {
    this.jobs.set(job.id, { ...job, instance: undefined });
  }

  async loadJob(id: string): Promise<ScheduledJob | null> {
    return this.jobs.get(id) || null;
  }

  async loadAllJobs(): Promise<ScheduledJob[]> {
    return Array.from(this.jobs.values());
  }

  async deleteJob(id: string): Promise<void> {
    this.jobs.delete(id);
    this.executionHistory.delete(id);
  }

  async saveExecutionResult(result: JobExecutionResult): Promise<void> {
    const history = this.executionHistory.get(result.jobId) || [];
    history.push(result);
    // Keep only last 100 executions
    if (history.length > 100) {
      history.shift();
    }
    this.executionHistory.set(result.jobId, history);
  }

  async loadExecutionHistory(jobId: string, limit: number = 10): Promise<JobExecutionResult[]> {
    const history = this.executionHistory.get(jobId) || [];
    return history.slice(-limit);
  }

  async clear(): Promise<void> {
    this.jobs.clear();
    this.executionHistory.clear();
  }
}

/**
 * Scheduler persistence service
 */
@Injectable()
export class SchedulerPersistence {
  private provider: PersistenceProvider;
  private autosaveInterval?: any;

  constructor(
    @Optional() @Inject(SCHEDULER_CONFIG_TOKEN) private readonly config?: SchedulerConfig
  ) {
    // Initialize persistence provider based on config
    this.provider = this.initializeProvider();

    // Setup autosave if enabled
    if (config?.persistence?.enabled) {
      this.setupAutosave();
    }
  }

  /**
   * Initialize persistence provider
   */
  private initializeProvider(): PersistenceProvider {
    if (!this.config?.persistence?.enabled) {
      return new InMemoryPersistenceProvider();
    }

    // For now, only support in-memory
    // TODO: Add Redis and database providers
    return new InMemoryPersistenceProvider();
  }

  /**
   * Setup autosave
   */
  private setupAutosave(): void {
    // Autosave every 5 minutes by default
    const interval = 5 * 60 * 1000;
    this.autosaveInterval = setInterval(() => {
      this.flush().catch(error => {
        console.error('Failed to autosave scheduler state:', error);
      });
    }, interval);
  }

  /**
   * Save job state
   */
  async saveJob(job: ScheduledJob): Promise<void> {
    if (!this.config?.persistence?.enabled) {
      return;
    }

    try {
      await this.provider.saveJob(job);
    } catch (error) {
      console.error('Failed to persist job:', error);
    }
  }

  /**
   * Load job state
   */
  async loadJob(id: string): Promise<ScheduledJob | null> {
    if (!this.config?.persistence?.enabled) {
      return null;
    }

    try {
      return await this.provider.loadJob(id);
    } catch (error) {
      console.error('Failed to load job:', error);
      return null;
    }
  }

  /**
   * Load all jobs
   */
  async loadAllJobs(): Promise<ScheduledJob[]> {
    if (!this.config?.persistence?.enabled) {
      return [];
    }

    try {
      return await this.provider.loadAllJobs();
    } catch (error) {
      console.error('Failed to load jobs:', error);
      return [];
    }
  }

  /**
   * Delete job state
   */
  async deleteJob(id: string): Promise<void> {
    if (!this.config?.persistence?.enabled) {
      return;
    }

    try {
      await this.provider.deleteJob(id);
    } catch (error) {
      console.error('Failed to delete job:', error);
    }
  }

  /**
   * Save execution result
   */
  async saveExecutionResult(result: JobExecutionResult): Promise<void> {
    if (!this.config?.persistence?.enabled) {
      return;
    }

    try {
      await this.provider.saveExecutionResult(result);
    } catch (error) {
      console.error('Failed to persist execution result:', error);
    }
  }

  /**
   * Load execution history
   */
  async loadExecutionHistory(jobId: string, limit?: number): Promise<JobExecutionResult[]> {
    if (!this.config?.persistence?.enabled) {
      return [];
    }

    try {
      return await this.provider.loadExecutionHistory(jobId, limit);
    } catch (error) {
      console.error('Failed to load execution history:', error);
      return [];
    }
  }

  /**
   * Flush all pending writes
   */
  async flush(): Promise<void> {
    // Implementation depends on provider
    // For in-memory, this is a no-op
  }

  /**
   * Clear all persisted data
   */
  async clear(): Promise<void> {
    try {
      await this.provider.clear();
    } catch (error) {
      console.error('Failed to clear persisted data:', error);
    }
  }

  /**
   * Destroy persistence
   */
  async destroy(): Promise<void> {
    if (this.autosaveInterval) {
      clearInterval(this.autosaveInterval);
    }
    await this.flush();
  }

  /**
   * Export job state
   */
  async exportState(): Promise<{
    jobs: ScheduledJob[];
    timestamp: Date;
  }> {
    const jobs = await this.provider.loadAllJobs();
    return {
      jobs,
      timestamp: new Date()
    };
  }

  /**
   * Import job state
   */
  async importState(state: {
    jobs: ScheduledJob[];
  }): Promise<void> {
    for (const job of state.jobs) {
      await this.provider.saveJob(job);
    }
  }
}