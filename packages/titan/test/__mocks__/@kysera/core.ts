/**
 * Mock for @kysera/core package
 * Provides simple implementations for testing
 */

export class DatabaseError extends Error {
  constructor(
    message: string,
    public code: string,
    public detail?: string
  ) {
    super(message);
    this.name = 'DatabaseError';
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      detail: this.detail,
    };
  }
}

export class UniqueConstraintError extends DatabaseError {
  constructor(
    public constraint: string,
    public table: string,
    public columns?: string[]
  ) {
    super(`UNIQUE constraint violation on ${table}`, 'UNIQUE_VIOLATION');
    this.name = 'UniqueConstraintError';
  }
}

export class ForeignKeyError extends DatabaseError {
  constructor(
    public constraint: string,
    public table: string,
    public referencedTable?: string
  ) {
    super('FOREIGN KEY constraint violation', 'FOREIGN_KEY_VIOLATION');
    this.name = 'ForeignKeyError';
  }
}

export class NotFoundError extends DatabaseError {
  constructor(entity: string, criteria?: unknown) {
    const message = `${entity} not found`;
    const detail = criteria ? JSON.stringify(criteria) : undefined;
    super(message, 'NOT_FOUND', detail);
    this.name = 'NotFoundError';
  }
}

export function parseDatabaseError(error: any, dialect: string = 'sqlite'): DatabaseError {
  if (!error || typeof error !== 'object') {
    return new DatabaseError('Unknown database error', 'UNKNOWN');
  }

  // Simple implementation - just wrap the error
  if (error.message?.includes('UNIQUE constraint')) {
    return new UniqueConstraintError('unique', 'unknown', []);
  }

  if (error.message?.includes('FOREIGN KEY constraint')) {
    return new ForeignKeyError('foreign_key', 'unknown');
  }

  return new DatabaseError(error.message || 'Database error', error.code || 'UNKNOWN');
}

// Simple pagination mock
export async function paginate(qb: any, options: any) {
  const { page = 1, limit = 10 } = options;
  const offset = (page - 1) * limit;

  const query = qb.limit(limit).offset(offset);
  const data = await query.execute();

  return {
    data,
    pagination: {
      total: data.length,
      page,
      limit,
      totalPages: Math.ceil(data.length / limit),
    },
  };
}

export async function paginateCursor(qb: any, options: any) {
  const { cursor, limit = 10 } = options;

  const data = await qb.limit(limit + 1).execute();
  const hasMore = data.length > limit;

  if (hasMore) {
    data.pop();
  }

  return {
    data,
    pagination: {
      nextCursor: hasMore ? String(data[data.length - 1]?.id) : null,
      prevCursor: cursor || null,
      hasMore,
    },
  };
}

export type PaginationOptions = {
  page?: number;
  limit?: number;
};

export type PaginatedResult<T> = {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
};

export type CursorOptions<T = unknown> = {
  cursor?: string;
  limit?: number;
  orderBy?: Array<{ column: keyof T & string; direction: 'asc' | 'desc' }>;
};

// Retry utilities
export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoff?: boolean;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown) => void;
}

export function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string };
  const transientCodes = ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE'];
  return transientCodes.includes(err.code || '');
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxAttempts = 3, delayMs = 1000, backoff = true, shouldRetry = isTransientError, onRetry } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts && shouldRetry(error)) {
        onRetry?.(attempt, error);
        const delay = backoff ? delayMs * Math.pow(2, attempt - 1) : delayMs;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export function createRetryWrapper<T extends (...args: any[]) => Promise<any>>(fn: T, options?: RetryOptions): T {
  return ((...args: any[]) => withRetry(() => fn(...args), options)) as T;
}

// Circuit Breaker
export class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failures = 0;
  private lastFailureTime?: number;

  constructor(private threshold: number = 5, private resetTimeMs: number = 60000) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - (this.lastFailureTime || 0) > this.resetTimeMs) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failures = 0;
      }
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();
      if (this.failures >= this.threshold) {
        this.state = 'open';
      }
      throw error;
    }
  }

  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.lastFailureTime = undefined;
  }

  getState(): { state: string; failures: number; lastFailureTime?: number } {
    return { state: this.state, failures: this.failures, lastFailureTime: this.lastFailureTime };
  }
}

// Debug utilities
export interface DebugOptions {
  logQuery?: boolean;
  logParams?: boolean;
  slowQueryThreshold?: number;
  onSlowQuery?: (sql: string, duration: number) => void;
  logger?: (message: string) => void;
  maxMetrics?: number;
}

export interface QueryMetrics {
  sql: string;
  params?: unknown[];
  duration: number;
  timestamp: number;
}

export function withDebug<DB>(db: DB, _options?: DebugOptions): DB & { getMetrics: () => QueryMetrics[]; clearMetrics: () => void } {
  const metrics: QueryMetrics[] = [];
  return Object.assign(db as object, {
    getMetrics: () => metrics,
    clearMetrics: () => { metrics.length = 0; },
  }) as DB & { getMetrics: () => QueryMetrics[]; clearMetrics: () => void };
}

export function formatSQL(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

export class QueryProfiler {
  private metrics: QueryMetrics[] = [];

  record(metric: QueryMetrics): void {
    this.metrics.push(metric);
  }

  getSummary(): { totalQueries: number; totalDuration: number; averageDuration: number } {
    const totalDuration = this.metrics.reduce((sum, m) => sum + m.duration, 0);
    return {
      totalQueries: this.metrics.length,
      totalDuration,
      averageDuration: this.metrics.length > 0 ? totalDuration / this.metrics.length : 0,
    };
  }

  clear(): void {
    this.metrics.length = 0;
  }
}

// Health check utilities
export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Array<{ name: string; status: string; message?: string }>;
  timestamp: Date;
}

export interface PoolMetrics {
  total: number;
  idle: number;
  active: number;
  waiting: number;
}

export interface MetricsPool {
  end(): Promise<void> | void;
  getMetrics(): PoolMetrics;
}

export interface DatabasePool {
  end(): Promise<void> | void;
}

export function createMetricsPool(pool: DatabasePool): MetricsPool {
  return {
    ...pool,
    getMetrics: () => ({ total: 10, idle: 5, active: 5, waiting: 0 }),
  };
}

export async function checkDatabaseHealth<DB>(_db: DB, _pool?: MetricsPool): Promise<HealthCheckResult> {
  return {
    status: 'healthy',
    checks: [{ name: 'database', status: 'healthy' }],
    timestamp: new Date(),
  };
}

export async function performHealthCheck<DB>(db: DB, _options?: { verbose?: boolean; pool?: MetricsPool }): Promise<HealthCheckResult> {
  return checkDatabaseHealth(db);
}

export async function getMetrics<DB>(_db: DB, _options?: { period?: string; pool?: MetricsPool }): Promise<unknown> {
  return {};
}

export class HealthMonitor {
  private lastCheck?: HealthCheckResult;

  constructor(_db: unknown, _pool?: MetricsPool, _intervalMs?: number) {}

  start(_onCheck?: (result: HealthCheckResult) => void): void {}
  stop(): void {}
  getLastCheck(): HealthCheckResult | undefined {
    return this.lastCheck;
  }
}

// Shutdown utilities
export interface ShutdownOptions {
  timeout?: number;
  onShutdown?: () => void | Promise<void>;
  logger?: (message: string) => void;
}

export async function createGracefulShutdown<DB>(_db: DB, _options?: ShutdownOptions): Promise<void> {}
export async function shutdownDatabase<DB>(_db: DB): Promise<void> {}

// Testing utilities
export type CleanupStrategy = 'truncate' | 'transaction' | 'delete';
export type IsolationLevel = 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';

class RollbackError extends Error {
  constructor() {
    super('Rollback');
    this.name = 'RollbackError';
  }
}

export async function testInTransaction<DB, T>(_db: DB, fn: (trx: unknown) => Promise<T>): Promise<void> {
  try {
    // @ts-ignore - mock implementation
    await _db.transaction().execute(async (trx: unknown) => {
      await fn(trx);
      throw new RollbackError();
    });
  } catch (error) {
    if (!(error instanceof RollbackError)) {
      throw error;
    }
  }
}

export async function testWithSavepoints<DB, T>(db: DB, fn: (trx: unknown) => Promise<T>): Promise<void> {
  return testInTransaction(db, fn);
}

export async function testWithIsolation<DB, T>(db: DB, _isolationLevel: IsolationLevel, fn: (trx: unknown) => Promise<T>): Promise<void> {
  return testInTransaction(db, fn);
}

export async function cleanDatabase<DB>(_db: DB, _strategy?: CleanupStrategy, _tables?: string[]): Promise<void> {}

export async function seedDatabase<DB, T>(db: DB, fn: (trx: unknown) => Promise<T>): Promise<void> {
  // @ts-ignore - mock implementation
  await db.transaction().execute(fn);
}

export async function snapshotTable<DB>(_db: DB, _table: string): Promise<unknown[]> {
  return [];
}

export async function countRows<DB>(_db: DB, _table: string): Promise<number> {
  return 0;
}

export async function waitFor(condition: () => Promise<boolean> | boolean, options?: { timeout?: number; interval?: number }): Promise<void> {
  const timeout = options?.timeout || 5000;
  const interval = options?.interval || 100;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error('waitFor timeout');
}

export function createFactory<T extends Record<string, unknown>>(
  defaults: { [K in keyof T]: T[K] | (() => T[K]) }
): (overrides?: Partial<T>) => T {
  return (overrides?: Partial<T>): T => {
    const result: Partial<T> = {};
    for (const key of Object.keys(defaults) as (keyof T)[]) {
      const defaultValue = defaults[key];
      result[key] = (overrides?.[key] !== undefined ? overrides[key] : typeof defaultValue === 'function' ? (defaultValue as () => T[keyof T])() : defaultValue) as T[keyof T];
    }
    return result as T;
  };
}

// Type utilities
export type Executor<DB> = DB;

export interface Timestamps {
  created_at: Date;
  updated_at?: Date;
}

export interface SoftDelete {
  deleted_at: Date | null;
}

export interface AuditFields {
  created_by?: number;
  updated_by?: number;
}

export class BadRequestError extends DatabaseError {
  constructor(message: string) {
    super(message, 'BAD_REQUEST');
    this.name = 'BadRequestError';
  }
}

export function paginateCursorSimple<DB, TB, O>(query: unknown, options?: PaginationOptions): Promise<PaginatedResult<O>> {
  return paginateCursor(query, { ...options, orderBy: [{ column: 'id' as any, direction: 'asc' }] }) as Promise<PaginatedResult<O>>;
}
