/**
 * Scheduler Executor
 *
 * Handles job execution with retry, timeout, and error handling
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import { Inject, Optional, Injectable } from '@omnitron-dev/titan/decorators';
import { Errors, TitanError, ErrorCode } from '@omnitron-dev/titan/errors';
import { computeBackoff } from '@omnitron-dev/titan/utils';

import { SCHEDULER_EVENTS, SCHEDULER_CONFIG_TOKEN, SCHEDULER_LISTENERS_TOKEN } from './scheduler.constants.js';

import type {
  IJobListener,
  IScheduledJob,
  IRetryOptions,
  ISchedulerConfig,
  IJobExecutionResult,
  IJobExecutionContext,
} from './scheduler.interfaces.js';

/** Did this failure come from cancelJob()/cancelAllJobs() rather than the job itself? */
function isCancellation(error: unknown): boolean {
  return (
    error instanceof TitanError &&
    (error.details as { cancelled?: boolean } | undefined)?.cancelled === true
  );
}

/**
 * Executes scheduled jobs with advanced features
 */
@Injectable()
export class SchedulerExecutor {
  /**
   * In-flight executions, keyed by execution id.
   *
   * Carries the job alongside its controller so `cancelJob`/`cancelAllJobs`
   * can tell listeners WHICH job was cancelled. Storing only the controller is
   * why `IJobListener.onJobCancelled` — declared, exported and documented —
   * was never invoked: cancellation aborted the signal and returned, and an
   * audit listener implementing the hook silently recorded nothing.
   */
  private runningJobs: Map<string, { controller: AbortController; job: IScheduledJob }> = new Map();

  /**
   * SC-4: authoritative set of job NAMES currently executing, owned solely by
   * the executor. The `preventOverlap` gate check-and-sets this synchronously
   * (no await between `has()` and `add()`), so two concurrent ticks of the same
   * job can't both pass — unlike the former `job.isRunning` read, which tested
   * the service's display flag that it had already set for THIS run. Retries
   * (attempt > 1) deliberately bypass the gate so a failing job's own retry
   * chain isn't self-cancelled.
   */
  private readonly runningJobNames = new Set<string>();
  private jobQueue: Array<{
    job: IScheduledJob;
    context: IJobExecutionContext;
    resolve: (result: IJobExecutionResult) => void;
    reject: (error: Error) => void;
  }> = [];
  private isProcessing = false;
  private eventEmitter = new EventEmitter();
  private concurrentJobs = 0;

  constructor(
    @Optional() @Inject(SCHEDULER_CONFIG_TOKEN) private readonly config?: ISchedulerConfig,
    @Optional() @Inject(SCHEDULER_LISTENERS_TOKEN) private readonly listeners?: IJobListener[]
  ) {}

  /**
   * Execute a job
   */
  async executeJob(job: IScheduledJob, context?: Partial<IJobExecutionContext>): Promise<IJobExecutionResult> {
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
      signal: abortController.signal,
    };

    // Store abort controller for cancellation
    this.runningJobs.set(executionId, { controller: abortController, job });

    // SC-4: a retry (attempt > 1) is a continuation of the first attempt, which
    // still holds the overlap lock — it must bypass the gate, not self-cancel.
    const isRetry = (fullContext.attempt ?? 1) > 1;
    // Tracks whether THIS call acquired the overlap lock, so only the acquirer
    // releases it in `finally` — a cancelled tick must NOT free the lock the
    // running tick holds.
    let acquiredOverlapLock = false;

    // Check if we should queue the job.
    //
    // The slot must be CLAIMED in the same synchronous step as the check.
    // `concurrentJobs++` used to live further down, after `await
    // notifyJobStart(...)`, so every job submitted in one tick saw the counter
    // at its pre-tick value and sailed through the gate: ten simultaneous
    // executeJob() calls all ran at once under maxConcurrent: 3. The same
    // discipline the SC-4 overlap lock already documents ("no `await` between
    // check and set") applies here.
    if (this.shouldQueueJob(job)) {
      return this.queueJob(job, fullContext);
    }
    this.concurrentJobs++;

    try {
      // Emit start event
      await this.notifyJobStart(job, fullContext);

      // Check if job is disabled
      if (job.options.disabled) {
        return this.createResult(job.id, executionId, 'cancelled', undefined, undefined, 0);
      }

      // SC-4: prevent overlapping executions via an atomic, executor-owned
      // check-and-set. `has()` + `add()` run with no `await` between them, so
      // two concurrent ticks of the same job cannot both pass (the former
      // `job.isRunning` read tested the service's display flag, already set for
      // THIS run — so the guard never actually fired).
      if (job.options.preventOverlap && !isRetry) {
        if (this.runningJobNames.has(job.name)) {
          return this.createResult(
            job.id,
            executionId,
            'cancelled',
            undefined,
            Errors.conflict('Job execution already in progress', { jobId: job.id }),
            0
          );
        }
        this.runningJobNames.add(job.name);
        acquiredOverlapLock = true;
      }

      // Execute with timeout
      const startTime = Date.now();
      const timeout = job.options.timeout || this.config?.shutdownTimeout || 30000;

      const result = await this.executeWithTimeout(job, fullContext, timeout, abortController.signal);

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
      // SC-4: release the overlap lock ONLY if this call acquired it — a tick
      // cancelled by the gate must not free the running tick's lock, and a retry
      // (which never acquires) must not free it mid-chain. The acquiring first
      // attempt's `finally` runs LAST (it `return`s the recursive retry chain),
      // so the name is freed exactly once, after the whole sequence.
      if (acquiredOverlapLock) {
        this.runningJobNames.delete(job.name);
      }
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
          reject(Errors.timeout('scheduled job: ' + job.name + ' (' + job.id + ')', timeout));
        }
      }, timeout);

      // Setup abort signal
      signal.addEventListener(
        'abort',
        () => {
          if (!completed) {
            completed = true;
            clearTimeout(timeoutId);
            reject(
              new TitanError({
                code: ErrorCode.INTERNAL_ERROR,
                message: 'Job execution cancelled',
                // `cancelled` is what handleJobFailure keys off to stop the
                // retry chain. Matching on the message would break the moment
                // someone rewords it.
                details: { jobId: job.id, cancelled: true },
              })
            );
          }
        },
        { once: true }
      );

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

    // A cancelled job is terminal — never retry it.
    //
    // cancelJob()/cancelAllJobs() abort the signal, executeWithTimeout rejects,
    // and this handler used to treat that like any other failure: it waited the
    // backoff and called executeJob() again with a FRESH AbortController that
    // nobody had aborted. With retries configured (the default is 3) cancelling
    // a job therefore restarted it, and the operator who asked for it to stop
    // watched it succeed.
    if (isCancellation(error)) {
      return this.createResult(job.id, executionId, 'failure', undefined, error, 0, context.attempt);
    }

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
          attempt: context.attempt + 1,
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

    // Call error handler if provided. The handler itself may
    // throw — pre-fix that was swallowed silently with a comment
    // ("Error in job error handler") that meant the bug NEVER
    // surfaced. Now we route handler failures through
    // `scheduler:error` so subscribers (including the
    // scheduler service's own logger) see both errors with full
    // context: the original failure the handler was reacting to,
    // and the secondary failure the handler itself caused.
    if (job.options.onError) {
      try {
        await job.options.onError(error);
      } catch (handlerError) {
        this.eventEmitter.emit(SCHEDULER_EVENTS.SCHEDULER_ERROR, {
          scope: 'onError-handler',
          jobId: job.id,
          jobName: job.name,
          executionId,
          originalError: error,
          handlerError,
        });
      }
    }

    return executionResult;
  }

  /**
   * Calculate retry delay
   */
  private calculateRetryDelay(retryOptions: IRetryOptions, attempt: number): number {
    // Delegate to the shared `computeBackoff` helper. The local
    // `attempt` is 1-indexed (1 = first retry); the helper is
    // 0-indexed, so subtract 1. This preserves the prior
    // semantic exactly while dropping the third hand-rolled
    // Math.pow / Math.min combo.
    return computeBackoff({
      attempt: attempt - 1,
      baseMs: retryOptions.delay || 1000,
      maxMs: retryOptions.maxDelay || 30000,
      factor: retryOptions.backoff || 2,
    });
  }

  /**
   * Queue a job for later execution
   */
  private async queueJob(job: IScheduledJob, context: IJobExecutionContext): Promise<IJobExecutionResult> {
    return new Promise((resolve, reject) => {
      // Add job to queue with resolve/reject callbacks
      this.jobQueue.push({
        job,
        context: { ...context, metadata: { ...context.metadata, queued: true } },
        resolve,
        reject,
      });

      // Setup timeout for queued job
      const queueTimeout = this.config?.queueTimeout || 60000; // Default 60s timeout
      const timeoutId = setTimeout(() => {
        // Find and remove the job from queue if still present
        const index = this.jobQueue.findIndex((q) => q.context.executionId === context.executionId);
        if (index !== -1) {
          this.jobQueue.splice(index, 1);
          reject(Errors.timeout(`Queued job: ${job.name} (${job.id})`, queueTimeout));
        }
      }, queueTimeout);

      // Clear timeout if job is processed before timeout
      const originalResolve = resolve;
      const originalReject = reject;

      // Find the queued job and update its resolve/reject to clear timeout
      const queuedJob = this.jobQueue[this.jobQueue.length - 1];
      if (queuedJob) {
        queuedJob.resolve = (result: IJobExecutionResult) => {
          clearTimeout(timeoutId);
          originalResolve(result);
        };
        queuedJob.reject = (error: Error) => {
          clearTimeout(timeoutId);
          originalReject(error);
        };
      }
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
      this.executeJob(nextJob.job, nextJob.context)
        .then((result) => {
          // Resolve the queued job's promise with the execution result
          nextJob.resolve(result);
        })
        .catch((error) => {
          // Reject the queued job's promise with the execution error
          nextJob.reject(error);
        })
        .finally(() => {
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

    return this.concurrentJobs >= maxConcurrent && this.jobQueue.length < queueSize;
  }

  /**
   * Cancel a running job
   */
  cancelJob(executionId: string, reason?: string): boolean {
    const entry = this.runningJobs.get(executionId);
    if (entry) {
      entry.controller.abort();
      this.runningJobs.delete(executionId);
      void this.notifyJobCancelled(entry.job, reason);
      return true;
    }
    return false;
  }

  /**
   * Cancel all running jobs
   */
  cancelAllJobs(reason?: string): void {
    const cancelled = [...this.runningJobs.values()];
    for (const { controller } of cancelled) {
      controller.abort();
    }
    this.runningJobs.clear();
    for (const { job } of cancelled) {
      void this.notifyJobCancelled(job, reason);
    }
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
    // Reject all pending queued jobs
    const cancelledError = new TitanError({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Job queue cleared',
      details: { reason: 'Queue was cleared manually' },
    });

    for (const queuedJob of this.jobQueue) {
      queuedJob.reject(cancelledError);
    }

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
      attempt,
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
  private async notifyJobError(job: IScheduledJob, error: Error, context: IJobExecutionContext): Promise<void> {
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
   * Notify job cancelled.
   *
   * `SCHEDULER_EVENTS.JOB_CANCELLED` and `IJobListener.onJobCancelled` both
   * existed and neither was ever reached: `cancelJob`/`cancelAllJobs` aborted
   * the signal and returned. So a subscriber to the event saw nothing, and a
   * listener implementing the hook — the shape the docs give for audit
   * trails — recorded every cancellation as silence.
   */
  private async notifyJobCancelled(job: IScheduledJob, reason?: string): Promise<void> {
    this.eventEmitter.emit(SCHEDULER_EVENTS.JOB_CANCELLED, { job, reason });

    if (this.listeners) {
      for (const listener of this.listeners) {
        if (listener.onJobCancelled) {
          try {
            await listener.onJobCancelled(job, reason);
          } catch {
            // Error in job cancelled listener
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

  /**
   * Emit an event
   */
  emit(event: string, data?: any): void {
    this.eventEmitter.emit(event, data);
  }
}
