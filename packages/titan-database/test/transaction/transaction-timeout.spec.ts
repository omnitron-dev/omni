/**
 * Transaction Context Tests
 *
 * Tests for the AsyncLocalStorage-based transaction context:
 * - runInTransaction / runWithTransaction
 * - getTransactionContext / getCurrentTransaction / isInTransactionContext
 * - getExecutor (returns transaction if in context, else db)
 * - @AutoTransactional decorator
 * - Plugin registry (registerTablePlugins / getTablePlugins / clearPluginRegistry)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  runInTransaction,
  runWithTransaction,
  getTransactionContext,
  getCurrentTransaction,
  isInTransactionContext,
  getExecutor,
  AutoTransactional,
  registerTablePlugins,
  getTablePlugins,
  clearPluginRegistry,
} from '../../src/transaction/transaction.context.js';
import type { Kysely, Transaction } from 'kysely';

// ---------------------------------------------------------------------------
// Helpers – minimal mock objects that satisfy the Kysely contract surface
// ---------------------------------------------------------------------------

function createMockTransaction(): Transaction<unknown> {
  return {
    _tag: 'mock-transaction',
    selectFrom: vi.fn().mockReturnThis(),
    insertInto: vi.fn().mockReturnThis(),
  } as unknown as Transaction<unknown>;
}

function createMockDb(trx?: Transaction<unknown>): Kysely<unknown> {
  const actualTrx = trx ?? createMockTransaction();
  return {
    _tag: 'mock-db',
    transaction: () => ({
      execute: async <T>(fn: (t: Transaction<unknown>) => Promise<T>) => fn(actualTrx),
    }),
  } as unknown as Kysely<unknown>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Transaction Context', () => {
  beforeEach(() => {
    clearPluginRegistry();
  });

  // =========================================================================
  // Basic context detection
  // =========================================================================

  describe('isInTransactionContext', () => {
    it('should return false when not in a transaction', () => {
      expect(isInTransactionContext()).toBe(false);
    });

    it('should return true inside runInTransaction', async () => {
      const db = createMockDb();

      await runInTransaction(db, async () => {
        expect(isInTransactionContext()).toBe(true);
      });
    });

    it('should return false after transaction completes', async () => {
      const db = createMockDb();

      await runInTransaction(db, async () => {
        // inside
      });

      expect(isInTransactionContext()).toBe(false);
    });
  });

  // =========================================================================
  // getTransactionContext / getCurrentTransaction
  // =========================================================================

  describe('getTransactionContext', () => {
    it('should return undefined when outside transaction', () => {
      expect(getTransactionContext()).toBeUndefined();
    });

    it('should return context data inside runInTransaction', async () => {
      const db = createMockDb();

      await runInTransaction(db, async () => {
        const ctx = getTransactionContext();
        expect(ctx).toBeDefined();
        expect(ctx!.depth).toBe(1);
        expect(ctx!.connectionName).toBe('default');
        expect(ctx!.startedAt).toBeInstanceOf(Date);
      });
    });

    it('should honour custom connectionName and name options', async () => {
      const db = createMockDb();

      await runInTransaction(
        db,
        async () => {
          const ctx = getTransactionContext();
          expect(ctx!.connectionName).toBe('secondary');
          expect(ctx!.name).toBe('my-txn');
        },
        { connectionName: 'secondary', name: 'my-txn' },
      );
    });
  });

  describe('getCurrentTransaction', () => {
    it('should return undefined when outside transaction', () => {
      expect(getCurrentTransaction()).toBeUndefined();
    });

    it('should return the transaction object inside runInTransaction', async () => {
      const trx = createMockTransaction();
      const db = createMockDb(trx);

      await runInTransaction(db, async () => {
        expect(getCurrentTransaction()).toBe(trx);
      });
    });
  });

  // =========================================================================
  // runInTransaction – nesting
  // =========================================================================

  describe('runInTransaction nesting', () => {
    it('should reuse existing transaction when nested', async () => {
      const trx = createMockTransaction();
      const db = createMockDb(trx);

      await runInTransaction(db, async () => {
        const outerTrx = getCurrentTransaction();

        // Nested call — should NOT create a new transaction
        await runInTransaction(db, async () => {
          const innerTrx = getCurrentTransaction();
          expect(innerTrx).toBe(outerTrx);
        });
      });
    });
  });

  // =========================================================================
  // runWithTransaction
  // =========================================================================

  describe('runWithTransaction', () => {
    it('should set transaction context with provided transaction', async () => {
      const trx = createMockTransaction();

      await runWithTransaction(trx, async () => {
        expect(isInTransactionContext()).toBe(true);
        expect(getCurrentTransaction()).toBe(trx);

        const ctx = getTransactionContext();
        expect(ctx!.depth).toBe(1);
      });
    });

    it('should increment depth when nested', async () => {
      const trx1 = createMockTransaction();
      const trx2 = createMockTransaction();

      await runWithTransaction(trx1, async () => {
        expect(getTransactionContext()!.depth).toBe(1);

        await runWithTransaction(trx2, async () => {
          expect(getTransactionContext()!.depth).toBe(2);
          // The inner call uses its own transaction
          expect(getCurrentTransaction()).toBe(trx2);
        });

        // Outer still sees its own transaction
        expect(getCurrentTransaction()).toBe(trx1);
      });
    });
  });

  // =========================================================================
  // getExecutor
  // =========================================================================

  describe('getExecutor', () => {
    it('should return db when not in transaction context', () => {
      const db = createMockDb();
      expect(getExecutor(db)).toBe(db);
    });

    it('should return transaction when in transaction context', async () => {
      const trx = createMockTransaction();
      const db = createMockDb(trx);

      await runInTransaction(db, async () => {
        const executor = getExecutor(db);
        expect(executor).toBe(trx);
      });
    });
  });

  // =========================================================================
  // @AutoTransactional decorator
  // =========================================================================

  describe('@AutoTransactional', () => {
    it('should wrap method in transaction', async () => {
      const trx = createMockTransaction();
      const db = createMockDb(trx);

      class Service {
        db = db;

        @AutoTransactional()
        async doWork(): Promise<string> {
          expect(isInTransactionContext()).toBe(true);
          return 'result';
        }
      }

      const svc = new Service();
      const result = await svc.doWork();
      expect(result).toBe('result');
    });

    it('should reuse existing transaction instead of creating new one', async () => {
      const trx = createMockTransaction();
      const db = createMockDb(trx);

      class Service {
        db = db;

        @AutoTransactional()
        async doWork(): Promise<Transaction<unknown> | undefined> {
          return getCurrentTransaction();
        }
      }

      const svc = new Service();

      // Call within an existing transaction
      await runInTransaction(db, async () => {
        const result = await svc.doWork();
        // Should be the same transaction, not a new one
        expect(result).toBe(trx);
      });
    });

    it('should throw if class has no db property', async () => {
      class BadService {
        @AutoTransactional()
        async doWork(): Promise<void> {
          // no-op
        }
      }

      const svc = new BadService();
      await expect(svc.doWork()).rejects.toThrow("@AutoTransactional requires 'db' property");
    });
  });

  // =========================================================================
  // Plugin registry
  // =========================================================================

  describe('Plugin Registry', () => {
    it('should register and retrieve plugins for a table', () => {
      const plugins = [{ name: 'soft-delete' } as any];
      registerTablePlugins('users', plugins);

      expect(getTablePlugins('users')).toBe(plugins);
    });

    it('should return empty array for unregistered table', () => {
      expect(getTablePlugins('nonexistent')).toEqual([]);
    });

    it('should clear all registered plugins', () => {
      registerTablePlugins('users', [{ name: 'a' } as any]);
      registerTablePlugins('posts', [{ name: 'b' } as any]);

      clearPluginRegistry();

      expect(getTablePlugins('users')).toEqual([]);
      expect(getTablePlugins('posts')).toEqual([]);
    });
  });
});
