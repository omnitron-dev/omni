/**
 * Transaction Timeout and Cleanup Tests
 *
 * Tests for abandoned transaction handling and timeout cleanup
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TransactionManager } from '../../src/transaction/transaction.manager.js';
import type { IDatabaseManager, DatabaseConnectionConfig } from '../../src/database.types.js';
import type { Kysely, Transaction } from 'kysely';

// Mock database manager with SQLite dialect (doesn't require sql.execute for statement_timeout)
const createMockDatabaseManager = (): IDatabaseManager => {
  const mockTrx = {
    selectFrom: vi.fn().mockReturnThis(),
    insertInto: vi.fn().mockReturnThis(),
    updateTable: vi.fn().mockReturnThis(),
    deleteFrom: vi.fn().mockReturnThis(),
  } as unknown as Transaction<unknown>;

  const mockDb = {
    transaction: () => ({
      execute: async <T>(fn: (trx: Transaction<unknown>) => Promise<T>) => fn(mockTrx),
    }),
  } as unknown as Kysely<unknown>;

  return {
    getConnection: vi.fn().mockResolvedValue(mockDb),
    // Use SQLite dialect to avoid sql.execute() calls for statement timeout
    // PostgreSQL and MySQL require sql.execute() which needs a full Kysely executor
    getConnectionConfig: vi.fn().mockReturnValue({
      dialect: 'sqlite',
    } as DatabaseConnectionConfig),
    logger: {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  } as unknown as IDatabaseManager;
};

describe('TransactionManager - Timeout and Cleanup', () => {
  let manager: TransactionManager;
  let mockDbManager: IDatabaseManager;

  beforeEach(() => {
    vi.useFakeTimers();
    mockDbManager = createMockDatabaseManager();
    // Use timeout: 0 to skip database-level statement timeout logic
    // which requires sql.execute() that needs a full Kysely executor.
    // The application-level timeout (via AbortController) still works.
    manager = new TransactionManager(mockDbManager, { timeout: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Savepoint Name Validation', () => {
    it('should reject invalid savepoint names', async () => {
      // Start a transaction first
      await manager.executeInTransaction(async (_trx) => {
        // Test invalid names - validation happens before sql.execute() is called
        await expect(manager.savepoint('123invalid')).rejects.toThrow('Invalid savepoint name');
        await expect(manager.savepoint('has-dash')).rejects.toThrow('Invalid savepoint name');
        await expect(manager.savepoint('has space')).rejects.toThrow('Invalid savepoint name');
        await expect(manager.savepoint('')).rejects.toThrow('Invalid savepoint name');
        await expect(manager.savepoint('drop;--')).rejects.toThrow('Invalid savepoint name');
      });
    });

    // Note: Valid savepoint names test is skipped in unit tests because savepoint()
    // requires sql.execute() which needs a full Kysely executor (not a mock).
    // This functionality is tested in integration tests with real databases.
  });

  describe('Active Transaction Tracking', () => {
    it('should track active transaction IDs', async () => {
      expect(manager.getActiveTransactionIds()).toHaveLength(0);

      const txPromise = manager.executeInTransaction(async (_trx) => {
        expect(manager.getActiveTransactionIds()).toHaveLength(1);
        return 'done';
      });

      await txPromise;
      expect(manager.getActiveTransactionIds()).toHaveLength(0);
    });

    it('should check if transaction is active', async () => {
      await manager.executeInTransaction(async (_trx) => {
        const ids = manager.getActiveTransactionIds();
        expect(ids).toHaveLength(1);
        expect(manager.isTransactionActive(ids[0])).toBe(true);
        expect(manager.isTransactionActive('nonexistent')).toBe(false);
      });
    });
  });

  describe('Force Cleanup', () => {
    it('should force cleanup of abandoned transactions', async () => {
      let transactionId: string | undefined;
      let cleanupResult = false;

      // Start a transaction and capture its ID
      await manager.executeInTransaction(async (_trx) => {
        const ids = manager.getActiveTransactionIds();
        transactionId = ids[0];
        expect(transactionId).toBeDefined();

        // Simulate cleanup while transaction is active
        cleanupResult = manager.forceCleanupTransaction(transactionId!);
      });

      // Force cleanup should return true when cleaning an active transaction
      expect(cleanupResult).toBe(true);
    });

    it('should remove transaction from tracking when force cleaned', async () => {
      await manager.executeInTransaction(async (_trx) => {
        const ids = manager.getActiveTransactionIds();
        const transactionId = ids[0];

        // Force cleanup removes tracking
        manager.forceCleanupTransaction(transactionId!);

        // Transaction should no longer be tracked
        expect(manager.isTransactionActive(transactionId!)).toBe(false);
        expect(manager.getActiveTransactionIds()).toHaveLength(0);
      });
    });

    it('should return false for non-existent transaction', () => {
      const cleaned = manager.forceCleanupTransaction('nonexistent-id');
      expect(cleaned).toBe(false);
    });
  });

  describe('Transaction Statistics', () => {
    it('should update statistics on successful transaction', async () => {
      const initialStats = manager.getStatistics();
      expect(initialStats.totalStarted).toBe(0);
      expect(initialStats.totalCommitted).toBe(0);

      await manager.executeInTransaction(async (_trx) => 'done');

      const stats = manager.getStatistics();
      expect(stats.totalStarted).toBe(1);
      expect(stats.totalCommitted).toBe(1);
      expect(stats.totalRolledBack).toBe(0);
    });

    it('should update statistics on failed transaction', async () => {
      try {
        await manager.executeInTransaction(async (_trx) => {
          throw new Error('Test error');
        });
      } catch {
        // Expected
      }

      const stats = manager.getStatistics();
      expect(stats.totalStarted).toBe(1);
      expect(stats.totalCommitted).toBe(0);
      expect(stats.totalRolledBack).toBe(1);
      expect(stats.errors).toBe(1);
    });

    it('should reset statistics', async () => {
      await manager.executeInTransaction(async (_trx) => 'done');

      manager.resetStatistics();

      const stats = manager.getStatistics();
      expect(stats.totalStarted).toBe(0);
      expect(stats.totalCommitted).toBe(0);
      expect(stats.activeTransactions).toBe(0);
    });
  });
});

describe('TransactionManager - Savepoint Validation in Internal Methods', () => {
  let manager: TransactionManager;
  let mockDbManager: IDatabaseManager;

  beforeEach(() => {
    mockDbManager = createMockDatabaseManager();
    // Use timeout: 0 to skip database-level statement timeout logic
    manager = new TransactionManager(mockDbManager, { timeout: 0 });
  });

  it('should validate savepoint names in releaseSavepoint', async () => {
    await manager.executeInTransaction(async (_trx) => {
      await expect(manager.releaseSavepoint('invalid-name')).rejects.toThrow('Invalid savepoint name');
    });
  });

  it('should validate savepoint names in rollbackToSavepoint', async () => {
    await manager.executeInTransaction(async (_trx) => {
      await expect(manager.rollbackToSavepoint('123bad')).rejects.toThrow('Invalid savepoint name');
    });
  });
});
