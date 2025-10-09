/**
 * Scheduler Executor
 *
 * Handles job execution with retry, timeout, and error handling
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import { Inject, Optional, Injectable } from '../../decorators/index.js';
import { Errors } from '../../errors/index.js';

import {
  ERROR_MESSAGES,
  SCHEDULER_EVENTS,
  SCHEDULER_CONFIG_TOKEN,
  SCHEDULER_LISTENERS_TOKEN
} from './scheduler.constants.js';

import type {
  IJobListener,
  IScheduledJob,
  IRetryOptions,
  ISchedulerConfig,
  IJobExecutionResult,
  IJobExecutionContext
} from './scheduler.interfaces.js';

/**
 * Executes scheduled jobs with advanced features
 */
@Injectable()
export class SchedulerExecutor {
  private runningJobs: Map<string, AbortController> = new Map();
  private jobQueue: Array<{ job: IScheduledJob; context: IJobExecutionContext }> = [];
  private isProcessing = false;
  private eventEmitter = new EventEmitter();
  private concurrentJobs = 0;

  constructor(
    @Optional() @Inject(SCHEDULER_CONFIG_TOKEN) private readonly config?: ISchedulerConfig,
    @Optional() @Inject(SCHEDULER_LISTENERS_TOKEN) private readonly listeners?: IJobListener[]
  ) { }

  /**
   * Execute a job
   */
  async executeJob(
    job: IScheduledJob,
    context?: Partial<IJobExecutionContext>
  ): Promise<IJobExecutionResult> {
    const executionId = this.generateExecutionId();
    const abortController = new AbortController();

    const fullContext: IJobExecutionContext = {
      jobId: job.id,
      jobName: job.name,
      executionId,
      timestamp: new Date(),
      attempt: context?.attempt || 1,
      metadata: { ...job.options.metadata, ...context?.metadata },
      previousResult: job.lastResult,
      signal: abortController.signal
    };

    // Store abort controller for cancellation
    this.runningJobs.set(executionId, abortController);

    // Check if we should queue the job
    if (this.shouldQueueJob(job)) {
      return this.queueJob(job, fullContext);
    }

    try {
      // Emit start event
      await this.notifyJobStart(job, fullContext);

      // Check if job is disabled
      if (job.options.disabled) {
        return this.createResult(job.id, executionId, 'cancelled', undefined, undefined, 0);
      }

      // Prevent overlapping executions
      if (job.options.preventOverlap && job.isRunning) {
        return this.createResult(
          job.id,
          executionId,
          'cancelled',
          undefined,
          new Error('Job is already running'),
          0
        );
      }

      // Execute with timeout
      const startTime = Date.now();
      const timeout = job.options.timeout || this.config?.shutdownTimeout || 30000;

      this.concurrentJobs++;
      const result = await this.executeWithTimeout(
        job,
        fullContext,
        timeout,
        abortController.signal
      );

      const duration = Date.now() - startTime;

      // Create execution result
      const executionResult = this.createResult(
        job.id,
        executionId,
        'success',
        result,
        undefined,
        duration,
        fullContext.attempt
      );

      // Notify success
      await this.notifyJobComplete(job, executionResult);

      return executionResult;
    } catch (error: any) {
      // Handle job failure
      return this.handleJobFailure(job, fullContext, error, executionId);
    } finally {
      this.concurrentJobs--;
      this.runningJobs.delete(executionId);
      this.processQueue();
    }
  }

  /**
   * Execute job with timeout
   */
  private async executeWithTimeout(
    job: IScheduledJob,
    context: IJobExecutionContext,
    timeout: number,
    signal: AbortSignal
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      let completed = false;

      // Setup timeout
      const timeoutId = setTimeout(() => {
        if (!completed) {
          completed = true;
          reject(new Error(ERROR_MESSAGES.JOB_TIMEOUT));
        }
      }, timeout);

      // Setup abort signal
      signal.addEventListener('abort', () => {
        if (!completed) {
          completed = true;
          clearTimeout(timeoutId);
          reject(new Error('Job cancelled'));
        }
      });

      // Execute the job
      const executeAsync = async () => {
        try {
          const instance = job.target;
          const method = instance[job.method];

          if (!method) {
            throw Errors.notFound(`Method ${job.method}`, 'target');
          }

          // Call the method with context
          const result = await method.call(instance, context);

          if (!completed) {
            completed = true;
            clearTimeout(timeoutId);
            resolve(result);
          }
        } catch (error) {
          if (!completed) {
            completed = true;
            clearTimeout(timeoutId);
            reject(error);
          }
        }
      };

      executeAsync();
    });
  }

  /**
   * Handle job failure with retry
   */
  private async handleJobFailure(
    job: IScheduledJob,
    context: IJobExecutionContext,
    error: Error,
    executionId: string
  ): Promise<IJobExecutionResult> {
    const retryOptions = job.options.retry || this.config?.retry;

    // Check if we should retry
    if (retryOptions && context.attempt < (retryOptions.maxAttempts || 3)) {
      const shouldRetry = !retryOptions.retryIf || retryOptions.retryIf(error);

      if (shouldRetry) {
        // Calculate retry delay
        const delay = this.calculateRetryDelay(retryOptions, context.attempt);

        // Notify retry
        await this.notifyJobRetry(job, context.attempt, error);

        // Wait before retry
        await this.delay(delay);

        // Retry execution
        return this.executeJob(job, {
          ...context,
          attempt: context.attempt + 1
        });
      }
    }

    // Max retries exceeded or retry not enabled
    const duration = Date.now() - context.timestamp.getTime();
    const executionResult = this.createResult(
      job.id,
      executionId,
      'failure',
      undefined,
      error,
      duration,
      context.attempt
    );

    // Notify failure
    await this.notifyJobError(job, error, context);

    // Call error handler if provided
    if (job.options.onError) {
      try {
        await job.options.onError(error);
      } catch {
        // Error in job error handler
      }
    }

    return executionResult;
  }

  /**
   * Calculate retry delay
   */
  private calculateRetryDelay(retryOptions: IRetryOptions, attempt: number): number {
    const baseDelay = retryOptions.delay || 1000;
    const backoff = retryOptions.backoff || 2;
    const maxDelay = retryOptions.maxDelay || 30000;

    const delay = Math.min(baseDelay * Math.pow(backoff, attempt - 1), maxDelay);
    return delay;
  }

  /**
   * Queue a job for later execution
   */
  private async queueJob(
    job: IScheduledJob,
    context: IJobExecutionContext
  ): Promise<IJobExecutionResult> {
    return new Promise((resolve) => {
      this.jobQueue.push({
        job,
        context: { ...context, metadata: { ...context.metadata, queued: true } }
      });

      // Store resolver for later
      const executionId = context.executionId;
      const checkQueue = setInterval(() => {
        const queuedJob = this.jobQueue.find(
          (q) => q.context.executionId === executionId
        );
        if (!queuedJob) {
          clearInterval(checkQueue);
          // Job has been processed
        }
      }, 100);
    });
  }

  /**
   * Process job queue
   */
  private processQueue(): void {
    if (this.isProcessing || this.jobQueue.length === 0) {
      return;
    }

    const maxConcurrent = this.config?.maxConcurrent || 10;
    if (this.concurrentJobs >= maxConcurrent) {
      return;
    }

    this.isProcessing = true;

    const nextJob = this.jobQueue.shift();
    if (nextJob) {
      this.executeJob(nextJob.job, nextJob.context).finally(() => {
        this.isProcessing = false;
        this.processQueue();
      });
    } else {
      this.isProcessing = false;
    }
  }

  /**
   * Check if job should be queued
   */
  private shouldQueueJob(job: IScheduledJob): boolean {
    const maxConcurrent = this.config?.maxConcurrent || 10;
    const queueSize = this.config?.queueSize || 100;

    return (
      this.concurrentJobs >= maxConcurrent &&
      this.jobQueue.length < queueSize
    );
  }

  /**
   * Cancel a running job
   */
  cancelJob(executionId: string): boolean {
    const controller = this.runningJobs.get(executionId);
    if (controller) {
      controller.abort();
      this.runningJobs.delete(executionId);
      return true;
    }
    return false;
  }

  /**
   * Cancel all running jobs
   */
  cancelAllJobs(): void {
    for (const controller of this.runningJobs.values()) {
      controller.abort();
    }
    this.runningJobs.clear();
  }

  /**
   * Get running job count
   */
  getRunningJobCount(): number {
    return this.runningJobs.size;
  }

  /**
   * Get queued job count
   */
  getQueuedJobCount(): number {
    return this.jobQueue.length;
  }

  /**
   * Clear job queue
   */
  clearQueue(): void {
    this.jobQueue = [];
  }

  /**
   * Generate execution ID
   */
  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create execution result
   */
  private createResult(
    jobId: string,
    executionId: string,
    status: 'success' | 'failure' | 'cancelled',
    result?: any,
    error?: Error,
    duration: number = 0,
    attempt?: number
  ): IJobExecutionResult {
    return {
      jobId,
      executionId,
      status,
      result,
      error,
      duration,
      timestamp: new Date(),
      attempt
    };
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Notify job start
   */
  private async notifyJobStart(job: IScheduledJob, context: IJobExecutionContext): Promise<void> {
    this.eventEmitter.emit(SCHEDULER_EVENTS.JOB_STARTED, { job, context });

    if (this.listeners) {
      for (const listener of this.listeners) {
        if (listener.onJobStart) {
          try {
            await listener.onJobStart(job, context);
          } catch {
            // Error in job start listener
          }
        }
      }
    }
  }

  /**
   * Notify job complete
   */
  private async notifyJobComplete(job: IScheduledJob, result: IJobExecutionResult): Promise<void> {
    this.eventEmitter.emit(SCHEDULER_EVENTS.JOB_COMPLETED, { job, result });

    if (this.listeners) {
      for (const listener of this.listeners) {
        if (listener.onJobComplete) {
          try {
            await listener.onJobComplete(job, result);
          } catch {
            // Error in job complete listener
          }
        }
      }
    }

    // Call success handler
    if (job.options.onSuccess) {
      try {
        await job.options.onSuccess(result.result);
      } catch {
        // Error in job success handler
      }
    }
  }

  /**
   * Notify job error
   */
  private async notifyJobError(
    job: IScheduledJob,
    error: Error,
    context: IJobExecutionContext
  ): Promise<void> {
    this.eventEmitter.emit(SCHEDULER_EVENTS.JOB_FAILED, { job, error, context });

    if (this.listeners) {
      for (const listener of this.listeners) {
        if (listener.onJobError) {
          try {
            await listener.onJobError(job, error, context);
          } catch {
            // Error in job error listener
          }
        }
      }
    }
  }

  /**
   * Notify job retry
   */
  private async notifyJobRetry(job: IScheduledJob, attempt: number, error: Error): Promise<void> {
    this.eventEmitter.emit(SCHEDULER_EVENTS.JOB_RETRYING, { job, attempt, error });

    if (this.listeners) {
      for (const listener of this.listeners) {
        if (listener.onJobRetry) {
          try {
            await listener.onJobRetry(job, attempt, error);
          } catch {
            // Error in job retry listener
          }
        }
      }
    }
  }

  /**
   * Subscribe to executor events
   */
  on(event: string, handler: (...args: any[]) => void): void {
    this.eventEmitter.on(event, handler);
  }

  /**
   * Unsubscribe from executor events
   */
  off(event: string, handler: (...args: any[]) => void): void {
    this.eventEmitter.off(event, handler);
  }
}