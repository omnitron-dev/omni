/**
 * Scheduler Registry
 *
 * Manages all scheduled jobs
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import { Inject, Optional, Injectable } from '../../decorators/index.js';
import { Errors } from '../../errors/index.js';

import { ERROR_MESSAGES, SCHEDULER_EVENTS, SCHEDULER_CONFIG_TOKEN } from './scheduler.constants.js';
import {
  JobStatus,
  SchedulerJobType,
  type ICronOptions,
  type IScheduledJob,
  type ITimeoutOptions,
  type ISchedulerConfig,
  type IIntervalOptions,
  type IJobFilterOptions,
} from './scheduler.interfaces.js';

/**
 * Registry for managing scheduled jobs
 */
@Injectable()
export class SchedulerRegistry {
  private jobs: Map<string, IScheduledJob> = new Map();
  private jobsByType: Map<SchedulerJobType, Set<string>> = new Map();
  private jobsByStatus: Map<JobStatus, Set<string>> = new Map();
  private eventEmitter: EventEmitter = new EventEmitter();
  private jobIdCounter = 0;

  constructor(@Optional() @Inject(SCHEDULER_CONFIG_TOKEN) private readonly config?: ISchedulerConfig) {
    // Initialize type and status maps
    for (const type of Object.values(SchedulerJobType)) {
      this.jobsByType.set(type as SchedulerJobType, new Set());
    }
    for (const status of Object.values(JobStatus)) {
      this.jobsByStatus.set(status as JobStatus, new Set());
    }
  }

  /**
   * Generate unique job ID
   */
  private generateJobId(): string {
    return `job_${Date.now()}_${++this.jobIdCounter}`;
  }

  /**
   * Register a new job
   */
  registerJob(
    name: string,
    type: SchedulerJobType,
    pattern: string | number,
    target: any,
    method: string,
    options: ICronOptions | IIntervalOptions | ITimeoutOptions = {}
  ): IScheduledJob {
    // Check if job already exists
    if (this.hasJob(name)) {
      throw Errors.conflict(`${ERROR_MESSAGES.JOB_ALREADY_EXISTS}: ${name}`);
    }

    const job: IScheduledJob = {
      id: this.generateJobId(),
      name,
      type,
      status: JobStatus.PENDING,
      target,
      method,
      options,
      pattern,
      executionCount: 0,
      failureCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      isRunning: false,
    };

    // Store job
    this.jobs.set(name, job);
    this.jobsByType.get(type)?.add(name);
    this.jobsByStatus.get(JobStatus.PENDING)?.add(name);

    // Emit event
    this.eventEmitter.emit(SCHEDULER_EVENTS.JOB_REGISTERED, job);

    return job;
  }

  /**
   * Get a job by name
   */
  getJob(name: string): IScheduledJob | undefined {
    return this.jobs.get(name);
  }

  /**
   * Check if job exists
   */
  hasJob(name: string): boolean {
    return this.jobs.has(name);
  }

  /**
   * Update job status
   */
  updateJobStatus(name: string, status: JobStatus): void {
    const job = this.jobs.get(name);
    if (!job) {
      throw Errors.notFound('Scheduled job', name);
    }

    // Remove from old status set
    this.jobsByStatus.get(job.status)?.delete(name);

    // Update status
    job.status = status;
    job.updatedAt = new Date();

    // Add to new status set
    this.jobsByStatus.get(status)?.add(name);
  }

  /**
   * Update job execution info
   */
  updateJobExecution(
    name: string,
    execution: {
      lastExecution?: Date;
      nextExecution?: Date;
      lastResult?: any;
      lastError?: Error;
      executionTime?: number;
    }
  ): void {
    const job = this.jobs.get(name);
    if (!job) {
      throw Errors.notFound('Scheduled job', name);
    }

    if (execution.lastExecution) {
      job.lastExecution = execution.lastExecution;
      job.executionCount++;
    }

    if (execution.nextExecution !== undefined) {
      job.nextExecution = execution.nextExecution;
    }

    if (execution.lastResult !== undefined) {
      job.lastResult = execution.lastResult;
    }

    if (execution.lastError) {
      job.lastError = execution.lastError;
      job.failureCount++;
    }

    if (execution.executionTime) {
      // Update average execution time
      if (!job.avgExecutionTime) {
        job.avgExecutionTime = execution.executionTime;
      } else {
        job.avgExecutionTime =
          (job.avgExecutionTime * (job.executionCount - 1) + execution.executionTime) / job.executionCount;
      }
    }

    job.updatedAt = new Date();
  }

  /**
   * Mark job as running
   */
  markJobRunning(name: string, isRunning: boolean): void {
    const job = this.jobs.get(name);
    if (!job) {
      throw Errors.notFound('Scheduled job', name);
    }
    job.isRunning = isRunning;
    job.updatedAt = new Date();
  }

  /**
   * Remove a job
   */
  removeJob(name: string): boolean {
    const job = this.jobs.get(name);
    if (!job) {
      return false;
    }

    // Remove from maps
    this.jobs.delete(name);
    this.jobsByType.get(job.type)?.delete(name);
    this.jobsByStatus.get(job.status)?.delete(name);

    // Emit event
    this.eventEmitter.emit(SCHEDULER_EVENTS.JOB_REMOVED, job);

    return true;
  }

  /**
   * Get all jobs
   */
  getAllJobs(): IScheduledJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Get jobs by type
   */
  getJobsByType(type: SchedulerJobType): IScheduledJob[] {
    const jobNames = this.jobsByType.get(type) || new Set();
    return Array.from(jobNames)
      .map((name) => this.jobs.get(name))
      .filter((job): job is IScheduledJob => job !== undefined);
  }

  /**
   * Get jobs by status
   */
  getJobsByStatus(status: JobStatus): IScheduledJob[] {
    const jobNames = this.jobsByStatus.get(status) || new Set();
    return Array.from(jobNames)
      .map((name) => this.jobs.get(name))
      .filter((job): job is IScheduledJob => job !== undefined);
  }

  /**
   * Find jobs with filter
   */
  findJobs(filter: IJobFilterOptions): IScheduledJob[] {
    let jobs = this.getAllJobs();

    // Filter by status
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      jobs = jobs.filter((job) => statuses.includes(job.status));
    }

    // Filter by type
    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      jobs = jobs.filter((job) => types.includes(job.type));
    }

    // Filter by name pattern
    if (filter.namePattern) {
      const pattern = filter.namePattern instanceof RegExp ? filter.namePattern : new RegExp(filter.namePattern);
      jobs = jobs.filter((job) => pattern.test(job.name));
    }

    // Filter by priority
    if (filter.priority !== undefined) {
      const priorities = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
      jobs = jobs.filter((job) => {
        const jobPriority = (job.options as any).priority;
        return jobPriority !== undefined && priorities.includes(jobPriority);
      });
    }

    // Filter disabled jobs
    if (!filter.includeDisabled) {
      jobs = jobs.filter((job) => !(job.options as any).disabled);
    }

    // Sort
    if (filter.sortBy) {
      jobs.sort((a, b) => {
        let compareValue = 0;

        switch (filter.sortBy) {
          case 'name':
            compareValue = a.name.localeCompare(b.name);
            break;
          case 'nextExecution':
            compareValue = (a.nextExecution?.getTime() || 0) - (b.nextExecution?.getTime() || 0);
            break;
          case 'lastExecution':
            compareValue = (a.lastExecution?.getTime() || 0) - (b.lastExecution?.getTime() || 0);
            break;
          case 'priority':
            compareValue = ((a.options as any).priority || 999) - ((b.options as any).priority || 999);
            break;
          case 'createdAt':
            compareValue = a.createdAt.getTime() - b.createdAt.getTime();
            break;
          default:
            compareValue = 0;
            break;
        }

        return filter.sortDirection === 'desc' ? -compareValue : compareValue;
      });
    }

    // Pagination
    if (filter.offset !== undefined || filter.limit !== undefined) {
      const offset = filter.offset || 0;
      const limit = filter.limit || jobs.length;
      jobs = jobs.slice(offset, offset + limit);
    }

    return jobs;
  }

  /**
   * Get cron jobs
   */
  getCronJobs(): IScheduledJob[] {
    return this.getJobsByType(SchedulerJobType.CRON);
  }

  /**
   * Get interval jobs
   */
  getIntervals(): IScheduledJob[] {
    return this.getJobsByType(SchedulerJobType.INTERVAL);
  }

  /**
   * Get timeout jobs
   */
  getTimeouts(): IScheduledJob[] {
    return this.getJobsByType(SchedulerJobType.TIMEOUT);
  }

  /**
   * Clear all jobs
   */
  clear(): void {
    this.jobs.clear();
    this.jobsByType.forEach((set) => set.clear());
    this.jobsByStatus.forEach((set) => set.clear());
  }

  /**
   * Get job count
   */
  getJobCount(): number {
    return this.jobs.size;
  }

  /**
   * Get job count by type
   */
  getJobCountByType(type: SchedulerJobType): number {
    return this.jobsByType.get(type)?.size || 0;
  }

  /**
   * Get job count by status
   */
  getJobCountByStatus(status: JobStatus): number {
    return this.jobsByStatus.get(status)?.size || 0;
  }

  /**
   * Subscribe to registry events
   */
  on(event: string, handler: (...args: any[]) => void): void {
    this.eventEmitter.on(event, handler);
  }

  /**
   * Unsubscribe from registry events
   */
  off(event: string, handler: (...args: any[]) => void): void {
    this.eventEmitter.off(event, handler);
  }

  /**
   * Store job instance (for internal use)
   */
  setJobInstance(name: string, instance: any): void {
    const job = this.jobs.get(name);
    if (job) {
      job.instance = instance;
    }
  }

  /**
   * Get job instance
   */
  getJobInstance(name: string): any {
    return this.jobs.get(name)?.instance;
  }
}
