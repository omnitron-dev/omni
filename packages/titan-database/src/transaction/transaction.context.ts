/**
 * Transaction Context using AsyncLocalStorage
 *
 * Provides automatic transaction propagation through the call stack without
 * explicit parameter passing. Services and repositories can access the current
 * transaction transparently.
 *
 * @module
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { detectDialect } from '@kysera/core';
import type { TransactionIsolationLevel } from '../database.types.js';
import type { Transaction, Kysely } from 'kysely';

/**
 * Transaction context stored in AsyncLocalStorage.
 */
export interface TransactionContextData {
  transaction: Transaction<unknown>;
  database?: Kysely<unknown>;
  parent?: TransactionContextData;
  connectionName: string;
  depth: number;
  isolationLevel?: TransactionIsolationLevel;
  startedAt: Date;
  name?: string;
}

/**
 * AsyncLocalStorage for transaction context.
 * Uses globalThis to survive dual-package hazard.
 */
/** Global store typed as Record<symbol, unknown> to avoid `any` on globalThis. */
const globalStore = globalThis as unknown as Record<symbol, unknown>;

const TXN_STORAGE_KEY = Symbol.for('titan:database:transaction-storage');
const transactionStorage: AsyncLocalStorage<TransactionContextData> =
  (globalStore[TXN_STORAGE_KEY] as AsyncLocalStorage<TransactionContextData> | undefined) ??=
    new AsyncLocalStorage<TransactionContextData>();

// Schema and plugin views of one connection share the Kysely adapter.
const isolationDefaultsKey = Symbol.for('titan:database:transaction-isolation-defaults');
const isolationDefaults = (globalStore[isolationDefaultsKey] as WeakMap<object, TransactionIsolationLevel> | undefined)
  ??= new WeakMap();

export function setTransactionIsolationDefault(db: Kysely<unknown>, level: TransactionIsolationLevel): void {
  isolationDefaults.set(db.getExecutor().adapter, level);
}

// ============================================================================
// Transaction Context Accessors
// ============================================================================

export function getTransactionContext(): TransactionContextData | undefined {
  return transactionStorage.getStore();
}

export function isInTransactionContext(): boolean {
  return transactionStorage.getStore() !== undefined;
}

export function getCurrentTransaction<DB = unknown>(): Transaction<DB> | undefined {
  const ctx = transactionStorage.getStore();
  return ctx?.transaction as Transaction<DB> | undefined;
}

// ============================================================================
// getExecutor — the key function for transparent transaction support
// ============================================================================

/**
 * Get the current executor: transaction if in transaction context, else db.
 *
 * When `db` is a KyseraExecutor (plugin-aware), its transactions
 * automatically inherit plugin interception. The returned value
 * is always safe to use for plugin-aware queries.
 */
function ownsConnection(db: Kysely<unknown>, ctx: TransactionContextData): boolean {
  if (db === ctx.database || db === ctx.transaction) return true;
  // withSchema/withPlugin views and their transactions share one adapter.
  // Different databases must never inherit an unrelated ambient transaction.
  if (typeof db.getExecutor !== 'function' || typeof ctx.transaction.getExecutor !== 'function') return false;
  const adapter = db.getExecutor().adapter;
  return adapter !== undefined && adapter === ctx.transaction.getExecutor().adapter;
}

function contextFor(db: Kysely<unknown>): TransactionContextData | undefined {
  for (let ctx = transactionStorage.getStore(); ctx; ctx = ctx.parent) {
    if (ownsConnection(db, ctx)) return ctx;
  }
  return undefined;
}

export function getExecutor<DB>(db: Kysely<DB> | Transaction<DB>): Kysely<DB> | Transaction<DB> {
  const ctx = contextFor(db as Kysely<unknown>);
  if (ctx) {
    return ctx.transaction as Transaction<DB>;
  }

  return db;
}

// ============================================================================
// runInTransaction / runWithTransaction
// ============================================================================

/**
 * Run a function within a new transaction context.
 * Nested work on the same database uses a savepoint via Kysera DAL.
 * Work on another database owns an independent transaction.
 */
export interface RunInTransactionOptions {
  isolationLevel?: TransactionIsolationLevel;
  name?: string;
  connectionName?: string;
  /**
   * Retry the WHOLE transaction on serialization failures/deadlocks
   * (pg 40001/40P01, mysql 1213/1205, mssql 1205, SQLITE_BUSY) via
   * @kysera/infra withTransactionRetry. Number = maxAttempts (true = 3).
   * Applies only when this call STARTS the transaction — a nested call
   * joins the outer transaction and cannot retry it in isolation.
   */
  retry?: boolean | number;
}

export async function runInTransaction<DB, T>(
  db: Kysely<DB>,
  fn: () => Promise<T>,
  options?: RunInTransactionOptions
): Promise<T> {
  const parent = transactionStorage.getStore();
  const existingCtx = contextFor(db as Kysely<unknown>);

  if (existingCtx) {
    if (options?.connectionName && options.connectionName !== existingCtx.connectionName) {
      throw new Error('The same database was requested under a different transaction connection name');
    }
    if (options?.isolationLevel !== undefined && options.isolationLevel !== existingCtx.isolationLevel) {
      throw new Error('Cannot change or certify a different isolation level inside an existing transaction');
    }
    const { withTransaction } = await import('@kysera/dal');
    return withTransaction(existingCtx.transaction, () => transactionStorage.run({
      ...existingCtx,
      depth: existingCtx.depth + 1,
      parent,
      name: options?.name ?? existingCtx.name,
    }, fn), {
      rollbackErrorMode: 'callback',
      onRollbackError: (originalError, rollbackError) => {
        throw new AggregateError([originalError, rollbackError], 'Nested transaction failed and savepoint rollback could not be confirmed');
      },
    });
  }

  const isolationLevel = options?.isolationLevel ?? isolationDefaults.get(db.getExecutor?.().adapter);
  if (isolationLevel && detectDialect(db) === 'sqlite') {
    throw new Error('SQLite does not support selecting isolation per transaction');
  }
  const begin = () => {
    const builder = db.transaction();
    return isolationLevel === undefined ? builder : builder.setIsolationLevel(isolationLevel);
  };
  const inContext = (trx: Transaction<DB>): Promise<T> => transactionStorage.run({
    transaction: trx as Transaction<unknown>,
    database: db as Kysely<unknown>,
    parent,
    connectionName: options?.connectionName ?? 'default',
    depth: 1,
    startedAt: new Date(),
    name: options?.name,
    isolationLevel,
  }, fn);

  if (options?.retry) {
    const { withTransactionRetry } = await import('@kysera/infra');
    const maxAttempts = typeof options.retry === 'number' ? options.retry : 3;
    return withTransactionRetry({ transaction: begin }, inContext, { maxAttempts });
  }
  return begin().execute(inContext);
}

/**
 * Run a function within an existing transaction context.
 */
export async function runWithTransaction<DB, T>(
  trx: Transaction<DB>,
  fn: () => Promise<T>,
  options?: { name?: string; connectionName?: string; database?: Kysely<DB> }
): Promise<T> {
  const existingCtx = transactionStorage.getStore();
  let knownTransaction = existingCtx;
  while (knownTransaction && !Object.is(knownTransaction.transaction, trx)) knownTransaction = knownTransaction.parent;
  const depth = existingCtx ? existingCtx.depth + 1 : 1;

  const ctx: TransactionContextData = {
    transaction: trx as Transaction<unknown>,
    database: options?.database as Kysely<unknown> | undefined,
    parent: existingCtx,
    connectionName: options?.connectionName ?? existingCtx?.connectionName ?? 'default',
    depth,
    startedAt: new Date(),
    name: options?.name,
    isolationLevel: knownTransaction?.isolationLevel,
  };

  return transactionStorage.run(ctx, fn);
}

// ============================================================================
// @AutoTransactional decorator
// ============================================================================

/**
 * Decorator to make a method auto-transactional using AsyncLocalStorage.
 * The class must have a `db` property of type Kysely<DB>.
 */
export function AutoTransactional(options?: RunInTransactionOptions): MethodDecorator {
  return function autoTransactionalDecorator(
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function autoTransactionalHandler(this: { db?: Kysely<unknown> }, ...args: unknown[]) {
      const db = this.db;

      if (!db) {
        throw new Error(
          `@AutoTransactional requires 'db' property on class ${target.constructor.name}. ` +
            `Ensure the service has Kysely database injected.`
        );
      }

      return runInTransaction(db, () => originalMethod.apply(this, args), {
        ...options,
        name: options?.name ?? `${target.constructor.name}.${String(propertyKey)}`,
      });
    };

    return descriptor;
  };
}
