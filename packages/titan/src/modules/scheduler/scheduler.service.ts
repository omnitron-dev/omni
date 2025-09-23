/**
 * Scheduler Service
 *
 * Main service for managing scheduled jobs
 */

import * as cron from 'node-cron';
import { Inject, Optional, Injectable } from '../../nexus/index.js';

import {
  ERROR_MESSAGES,
  SCHEDULER_CONFIG_TOKEN,
  SCHEDULER_METRICS_TOKEN,
  SCHEDULER_REGISTRY_TOKEN,
  SCHEDULER_EXECUTOR_TOKEN,
  SCHEDULER_DISCOVERY_TOKEN,
  SCHEDULER_PERSISTENCE_TOKEN
} from './scheduler.constants.js';
import {
  JobStatus,
  SchedulerJobType,
  type ICronOptions,
  type IScheduledJob,
  type CronExpression,
  type ITimeoutOptions,
  type ISchedulerConfig,
  type IIntervalOptions,
  type IJobFilterOptions,
  type ISchedulerMetrics,
  type IJobExecutionResult,
  type IJobExecutionContext
} from './scheduler.interfaces.js';

import type { SchedulerRegistry } from './scheduler.registry.js';
import type { SchedulerExecutor } from './scheduler.executor.js';
import type { SchedulerDiscovery } from './scheduler.discovery.js';
import type { SchedulerMetricsService } from './scheduler.metrics.js';
import type { SchedulerPersistence } from './scheduler.persistence.js';

/**
 * Main scheduler service
 */
@Injectable()
export class SchedulerService {
  private isStarted = false;
  private intervalHandles = new Map<string, any>();
  private timeoutHandles = new Map<string, any>();
  private cronJobs = new Map<string, cron.ScheduledTask>();

  constructor(
    @Inject(SCHEDULER_REGISTRY_TOKEN) private readonly registry: SchedulerRegistry,
    @Inject(SCHEDULER_EXECUTOR_TOKEN) private readonly executor: SchedulerExecutor,
    @Optional() @Inject(SCHEDULER_CONFIG_TOKEN) private readonly config?: ISchedulerConfig,
    @Optional() @Inject(SCHEDULER_PERSISTENCE_TOKEN) private readonly persistence?: SchedulerPersistence,
    @Optional() @Inject(SCHEDULER_METRICS_TOKEN) private readonly metrics?: SchedulerMetricsService,
    @Optional() @Inject(SCHEDULER_DISCOVERY_TOKEN) private readonly discovery?: SchedulerDiscovery
  ) {}

  /**
   * Initialize scheduler
   */
  async onInit(): Promise<void> {
    // Load persisted jobs
    if (this.persistence) {
      const jobs = await this.persistence.loadAllJobs();
      for (const job of jobs) {
        this.registry.registerJob(
          job.name,
          job.type,
          job.pattern!,
          job.target,
          job.method,
          job.options
        );
      }
    }

    // Discover decorated jobs
    if (this.discovery) {
      await this.discovery.discover();
    }

    // Auto-start if configured
    if (this.config?.enabled !== false) {
      await this.start();
    }
  }

  /**
   * Start the scheduler
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      throw new Error(ERROR_MESSAGES.SCHEDULER_ALREADY_STARTED);
    }

    this.isStarted = true;

    // Start all registered jobs
    const jobs = this.registry.getAllJobs();
    for (const job of jobs) {
      if (!job.options.disabled) {
        this.scheduleJob(job);
      }
    }

    // Emit started event (registry should emit, not subscribe)
    // This is a placeholder - real implementation would emit through event bus
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    this.isStarted = false;

    // Stop all cron jobs
    for (const [, task] of this.cronJobs) {
      task.stop();
    }
    this.cronJobs.clear();

    // Clear all intervals
    for (const [, handle] of this.intervalHandles) {
      clearInterval(handle);
    }
    this.intervalHandles.clear();

    // Clear all timeouts
    for (const [, handle] of this.timeoutHandles) {
      clearTimeout(handle);
    }
    this.timeoutHandles.clear();

    // Cancel all running jobs
    this.executor.cancelAllJobs();

    // Wait for graceful shutdown
    const timeout = this.config?.shutdownTimeout || 30000;
    await this.waitForJobsCompletion(timeout);

    // Persist final state
    if (this.persistence) {
      await this.persistence.flush();
    }

    // Emit stopped event (registry should emit, not subscribe)
    // This is a placeholder - real implementation would emit through event bus
  }

  /**
   * Schedule a job based on its type
   */
  private scheduleJob(job: IScheduledJob): void {
    switch (job.type) {
      case 'cron':
        this.scheduleCronJob(job);
        break;
      case 'interval':
        this.scheduleIntervalJob(job);
        break;
      case 'timeout':
        this.scheduleTimeoutJob(job);
        break;
      default:
        // Should not happen due to type checking, but satisfy linter
        break;
    }
  }

  /**
   * Schedule a cron job
   */
  private scheduleCronJob(job: IScheduledJob): void {
    const pattern = job.pattern as string;
    const options = job.options as ICronOptions;

    // Validate cron expression
    if (!cron.validate(pattern)) {
      throw new Error(`${ERROR_MESSAGES.INVALID_CRON_EXPRESSION}: ${pattern}`);
    }

    // Create cron job
    const task = cron.schedule(
      pattern,
      async () => {
        if (!job.options.disabled) {
          await this.executeJob(job);
        }
      },
      {
        timezone: options.timezone || this.config?.timezone
      }
    );

    // Start the task
    task.start();

    // Store the task
    this.cronJobs.set(job.name, task);
    this.registry.setJobInstance(job.name, task);

    // Calculate next execution
    this.updateNextExecution(job);
  }

  /**
   * Schedule an interval job
   */
  private scheduleIntervalJob(job: IScheduledJob): void {
    const interval = job.pattern as number;
    const options = job.options as IIntervalOptions;

    // Execute immediately if configured
    if (options.immediate) {
      this.executeJob(job);
    }

    // Create interval
    const handle = setInterval(async () => {
      if (!job.options.disabled) {
        await this.executeJob(job);
      }
    }, interval);

    // Store the handle
    this.intervalHandles.set(job.name, handle);
    this.registry.setJobInstance(job.name, handle);

    // Calculate next execution
    this.registry.updateJobExecution(job.name, {
      nextExecution: new Date(Date.now() + interval)
    });
  }

  /**
   * Schedule a timeout job
   */
  private scheduleTimeoutJob(job: IScheduledJob): void {
    const timeout = job.pattern as number;

    // Create timeout
    const handle = setTimeout(async () => {
      await this.executeJob(job);
      // Remove from active timeouts
      this.timeoutHandles.delete(job.name);
      // Update job status
      this.registry.updateJobStatus(job.name, JobStatus.COMPLETED);
    }, timeout);

    // Store the handle
    this.timeoutHandles.set(job.name, handle);
    this.registry.setJobInstance(job.name, handle);

    // Calculate execution time
    this.registry.updateJobExecution(job.name, {
      nextExecution: new Date(Date.now() + timeout)
    });
  }

  /**
   * Execute a job
   */
  private async executeJob(job: IScheduledJob): Promise<void> {
    // Update job status
    this.registry.updateJobStatus(job.name, JobStatus.RUNNING);
    this.registry.markJobRunning(job.name, true);

    try {
      // Execute through executor
      const result = await this.executor.executeJob(job);

      // Update job info
      this.registry.updateJobExecution(job.name, {
        lastExecution: new Date(),
        lastResult: result.result,
        executionTime: result.duration
      });

      // Update status based on result
      if (result.status === 'success') {
        this.registry.updateJobStatus(job.name, JobStatus.COMPLETED);
      } else if (result.status === 'failure') {
        this.registry.updateJobStatus(job.name, JobStatus.FAILED);
      }

      // Persist execution result
      if (this.persistence) {
        await this.persistence.saveExecutionResult(result);
      }

      // Calculate next execution for cron and interval jobs
      if (job.type === 'cron' || job.type === 'interval') {
        this.updateNextExecution(job);
      }
    } catch (error: any) {
      // Update job error info
      this.registry.updateJobExecution(job.name, {
        lastExecution: new Date(),
        lastError: error
      });
      this.registry.updateJobStatus(job.name, JobStatus.FAILED);
    } finally {
      this.registry.markJobRunning(job.name, false);
    }
  }

  /**
   * Update next execution time
   */
  private updateNextExecution(job: IScheduledJob): void {
    let nextExecution: Date | undefined;

    if (job.type === 'cron') {
      // For cron jobs, we need to parse the expression
      // This is a simplified version - real implementation would use a cron parser
      const now = new Date();
      nextExecution = new Date(now.getTime() + 60000); // Next minute
    } else if (job.type === 'interval') {
      const interval = job.pattern as number;
      nextExecution = new Date(Date.now() + interval);
    }

    if (nextExecution) {
      this.registry.updateJobExecution(job.name, { nextExecution });
    }
  }

  /**
   * Add a cron job dynamically
   */
  addCronJob(
    name: string,
    expression: CronExpression,
    handler: (context: IJobExecutionContext) => void | Promise<void>,
    options?: ICronOptions
  ): IScheduledJob {
    // Create a wrapper object for the handler
    const wrapper = {
      [name]: handler
    };

    // Register the job
    const job = this.registry.registerJob(
      name,
      'cron' as SchedulerJobType,
      expression.toString(),
      wrapper,
      name,
      options || {}
    );

    // Schedule if started
    if (this.isStarted && !options?.disabled) {
      this.scheduleJob(job);
    }

    return job;
  }

  /**
   * Add an interval job dynamically
   */
  addInterval(
    name: string,
    milliseconds: number,
    handler: (context: IJobExecutionContext) => void | Promise<void>,
    options?: IIntervalOptions
  ): IScheduledJob {
    // Create a wrapper object for the handler
    const wrapper = {
      [name]: handler
    };

    // Register the job
    const job = this.registry.registerJob(
      name,
      'interval' as SchedulerJobType,
      milliseconds,
      wrapper,
      name,
      options || {}
    );

    // Schedule if started
    if (this.isStarted && !options?.disabled) {
      this.scheduleJob(job);
    }

    return job;
  }

  /**
   * Add a timeout job dynamically
   */
  addTimeout(
    name: string,
    milliseconds: number,
    handler: (context: IJobExecutionContext) => void | Promise<void>,
    options?: ITimeoutOptions
  ): IScheduledJob {
    // Create a wrapper object for the handler
    const wrapper = {
      [name]: handler
    };

    // Register the job
    const job = this.registry.registerJob(
      name,
      'timeout' as SchedulerJobType,
      milliseconds,
      wrapper,
      name,
      options || {}
    );

    // Schedule if started
    if (this.isStarted && !options?.disabled) {
      this.scheduleJob(job);
    }

    return job;
  }

  /**
   * Delete a job
   */
  deleteJob(name: string): boolean {
    // Stop the job first
    this.stopJob(name);

    // Remove from registry
    const removed = this.registry.removeJob(name);

    // Remove from persistence
    if (this.persistence && removed) {
      const job = this.registry.getJob(name);
      if (job) {
        this.persistence.deleteJob(job.id);
      }
    }

    return removed;
  }

  /**
   * Stop a job
   */
  stopJob(name: string): void {
    const job = this.registry.getJob(name);
    if (!job) {
      throw new Error(`${ERROR_MESSAGES.JOB_NOT_FOUND}: ${name}`);
    }

    // Stop based on type
    if (job.type === 'cron') {
      const task = this.cronJobs.get(name);
      if (task) {
        task.stop();
        this.cronJobs.delete(name);
      }
    } else if (job.type === 'interval') {
      const handle = this.intervalHandles.get(name);
      if (handle) {
        clearInterval(handle);
        this.intervalHandles.delete(name);
      }
    } else if (job.type === 'timeout') {
      const handle = this.timeoutHandles.get(name);
      if (handle) {
        clearTimeout(handle);
        this.timeoutHandles.delete(name);
      }
    }

    // Update status
    this.registry.updateJobStatus(name, JobStatus.PAUSED);
  }

  /**
   * Start a stopped job
   */
  startJob(name: string): void {
    const job = this.registry.getJob(name);
    if (!job) {
      throw new Error(`${ERROR_MESSAGES.JOB_NOT_FOUND}: ${name}`);
    }

    // Schedule the job
    this.scheduleJob(job);

    // Update status
    this.registry.updateJobStatus(name, JobStatus.PENDING);
  }

  /**
   * Get all jobs
   */
  getAllJobs(): IScheduledJob[] {
    return this.registry.getAllJobs();
  }

  /**
   * Get job by name
   */
  getJob(name: string): IScheduledJob | undefined {
    return this.registry.getJob(name);
  }

  /**
   * Find jobs with filter
   */
  findJobs(filter: IJobFilterOptions): IScheduledJob[] {
    return this.registry.findJobs(filter);
  }

  /**
   * Get metrics
   */
  getMetrics(): ISchedulerMetrics | null {
    return this.metrics?.getMetrics() || null;
  }

  /**
   * Wait for jobs to complete
   */
  private async waitForJobsCompletion(timeout: number): Promise<void> {
    const startTime = Date.now();

    while (this.executor.getRunningJobCount() > 0) {
      if (Date.now() - startTime > timeout) {
        // Timeout waiting for jobs to complete, forcing shutdown
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Destroy scheduler
   */
  async onDestroy(): Promise<void> {
    await this.stop();

    if (this.persistence) {
      await this.persistence.destroy();
    }

    if (this.metrics) {
      this.metrics.destroy();
    }
  }

  /**
   * Check if scheduler is started
   */
  isRunning(): boolean {
    return this.isStarted;
  }

  /**
   * Trigger a job manually
   */
  async triggerJob(name: string): Promise<IJobExecutionResult> {
    const job = this.registry.getJob(name);
    if (!job) {
      throw new Error(`${ERROR_MESSAGES.JOB_NOT_FOUND}: ${name}`);
    }

    return this.executor.executeJob(job);
  }
}