/**
 * Mock for @kysera/dal
 */

import { vi } from 'vitest';

export const createContext = vi.fn().mockImplementation((db) => ({
  db,
  isTransaction: false,
}));

export const withTransaction = vi.fn().mockImplementation(async (db, fn) => {
  const ctx = { db, isTransaction: true };
  return fn(ctx);
});

export const withContext = vi.fn().mockImplementation((ctx, fn) => fn(ctx));

export const isInTransaction = vi.fn().mockReturnValue(false);

export const createQuery = vi.fn().mockImplementation((fn) => async (ctxOrDb: any, ...args: any[]) => {
  const ctx = ctxOrDb.db ? ctxOrDb : { db: ctxOrDb, isTransaction: false };
  return fn(ctx, ...args);
});

export const createTransactionalQuery = vi.fn().mockImplementation((fn) => async (ctxOrDb: any, ...args: any[]) => {
  const ctx = ctxOrDb.db ? ctxOrDb : { db: ctxOrDb, isTransaction: false };
  return fn(ctx, ...args);
});

export const compose = vi.fn().mockImplementation((first, second) => async (ctx: any, ...args: any[]) => {
  const result = await first(ctx, ...args);
  return second(ctx, result);
});

export const chain = vi.fn().mockImplementation((...fns) => async (ctx: any, ...args: any[]) => {
  let result = args[0];
  for (const fn of fns) {
    result = await fn(ctx, result);
  }
  return result;
});

export const parallel = vi.fn().mockImplementation((queries) => async (ctx: any, ...args: any[]) => {
  const results: Record<string, any> = {};
  for (const [key, fn] of Object.entries(queries)) {
    results[key] = await (fn as any)(ctx, ...args);
  }
  return results;
});

export const conditional = vi.fn();
export const mapResult = vi.fn();

export class TransactionRequiredError extends Error {
  constructor(message: string = 'Transaction required') {
    super(message);
    this.name = 'TransactionRequiredError';
  }
}

export const DB_CONTEXT_SYMBOL: unique symbol = Symbol.for('kysera.DbContext') as any;
export const IN_TRANSACTION_SYMBOL: unique symbol = Symbol.for('kysera.InTransaction') as any;
export const SAVEPOINT_COUNTER_SYMBOL: unique symbol = Symbol.for('kysera.SavepointCounter') as any;

export function isDbContext<DB>(obj: unknown): boolean {
  return obj !== null && typeof obj === 'object' && 'db' in (obj as any);
}

export const createSchemaContext = vi.fn().mockImplementation((db, schema) => ({
  db,
  schema,
  isTransaction: false,
}));

// Re-export from @kysera/executor for convenience
export class PluginValidationError extends Error {
  constructor(
    message: string,
    public type: string,
    public details: unknown
  ) {
    super(message);
    this.name = 'PluginValidationError';
  }
}
