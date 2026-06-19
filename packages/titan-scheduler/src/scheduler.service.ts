/**
 * Scheduler Service
 *
 * Main service for managing scheduled jobs
 */

import * as cron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import { Inject, Optional, Injectable } from '@omnitron-dev/titan/decorators';
import { Errors } from '@omnitron-dev/titan/errors';

import {
  ERROR_MESSAGES,
  SCHEDULER_EVENTS,
  SCHEDULER_CONFIG_TOKEN,
  SCHEDULER_METRICS_TOKEN,
  SCHEDULER_REGISTRY_TOKEN,
  SCHEDULER_EXECUTOR_TOKEN,
  SCHEDULER_DISCOVERY_TOKEN,
  SCHEDULER_PERSISTENCE_TOKEN,
  SCHEDULER_LOCK_TOKEN,
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
  type IJobExecutionContext,
  type ISchedulerLockProvider,
} from './scheduler.interfaces.js';

import type { SchedulerRegistry } from './scheduler.registry.js';
import type { SchedulerExecutor } from './scheduler.executor.js';
import type { SchedulerDiscovery } from './scheduler.discovery.js';
import type { SchedulerMetricsService } from './scheduler.metrics.js';
import type { SchedulerPersistence } from './scheduler.persistence.js';
import type { ILifecycle } from '@omnitron-dev/titan/types';

/**
 * Main scheduler service
 */
@Injectable()
export class SchedulerService implements ILifecycle {
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
    @Optional() @Inject(SCHEDULER_DISCOVERY_TOKEN) private readonly discovery?: SchedulerDiscovery,
    // SC-1: optional per-fire-window distributed lock. REQUIRED when
    // config.distributed.enabled is true (enforced in onStart).
    @Optional() @Inject(SCHEDULER_LOCK_TOKEN) private readonly lockProvider?: ISchedulerLockProvider
  ) {}

  /**
   * Initialize scheduler (ILifecycle)
   */
  async onInit(): Promise<void> {
    // Load persisted jobs.
    if (this.persistence) {
      const jobs = await this.persistence.loadAllJobs();
      for (const job of jobs) {
        // SC-2: a job restored from a SERIALIZING provider (Redis/DB) has lost
        // its handler — `target`/`method` (and any closure options like
        // onError/retryIf) don't survive JSON. Registering such a job would
        // schedule a timer that crashes on fire with no callable method. Skip
        // jobs whose handler can't be restored; decorator-defined jobs are
        // re-discovered below from their @Cron/@Interval metadata each boot, and
        // dynamic-handler jobs simply cannot survive a process restart.
        const handler = job.target && job.method ? (job.target as Record<string, unknown>)[job.method] : undefined;
        if (typeof handler !== 'function') {
          continue;
        }
        this.registry.registerJob(job.name, job.type, job.pattern!, job.target, job.method, job.options);
      }
    }

    // Discover decorated jobs
    if (this.discovery) {
      await this.discovery.discover();
    }

    // Auto-start if configured
    if (this.config?.enabled !== false) {
      await this.onStart();
    }
  }

  /**
   * Start the scheduler (ILifecycle)
   */
  async onStart(): Promise<void> {
    if (this.isStarted) {
      return; // Already started (e.g., via onInit auto-start) — idempotent
    }

    // SC-1: distributed mode coordinates fires through a per-fire-window lock
    // (see `executeJob`). It REQUIRES a lock provider — without one, node-cron
    // fires on EVERY node with nothing consulting a lock, silently running every
    // job on every node (duplicate execution at scale). Fail fast rather than
    // pretend. Single-node usage is unaffected (opt-in, defaults to false).
    if (this.config?.distributed?.enabled && !this.lockProvider) {
      throw Errors.badRequest(
        'Scheduler distributed mode is enabled but no lock provider is configured: jobs would ' +
          'execute on every node (duplicate execution). Provide a lock provider at ' +
          'SCHEDULER_LOCK_TOKEN (e.g. titan-lock DistributedLockService) or set ' +
          'config.distributed.enabled = false.'
      );
    }

    this.isStarted = true;

    // Start all registered jobs
    const jobs = this.registry.getAllJobs();
    for (const job of jobs) {
      if (!job.options.disabled) {
        this.scheduleJob(job);
      }
    }

    // Emit started event through registry event emitter
    if (this.registry) {
      this.registry.emit(SCHEDULER_EVENTS.SCHEDULER_STARTED, {
        timestamp: new Date(),
        jobCount: jobs.length,
      });
    }
  }

  /**
   * Stop the scheduler (ILifecycle)
   */
  async onStop(): Promise<void> {
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

    // Emit stopped event through registry event emitter
    if (this.registry) {
      this.registry.emit(SCHEDULER_EVENTS.SCHEDULER_STOPPED, {
        timestamp: new Date(),
      });
    }
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
      throw Errors.badRequest(`${ERROR_MESSAGES.INVALID_CRON_EXPRESSION}: ${pattern}`);
    }

    // SC-5: stop + drop any existing node-cron task for this job before
    // replacing it. Re-scheduling (e.g. `startJob` on an already-scheduled job)
    // otherwise overwrote the map entry while the OLD task kept firing on its
    // own timer — a leak that also double-ran the handler each tick.
    const existingTask = this.cronJobs.get(job.name);
    if (existingTask) {
      existingTask.stop();
      this.cronJobs.delete(job.name);
    }

    // Create cron job. node-cron v4's `schedule()` AUTO-STARTS the task (it calls
    // `task.start()` internally), so we must NOT start it again — the former
    // explicit `task.start()` here was a redundant double-start (SC-5).
    const task = cron.schedule(
      pattern,
      async () => {
        if (!job.options.disabled) {
          await this.executeJob(job);
        }
      },
      {
        timezone: options.timezone || this.config?.timezone,
      }
    );

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

    // SC-8 (interval variant): clear any existing interval for this job before
    // replacing it, or the old setInterval keeps firing on its own timer after
    // a re-schedule — a leak that double-runs the handler every tick.
    const existingInterval = this.intervalHandles.get(job.name);
    if (existingInterval) {
      clearInterval(existingInterval);
      this.intervalHandles.delete(job.name);
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
      nextExecution: new Date(Date.now() + interval),
    });
  }

  /**
   * Schedule a timeout job
   */
  private scheduleTimeoutJob(job: IScheduledJob): void {
    const timeout = job.pattern as number;

    // SC-8: clear any existing timeout for this job before replacing it, or the
    // old setTimeout still fires (leak + double-run) on a re-schedule.
    const existingTimeout = this.timeoutHandles.get(job.name);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      this.timeoutHandles.delete(job.name);
    }

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
      nextExecution: new Date(Date.now() + timeout),
    });
  }

  /**
   * Execute a scheduled fire. In distributed mode (SC-1), coordinates through a
   * per-fire-window lock so a given fire runs on exactly ONE node; other nodes
   * skip it. Manual `triggerJob()` bypasses this entirely (it calls the executor
   * directly) — an explicit per-node action that should always run locally.
   */
  private async executeJob(job: IScheduledJob): Promise<void> {
    const distributed = this.config?.distributed;
    if (distributed?.enabled && this.lockProvider) {
      const key = this.fireWindowKey(job);
      const ttlMs = distributed.lockTTL ?? 30000;
      let lockId: string | null = null;
      try {
        lockId = await this.lockProvider.acquireLock(key, ttlMs);
      } catch {
        // Lock store unreachable: fail CLOSED (skip this fire) rather than risk
        // a duplicate run on every node. The next fire retries; the provider is
        // responsible for logging the underlying store error.
        return;
      }
      // `null` = another node already owns this fire window → skip. This is
      // normal contention, not an error: every non-winning node skips every
      // fire, so it is intentionally silent.
      if (!lockId) {
        return;
      }
      // Winner: run it. We deliberately do NOT release the lock — holding it for
      // the full TTL stops a clock-skewed-late node from re-acquiring and
      // re-running the SAME fire. The per-fire key differs from the next fire's
      // key, so holding never blocks a legitimate future fire.
      await this.runJob(job);
      return;
    }

    // Single-node (or distributed with no provider — already rejected at start).
    await this.runJob(job);
  }

  /**
   * Compute the lock key identifying ONE scheduled fire across all nodes.
   *
   * Cron: the cron's scheduled fire instant, derived from the expression — the
   * same on every node regardless of clock skew (node-cron fires AT/after the
   * instant, so `prev()` of "now" resolves to this fire), so all nodes firing
   * the same tick contend on the same key. Interval/timeout (no shared
   * schedule): a wall-clock window bucket of width `lockTTL`, which dedupes
   * fires landing in the same window.
   */
  private fireWindowKey(job: IScheduledJob): string {
    const prefix = `scheduler:fire:${job.name}`;
    const ttlMs = this.config?.distributed?.lockTTL ?? 30000;
    if (job.type === 'cron') {
      try {
        const scheduled = CronExpressionParser.parse(String(job.pattern)).prev().getTime();
        return `${prefix}:${scheduled}`;
      } catch {
        // Unparseable pattern — degrade to the time-bucket key below.
      }
    }
    return `${prefix}:${Math.floor(Date.now() / ttlMs) * ttlMs}`;
  }

  /**
   * Run a job through the executor + record its result. Split out of
   * `executeJob` so the SC-1 distributed lock can wrap it without duplicating
   * the status/result/next-execution handling.
   */
  private async runJob(job: IScheduledJob): Promise<void> {
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
        executionTime: result.duration,
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
        lastError: error,
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
      // SC-3: derive the real next fire time from the cron expression instead
      // of the old faked `now + 60000` (which made `0 9 * * 1` report "in a
      // minute"). node-cron owns ACTUAL firing; this only feeds the
      // `nextExecution` DISPLAY metadata (health view + sort key), so a parse
      // failure degrades gracefully to `undefined` rather than throwing.
      try {
        nextExecution = CronExpressionParser.parse(String(job.pattern)).next().toDate();
      } catch {
        nextExecution = undefined;
      }
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
      [name]: handler,
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
      [name]: handler,
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
      [name]: handler,
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
    // SC-11: capture the job (its id) BEFORE removal. `registry.removeJob()`
    // deletes the job from the lookup maps, so a `getJob()` afterwards returns
    // undefined — the old code looked it up post-removal, so `deleteJob` never
    // reached persistence and the persisted record leaked (and could resurrect
    // on the next boot via loadAllJobs).
    const job = this.registry.getJob(name);

    // Stop the job first
    this.stopJob(name);

    // Remove from registry (emits JOB_REMOVED)
    const removed = this.registry.removeJob(name);

    // Remove from persistence using the id captured before removal
    if (this.persistence && removed && job) {
      this.persistence.deleteJob(job.id);
    }

    return removed;
  }

  /**
   * Stop a job
   */
  stopJob(name: string): void {
    const job = this.registry.getJob(name);
    if (!job) {
      throw Errors.notFound('Scheduled job', name);
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
      throw Errors.notFound('Scheduled job', name);
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
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Destroy scheduler (ILifecycle)
   */
  async onDestroy(): Promise<void> {
    await this.onStop();

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
      throw Errors.notFound('Scheduled job', name);
    }

    return this.executor.executeJob(job);
  }
}
