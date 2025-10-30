/**
 * Database Persistence Provider for Scheduler
 *
 * Provides database-based persistence for scheduled jobs and execution history
 * using Kysely ORM
 */

import type { Kysely, Generated } from 'kysely';
import { sql } from 'kysely';
import type { IPersistenceProvider } from '../scheduler.persistence.js';
import type { IScheduledJob, IJobExecutionResult } from '../scheduler.interfaces.js';

/**
 * Database schema for scheduler jobs
 */
interface SchedulerJobsTable {
  id: string;
  name: string;
  type: string;
  status: string;
  target_class_name: string;
  method: string;
  pattern: string | null;
  options: string; // JSON
  next_execution: Date | null;
  last_execution: Date | null;
  execution_count: number;
  failure_count: number;
  last_error_message: string | null;
  last_error_stack: string | null;
  last_result: string | null; // JSON
  avg_execution_time: number | null;
  is_running: boolean;
  dependencies: string | null; // JSON array
  metadata: string | null; // JSON
  created_at: Generated<Date>; // Auto-generated timestamp
  updated_at: Generated<Date>; // Auto-generated timestamp
}

interface SchedulerExecutionHistoryTable {
  id: Generated<number>; // Auto-generated primary key
  job_id: string;
  execution_id: string;
  status: string;
  result: string | null; // JSON
  error: string | null; // JSON
  timestamp: Date;
  duration: number;
  attempt: number | null;
  created_at: Generated<Date>; // Auto-generated timestamp
}

interface DatabaseSchema {
  scheduler_jobs: SchedulerJobsTable;
  scheduler_execution_history: SchedulerExecutionHistoryTable;
}

/**
 * Database persistence provider
 */
export class DatabasePersistenceProvider implements IPersistenceProvider {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  /**
   * Initialize database tables
   * Should be called once during setup
   */
  async initialize(): Promise<void> {
    // Create scheduler_jobs table if it doesn't exist
    await this.db.schema
      .createTable('scheduler_jobs')
      .ifNotExists()
      .addColumn('id', 'varchar(255)', (col) => col.primaryKey())
      .addColumn('name', 'varchar(255)', (col) => col.notNull())
      .addColumn('type', 'varchar(50)', (col) => col.notNull())
      .addColumn('status', 'varchar(50)', (col) => col.notNull())
      .addColumn('target_class_name', 'varchar(255)', (col) => col.notNull())
      .addColumn('method', 'varchar(255)', (col) => col.notNull())
      .addColumn('pattern', 'text')
      .addColumn('options', 'text', (col) => col.notNull())
      .addColumn('next_execution', 'timestamp')
      .addColumn('last_execution', 'timestamp')
      .addColumn('execution_count', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('failure_count', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('last_error_message', 'text')
      .addColumn('last_error_stack', 'text')
      .addColumn('last_result', 'text')
      .addColumn('avg_execution_time', 'real')
      .addColumn('is_running', 'boolean', (col) => col.notNull().defaultTo(false))
      .addColumn('dependencies', 'text')
      .addColumn('metadata', 'text')
      .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Create scheduler_execution_history table if it doesn't exist
    // Note: id is auto-generated, so we don't need to provide it in inserts
    await this.db.schema
      .createTable('scheduler_execution_history')
      .ifNotExists()
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('job_id', 'varchar(255)', (col) => col.notNull())
      .addColumn('execution_id', 'varchar(255)', (col) => col.notNull())
      .addColumn('status', 'varchar(50)', (col) => col.notNull())
      .addColumn('result', 'text')
      .addColumn('error', 'text')
      .addColumn('timestamp', 'timestamp', (col) => col.notNull())
      .addColumn('duration', 'integer', (col) => col.notNull())
      .addColumn('attempt', 'integer')
      .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Create indexes
    await this.db.schema
      .createIndex('idx_scheduler_jobs_status')
      .ifNotExists()
      .on('scheduler_jobs')
      .column('status')
      .execute();

    await this.db.schema
      .createIndex('idx_scheduler_jobs_next_execution')
      .ifNotExists()
      .on('scheduler_jobs')
      .column('next_execution')
      .execute();

    await this.db.schema
      .createIndex('idx_scheduler_execution_history_job_id')
      .ifNotExists()
      .on('scheduler_execution_history')
      .column('job_id')
      .execute();
  }

  async saveJob(job: IScheduledJob): Promise<void> {
    const serializedJob = this.serializeJobForDb(job);

    // Upsert job (insert or update)
    await this.db
      .insertInto('scheduler_jobs')
      .values(serializedJob as any) // Type casting for Generated types
      .onConflict((oc) =>
        oc.column('id').doUpdateSet(serializedJob as any)
      )
      .execute();
  }

  async loadJob(id: string): Promise<IScheduledJob | null> {
    const row = await this.db
      .selectFrom('scheduler_jobs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!row) {
      return null;
    }

    return this.deserializeJobFromDb(row);
  }

  async loadAllJobs(): Promise<IScheduledJob[]> {
    const rows = await this.db
      .selectFrom('scheduler_jobs')
      .selectAll()
      .execute();

    return rows.map(row => this.deserializeJobFromDb(row));
  }

  async deleteJob(id: string): Promise<void> {
    // Delete job
    await this.db
      .deleteFrom('scheduler_jobs')
      .where('id', '=', id)
      .execute();

    // Delete execution history
    await this.db
      .deleteFrom('scheduler_execution_history')
      .where('job_id', '=', id)
      .execute();
  }

  async saveExecutionResult(result: IJobExecutionResult): Promise<void> {
    await this.db
      .insertInto('scheduler_execution_history')
      .values({
        job_id: result.jobId,
        execution_id: result.executionId,
        status: result.status,
        result: result.result ? JSON.stringify(result.result) : null,
        error: result.error ? JSON.stringify({
          message: result.error.message,
          stack: result.error.stack,
          name: result.error.name,
        }) : null,
        timestamp: result.timestamp,
        duration: result.duration,
        attempt: result.attempt || null,
      } as any) // Type casting for Generated types
      .execute();

    // Clean up old history (keep only last 100 entries per job)
    await this.cleanupOldHistory(result.jobId);
  }

  async loadExecutionHistory(jobId: string, limit: number = 10): Promise<IJobExecutionResult[]> {
    const rows = await this.db
      .selectFrom('scheduler_execution_history')
      .selectAll()
      .where('job_id', '=', jobId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();

    return rows.map(row => ({
      jobId: row.job_id,
      executionId: row.execution_id,
      status: row.status as 'success' | 'failure' | 'cancelled',
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error ? this.parseError(JSON.parse(row.error)) : undefined,
      timestamp: row.timestamp,
      duration: row.duration,
      attempt: row.attempt || undefined,
    }));
  }

  async clear(): Promise<void> {
    // Delete all jobs
    await this.db.deleteFrom('scheduler_jobs').execute();

    // Delete all execution history
    await this.db.deleteFrom('scheduler_execution_history').execute();
  }

  /**
   * Clean up old execution history for a job
   * Keeps only last 100 entries
   */
  private async cleanupOldHistory(jobId: string): Promise<void> {
    // Find the ID threshold (100th most recent entry)
    const thresholdRow = await this.db
      .selectFrom('scheduler_execution_history')
      .select('id')
      .where('job_id', '=', jobId)
      .orderBy('created_at', 'desc')
      .limit(1)
      .offset(100)
      .executeTakeFirst();

    if (thresholdRow) {
      // Delete all entries older than threshold
      await this.db
        .deleteFrom('scheduler_execution_history')
        .where('job_id', '=', jobId)
        .where('id', '<', thresholdRow.id)
        .execute();
    }
  }

  /**
   * Serialize job for database storage
   */
  private serializeJobForDb(job: IScheduledJob): Partial<SchedulerJobsTable> {
    const {
      instance,
      target,
      lastError,
      options,
      ...rest
    } = job;

    // Clean options - remove function callbacks
    const cleanOptions = options ? {
      ...options,
      onError: undefined,
      onSuccess: undefined,
      retry: options.retry ? {
        ...options.retry,
        retryIf: undefined,
      } : undefined,
    } : {};

    return {
      id: rest.id,
      name: rest.name,
      type: rest.type,
      status: rest.status,
      target_class_name: target?.constructor?.name || target?.name || 'Unknown',
      method: rest.method,
      pattern: rest.pattern?.toString() || null,
      options: JSON.stringify(cleanOptions),
      next_execution: rest.nextExecution || null,
      last_execution: rest.lastExecution || null,
      execution_count: rest.executionCount,
      failure_count: rest.failureCount,
      last_error_message: lastError?.message || null,
      last_error_stack: lastError?.stack || null,
      last_result: rest.lastResult ? JSON.stringify(rest.lastResult) : null,
      avg_execution_time: rest.avgExecutionTime || null,
      is_running: rest.isRunning,
      dependencies: rest.dependencies ? JSON.stringify(rest.dependencies) : null,
      metadata: options?.metadata ? JSON.stringify(options.metadata) : null,
    };
  }

  /**
   * Deserialize job from database
   */
  private deserializeJobFromDb(row: any): IScheduledJob {
    // Reconstruct lastError if it exists
    let lastError: Error | undefined;
    if (row.last_error_message) {
      lastError = new Error(row.last_error_message);
      if (row.last_error_stack) {
        lastError.stack = row.last_error_stack;
      }
    }

    return {
      id: row.id,
      name: row.name,
      type: row.type as any,
      status: row.status as any,
      target: null, // Target needs to be resolved by scheduler
      method: row.method,
      pattern: row.pattern || undefined,
      options: JSON.parse(row.options),
      nextExecution: row.next_execution || undefined,
      lastExecution: row.last_execution || undefined,
      executionCount: row.execution_count,
      failureCount: row.failure_count,
      lastError,
      lastResult: row.last_result ? JSON.parse(row.last_result) : undefined,
      avgExecutionTime: row.avg_execution_time || undefined,
      isRunning: row.is_running,
      dependencies: row.dependencies ? JSON.parse(row.dependencies) : undefined,
      createdAt: new Date(row.created_at as any),
      updatedAt: new Date(row.updated_at as any),
      instance: undefined,
    };
  }

  /**
   * Parse error from JSON
   */
  private parseError(errorData: { message: string; stack?: string; name?: string }): Error {
    const error = new Error(errorData.message);
    error.name = errorData.name || 'Error';
    if (errorData.stack) {
      error.stack = errorData.stack;
    }
    return error;
  }
}
