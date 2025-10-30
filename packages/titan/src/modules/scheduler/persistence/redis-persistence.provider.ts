/**
 * Redis Persistence Provider for Scheduler
 *
 * Provides Redis-based persistence for scheduled jobs and execution history
 */

import type { IPersistenceProvider } from '../scheduler.persistence.js';
import type { IScheduledJob, IJobExecutionResult } from '../scheduler.interfaces.js';
import type { RedisService } from '../../redis/redis.service.js';

const JOBS_KEY_PREFIX = 'scheduler:jobs:';
const HISTORY_KEY_PREFIX = 'scheduler:history:';
const ALL_JOBS_SET_KEY = 'scheduler:jobs:all';
const MAX_HISTORY_LENGTH = 100;

/**
 * Redis persistence provider
 */
export class RedisPersistenceProvider implements IPersistenceProvider {
  constructor(private readonly redis: RedisService) {}

  async saveJob(job: IScheduledJob): Promise<void> {
    const key = `${JOBS_KEY_PREFIX}${job.id}`;

    // Serialize job, removing non-serializable fields
    const serializedJob = this.serializeJob(job);

    // Save job data
    await this.redis.set(key, JSON.stringify(serializedJob));

    // Add job ID to set of all jobs
    await this.redis.sadd(ALL_JOBS_SET_KEY, job.id);
  }

  async loadJob(id: string): Promise<IScheduledJob | null> {
    const key = `${JOBS_KEY_PREFIX}${id}`;
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    return this.deserializeJob(JSON.parse(data));
  }

  async loadAllJobs(): Promise<IScheduledJob[]> {
    // Get all job IDs
    const jobIds = await this.redis.smembers(ALL_JOBS_SET_KEY);

    if (!jobIds || jobIds.length === 0) {
      return [];
    }

    // Load all jobs in parallel
    const jobs = await Promise.all(
      jobIds.map(id => this.loadJob(id))
    );

    // Filter out null values (deleted jobs)
    return jobs.filter((job): job is IScheduledJob => job !== null);
  }

  async deleteJob(id: string): Promise<void> {
    const jobKey = `${JOBS_KEY_PREFIX}${id}`;
    const historyKey = `${HISTORY_KEY_PREFIX}${id}`;

    // Delete job data
    await this.redis.del(jobKey);

    // Remove job ID from set
    await this.redis.srem(ALL_JOBS_SET_KEY, id);

    // Delete execution history
    await this.redis.del(historyKey);
  }

  async saveExecutionResult(result: IJobExecutionResult): Promise<void> {
    const key = `${HISTORY_KEY_PREFIX}${result.jobId}`;

    // Serialize execution result
    const serializedResult = JSON.stringify(result);

    // Add to list (right push)
    await this.redis.rpush(key, serializedResult);

    // Trim list to keep only last MAX_HISTORY_LENGTH entries
    await this.redis.ltrim(key, -MAX_HISTORY_LENGTH, -1);
  }

  async loadExecutionHistory(jobId: string, limit: number = 10): Promise<IJobExecutionResult[]> {
    const key = `${HISTORY_KEY_PREFIX}${jobId}`;

    // Get last N entries
    const results = await this.redis.lrange(key, -limit, -1);

    if (!results || results.length === 0) {
      return [];
    }

    return results.map(data => JSON.parse(data));
  }

  async clear(): Promise<void> {
    // Get all job IDs
    const jobIds = await this.redis.smembers(ALL_JOBS_SET_KEY);

    if (!jobIds || jobIds.length === 0) {
      return;
    }

    // Delete all job keys and history keys
    const keysToDelete: string[] = [
      ALL_JOBS_SET_KEY,
      ...jobIds.map(id => `${JOBS_KEY_PREFIX}${id}`),
      ...jobIds.map(id => `${HISTORY_KEY_PREFIX}${id}`),
    ];

    if (keysToDelete.length > 0) {
      // Delete keys in batches to avoid spread operator issues
      for (const key of keysToDelete) {
        await this.redis.del(key);
      }
    }
  }

  /**
   * Serialize job for storage
   * Removes non-serializable fields like functions and instances
   */
  private serializeJob(job: IScheduledJob): Record<string, unknown> {
    const {
      instance,
      target,
      lastError,
      options,
      ...serializable
    } = job;

    // Handle options - remove function callbacks
    const cleanOptions = options ? {
      ...options,
      onError: undefined,
      onSuccess: undefined,
      retry: options.retry ? {
        ...options.retry,
        retryIf: undefined,
      } : undefined,
    } : undefined;

    return {
      ...serializable,
      options: cleanOptions,
      // Store target class name if available
      targetClassName: target?.constructor?.name || target?.name || 'Unknown',
      // Store error message only
      lastErrorMessage: lastError?.message,
      lastErrorStack: lastError?.stack,
    };
  }

  /**
   * Deserialize job from storage
   */
  private deserializeJob(data: Record<string, unknown>): IScheduledJob {
    const {
      targetClassName,
      lastErrorMessage,
      lastErrorStack,
      ...rest
    } = data;

    // Reconstruct lastError if it exists
    let lastError: Error | undefined;
    if (lastErrorMessage) {
      lastError = new Error(lastErrorMessage as string);
      if (lastErrorStack) {
        lastError.stack = lastErrorStack as string;
      }
    }

    // Convert date strings back to Date objects
    return {
      ...rest,
      target: null, // Target needs to be resolved by scheduler
      instance: undefined,
      lastError,
      createdAt: new Date(data['createdAt'] as string),
      updatedAt: new Date(data['updatedAt'] as string),
      nextExecution: data['nextExecution'] ? new Date(data['nextExecution'] as string) : undefined,
      lastExecution: data['lastExecution'] ? new Date(data['lastExecution'] as string) : undefined,
    } as IScheduledJob;
  }
}
