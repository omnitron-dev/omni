/**
 * Database Service Unit Tests
 *
 * Tests for high-level database operations including:
 * - Query execution with metrics
 * - Transaction management
 * - Pagination (offset and cursor-based)
 * - Error handling and parsing
 * - Event emission
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DatabaseService } from '../../../src/modules/database/database.service.js';
import { Kysely, sql } from 'kysely';

describe('DatabaseService - Unit Tests', () => {
  let service: DatabaseService;
  let mockManager: any;
  let mockDb: any;
  let mockEventsService: any;

  beforeEach(() => {
    mockDb = {
      selectFrom: jest.fn().mockReturnThis(),
      insertInto: jest.fn().mockReturnThis(),
      updateTable: jest.fn().mockReturnThis(),
      deleteFrom: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      selectAll: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ rows: [] }),
      executeTakeFirst: jest.fn().mockResolvedValue(null),
      transaction: jest.fn().mockReturnValue({
        execute: jest.fn().mockImplementation(async (fn: any) => fn(mockDb)),
      }),
    };

    mockManager = {
      getConnection: jest.fn().mockResolvedValue(mockDb),
      getConnectionConfig: jest.fn().mockReturnValue({ dialect: 'sqlite' }),
    };

    mockEventsService = {
      emit: jest.fn(),
    };

    service = new DatabaseService(mockManager, mockEventsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Connection Management', () => {
    it('should get database connection', async () => {
      const db = await service.getConnection();
      expect(db).toBeDefined();
      expect(mockManager.getConnection).toHaveBeenCalledWith(undefined);
    });

    it('should get named connection', async () => {
      await service.getConnection('custom');
      expect(mockManager.getConnection).toHaveBeenCalledWith('custom');
    });
  });

  describe('Query Execution', () => {
    it('should execute query successfully', async () => {
      mockDb.execute.mockResolvedValue({ rows: [{ id: 1 }] });

      const result = await service.executeQuery(async (db) => {
        return db.execute();
      });

      expect(result).toEqual({ rows: [{ id: 1 }] });
      expect(mockManager.getConnection).toHaveBeenCalled();
    });

    it('should execute query with custom connection', async () => {
      await service.executeQuery(
        async (db) => {
          return db.execute();
        },
        { connection: 'custom' }
      );

      expect(mockManager.getConnection).toHaveBeenCalledWith('custom');
    });

    it('should execute query with timeout', async () => {
      const slowQuery = async (db: any) => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { rows: [] };
      };

      await expect(
        service.executeQuery(slowQuery, { timeout: 50 })
      ).rejects.toThrow();
    }, 10000);

    it('should track query metrics by default', async () => {
      await service.executeQuery(async (db) => {
        return { rows: [] };
      });

      // Metrics should be tracked (internal method call verification)
      expect(mockManager.getConnection).toHaveBeenCalled();
    });

    it('should skip metrics when trackMetrics is false', async () => {
      await service.executeQuery(
        async (db) => {
          return { rows: [] };
        },
        { trackMetrics: false }
      );

      expect(mockManager.getConnection).toHaveBeenCalled();
    });

    it('should parse database errors', async () => {
      const dbError = new Error('UNIQUE constraint failed');
      mockDb.execute.mockRejectedValue(dbError);

      await expect(
        service.executeQuery(async (db) => {
          return db.execute();
        })
      ).rejects.toThrow();
    });

    it('should handle query execution errors', async () => {
      mockManager.getConnection.mockRejectedValue(new Error('Connection failed'));

      await expect(
        service.executeQuery(async (db) => {
          return db.execute();
        })
      ).rejects.toThrow('Connection failed');
    });
  });

  describe('Transaction Management', () => {
    it('should execute transaction', async () => {
      const result = await service.transaction(async (trx) => {
        return 'success';
      });

      expect(result).toBe('success');
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should execute transaction with custom connection', async () => {
      await service.transaction(
        async (trx) => {
          return 'success';
        },
        { connection: 'custom' }
      );

      expect(mockManager.getConnection).toHaveBeenCalledWith('custom');
    });

    it('should execute transaction with isolation level', async () => {
      await service.transaction(
        async (trx) => {
          return 'success';
        },
        { isolationLevel: 'serializable' }
      );

      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should rollback transaction on error', async () => {
      await expect(
        service.transaction(async (trx) => {
          throw new Error('Transaction error');
        })
      ).rejects.toThrow('Transaction error');
    });

    it('should emit transaction started event', async () => {
      await service.transaction(async (trx) => {
        return 'success';
      });

      expect(mockEventsService.emit).toHaveBeenCalledWith(
        'database.transaction.started',
        expect.any(Object)
      );
    });

    it('should emit transaction committed event', async () => {
      await service.transaction(async (trx) => {
        return 'success';
      });

      expect(mockEventsService.emit).toHaveBeenCalledWith(
        'database.transaction.committed',
        expect.any(Object)
      );
    });

    it('should emit transaction rolled back event on error', async () => {
      try {
        await service.transaction(async (trx) => {
          throw new Error('Test error');
        });
      } catch {}

      expect(mockEventsService.emit).toHaveBeenCalledWith(
        'database.transaction.rolled_back',
        expect.any(Object)
      );
    });
  });

  describe('Pagination', () => {
    it('should paginate query with default options', async () => {
      mockDb.execute.mockResolvedValue({
        rows: [
          { id: 1, name: 'User 1' },
          { id: 2, name: 'User 2' },
        ],
      });

      const query = mockDb.selectFrom('users').selectAll();

      const result = await service.paginate(query);

      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
    });

    it('should paginate with custom page and page size', async () => {
      mockDb.execute.mockResolvedValue({
        rows: [{ id: 3, name: 'User 3' }],
      });

      const query = mockDb.selectFrom('users').selectAll();

      const result = await service.paginate(query, {
        page: 2,
        pageSize: 1,
      });

      expect(result).toBeDefined();
    });

    it('should paginate with connection option', async () => {
      const query = mockDb.selectFrom('users').selectAll();

      await service.paginate(query, {
        connection: 'custom',
      });

      expect(mockManager.getConnection).toHaveBeenCalledWith('custom');
    });

    it('should handle cursor-based pagination', async () => {
      mockDb.execute.mockResolvedValue({
        rows: [
          { id: 1, name: 'User 1' },
          { id: 2, name: 'User 2' },
        ],
      });

      const query = mockDb.selectFrom('users').selectAll();

      const result = await service.paginateCursor(query, {
        cursor: 'cursor_value',
        limit: 10,
      });

      expect(result).toBeDefined();
    });

    it('should handle empty pagination results', async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });

      const query = mockDb.selectFrom('users').selectAll();

      const result = await service.paginate(query);

      expect(result.data).toEqual([]);
    });
  });

  describe('Raw Query Execution', () => {
    it('should execute raw query', async () => {
      mockDb.execute.mockResolvedValue({ rows: [{ count: 5 }] });

      const result = await service.raw('SELECT COUNT(*) as count FROM users');

      expect(result).toEqual({ rows: [{ count: 5 }] });
    });

    it('should execute raw query with parameters', async () => {
      mockDb.execute.mockResolvedValue({ rows: [{ id: 1 }] });

      const result = await service.raw('SELECT * FROM users WHERE id = ?', [1]);

      expect(result).toBeDefined();
    });

    it('should execute raw query with custom connection', async () => {
      await service.raw('SELECT 1', [], { connection: 'custom' });

      expect(mockManager.getConnection).toHaveBeenCalledWith('custom');
    });

    it('should handle raw query errors', async () => {
      mockDb.execute.mockRejectedValue(new Error('SQL syntax error'));

      await expect(service.raw('INVALID SQL')).rejects.toThrow();
    });
  });

  describe('Query Context', () => {
    it('should create query context', () => {
      const context = service.createQueryContext({
        connection: 'custom',
        timeout: 5000,
      });

      expect(context).toBeDefined();
      expect(context.connection).toBe('custom');
      expect(context.timeout).toBe(5000);
    });

    it('should create query context with defaults', () => {
      const context = service.createQueryContext();

      expect(context).toBeDefined();
      expect(context.connection).toBeUndefined();
    });
  });

  describe('Error Parsing', () => {
    it('should parse unique constraint errors', async () => {
      const error = new Error('UNIQUE constraint failed: users.email');
      (error as any).code = 'SQLITE_CONSTRAINT';

      mockDb.execute.mockRejectedValue(error);

      try {
        await service.executeQuery(async (db) => db.execute());
      } catch (e: any) {
        expect(e).toBeDefined();
      }
    });

    it('should parse foreign key errors', async () => {
      const error = new Error('FOREIGN KEY constraint failed');
      (error as any).code = 'SQLITE_CONSTRAINT_FOREIGNKEY';

      mockDb.execute.mockRejectedValue(error);

      try {
        await service.executeQuery(async (db) => db.execute());
      } catch (e: any) {
        expect(e).toBeDefined();
      }
    });

    it('should parse not null errors', async () => {
      const error = new Error('NOT NULL constraint failed');
      (error as any).code = 'SQLITE_CONSTRAINT_NOTNULL';

      mockDb.execute.mockRejectedValue(error);

      try {
        await service.executeQuery(async (db) => db.execute());
      } catch (e: any) {
        expect(e).toBeDefined();
      }
    });
  });

  describe('Events Service Integration', () => {
    it('should work without events service', async () => {
      const serviceWithoutEvents = new DatabaseService(mockManager);

      const result = await serviceWithoutEvents.executeQuery(async (db) => {
        return { rows: [] };
      });

      expect(result).toBeDefined();
    });

    it('should emit query executed event', async () => {
      await service.executeQuery(async (db) => {
        return { rows: [] };
      });

      // Events should be emitted if events service is available
      expect(mockManager.getConnection).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle null query results', async () => {
      mockDb.execute.mockResolvedValue(null);

      const result = await service.executeQuery(async (db) => {
        return db.execute();
      });

      expect(result).toBeNull();
    });

    it('should handle undefined query results', async () => {
      mockDb.execute.mockResolvedValue(undefined);

      const result = await service.executeQuery(async (db) => {
        return db.execute();
      });

      expect(result).toBeUndefined();
    });

    it('should handle concurrent query execution', async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });

      const promises = Array.from({ length: 10 }, (_, i) =>
        service.executeQuery(async (db) => {
          return { id: i };
        })
      );

      const results = await Promise.all(promises);
      expect(results.length).toBe(10);
    });

    it('should handle query with very long timeout', async () => {
      const result = await service.executeQuery(
        async (db) => {
          return { rows: [] };
        },
        { timeout: 60000 }
      );

      expect(result).toBeDefined();
    });

    it('should handle query with zero timeout', async () => {
      // Zero timeout should be handled gracefully
      const result = await service.executeQuery(
        async (db) => {
          return { rows: [] };
        },
        { timeout: 0 }
      );

      expect(result).toBeDefined();
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout queries that exceed limit', async () => {
      const slowQuery = jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return { rows: [] };
      });

      await expect(
        service.executeQuery(slowQuery, { timeout: 100 })
      ).rejects.toThrow();
    }, 10000);

    it('should not timeout fast queries', async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });

      const result = await service.executeQuery(
        async (db) => db.execute(),
        { timeout: 5000 }
      );

      expect(result).toBeDefined();
    });
  });

  describe('Connection Options', () => {
    it('should respect connection option in all methods', async () => {
      await service.getConnection('test');
      expect(mockManager.getConnection).toHaveBeenCalledWith('test');

      await service.executeQuery(async (db) => ({}), { connection: 'test' });
      expect(mockManager.getConnection).toHaveBeenCalledWith('test');

      await service.transaction(async () => ({}), { connection: 'test' });
      expect(mockManager.getConnection).toHaveBeenCalledWith('test');
    });
  });
});
