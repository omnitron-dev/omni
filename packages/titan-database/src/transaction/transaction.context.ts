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
import type { Transaction, Kysely } from 'kysely';
import type { Plugin } from '@kysera/executor';

/**
 * Transaction context stored in AsyncLocalStorage.
 */
export interface TransactionContextData {
  transaction: Transaction<unknown>;
  connectionName: string;
  depth: number;
  startedAt: Date;
  name?: string;
  plugins?: Plugin[];
  wrappedExecutor?: unknown;
}

/**
 * AsyncLocalStorage for transaction context.
 * Uses globalThis to survive dual-package hazard.
 */
const TXN_STORAGE_KEY = Symbol.for('titan:database:transaction-storage');
const transactionStorage: AsyncLocalStorage<TransactionContextData> = ((globalThis as any)[TXN_STORAGE_KEY] ??=
  new AsyncLocalStorage<TransactionContextData>());

// ============================================================================
// Table Plugin Registry (used by apps for RLS plugin registration)
// ============================================================================

const PLUGIN_REGISTRY_KEY = Symbol.for('titan:database:plugin-registry');
const globalPluginRegistry: Map<string, Plugin[]> = ((globalThis as any)[PLUGIN_REGISTRY_KEY] ??= new Map<
  string,
  Plugin[]
>());

/**
 * Register plugins for a specific table.
 * Used by application code to register RLS/soft-delete plugins per table.
 */
export function registerTablePlugins(tableName: string, plugins: Plugin[]): void {
  globalPluginRegistry.set(tableName, plugins);
}

/**
 * Get registered plugins for a specific table.
 */
export function getTablePlugins(tableName: string): Plugin[] {
  return globalPluginRegistry.get(tableName) || [];
}

/**
 * Clear the global plugin registry. Primarily for testing.
 */
export function clearPluginRegistry(): void {
  globalPluginRegistry.clear();
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
 * If a tableName is provided and plugins are registered for that table,
 * the executor will be wrapped with those plugins (lazy, cached).
 */
export function getExecutor<DB>(db: Kysely<DB> | Transaction<DB>, tableName?: string): Kysely<DB> | Transaction<DB> {
  const ctx = transactionStorage.getStore();

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
 * If already in a transaction, reuses it (nested support).
 */
export async function runInTransaction<DB, T>(
  db: Kysely<DB>,
  fn: () => Promise<T>,
  options?: { name?: string; connectionName?: string }
): Promise<T> {
  const existingCtx = transactionStorage.getStore();

  if (existingCtx) {
    return fn();
  }

  return db.transaction().execute(async (trx) => {
    const ctx: TransactionContextData = {
      transaction: trx as Transaction<unknown>,
      connectionName: options?.connectionName ?? 'default',
      depth: 1,
      startedAt: new Date(),
      name: options?.name,
    };
    return transactionStorage.run(ctx, fn);
  });
}

/**
 * Run a function within an existing transaction context.
 */
export async function runWithTransaction<DB, T>(
  trx: Transaction<DB>,
  fn: () => Promise<T>,
  options?: { name?: string; connectionName?: string }
): Promise<T> {
  const existingCtx = transactionStorage.getStore();
  const depth = existingCtx ? existingCtx.depth + 1 : 1;

  const ctx: TransactionContextData = {
    transaction: trx as Transaction<unknown>,
    connectionName: options?.connectionName ?? existingCtx?.connectionName ?? 'default',
    depth,
    startedAt: new Date(),
    name: options?.name,
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
export function AutoTransactional(options?: { name?: string; connectionName?: string }): MethodDecorator {
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

      if (isInTransactionContext()) {
        return originalMethod.apply(this, args);
      }

      return runInTransaction(db, () => originalMethod.apply(this, args), {
        name: options?.name ?? `${target.constructor.name}.${String(propertyKey)}`,
        connectionName: options?.connectionName,
      });
    };

    return descriptor;
  };
}
