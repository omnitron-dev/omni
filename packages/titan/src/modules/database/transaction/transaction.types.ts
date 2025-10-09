/**
 * Transaction Management Types
 *
 * Type definitions for advanced transaction management
 */

import type { Transaction } from 'kysely';

/**
 * Transaction isolation levels
 */
export enum TransactionIsolationLevel {
  READ_UNCOMMITTED = 'READ UNCOMMITTED',
  READ_COMMITTED = 'READ COMMITTED',
  REPEATABLE_READ = 'REPEATABLE READ',
  SERIALIZABLE = 'SERIALIZABLE',
}

/**
 * Transaction options
 */
export interface TransactionOptions {
  /**
   * Connection name to use
   */
  connection?: string;

  /**
   * Transaction isolation level
   */
  isolationLevel?: TransactionIsolationLevel;

  /**
   * Whether transaction is read-only
   */
  readOnly?: boolean;

  /**
   * Transaction timeout in milliseconds
   */
  timeout?: number;

  /**
   * Number of retry attempts for deadlocks
   */
  retryAttempts?: number;

  /**
   * Retry delay strategy
   */
  retryDelay?: 'exponential' | 'linear' | number;

  /**
   * Initial retry delay in ms (for exponential/linear)
   */
  initialRetryDelay?: number;

  /**
   * Maximum retry delay in ms
   */
  maxRetryDelay?: number;

  /**
   * Whether to use savepoints for nested transactions
   */
  useSavepoints?: boolean;

  /**
   * Transaction name for debugging
   */
  name?: string;

  /**
   * Whether to propagate existing transaction
   */
  propagation?: TransactionPropagation;

  /**
   * Custom error handler
   */
  onError?: (error: Error) => void | Promise<void>;

  /**
   * Whether to log transaction events
   */
  logging?: boolean;
}

/**
 * Transaction propagation behavior
 */
export enum TransactionPropagation {
  /**
   * Support a current transaction, create a new one if none exists
   */
  REQUIRED = 'REQUIRED',

  /**
   * Create a new transaction, suspend the current one if it exists
   */
  REQUIRES_NEW = 'REQUIRES_NEW',

  /**
   * Support a current transaction, execute non-transactionally if none exists
   */
  SUPPORTS = 'SUPPORTS',

  /**
   * Execute non-transactionally, suspend the current transaction if it exists
   */
  NOT_SUPPORTED = 'NOT_SUPPORTED',

  /**
   * Support a current transaction, throw an error if none exists
   */
  MANDATORY = 'MANDATORY',

  /**
   * Execute non-transactionally, throw an error if a transaction exists
   */
  NEVER = 'NEVER',

  /**
   * Execute within a nested transaction if a current transaction exists
   */
  NESTED = 'NESTED',
}

/**
 * Transaction context
 */
export interface TransactionContext {
  /**
   * Unique transaction ID
   */
  id: string;

  /**
   * Transaction name
   */
  name?: string;

  /**
   * Connection name
   */
  connection: string;

  /**
   * Transaction isolation level
   */
  isolationLevel?: TransactionIsolationLevel;

  /**
   * Whether transaction is read-only
   */
  readOnly: boolean;

  /**
   * Transaction start time
   */
  startedAt: Date;

  /**
   * Parent transaction context (for nested transactions)
   */
  parent?: TransactionContext;

  /**
   * Savepoint name (for nested transactions)
   */
  savepoint?: string;

  /**
   * Transaction state
   */
  state: TransactionState;

  /**
   * Error if transaction failed
   */
  error?: Error;

  /**
   * Custom metadata
   */
  metadata?: Record<string, any>;
}

/**
 * Transaction state
 */
export enum TransactionState {
  ACTIVE = 'ACTIVE',
  COMMITTING = 'COMMITTING',
  COMMITTED = 'COMMITTED',
  ROLLING_BACK = 'ROLLING_BACK',
  ROLLED_BACK = 'ROLLED_BACK',
  FAILED = 'FAILED',
}

/**
 * Transaction manager interface
 */
export interface ITransactionManager {
  /**
   * Execute function within transaction
   */
  executeInTransaction<T>(
    fn: (trx: Transaction<any>) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T>;

  /**
   * Get current transaction context
   */
  getCurrentTransaction(): TransactionContext | null;

  /**
   * Get current transaction connection
   */
  getCurrentTransactionConnection(): Transaction<any> | null;

  /**
   * Create a new transaction scope
   */
  withTransaction<T>(
    connection: string,
    fn: (trx: Transaction<any>) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T>;

  /**
   * Begin a new transaction manually
   */
  begin(options?: TransactionOptions): Promise<TransactionContext>;

  /**
   * Commit current transaction
   */
  commit(): Promise<void>;

  /**
   * Rollback current transaction
   */
  rollback(error?: Error): Promise<void>;

  /**
   * Create savepoint
   */
  savepoint(name: string): Promise<void>;

  /**
   * Release savepoint
   */
  releaseSavepoint(name: string): Promise<void>;

  /**
   * Rollback to savepoint
   */
  rollbackToSavepoint(name: string): Promise<void>;

  /**
   * Check if currently in transaction
   */
  isInTransaction(): boolean;

  /**
   * Get transaction depth (for nested transactions)
   */
  getTransactionDepth(): number;

  /**
   * Set transaction isolation level
   */
  setIsolationLevel(level: TransactionIsolationLevel): Promise<void>;

  /**
   * Set transaction as read-only
   */
  setReadOnly(readOnly: boolean): Promise<void>;
}

/**
 * Transaction event types
 */
export enum TransactionEventType {
  TRANSACTION_START = 'transaction.start',
  TRANSACTION_COMMIT = 'transaction.commit',
  TRANSACTION_ROLLBACK = 'transaction.rollback',
  TRANSACTION_ERROR = 'transaction.error',
  SAVEPOINT_CREATE = 'savepoint.create',
  SAVEPOINT_RELEASE = 'savepoint.release',
  SAVEPOINT_ROLLBACK = 'savepoint.rollback',
  DEADLOCK_RETRY = 'deadlock.retry',
}

/**
 * Transaction event
 */
export interface TransactionEvent {
  type: TransactionEventType;
  transactionId: string;
  transactionName?: string;
  connection: string;
  duration?: number;
  error?: Error;
  metadata?: Record<string, any>;
}

/**
 * Transaction statistics
 */
export interface TransactionStatistics {
  /**
   * Total transactions started
   */
  totalStarted: number;

  /**
   * Total transactions committed
   */
  totalCommitted: number;

  /**
   * Total transactions rolled back
   */
  totalRolledBack: number;

  /**
   * Currently active transactions
   */
  activeTransactions: number;

  /**
   * Average transaction duration in ms
   */
  averageDuration: number;

  /**
   * Longest transaction duration in ms
   */
  maxDuration: number;

  /**
   * Number of deadlock retries
   */
  deadlockRetries: number;

  /**
   * Number of transaction errors
   */
  errors: number;

  /**
   * Transactions by isolation level
   */
  byIsolationLevel: Record<string, number>;

  /**
   * Nested transactions count
   */
  nestedTransactions: number;
}

/**
 * Deadlock error codes by dialect
 */
export const DEADLOCK_ERROR_CODES = {
  postgres: ['40P01'],
  mysql: ['1213', '40001'],
  sqlite: ['SQLITE_BUSY'],
} as const;

/**
 * Transaction scope interface for dependency injection
 */
export interface ITransactionScope {
  /**
   * Get scoped repository
   */
  getRepository<T>(repositoryClass: any): T;

  /**
   * Get scoped service
   */
  getService<T>(serviceClass: any): T;

  /**
   * Get transaction connection
   */
  getTransaction(): Transaction<any>;

  /**
   * Execute within this transaction scope
   */
  execute<T>(fn: () => Promise<T>): Promise<T>;
}