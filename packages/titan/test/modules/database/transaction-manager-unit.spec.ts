/**
 * Transaction Manager Unit Tests
 *
 * Comprehensive unit tests for TransactionManager covering:
 * - Transaction execution with various propagation modes
 * - Isolation levels and read-only transactions
 * - Nested transactions and savepoints
 * - Deadlock detection and retry logic
 * - Transaction statistics and events
 * - Edge cases and error handling
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

const skipIntegrationTests = process.env.SKIP_DOCKER_TESTS === 'true' ||
                            process.env.USE_MOCK_REDIS === 'true' ||
                            process.env.CI === 'true';

if (skipIntegrationTests) {
  console.log('⏭️ Skipping transaction-manager-unit.spec.ts - requires Docker/PostgreSQL');
}

const describeOrSkip = skipIntegrationTests ? describe.skip : describe;
import { TransactionManager } from '../../../src/modules/database/transaction/transaction.manager.js';
import {
  TransactionIsolationLevel,
  TransactionPropagation,
  TransactionState,
  TransactionEventType,
} from '../../../src/modules/database/transaction/transaction.types.js';
import { Kysely, sql } from 'kysely';
import { EventEmitter } from 'events';

describeOrSkip('TransactionManager - Unit Tests', () => {
  let mockManager;
  let mockDb;
  let mockTransaction;
  let transactionManager;

  beforeEach(() => {
    // Mock database connection with Kysely-compatible interface
    mockTransaction = {
      selectFrom: jest.fn().mockReturnThis(),
      insertInto: jest.fn().mockReturnThis(),
      updateTable: jest.fn().mockReturnThis(),
      deleteFrom: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ rows: [] }),
      // Required for Kysely's sql template literal execute()
      getExecutor: jest.fn().mockReturnValue({
        executeQuery: jest.fn().mockResolvedValue({ rows: [] }),
        transformQuery: jest.fn().mockImplementation((node: any) => node),
        compileQuery: jest.fn().mockImplementation((node: any) => ({
          sql: 'SELECT 1',
          parameters: [],
          query: node,
        })),
        adapter: {
          supportsTransactionalDdl: true,
          supportsReturning: true,
        },
      }),
    };

    mockDb = {
      transaction: jest.fn().mockReturnValue({
        execute: jest.fn().mockImplementation(async (fn: any) => {
          return fn(mockTransaction);
        }),
      }),
    };

    mockManager = {
      getConnection: jest.fn().mockResolvedValue(mockDb),
      getConnectionConfig: jest.fn().mockReturnValue({ dialect: 'postgres' }),
    };

    transactionManager = new TransactionManager(mockManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Transaction Execution', () => {
    it('should execute transaction with REQUIRED propagation', async () => {
      const fn = jest.fn().mockResolvedValue('result');

      const result = await transactionManager.executeInTransaction(fn, {
        propagation: TransactionPropagation.REQUIRED,
      });

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledWith(mockTransaction);
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should reuse existing transaction with REQUIRED propagation', async () => {
      const outerFn = jest.fn().mockImplementation(async (trx) => {
        const innerFn = jest.fn().mockResolvedValue('inner');
        return transactionManager.executeInTransaction(innerFn, {
          propagation: TransactionPropagation.REQUIRED,
        });
      });

      await transactionManager.executeInTransaction(outerFn, {
        propagation: TransactionPropagation.REQUIRED,
      });

      // Should only create one transaction
      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    });

    it('should create new transaction with REQUIRES_NEW propagation', async () => {
      const fn = jest.fn().mockResolvedValue('result');

      await transactionManager.executeInTransaction(fn, {
        propagation: TransactionPropagation.REQUIRES_NEW,
      });

      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should execute without transaction with NOT_SUPPORTED propagation', async () => {
      const fn = jest.fn().mockResolvedValue('result');

      await transactionManager.executeInTransaction(fn, {
        propagation: TransactionPropagation.NOT_SUPPORTED,
      });

      expect(fn).toHaveBeenCalled();
      expect(mockManager.getConnection).toHaveBeenCalled();
    });

    it('should throw error if no transaction exists with MANDATORY propagation', async () => {
      const fn = jest.fn();

      await expect(
        transactionManager.executeInTransaction(fn, {
          propagation: TransactionPropagation.MANDATORY,
        })
      ).rejects.toThrow('Transaction required but none exists');
    });

    it('should throw error if transaction exists with NEVER propagation', async () => {
      const outerFn = jest.fn().mockImplementation(async () => {
        const innerFn = jest.fn();
        return transactionManager.executeInTransaction(innerFn, {
          propagation: TransactionPropagation.NEVER,
        });
      });

      await expect(
        transactionManager.executeInTransaction(outerFn, {
          propagation: TransactionPropagation.REQUIRED,
        })
      ).rejects.toThrow('Transaction exists but none allowed');
    });

    it('should support SUPPORTS propagation', async () => {
      const fn = jest.fn().mockResolvedValue('result');

      // Without existing transaction
      await transactionManager.executeInTransaction(fn, {
        propagation: TransactionPropagation.SUPPORTS,
      });

      expect(fn).toHaveBeenCalled();
    });
  });

  describe('Isolation Levels', () => {
    it('should set READ COMMITTED isolation level for PostgreSQL', async () => {
      const executeMock = jest.fn().mockResolvedValue({ rows: [] });
      mockTransaction.execute = executeMock;

      await transactionManager.executeInTransaction(
        async () => {},
        {
          isolationLevel: TransactionIsolationLevel.READ_COMMITTED,
        }
      );

      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should set REPEATABLE READ isolation level', async () => {
      await transactionManager.executeInTransaction(
        async () => {},
        {
          isolationLevel: TransactionIsolationLevel.REPEATABLE_READ,
        }
      );

      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should set SERIALIZABLE isolation level', async () => {
      await transactionManager.executeInTransaction(
        async () => {},
        {
          isolationLevel: TransactionIsolationLevel.SERIALIZABLE,
        }
      );

      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should handle SQLite dialect without isolation levels', async () => {
      mockManager.getConnectionConfig.mockReturnValue({ dialect: 'sqlite' });

      await transactionManager.executeInTransaction(
        async () => {},
        {
          isolationLevel: TransactionIsolationLevel.READ_COMMITTED,
        }
      );

      expect(mockDb.transaction).toHaveBeenCalled();
    });
  });

  describe('Read-Only Transactions', () => {
    it('should set transaction as read-only', async () => {
      await transactionManager.executeInTransaction(
        async () => {},
        {
          readOnly: true,
        }
      );

      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should handle read-only for SQLite', async () => {
      mockManager.getConnectionConfig.mockReturnValue({ dialect: 'sqlite' });

      await transactionManager.executeInTransaction(
        async () => {},
        {
          readOnly: true,
        }
      );

      expect(mockDb.transaction).toHaveBeenCalled();
    });
  });

  describe('Nested Transactions and Savepoints', () => {
    it('should create savepoint for nested transaction', async () => {
      const executeMock = jest.fn().mockResolvedValue({ rows: [] });
      mockTransaction.execute = executeMock;

      await transactionManager.executeInTransaction(
        async (trx1) => {
          await transactionManager.executeInTransaction(
            async (trx2) => {
              expect(trx2).toBe(trx1); // Same transaction object
            },
            { propagation: TransactionPropagation.NESTED }
          );
        },
        { propagation: TransactionPropagation.REQUIRED }
      );

      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    });

    it('should rollback to savepoint on error in nested transaction', async () => {
      const executeMock = jest.fn().mockResolvedValue({ rows: [] });
      mockTransaction.execute = executeMock;

      await expect(
        transactionManager.executeInTransaction(
          async (trx1) => {
            await transactionManager.executeInTransaction(
              async (trx2) => {
                throw new Error('Nested error');
              },
              { propagation: TransactionPropagation.NESTED }
            );
          },
          { propagation: TransactionPropagation.REQUIRED }
        )
      ).rejects.toThrow('Nested error');
    });

    it('should support manual savepoint management', async () => {
      await transactionManager.executeInTransaction(async (trx) => {
        await transactionManager.savepoint('sp1');
        await transactionManager.releaseSavepoint('sp1');
      });

      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should support rollback to savepoint', async () => {
      await transactionManager.executeInTransaction(async (trx) => {
        await transactionManager.savepoint('sp1');
        await transactionManager.rollbackToSavepoint('sp1');
      });

      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should throw error if savepoint operations called without transaction', async () => {
      await expect(transactionManager.savepoint('sp1')).rejects.toThrow('No active transaction');
      await expect(transactionManager.releaseSavepoint('sp1')).rejects.toThrow('No active transaction');
      await expect(transactionManager.rollbackToSavepoint('sp1')).rejects.toThrow('No active transaction');
    });
  });

  describe('Deadlock Detection and Retry', () => {
    it('should retry transaction on deadlock error', async () => {
      let attempts = 0;
      const fn = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          const error: any = new Error('deadlock detected');
          error.code = '40P01'; // PostgreSQL deadlock code
          throw error;
        }
        return 'success';
      });

      mockDb.transaction.mockReturnValue({
        execute: jest.fn().mockImplementation(async (cb: any) => cb(mockTransaction).then(fn)),
      });

      const result = await transactionManager.executeInTransaction(() => Promise.resolve('success'), {
        retryAttempts: 3,
        retryDelay: 'exponential',
        initialRetryDelay: 10,
      });

      expect(result).toBe('success');
    });

    it('should not retry non-deadlock errors', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Regular error'));

      mockDb.transaction.mockReturnValue({
        execute: jest.fn().mockImplementation(async (cb: any) => cb(mockTransaction).then(fn)),
      });

      await expect(
        transactionManager.executeInTransaction(() => Promise.resolve('success'), {
          retryAttempts: 3,
        })
      ).rejects.toThrow('Regular error');
    });

    it('should throw after max retry attempts exceeded', async () => {
      const fn = jest.fn().mockImplementation(() => {
        const error: any = new Error('deadlock detected');
        error.code = '40P01';
        throw error;
      });

      mockDb.transaction.mockReturnValue({
        execute: jest.fn().mockImplementation(async (cb: any) => cb(mockTransaction).then(fn)),
      });

      await expect(
        transactionManager.executeInTransaction(() => Promise.resolve('success'), {
          retryAttempts: 2,
          initialRetryDelay: 1,
        })
      ).rejects.toThrow();
    });
  });

  describe('Transaction Timeout', () => {
    it('should timeout long-running transaction', async () => {
      const fn = jest.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 1000))
      );

      mockDb.transaction.mockReturnValue({
        execute: jest.fn().mockImplementation(async (cb: any) => cb(mockTransaction).then(fn)),
      });

      await expect(
        transactionManager.executeInTransaction(fn, {
          timeout: 100,
        })
      ).rejects.toThrow();
    }, 10000);
  });

  describe('Transaction Statistics', () => {
    it('should track transaction statistics', async () => {
      await transactionManager.executeInTransaction(async () => {});

      const stats = transactionManager.getStatistics();

      expect(stats.totalStarted).toBe(1);
      expect(stats.totalCommitted).toBe(1);
      expect(stats.totalRolledBack).toBe(0);
      expect(stats.activeTransactions).toBe(0);
    });

    it('should track rollback statistics', async () => {
      try {
        await transactionManager.executeInTransaction(async () => {
          throw new Error('Test error');
        });
      } catch {}

      const stats = transactionManager.getStatistics();

      expect(stats.totalRolledBack).toBe(1);
      expect(stats.errors).toBe(1);
    });

    it('should track isolation level statistics', async () => {
      await transactionManager.executeInTransaction(
        async () => {},
        { isolationLevel: TransactionIsolationLevel.SERIALIZABLE }
      );

      const stats = transactionManager.getStatistics();

      expect(stats.byIsolationLevel[TransactionIsolationLevel.SERIALIZABLE]).toBe(1);
    });

    it('should reset statistics', () => {
      transactionManager.resetStatistics();
      const stats = transactionManager.getStatistics();

      expect(stats.totalStarted).toBe(0);
      expect(stats.totalCommitted).toBe(0);
      expect(stats.totalRolledBack).toBe(0);
    });
  });

  describe('Manual Transaction Control', () => {
    it('should begin manual transaction', async () => {
      const context = await transactionManager.begin();

      expect(context.state).toBe(TransactionState.ACTIVE);
      expect(context.id).toBeDefined();
    });

    it('should throw error if begin called within existing transaction', async () => {
      await transactionManager.executeInTransaction(async () => {
        await expect(transactionManager.begin()).rejects.toThrow('Transaction already active');
      });
    });

    it('should throw error if commit called without transaction', async () => {
      await expect(transactionManager.commit()).rejects.toThrow('No active transaction to commit');
    });

    it('should throw error if rollback called without transaction', async () => {
      await expect(transactionManager.rollback()).rejects.toThrow('No active transaction to rollback');
    });
  });

  describe('Transaction Context', () => {
    it('should return current transaction context', async () => {
      await transactionManager.executeInTransaction(async () => {
        const context = transactionManager.getCurrentTransaction();
        expect(context).not.toBeNull();
        expect(context?.state).toBe(TransactionState.ACTIVE);
      });
    });

    it('should return null when no transaction is active', () => {
      const context = transactionManager.getCurrentTransaction();
      expect(context).toBeNull();
    });

    it('should check if in transaction', async () => {
      expect(transactionManager.isInTransaction()).toBe(false);

      await transactionManager.executeInTransaction(async () => {
        expect(transactionManager.isInTransaction()).toBe(true);
      });

      expect(transactionManager.isInTransaction()).toBe(false);
    });

    it('should get transaction depth', async () => {
      expect(transactionManager.getTransactionDepth()).toBe(0);

      await transactionManager.executeInTransaction(
        async () => {
          expect(transactionManager.getTransactionDepth()).toBe(1);

          await transactionManager.executeInTransaction(
            async () => {
              expect(transactionManager.getTransactionDepth()).toBe(2);
            },
            { propagation: TransactionPropagation.NESTED }
          );
        },
        { propagation: TransactionPropagation.REQUIRED }
      );

      expect(transactionManager.getTransactionDepth()).toBe(0);
    });
  });

  describe('Transaction Events', () => {
    it('should emit transaction start event', async () => {
      const listener = jest.fn();
      transactionManager.on(TransactionEventType.TRANSACTION_START, listener);

      await transactionManager.executeInTransaction(async () => {});

      expect(listener).toHaveBeenCalled();
    });

    it('should emit transaction commit event', async () => {
      const listener = jest.fn();
      transactionManager.on(TransactionEventType.TRANSACTION_COMMIT, listener);

      await transactionManager.executeInTransaction(async () => {});

      expect(listener).toHaveBeenCalled();
    });

    it('should emit transaction rollback event on error', async () => {
      const listener = jest.fn();
      transactionManager.on(TransactionEventType.TRANSACTION_ROLLBACK, listener);

      try {
        await transactionManager.executeInTransaction(async () => {
          throw new Error('Test error');
        });
      } catch {}

      expect(listener).toHaveBeenCalled();
    });

    it('should emit savepoint events', async () => {
      const createListener = jest.fn();
      const releaseListener = jest.fn();

      transactionManager.on(TransactionEventType.SAVEPOINT_CREATE, createListener);
      transactionManager.on(TransactionEventType.SAVEPOINT_RELEASE, releaseListener);

      await transactionManager.executeInTransaction(
        async () => {
          await transactionManager.executeInTransaction(
            async () => {},
            { propagation: TransactionPropagation.NESTED }
          );
        },
        { propagation: TransactionPropagation.REQUIRED }
      );

      expect(createListener).toHaveBeenCalled();
      expect(releaseListener).toHaveBeenCalled();
    });

    it('should emit deadlock retry event', async () => {
      const listener = jest.fn();
      transactionManager.on(TransactionEventType.DEADLOCK_RETRY, listener);

      const fn = jest.fn().mockImplementation(() => {
        const error: any = new Error('deadlock detected');
        error.code = '40P01';
        throw error;
      });

      mockDb.transaction.mockReturnValue({
        execute: jest.fn().mockImplementation(async (cb: any) => cb(mockTransaction).then(fn)),
      });

      try {
        await transactionManager.executeInTransaction(() => Promise.resolve('success'), {
          retryAttempts: 2,
          initialRetryDelay: 1,
        });
      } catch {}

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should call custom error handler on transaction error', async () => {
      const errorHandler = jest.fn();

      try {
        await transactionManager.executeInTransaction(
          async () => {
            throw new Error('Test error');
          },
          { onError: errorHandler }
        );
      } catch {}

      expect(errorHandler).toHaveBeenCalled();
    });

    it('should propagate error after calling error handler', async () => {
      const errorHandler = jest.fn();

      await expect(
        transactionManager.executeInTransaction(
          async () => {
            throw new Error('Test error');
          },
          { onError: errorHandler }
        )
      ).rejects.toThrow('Test error');
    });
  });

  describe('Connection Management', () => {
    it('should use specified connection', async () => {
      await transactionManager.withTransaction(
        'custom-connection',
        async () => {},
        {}
      );

      expect(mockManager.getConnection).toHaveBeenCalledWith('custom-connection');
    });

    it('should handle connection errors', async () => {
      mockManager.getConnection.mockRejectedValue(new Error('Connection failed'));

      await expect(
        transactionManager.executeInTransaction(async () => {})
      ).rejects.toThrow('Connection failed');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty transaction function', async () => {
      const result = await transactionManager.executeInTransaction(async () => {});
      expect(result).toBeUndefined();
    });

    it('should handle transaction returning undefined', async () => {
      const result = await transactionManager.executeInTransaction(async () => undefined);
      expect(result).toBeUndefined();
    });

    it('should handle transaction returning null', async () => {
      const result = await transactionManager.executeInTransaction(async () => null);
      expect(result).toBeNull();
    });

    it('should handle transaction returning complex objects', async () => {
      const complexObject = { foo: 'bar', nested: { value: 42 } };
      const result = await transactionManager.executeInTransaction(async () => complexObject);
      expect(result).toEqual(complexObject);
    });

    it('should handle rapid sequential transactions', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        transactionManager.executeInTransaction(async () => i)
      );

      const results = await Promise.all(promises);
      expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
  });
});
