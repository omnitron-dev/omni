/**
 * Scheduler Persistence
 *
 * Handles job state persistence and recovery
 */

import { Inject, Optional, Injectable } from '../../decorators/index.js';

import {
  SCHEDULER_CONFIG_TOKEN
} from './scheduler.constants.js';

import type {
  IScheduledJob,
  ISchedulerConfig,
  IJobExecutionResult
} from './scheduler.interfaces.js';

/**
 * Interface for persistence providers
 */
export interface IPersistenceProvider {
  saveJob(job: IScheduledJob): Promise<void>;
  loadJob(id: string): Promise<IScheduledJob | null>;
  loadAllJobs(): Promise<IScheduledJob[]>;
  deleteJob(id: string): Promise<void>;
  saveExecutionResult(result: IJobExecutionResult): Promise<void>;
  loadExecutionHistory(jobId: string, limit?: number): Promise<IJobExecutionResult[]>;
  clear(): Promise<void>;
}

/**
 * In-memory persistence provider (default)
 */
export class InMemoryPersistenceProvider implements IPersistenceProvider {
  private jobs: Map<string, IScheduledJob> = new Map();
  private executionHistory: Map<string, IJobExecutionResult[]> = new Map();

  async saveJob(job: IScheduledJob): Promise<void> {
    this.jobs.set(job.id, { ...job, instance: undefined });
  }

  async loadJob(id: string): Promise<IScheduledJob | null> {
    return this.jobs.get(id) || null;
  }

  async loadAllJobs(): Promise<IScheduledJob[]> {
    return Array.from(this.jobs.values());
  }

  async deleteJob(id: string): Promise<void> {
    this.jobs.delete(id);
    this.executionHistory.delete(id);
  }

  async saveExecutionResult(result: IJobExecutionResult): Promise<void> {
    const history = this.executionHistory.get(result.jobId) || [];
    history.push(result);
    // Keep only last 100 executions
    if (history.length > 100) {
      history.shift();
    }
    this.executionHistory.set(result.jobId, history);
  }

  async loadExecutionHistory(jobId: string, limit: number = 10): Promise<IJobExecutionResult[]> {
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
  private provider: IPersistenceProvider;
  private autosaveInterval?: any;

  constructor(
    @Optional() @Inject(SCHEDULER_CONFIG_TOKEN) private readonly config?: ISchedulerConfig
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
  private initializeProvider(): IPersistenceProvider {
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
        // Failed to autosave scheduler state
      });
    }, interval);
  }

  /**
   * Save job state
   */
  async saveJob(job: IScheduledJob): Promise<void> {
    if (!this.config?.persistence?.enabled) {
      return;
    }

    try {
      await this.provider.saveJob(job);
    } catch {
      // Failed to persist job
    }
  }

  /**
   * Load job state
   */
  async loadJob(id: string): Promise<IScheduledJob | null> {
    if (!this.config?.persistence?.enabled) {
      return null;
    }

    try {
      return await this.provider.loadJob(id);
    } catch {
      // Failed to load job
      return null;
    }
  }

  /**
   * Load all jobs
   */
  async loadAllJobs(): Promise<IScheduledJob[]> {
    if (!this.config?.persistence?.enabled) {
      return [];
    }

    try {
      return await this.provider.loadAllJobs();
    } catch {
      // Failed to load jobs
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
    } catch {
      // Failed to delete job
    }
  }

  /**
   * Save execution result
   */
  async saveExecutionResult(result: IJobExecutionResult): Promise<void> {
    if (!this.config?.persistence?.enabled) {
      return;
    }

    try {
      await this.provider.saveExecutionResult(result);
    } catch {
      // Failed to persist execution result
    }
  }

  /**
   * Load execution history
   */
  async loadExecutionHistory(jobId: string, limit?: number): Promise<IJobExecutionResult[]> {
    if (!this.config?.persistence?.enabled) {
      return [];
    }

    try {
      return await this.provider.loadExecutionHistory(jobId, limit);
    } catch {
      // Failed to load execution history
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
    } catch {
      // Failed to clear persisted data
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
    jobs: IScheduledJob[];
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
    jobs: IScheduledJob[];
  }): Promise<void> {
    for (const job of state.jobs) {
      await this.provider.saveJob(job);
    }
  }
}