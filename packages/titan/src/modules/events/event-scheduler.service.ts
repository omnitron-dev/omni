/**
 * Event Scheduler Service
 * 
 * Schedules events for delayed or recurring emission
 */

import { EnhancedEventEmitter } from '@omnitron-dev/eventemitter';
import { Inject, Injectable } from '@omnitron-dev/nexus';

import { EVENT_EMITTER_TOKEN } from './events.module.js';

import type { IEventSchedulerJob } from './types.js';

/**
 * Service for scheduling events
 */
@Injectable()
export class EventSchedulerService {
  private jobs: Map<string, IEventSchedulerJob> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private jobIdCounter = 0;
  private initialized = false;
  private destroyed = false;
  private logger: any = null;

  constructor(
    @Inject(EVENT_EMITTER_TOKEN) private readonly emitter: EnhancedEventEmitter,
    
  ) { }

  /**
   * Initialize the service
   */
  async onInit(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.logger?.info('EventSchedulerService initialized');
  }

  /**
   * Destroy the service
   */
  async onDestroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    // Clean up all timers and intervals
    this.dispose();

    this.logger?.info('EventSchedulerService destroyed');
  }

  /**
   * Get health status
   */
  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details?: any }> {
    const stats = this.getStatistics();

    return {
      status: this.initialized && !this.destroyed ? 'healthy' : 'unhealthy',
      details: {
        initialized: this.initialized,
        destroyed: this.destroyed,
        totalJobs: stats.total,
        pendingJobs: stats.pending,
        runningJobs: stats.running,
        completedJobs: stats.completed,
        failedJobs: stats.failed,
        activeTimers: this.timers.size,
        activeIntervals: this.intervals.size
      }
    };
  }

  /**
   * Schedule an event (alias for scheduleEvent)
   */
  schedule(
    event: string,
    data: any,
    delay: number
  ): string {
    return this.scheduleEvent(event, data, { delay });
  }

  /**
   * Cancel a scheduled job (alias for cancelJob)
   */
  cancel(jobId: string): boolean {
    return this.cancelJob(jobId);
  }

  /**
   * Get scheduled jobs (first implementation)
   */
  getScheduledJobs(filter?: {
    status?: IEventSchedulerJob['status'];
    event?: string;
  }): IEventSchedulerJob[] {
    let jobs = Array.from(this.jobs.values());

    if (filter?.status) {
      jobs = jobs.filter(j => j.status === filter.status);
    }

    if (filter?.event) {
      jobs = jobs.filter(j => j.event === filter.event);
    }

    return jobs;
  }

  /**
   * Schedule an event for later emission
   */
  scheduleEvent(event: string, data: any, delay: number): string;
  scheduleEvent(
    event: string,
    data: any,
    options: {
      delay?: number;
      at?: Date;
      cron?: string;
      retry?: {
        attempts: number;
        delay: number;
      };
    }
  ): string;
  scheduleEvent(
    event: string,
    data: any,
    delayOrOptions: number | {
      delay?: number;
      at?: Date;
      cron?: string;
      retry?: {
        attempts: number;
        delay: number;
      };
    }
  ): string {
    const options = typeof delayOrOptions === 'number'
      ? { delay: delayOrOptions }
      : delayOrOptions;
    const jobId = this.generateJobId();
    const scheduledAt = options.at || new Date(Date.now() + (options.delay || 0));

    const job: IEventSchedulerJob = {
      id: jobId,
      event,
      data,
      scheduledAt,
      cron: options.cron,
      status: 'pending',
      retry: options.retry ? { ...options.retry, currentAttempt: 0 } : undefined
    };

    this.jobs.set(jobId, job);

    if (options.cron) {
      this.scheduleCronJob(job);
    } else {
      this.scheduleOneTimeJob(job);
    }

    return jobId;
  }

  /**
   * Cancel a scheduled event
   */
  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    // Clear timer/interval
    const timer = this.timers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(jobId);
    }

    const interval = this.intervals.get(jobId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(jobId);
    }

    // Update job status
    job.status = 'cancelled';

    return true;
  }

  /**
   * Get all scheduled jobs
   */
  getJobs(filter?: {
    status?: IEventSchedulerJob['status'];
    event?: string;
  }): IEventSchedulerJob[] {
    let jobs = Array.from(this.jobs.values());

    if (filter?.status) {
      jobs = jobs.filter(j => j.status === filter.status);
    }

    if (filter?.event) {
      jobs = jobs.filter(j => j.event === filter.event);
    }

    return jobs;
  }

  /**
   * Register a handler for scheduled events
   */
  onScheduledEvent(event: string, handler: (data: any) => void): void {
    this.emitter.on(event, handler);
  }

  /**
   * Schedule a recurring event
   */
  scheduleRecurring(event: string, data: any, interval: number): string {
    return this.scheduleEvent(event, data, { cron: this.intervalToCron(interval) });
  }

  /**
   * Schedule a cron-based event
   */
  scheduleCron(event: string, data: any, cron: string): string {
    return this.scheduleEvent(event, data, { cron });
  }

  /**
   * Get active jobs
   */
  getActiveJobs(): string[] {
    return Array.from(this.jobs.entries())
      .filter(([, job]) => job.status === 'pending' || job.status === 'running')
      .map(([id]) => id);
  }

  /**
   * Convert interval (ms) to simple cron expression
   */
  private intervalToCron(interval: number): string {
    const seconds = Math.floor(interval / 1000);
    if (seconds < 60) return `*/${seconds} * * * * *`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `*/${minutes} * * * *`;

    const hours = Math.floor(minutes / 60);
    return `0 */${hours} * * *`;
  }

  /**
   * Get a specific job
   */
  getJob(jobId: string): IEventSchedulerJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'failed') {
      throw new Error(`Job ${jobId} not found or not in failed state`);
    }

    job.status = 'pending';
    if (job.retry) {
      job.retry.currentAttempt = 0;
    }

    this.scheduleOneTimeJob(job);
  }

  /**
   * Clear completed jobs
   */
  clearCompletedJobs(): number {
    const completed = Array.from(this.jobs.entries())
      .filter(([, job]) => job.status === 'completed' || job.status === 'cancelled');

    for (const [id] of completed) {
      this.jobs.delete(id);
    }

    return completed.length;
  }

  /**
   * Execute a job immediately
   */
  async executeJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    await this.runJob(job);
  }

  /**
   * Get job statistics
   */
  getStatistics(): {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
  } {
    const jobs = Array.from(this.jobs.values());

    return {
      total: jobs.length,
      pending: jobs.filter(j => j.status === 'pending').length,
      running: jobs.filter(j => j.status === 'running').length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      cancelled: jobs.filter(j => j.status === 'cancelled').length
    };
  }

  /**
   * Schedule a one-time job
   */
  private scheduleOneTimeJob(job: IEventSchedulerJob): void {
    const delay = job.scheduledAt.getTime() - Date.now();

    if (delay <= 0) {
      // Execute immediately
      this.runJob(job);
    } else {
      // Schedule for later
      const timer = setTimeout(() => {
        this.runJob(job);
        this.timers.delete(job.id);
      }, delay);

      this.timers.set(job.id, timer);
    }
  }

  /**
   * Schedule a cron job
   */
  private scheduleCronJob(job: IEventSchedulerJob): void {
    if (!job.cron) return;

    // Parse cron expression and calculate next run time
    const interval = this.parseCronInterval(job.cron);

    const intervalId = setInterval(() => {
      this.runJob({ ...job, id: `${job.id}_${Date.now()}` });
    }, interval);

    this.intervals.set(job.id, intervalId);
  }

  /**
   * Run a job
   */
  private async runJob(job: IEventSchedulerJob): Promise<void> {
    job.status = 'running';

    try {
      // Emit the event - use plain emit for backward compatibility
      await this.emitter.emit(job.event, job.data);

      job.status = 'completed';
    } catch (error) {
      job.status = 'failed';

      if (job.retry && job.retry.currentAttempt < job.retry.attempts) {
        // Retry the job
        job.retry.currentAttempt++;
        job.retry.lastError = error as Error;
        job.status = 'pending';

        // Schedule retry
        setTimeout(() => {
          this.runJob(job);
        }, job.retry.delay * Math.pow(2, job.retry.currentAttempt - 1));
      }
    }
  }

  /**
   * Parse cron expression to interval
   */
  private parseCronInterval(cron: string): number {
    // Simplified cron parsing - in production, use a proper cron library
    const parts = cron.split(' ');

    // Support both 5-field (minute precision) and 6-field (second precision) cron
    if (parts.length === 6) {
      // Second-based cron expression
      const secondPart = parts[0];
      if (secondPart && secondPart.startsWith('*/')) {
        const seconds = parseInt(secondPart.slice(2));
        return seconds * 1000;
      }
      if (secondPart === '*') return 1000; // Every second
    } else if (parts.length === 5) {
      // Minute-based cron expression
      const minutePart = parts[0];
      if (minutePart && minutePart.startsWith('*/')) {
        const minutes = parseInt(minutePart.slice(2));
        return minutes * 60000;
      }
      if (minutePart === '*') return 60000; // Every minute

      // For now, support simple intervals
      if (cron === '* * * * *') return 60000; // Every minute
      if (cron === '*/5 * * * *') return 300000; // Every 5 minutes
      if (cron === '0 * * * *') return 3600000; // Every hour
      if (cron === '0 0 * * *') return 86400000; // Every day
    } else {
      throw new Error('Invalid cron expression');
    }

    // Default to every hour
    return 3600000;
  }

  /**
   * Generate unique job ID
   */
  private generateJobId(): string {
    this.jobIdCounter++;
    return `job_${Date.now()}_${this.jobIdCounter}`;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    // Clear all intervals
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }
    this.intervals.clear();

    // Clear jobs
    this.jobs.clear();
  }
}