/**
 * Transaction Manager
 *
 * Handles advanced transaction management with nested transactions,
 * savepoints, isolation levels, and deadlock retry
 */

import { Injectable, Inject } from '../../../decorators/index.js';
import { EventEmitter } from 'events';
import { Transaction, sql } from 'kysely';
import { v4 as uuidv4 } from 'uuid';
import { AsyncLocalStorage } from 'async_hooks';
import { DATABASE_MANAGER } from '../database.constants.js';
import type { IDatabaseManager, DatabaseDialect } from '../database.types.js';
import { Errors } from '../../../errors/index.js';
import {
  TransactionIsolationLevel,
  TransactionState,
  TransactionPropagation,
  TransactionEventType,
  DEADLOCK_ERROR_CODES,
} from './transaction.types.js';
import type {
  ITransactionManager,
  TransactionOptions,
  TransactionContext,
  TransactionStatistics,
  TransactionEvent,
} from './transaction.types.js';

@Injectable()
export class TransactionManager extends EventEmitter implements ITransactionManager {
  private readonly storage = new AsyncLocalStorage<TransactionContext>();
  private readonly transactions = new Map<string, TransactionContext>();
  private readonly connections = new Map<string, Transaction<any>>();
  private readonly statistics: TransactionStatistics = {
    totalStarted: 0,
    totalCommitted: 0,
    totalRolledBack: 0,
    activeTransactions: 0,
    averageDuration: 0,
    maxDuration: 0,
    deadlockRetries: 0,
    errors: 0,
    byIsolationLevel: {},
    nestedTransactions: 0,
  };

  constructor(
    @Inject(DATABASE_MANAGER) private manager: IDatabaseManager,
    private defaultOptions: TransactionOptions = {}
  ) {
    super();
  }

  /**
   * Execute function within transaction
   */
  async executeInTransaction<T>(
    fn: (trx: Transaction<any>) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T> {
    const opts = { ...this.defaultOptions, ...options };
    const propagation = opts.propagation || TransactionPropagation.REQUIRED;

    // Check propagation behavior
    const currentContext = this.getCurrentTransaction();

    switch (propagation) {
      case TransactionPropagation.REQUIRED:
        // Use existing or create new
        if (currentContext) {
          return this.executeInExistingTransaction(fn, currentContext, opts);
        }
        return this.executeInNewTransaction(fn, opts);

      case TransactionPropagation.REQUIRES_NEW:
        // Always create new, suspend current
        return this.executeInNewTransaction(fn, opts);

      case TransactionPropagation.SUPPORTS:
        // Use existing or execute without transaction
        if (currentContext) {
          return this.executeInExistingTransaction(fn, currentContext, opts);
        }
        return fn(await this.manager.getConnection(opts.connection) as any);

      case TransactionPropagation.NOT_SUPPORTED:
        // Execute without transaction, suspend current
        return fn(await this.manager.getConnection(opts.connection) as any);

      case TransactionPropagation.MANDATORY:
        // Must have existing transaction
        if (!currentContext) {
          throw Errors.badRequest('Invalid transaction propagation', {
            propagation,
            message: 'Transaction required but none exists'
          });
        }
        return this.executeInExistingTransaction(fn, currentContext, opts);

      case TransactionPropagation.NEVER:
        // Must not have transaction
        if (currentContext) {
          throw Errors.badRequest('Invalid transaction propagation', {
            propagation,
            message: 'Transaction exists but none allowed'
          });
        }
        return fn(await this.manager.getConnection(opts.connection) as any);

      case TransactionPropagation.NESTED:
        // Create nested transaction with savepoint
        if (currentContext) {
          return this.executeInNestedTransaction(fn, currentContext, opts);
        }
        return this.executeInNewTransaction(fn, opts);

      default:
        throw Errors.badRequest(`Unknown propagation: ${propagation}`);
    }
  }

  /**
   * Execute in new transaction
   */
  private async executeInNewTransaction<T>(
    fn: (trx: Transaction<any>) => Promise<T>,
    options: TransactionOptions
  ): Promise<T> {
    const connectionName = options.connection || 'default';
    const db = await this.manager.getConnection(connectionName);
    const transactionId = uuidv4();
    const transactionName = options.name || `transaction_${transactionId}`;
    const startTime = Date.now();

    // Create context
    const context: TransactionContext = {
      id: transactionId,
      name: transactionName,
      connection: connectionName,
      isolationLevel: options.isolationLevel,
      readOnly: options.readOnly || false,
      startedAt: new Date(),
      state: TransactionState.ACTIVE,
    };

    // Emit start event
    this.emitEvent({
      type: TransactionEventType.TRANSACTION_START,
      transactionId,
      transactionName,
      connection: connectionName,
    });

    // Update statistics
    this.statistics.totalStarted++;
    this.statistics.activeTransactions++;
    if (options.isolationLevel) {
      this.statistics.byIsolationLevel[options.isolationLevel] =
        (this.statistics.byIsolationLevel[options.isolationLevel] || 0) + 1;
    }

    try {
      // Execute with retry for deadlocks
      const result = await this.executeWithRetry(async () => db.transaction().execute(async (trx) => {
          // Set isolation level if specified
          if (options.isolationLevel) {
            await this.setTransactionIsolationLevel(trx, options.isolationLevel);
          }

          // Set read-only if specified
          if (options.readOnly) {
            await this.setTransactionReadOnly(trx, true);
          }

          // Store transaction
          this.transactions.set(transactionId, context);
          this.connections.set(transactionId, trx);

          // Execute with timeout if specified
          if (options.timeout) {
            return this.executeWithTimeout(
              () => this.storage.run(context, () => fn(trx)),
              options.timeout,
              transactionId
            );
          }

          // Execute function with context
          return this.storage.run(context, () => fn(trx));
        }), options);

      // Update context state
      context.state = TransactionState.COMMITTED;

      // Update statistics
      this.statistics.totalCommitted++;
      const duration = Date.now() - startTime;
      this.updateDurationStatistics(duration);

      // Emit commit event
      this.emitEvent({
        type: TransactionEventType.TRANSACTION_COMMIT,
        transactionId,
        transactionName,
        connection: connectionName,
        duration,
      });

      return result;
    } catch (error) {
      // Update context state
      context.state = TransactionState.ROLLED_BACK;
      context.error = error as Error;

      // Update statistics
      this.statistics.totalRolledBack++;
      this.statistics.errors++;

      // Handle custom error handler
      if (options.onError) {
        await options.onError(error as Error);
      }

      // Emit rollback event
      this.emitEvent({
        type: TransactionEventType.TRANSACTION_ROLLBACK,
        transactionId,
        transactionName,
        connection: connectionName,
        error: error as Error,
        duration: Date.now() - startTime,
      });

      throw error;
    } finally {
      // Clean up
      this.transactions.delete(transactionId);
      this.connections.delete(transactionId);
      this.statistics.activeTransactions--;
    }
  }

  /**
   * Execute in existing transaction
   */
  private async executeInExistingTransaction<T>(
    fn: (trx: Transaction<any>) => Promise<T>,
    context: TransactionContext,
    options: TransactionOptions
  ): Promise<T> {
    const trx = this.connections.get(context.id);
    if (!trx) {
      throw Errors.notFound('Transaction connection', context.id);
    }

    return fn(trx);
  }

  /**
   * Execute in nested transaction with savepoint
   */
  private async executeInNestedTransaction<T>(
    fn: (trx: Transaction<any>) => Promise<T>,
    parentContext: TransactionContext,
    options: TransactionOptions
  ): Promise<T> {
    const parentTrx = this.connections.get(parentContext.id);
    if (!parentTrx) {
      throw Errors.notFound('Parent transaction connection', parentContext.id);
    }

    const savepointName = `sp_${uuidv4().replace(/-/g, '_')}`;
    const nestedId = uuidv4();

    // Create nested context
    const nestedContext: TransactionContext = {
      id: nestedId,
      name: options.name || `nested_${nestedId}`,
      connection: parentContext.connection,
      isolationLevel: parentContext.isolationLevel,
      readOnly: parentContext.readOnly,
      startedAt: new Date(),
      parent: parentContext,
      savepoint: savepointName,
      state: TransactionState.ACTIVE,
    };

    // Update statistics
    this.statistics.nestedTransactions++;

    // Create savepoint
    await this.createSavepoint(parentTrx, savepointName);

    // Emit savepoint event
    this.emitEvent({
      type: TransactionEventType.SAVEPOINT_CREATE,
      transactionId: nestedId,
      transactionName: nestedContext.name,
      connection: nestedContext.connection,
      metadata: { savepoint: savepointName },
    });

    try {
      // Execute function with nested context
      const result = await this.storage.run(nestedContext, () => fn(parentTrx));

      // Release savepoint
      await this.releaseSavepointInternal(parentTrx, savepointName);

      // Emit savepoint release event
      this.emitEvent({
        type: TransactionEventType.SAVEPOINT_RELEASE,
        transactionId: nestedId,
        transactionName: nestedContext.name,
        connection: nestedContext.connection,
        metadata: { savepoint: savepointName },
      });

      return result;
    } catch (error) {
      // Rollback to savepoint
      await this.rollbackToSavepointInternal(parentTrx, savepointName);

      // Emit savepoint rollback event
      this.emitEvent({
        type: TransactionEventType.SAVEPOINT_ROLLBACK,
        transactionId: nestedId,
        transactionName: nestedContext.name,
        connection: nestedContext.connection,
        error: error as Error,
        metadata: { savepoint: savepointName },
      });

      throw error;
    }
  }

  /**
   * Execute with retry for deadlocks
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    options: TransactionOptions
  ): Promise<T> {
    const maxAttempts = options.retryAttempts || 3;
    const retryDelay = options.retryDelay || 'exponential';
    const initialDelay = options.initialRetryDelay || 100;
    const maxDelay = options.maxRetryDelay || 5000;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        // Check if it's a deadlock error
        if (!this.isDeadlockError(error as Error)) {
          throw error;
        }

        // Don't retry on last attempt
        if (attempt === maxAttempts) {
          throw Errors.conflict('Transaction deadlock detected', {
            transactionId: '',
            attempt,
            message: `Transaction failed after ${maxAttempts} attempts due to deadlock`
          });
        }

        // Calculate delay
        let delay: number;
        if (typeof retryDelay === 'number') {
          delay = retryDelay;
        } else if (retryDelay === 'exponential') {
          delay = Math.min(initialDelay * Math.pow(2, attempt - 1), maxDelay);
        } else {
          delay = Math.min(initialDelay * attempt, maxDelay);
        }

        // Update statistics
        this.statistics.deadlockRetries++;

        // Emit retry event
        this.emitEvent({
          type: TransactionEventType.DEADLOCK_RETRY,
          transactionId: '',
          connection: options.connection || 'default',
          metadata: { attempt, delay },
        });

        // Wait before retry
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout: number,
    transactionId: string
  ): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(Errors.timeout('transaction: ' + transactionId, timeout)),
          timeout
        )
      ),
    ]);
  }

  /**
   * Set transaction isolation level
   */
  private async setTransactionIsolationLevel(
    trx: Transaction<any>,
    level: TransactionIsolationLevel
  ): Promise<void> {
    const dialect = await this.getDialect();

    switch (dialect) {
      case 'postgres':
        await sql`SET TRANSACTION ISOLATION LEVEL ${sql.raw(level)}`.execute(trx);
        break;
      case 'mysql':
        await sql`SET TRANSACTION ISOLATION LEVEL ${sql.raw(level)}`.execute(trx);
        break;
      case 'sqlite':
        // SQLite doesn't support standard isolation levels
        // It uses DEFERRED, IMMEDIATE, or EXCLUSIVE
        break;
      default:
        throw Errors.badRequest(`Unsupported dialect for isolation level: ${dialect}`);
    }
  }

  /**
   * Set transaction as read-only
   */
  private async setTransactionReadOnly(
    trx: Transaction<any>,
    readOnly: boolean
  ): Promise<void> {
    const dialect = await this.getDialect();

    switch (dialect) {
      case 'postgres':
        await sql`SET TRANSACTION ${sql.raw(readOnly ? 'READ ONLY' : 'READ WRITE')}`.execute(trx);
        break;
      case 'mysql':
        await sql`SET TRANSACTION ${sql.raw(readOnly ? 'READ ONLY' : 'READ WRITE')}`.execute(trx);
        break;
      case 'sqlite':
        // SQLite doesn't support read-only transactions at this level
        break;
      default:
        throw Errors.badRequest(`Unsupported dialect for read-only: ${dialect}`);
    }
  }

  /**
   * Create savepoint
   */
  private async createSavepoint(trx: Transaction<any>, name: string): Promise<void> {
    await sql`SAVEPOINT ${sql.ref(name)}`.execute(trx);
  }

  /**
   * Release savepoint
   */
  private async releaseSavepointInternal(trx: Transaction<any>, name: string): Promise<void> {
    const dialect = await this.getDialect();

    // SQLite uses RELEASE instead of RELEASE SAVEPOINT
    if (dialect === 'sqlite') {
      await sql`RELEASE ${sql.ref(name)}`.execute(trx);
    } else {
      await sql`RELEASE SAVEPOINT ${sql.ref(name)}`.execute(trx);
    }
  }

  /**
   * Rollback to savepoint
   */
  private async rollbackToSavepointInternal(trx: Transaction<any>, name: string): Promise<void> {
    await sql`ROLLBACK TO SAVEPOINT ${sql.ref(name)}`.execute(trx);
  }

  /**
   * Check if error is a deadlock error
   */
  private isDeadlockError(error: Error): boolean {
    const errorCode = (error as any).code || (error as any).errno || '';
    const message = error.message.toLowerCase();

    // Check error codes
    for (const [dialect, codes] of Object.entries(DEADLOCK_ERROR_CODES)) {
      if ((codes as readonly string[]).includes(errorCode)) {
        return true;
      }
    }

    // Check message patterns
    return message.includes('deadlock') || message.includes('lock timeout');
  }

  /**
   * Get database dialect
   */
  private async getDialect(): Promise<DatabaseDialect> {
    // This would need to be implemented based on your database manager
    // For now, return a default
    return 'postgres';
  }

  /**
   * Update duration statistics
   */
  private updateDurationStatistics(duration: number): void {
    const totalDuration = this.statistics.averageDuration * (this.statistics.totalCommitted - 1);
    this.statistics.averageDuration = (totalDuration + duration) / this.statistics.totalCommitted;
    this.statistics.maxDuration = Math.max(this.statistics.maxDuration, duration);
  }

  /**
   * Emit transaction event
   */
  private emitEvent(event: Omit<TransactionEvent, 'type'> & { type: TransactionEventType }): void {
    this.emit(event.type, event);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Public methods from interface

  getCurrentTransaction(): TransactionContext | null {
    return this.storage.getStore() || null;
  }

  getCurrentTransactionConnection(): Transaction<any> | null {
    const context = this.getCurrentTransaction();
    if (!context) return null;
    return this.connections.get(context.id) || null;
  }

  async withTransaction<T>(
    connection: string,
    fn: (trx: Transaction<any>) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T> {
    return this.executeInTransaction(fn, { ...options, connection });
  }

  async begin(options?: TransactionOptions): Promise<TransactionContext> {
    throw Errors.notImplemented('Manual transaction management');
  }

  async commit(): Promise<void> {
    throw Errors.notImplemented('Manual transaction management');
  }

  async rollback(error?: Error): Promise<void> {
    throw Errors.notImplemented('Manual transaction management');
  }

  async savepoint(name: string): Promise<void> {
    const trx = this.getCurrentTransactionConnection();
    if (!trx) throw Errors.conflict('No active transaction');
    await this.createSavepoint(trx, name);
  }

  async releaseSavepoint(name: string): Promise<void> {
    const trx = this.getCurrentTransactionConnection();
    if (!trx) throw Errors.conflict('No active transaction');
    await this.releaseSavepointInternal(trx, name);
  }

  async rollbackToSavepoint(name: string): Promise<void> {
    const trx = this.getCurrentTransactionConnection();
    if (!trx) throw Errors.conflict('No active transaction');
    await this.rollbackToSavepointInternal(trx, name);
  }

  isInTransaction(): boolean {
    return this.getCurrentTransaction() !== null;
  }

  getTransactionDepth(): number {
    let depth = 0;
    let context: TransactionContext | null = this.getCurrentTransaction();
    while (context) {
      depth++;
      context = context.parent || null;
    }
    return depth;
  }

  async setIsolationLevel(level: TransactionIsolationLevel): Promise<void> {
    const trx = this.getCurrentTransactionConnection();
    if (!trx) throw Errors.conflict('No active transaction');
    await this.setTransactionIsolationLevel(trx, level);
  }

  async setReadOnly(readOnly: boolean): Promise<void> {
    const trx = this.getCurrentTransactionConnection();
    if (!trx) throw Errors.conflict('No active transaction');
    await this.setTransactionReadOnly(trx, readOnly);
  }

  /**
   * Get transaction statistics
   */
  getStatistics(): TransactionStatistics {
    return { ...this.statistics };
  }

  /**
   * Reset statistics
   */
  resetStatistics(): void {
    this.statistics.totalStarted = 0;
    this.statistics.totalCommitted = 0;
    this.statistics.totalRolledBack = 0;
    this.statistics.averageDuration = 0;
    this.statistics.maxDuration = 0;
    this.statistics.deadlockRetries = 0;
    this.statistics.errors = 0;
    this.statistics.byIsolationLevel = {};
    this.statistics.nestedTransactions = 0;
  }
}