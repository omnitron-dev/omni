/**
 * Mock for @kysera/dal
 */

export const createContext = jest.fn().mockImplementation((db) => ({
  db,
  isTransaction: false,
}));

export const withTransaction = jest.fn().mockImplementation(async (db, fn) => {
  const ctx = { db, isTransaction: true };
  return fn(ctx);
});

export const withContext = jest.fn().mockImplementation((ctx, fn) => fn(ctx));

export const isInTransaction = jest.fn().mockReturnValue(false);

export const createQuery = jest.fn().mockImplementation((fn) => {
  return async (ctxOrDb: any, ...args: any[]) => {
    const ctx = ctxOrDb.db ? ctxOrDb : { db: ctxOrDb, isTransaction: false };
    return fn(ctx, ...args);
  };
});

export const createTransactionalQuery = jest.fn().mockImplementation((fn) => {
  return async (ctxOrDb: any, ...args: any[]) => {
    const ctx = ctxOrDb.db ? ctxOrDb : { db: ctxOrDb, isTransaction: false };
    return fn(ctx, ...args);
  };
});

export const compose = jest.fn().mockImplementation((first, second) => {
  return async (ctx: any, ...args: any[]) => {
    const result = await first(ctx, ...args);
    return second(ctx, result);
  };
});

export const chain = jest.fn().mockImplementation((...fns) => {
  return async (ctx: any, ...args: any[]) => {
    let result = args[0];
    for (const fn of fns) {
      result = await fn(ctx, result);
    }
    return result;
  };
});

export const parallel = jest.fn().mockImplementation((queries) => {
  return async (ctx: any, ...args: any[]) => {
    const results: Record<string, any> = {};
    for (const [key, fn] of Object.entries(queries)) {
      results[key] = await (fn as any)(ctx, ...args);
    }
    return results;
  };
});

export const conditional = jest.fn();
export const mapResult = jest.fn();
