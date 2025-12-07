/**
 * Database Service
 *
 * High-level service for database operations
 */

import { Injectable, Inject } from '../../decorators/index.js';
import { Kysely, Transaction, sql } from 'kysely';
import {
  paginate as kyseraPaginate,
  paginateCursor as kyseraPaginateCursor,
  parseDatabaseError,
  withRetry,
  isTransientError,
  CircuitBreaker,
  withDebug,
  type PaginationOptions as KyseraPaginateOptions,
  type PaginatedResult as KyseraPaginatedResult,
  type CursorOptions as KyseraCursorOptions,
  type RetryOptions,
  type DebugOptions,
} from '@kysera/core';
import { EventsService } from '../events/index.js';
import { DatabaseManager } from './database.manager.js';
import { Errors } from '../../errors/index.js';
import { DATABASE_MANAGER, DATABASE_DEFAULT_CONNECTION, DATABASE_EVENTS } from './database.constants.js';
import type {
  PaginationOptions,
  PaginatedResult,
  TransactionOptions,
  QueryContext,
  DatabaseEventType,
} from './database.types.js';
import type { Logger, DatabaseError } from './database.internal-types.js';
import { isDatabaseError } from './database.internal-types.js';
import { createDefaultLogger } from './utils/logger.factory.js';
import { isDeadlockError as isDeadlockErrorGuard, isError, isRecord } from './utils/type-guards.js';

@Injectable()
export class DatabaseService {
  private logger: Logger;
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private debugConnections: Map<string, Kysely<unknown>> = new Map();

  constructor(
    @Inject(DATABASE_MANAGER) private manager: DatabaseManager,
    private eventsService?: EventsService
  ) {
    // Create a console logger for proper output
    this.logger = createDefaultLogger('DatabaseService');
  }

  // ============================================================================
  // KYSERA-CORE INTEGRATIONS: Retry & Circuit Breaker
  // ============================================================================

  /**
   * Execute a query with retry logic for transient errors
   * Uses @kysera/core withRetry with exponential backoff
   */
  async executeWithRetry<T>(
    queryFn: (db: Kysely<unknown>) => Promise<T>,
    options: RetryOptions & { connection?: string } = {}
  ): Promise<T> {
    const { connection, ...retryOptions } = options;
    const connectionName = connection || DATABASE_DEFAULT_CONNECTION;
    const db = await this.getConnection(connectionName);

    return withRetry(
      () => queryFn(db),
      {
        maxAttempts: retryOptions.maxAttempts || 3,
        delayMs: retryOptions.delayMs || 1000,
        backoff: retryOptions.backoff !== false,
        shouldRetry: retryOptions.shouldRetry || isTransientError,
        onRetry: (attempt, error) => {
          this.logger.warn({ connection: connectionName, attempt, error }, 'Query retry attempt');
          retryOptions.onRetry?.(attempt, error);
        },
      }
    );
  }

  /**
   * Get or create a circuit breaker for a connection
   * Circuit breakers prevent cascading failures by failing fast
   */
  getCircuitBreaker(
    connection?: string,
    options?: { threshold?: number; resetTimeMs?: number }
  ): CircuitBreaker {
    const connectionName = connection || DATABASE_DEFAULT_CONNECTION;

    if (!this.circuitBreakers.has(connectionName)) {
      const breaker = new CircuitBreaker(
        options?.threshold || 5,
        options?.resetTimeMs || 60000
      );
      this.circuitBreakers.set(connectionName, breaker);
    }

    return this.circuitBreakers.get(connectionName)!;
  }

  /**
   * Execute a query through circuit breaker for resilience
   */
  async executeWithCircuitBreaker<T>(
    queryFn: (db: Kysely<unknown>) => Promise<T>,
    options: { connection?: string; threshold?: number; resetTimeMs?: number } = {}
  ): Promise<T> {
    const connectionName = options.connection || DATABASE_DEFAULT_CONNECTION;
    const db = await this.getConnection(connectionName);
    const breaker = this.getCircuitBreaker(connectionName, options);

    return breaker.execute(() => queryFn(db));
  }

  /**
   * Execute with both retry and circuit breaker for maximum resilience
   */
  async executeResilient<T>(
    queryFn: (db: Kysely<unknown>) => Promise<T>,
    options: RetryOptions & {
      connection?: string;
      circuitBreakerThreshold?: number;
      circuitBreakerResetMs?: number;
    } = {}
  ): Promise<T> {
    const { connection, circuitBreakerThreshold, circuitBreakerResetMs, ...retryOptions } = options;
    const connectionName = connection || DATABASE_DEFAULT_CONNECTION;
    const breaker = this.getCircuitBreaker(connectionName, {
      threshold: circuitBreakerThreshold,
      resetTimeMs: circuitBreakerResetMs,
    });

    return breaker.execute(async () => {
      return this.executeWithRetry(queryFn, { connection: connectionName, ...retryOptions });
    });
  }

  /**
   * Reset circuit breaker for a connection
   */
  resetCircuitBreaker(connection?: string): void {
    const connectionName = connection || DATABASE_DEFAULT_CONNECTION;
    const breaker = this.circuitBreakers.get(connectionName);
    if (breaker) {
      breaker.reset();
    }
  }

  /**
   * Get circuit breaker state for monitoring
   */
  getCircuitBreakerState(connection?: string): { state: string; failures: number; lastFailureTime?: number } | undefined {
    const connectionName = connection || DATABASE_DEFAULT_CONNECTION;
    const breaker = this.circuitBreakers.get(connectionName);
    return breaker?.getState();
  }

  // ============================================================================
  // KYSERA-CORE INTEGRATIONS: Debug & Profiling
  // ============================================================================

  /**
   * Get a debug-enabled connection for query logging and profiling
   * Uses @kysera/core withDebug plugin
   */
  async getDebugConnection(
    options: DebugOptions & { connection?: string } = {}
  ): Promise<Kysely<unknown> & { getMetrics: () => unknown; clearMetrics: () => void }> {
    const { connection, ...debugOptions } = options;
    const connectionName = connection || DATABASE_DEFAULT_CONNECTION;
    const cacheKey = `${connectionName}:debug`;

    // Return cached debug connection if exists with same options
    if (this.debugConnections.has(cacheKey)) {
      return this.debugConnections.get(cacheKey) as Kysely<unknown> & { getMetrics: () => unknown; clearMetrics: () => void };
    }

    const db = await this.getConnection(connectionName);
    const debugDb = withDebug(db, {
      logQuery: debugOptions.logQuery ?? true,
      logParams: debugOptions.logParams ?? false,
      slowQueryThreshold: debugOptions.slowQueryThreshold ?? 100,
      maxMetrics: debugOptions.maxMetrics ?? 1000,
      onSlowQuery: (sqlQuery, duration) => {
        this.logger.warn({ connection: connectionName, duration, sql: sqlQuery }, 'Slow query detected');
        debugOptions.onSlowQuery?.(sqlQuery, duration);
      },
      logger: debugOptions.logger || {
        debug: (msg: string, ...args: unknown[]) => this.logger.debug({ ...args }, msg),
        info: (msg: string, ...args: unknown[]) => this.logger.info({ ...args }, msg),
        warn: (msg: string, ...args: unknown[]) => this.logger.warn({ ...args }, msg),
        error: (msg: string, ...args: unknown[]) => this.logger.error({ ...args }, msg),
      },
    });

    this.debugConnections.set(cacheKey, debugDb);
    return debugDb as Kysely<unknown> & { getMetrics: () => unknown; clearMetrics: () => void };
  }

  /**
   * Check if an error is transient (can be retried)
   * Uses @kysera/core isTransientError
   */
  isTransientError(error: unknown): boolean {
    return isTransientError(error);
  }

  /**
   * Get a database connection
   */
  async getConnection(name?: string): Promise<Kysely<unknown>> {
    return this.manager.getConnection(name);
  }

  /**
   * Execute a query with metrics and event tracking
   */
  async executeQuery<T>(
    queryFn: (db: Kysely<unknown>) => Promise<T>,
    options: {
      connection?: string;
      timeout?: number;
      trackMetrics?: boolean;
    } = {}
  ): Promise<T> {
    const connectionName = options.connection || DATABASE_DEFAULT_CONNECTION;
    const db = await this.getConnection(connectionName);
    const startTime = Date.now();

    try {
      // Execute with optional timeout
      const result = options.timeout ? await this.withTimeout(queryFn(db), options.timeout) : await queryFn(db);

      const duration = Date.now() - startTime;

      // Track metrics and emit event
      if (options.trackMetrics !== false) {
        await this.trackQueryMetrics(connectionName, duration);
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Parse database error
      const dbError = parseDatabaseError(error);

      // Track error metrics
      await this.trackQueryError(connectionName, dbError, duration);

      throw dbError;
    }
  }

  /**
   * Execute a transaction
   */
  async transaction<T>(fn: (trx: Transaction<unknown>) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    const connectionName = options.connection || DATABASE_DEFAULT_CONNECTION;
    const db = await this.getConnection(connectionName);

    // Emit transaction started event
    await this.emitEvent(DATABASE_EVENTS.TRANSACTION_STARTED as DatabaseEventType, {
      connection: connectionName,
    });

    const startTime = Date.now();
    let retries = 0;
    const maxRetries = options.retry?.attempts || 0;

    while (retries <= maxRetries) {
      try {
        const result = await db.transaction().execute(async (trx) => {
          // Set isolation level if specified
          if (options.isolationLevel) {
            await this.setTransactionIsolationLevel(trx, options.isolationLevel);
          }

          // Execute with optional timeout
          if (options.timeout) {
            return await this.withTimeout(fn(trx), options.timeout);
          }

          return await fn(trx);
        });

        const duration = Date.now() - startTime;

        // Emit transaction committed event
        await this.emitEvent(DATABASE_EVENTS.TRANSACTION_COMMITTED as DatabaseEventType, {
          connection: connectionName,
          data: { duration },
        });

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;

        // Try to parse as database error only if it looks like a DB error
        // parseDatabaseError can throw for non-database errors
        let dbError: unknown = error;
        if (isDatabaseError(error)) {
          try {
            dbError = parseDatabaseError(error);
          } catch {
            // If parsing fails, use original error
            dbError = error;
          }
        }

        // Check if error is retryable (deadlock)
        if (this.isDeadlockError(dbError) && retries < maxRetries) {
          retries++;
          const delay = this.calculateRetryDelay(retries, options.retry);
          this.logger.warn({ error: dbError, retries, delay }, 'Transaction deadlock detected, retrying');
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // Emit transaction rolled back event
        await this.emitEvent(DATABASE_EVENTS.TRANSACTION_ROLLED_BACK as DatabaseEventType, {
          connection: connectionName,
          error: dbError,
          data: { duration },
        });

        throw dbError;
      }
    }

    throw Errors.internal('Transaction failed after maximum retries');
  }

  /**
   * Paginate query results (offset-based)
   */
  async paginate<T>(
    query: unknown,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<T>> {
    const paginateOptions: KyseraPaginateOptions = {
      page: options.page || 1,
      limit: options.limit || 20,
    };

    const result = await kyseraPaginate(query as never, paginateOptions) as KyseraPaginatedResult<T>;
    const resultData = result as unknown as Record<string, unknown>;
    const page = resultData['page'] as number || options.page || 1;
    const limit = resultData['limit'] as number || options.limit || 20;
    const total = resultData['total'] as number | undefined;
    const totalPages = resultData['totalPages'] as number | undefined;

    return {
      data: result.data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore: totalPages ? page < totalPages : false,
      },
    };
  }

  /**
   * Paginate query results (cursor-based)
   */
  async paginateCursor<T>(
    query: unknown,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<T>> {
    const cursorOptions: KyseraCursorOptions<Record<string, unknown>> = {
      limit: options.limit || 20,
      cursor: options.cursor,
      orderBy: options.orderBy?.map((o) => ({
        column: o.column as string,
        direction: o.direction,
      })) || [{ column: 'id', direction: 'asc' }],
    };

    const result = (await kyseraPaginateCursor(query as never, cursorOptions)) as unknown as Record<string, unknown>;

    return {
      data: ((result['data'] as T[]) || []),
      pagination: {
        limit: ((result['limit'] as number) || (options.limit || 20)),
        hasMore: ((result['hasMore'] as boolean) || false),
        nextCursor: ((result['nextCursor'] as string | undefined) || undefined),
        prevCursor: ((result['prevCursor'] as string | undefined) || undefined),
      },
    };
  }

  /**
   * Execute raw SQL query
   */
  async raw<T = unknown>(sqlString: string, params?: unknown[], connection?: string): Promise<T> {
    const db = await this.getConnection(connection);

    // If no parameters, execute directly
    if (!params || params.length === 0) {
      const result = await sql.raw(sqlString).execute(db);
      return result as T;
    }

    // Get the dialect type to determine parameter placeholder format
    const config = this.manager.getConnectionConfig(connection);
    const dialect = config?.dialect || 'sqlite';

    // PostgreSQL uses $1, $2, etc. placeholders
    if (dialect === 'postgres') {
      // Check if the query already uses PostgreSQL-style placeholders
      const hasPostgresPlaceholders = /\$\d+/.test(sqlString);

      if (!hasPostgresPlaceholders) {
        // Convert ? placeholders to $1, $2, etc. for PostgreSQL
        let paramIndex = 0;
        sqlString = sqlString.replace(/\?/g, () => `$${++paramIndex}`);
      }

      // Build the query with parameters for PostgreSQL
      // We need to use sql template literal for proper parameter binding

      // Count placeholders in the query
      const placeholderMatches = sqlString.match(/\$\d+/g);
      const placeholderCount = placeholderMatches ? placeholderMatches.length : 0;

      if (placeholderCount !== params.length) {
        throw Errors.badRequest(`Parameter count mismatch: expected ${placeholderCount}, got ${params.length}`);
      }

      const parts = sqlString.split(/\$\d+/);
      let boundQuery = sql`${sql.raw(parts[0] || '')}`;

      for (let i = 0; i < params.length && i < parts.length - 1; i++) {
        boundQuery = sql`${boundQuery}${params[i]}${sql.raw(parts[i + 1] || '')}`;
      }

      const result = await boundQuery.execute(db);
      return result as T;
    }

    // For MySQL and SQLite, use ? placeholders
    const parts = sqlString.split('?');
    if (parts.length - 1 !== params.length) {
      throw Errors.badRequest(`Parameter count mismatch: expected ${parts.length - 1}, got ${params.length}`);
    }

    // Build the SQL with bound parameters for MySQL/SQLite
    let boundQuery = sql`${sql.raw(parts[0] || '')}`;
    for (let i = 0; i < params.length; i++) {
      const param = params[i];
      boundQuery = sql`${boundQuery}${sql.literal(param)}${sql.raw(parts[i + 1] || '')}`;
    }

    const result = await boundQuery.execute(db);
    return result as T;
  }

  /**
   * Begin explicit transaction (for manual control)
   */
  async beginTransaction(connection?: string): Promise<Transaction<unknown>> {
    const db = await this.getConnection(connection);
    return await db.transaction().execute(async (trx) => trx);
  }

  /**
   * Check if database is connected
   */
  isConnected(connection?: string): boolean {
    return this.manager.isConnected(connection);
  }

  /**
   * Get all connection names
   */
  getConnectionNames(): string[] {
    return this.manager.getConnectionNames();
  }

  /**
   * Close database connection
   */
  async close(connection?: string): Promise<void> {
    await this.manager.close(connection);
  }

  /**
   * Close all database connections
   */
  async closeAll(): Promise<void> {
    await this.manager.closeAll();
  }

  /**
   * Get connection metrics
   */
  getMetrics(connection?: string): Record<string, unknown> {
    return this.manager.getMetrics(connection);
  }

  /**
   * Set transaction isolation level
   */
  private async setTransactionIsolationLevel(trx: Transaction<unknown>, level: string): Promise<void> {
    // This is database-specific
    // PostgreSQL: SET TRANSACTION ISOLATION LEVEL ...
    // MySQL: SET TRANSACTION ISOLATION LEVEL ...
    // SQLite doesn't support standard isolation levels

    await sql.raw(`SET TRANSACTION ISOLATION LEVEL ${level.toUpperCase()}`).execute(trx);
  }

  /**
   * Check if error is a deadlock error
   */
  private isDeadlockError(error: unknown): boolean {
    return isDeadlockErrorGuard(error);
  }

  /**
   * Calculate retry delay
   */
  private calculateRetryDelay(attempt: number, retryConfig?: TransactionOptions['retry']): number {
    const baseDelay = retryConfig?.delay || 100;
    const backoff = retryConfig?.backoff || 'exponential';

    if (backoff === 'linear') {
      return baseDelay * attempt;
    } else {
      return baseDelay * Math.pow(2, attempt - 1);
    }
  }

  /**
   * Execute with timeout
   */
  private async withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(Errors.timeout('database operation', timeout)), timeout)
    );

    return Promise.race([promise, timeoutPromise]);
  }

  /**
   * Track query metrics
   */
  private async trackQueryMetrics(connection: string, duration: number): Promise<void> {
    // Update metrics in manager (simplified for now)
    // In a full implementation, this would update proper metrics

    // Check for slow query
    const slowQueryThreshold = 1000; // 1 second
    if (duration > slowQueryThreshold) {
      await this.emitEvent(DATABASE_EVENTS.SLOW_QUERY as DatabaseEventType, {
        connection,
        data: { duration },
      });
    }

    // Emit query executed event
    await this.emitEvent(DATABASE_EVENTS.QUERY_EXECUTED as DatabaseEventType, {
      connection,
      data: { duration },
    });
  }

  /**
   * Track query error
   */
  private async trackQueryError(connection: string, error: unknown, duration: number): Promise<void> {
    this.logger.error({ connection, error, duration }, 'Query execution failed');

    await this.emitEvent(DATABASE_EVENTS.ERROR as DatabaseEventType, {
      connection,
      error,
      data: { duration },
    });
  }

  /**
   * Emit database event
   */
  private async emitEvent(
    type: DatabaseEventType,
    data: Partial<Omit<QueryContext, 'type'>> & { error?: unknown; data?: unknown }
  ): Promise<void> {
    if (this.eventsService) {
      await this.eventsService.emit(type, {
        type,
        timestamp: new Date(),
        ...data,
      });
    }
  }
}
