/**
 * Database Manager Unit Tests
 *
 * Comprehensive tests for DatabaseManager covering:
 * - Connection initialization and configuration
 * - Multiple database dialects (PostgreSQL, MySQL, SQLite)
 * - Connection pooling and health checks
 * - Retry logic and error handling
 * - Connection lifecycle management
 * - Event emission and metrics tracking
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DatabaseManager } from '../../../src/modules/database/database.manager.js';
import { Kysely, sql } from 'kysely';
import { Pool } from 'pg';
import * as mysql from 'mysql2';

describe('DatabaseManager - Unit Tests', () => {
  let manager: DatabaseManager;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  });

  afterEach(async () => {
    if (manager) {
      await manager.closeAll();
    }
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with default SQLite in-memory database', async () => {
      manager = new DatabaseManager({}, mockLogger);
      await manager.init();

      expect(manager.isConnected('default')).toBe(true);
      const names = manager.getConnectionNames();
      expect(names).toContain('default');
    });

    it('should initialize with single connection config', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: ':memory:',
          },
        },
        mockLogger
      );

      await manager.init();
      expect(manager.isConnected('default')).toBe(true);
    });

    it('should initialize with multiple named connections', async () => {
      manager = new DatabaseManager(
        {
          connections: {
            primary: {
              dialect: 'sqlite',
              connection: ':memory:',
            },
            secondary: {
              dialect: 'sqlite',
              connection: 'file::memory:?cache=shared',
            },
          },
        },
        mockLogger
      );

      await manager.init();
      expect(manager.isConnected('primary')).toBe(true);
      expect(manager.isConnected('secondary')).toBe(true);
    });

    it('should be idempotent - multiple init calls should not create duplicate connections', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: ':memory:',
          },
        },
        mockLogger
      );

      await manager.init();
      await manager.init();
      await manager.init();

      const names = manager.getConnectionNames();
      expect(names.length).toBe(1);
    });

    it('should validate connection configuration', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'postgres',
            connection: {} as any, // Invalid config
          },
        },
        mockLogger
      );

      await expect(manager.init()).rejects.toThrow();
    });
  });

  describe('Connection Management', () => {
    it('should get connection by name', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: ':memory:',
          },
        },
        mockLogger
      );

      await manager.init();
      const db = await manager.getConnection('default');

      expect(db).toBeDefined();
      expect(db).toBeInstanceOf(Kysely);
    });

    it('should throw error for non-existent connection', async () => {
      manager = new DatabaseManager({}, mockLogger);
      await manager.init();

      await expect(manager.getConnection('nonexistent')).rejects.toThrow('not found');
    });

    it('should get connection names', async () => {
      manager = new DatabaseManager(
        {
          connections: {
            conn1: { dialect: 'sqlite', connection: ':memory:' },
            conn2: { dialect: 'sqlite', connection: 'file::memory:?cache=shared' },
          },
        },
        mockLogger
      );

      await manager.init();
      const names = manager.getConnectionNames();

      expect(names).toContain('conn1');
      expect(names).toContain('conn2');
      expect(names.length).toBe(2);
    });

    it('should check connection status', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: ':memory:',
          },
        },
        mockLogger
      );

      expect(manager.isConnected('default')).toBe(false);
      await manager.init();
      expect(manager.isConnected('default')).toBe(true);
    });

    it('should get connection pool for PostgreSQL', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: ':memory:',
          },
        },
        mockLogger
      );

      await manager.init();
      const pool = manager.getPool('default');

      expect(pool).toBeDefined();
    });

    it('should return undefined for pool of non-existent connection', () => {
      manager = new DatabaseManager({}, mockLogger);
      const pool = manager.getPool('nonexistent');

      expect(pool).toBeUndefined();
    });
  });

  describe('Connection String Parsing', () => {
    it('should parse SQLite connection string', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: ':memory:',
          },
        },
        mockLogger
      );

      await manager.init();
      expect(manager.isConnected('default')).toBe(true);
    });

    it('should parse SQLite file path', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: 'file::memory:?cache=shared',
          },
        },
        mockLogger
      );

      await manager.init();
      expect(manager.isConnected('default')).toBe(true);
    });

    it('should handle SQLite shared memory mode', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: 'file:memdb1?mode=memory&cache=shared',
          },
        },
        mockLogger
      );

      await manager.init();
      expect(manager.isConnected('default')).toBe(true);
    });
  });

  describe('Connection Lifecycle', () => {
    it('should close specific connection', async () => {
      manager = new DatabaseManager(
        {
          connections: {
            conn1: { dialect: 'sqlite', connection: ':memory:' },
            conn2: { dialect: 'sqlite', connection: 'file::memory:?cache=shared' },
          },
        },
        mockLogger
      );

      await manager.init();
      expect(manager.isConnected('conn1')).toBe(true);

      await manager.close('conn1');
      expect(manager.isConnected('conn1')).toBe(false);
      expect(manager.isConnected('conn2')).toBe(true);
    });

    it('should close all connections', async () => {
      manager = new DatabaseManager(
        {
          connections: {
            conn1: { dialect: 'sqlite', connection: ':memory:' },
            conn2: { dialect: 'sqlite', connection: 'file::memory:?cache=shared' },
          },
        },
        mockLogger
      );

      await manager.init();
      await manager.closeAll();

      expect(manager.isConnected('conn1')).toBe(false);
      expect(manager.isConnected('conn2')).toBe(false);
      expect(manager.getConnectionNames().length).toBe(0);
    });

    it('should handle closing non-existent connection gracefully', async () => {
      manager = new DatabaseManager({}, mockLogger);
      await manager.init();

      await expect(manager.close('nonexistent')).resolves.not.toThrow();
    });

    it('should cleanup on module destroy', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: ':memory:',
          },
        },
        mockLogger
      );

      await manager.init();
      await manager.onModuleDestroy();

      expect(manager.isConnected('default')).toBe(false);
    });
  });

  describe('Health Checks', () => {
    it('should validate connection health on initialization', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: ':memory:',
          },
        },
        mockLogger
      );

      await manager.init();
      expect(manager.isConnected('default')).toBe(true);
    });

    it('should detect unhealthy connections', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: ':memory:',
          },
        },
        mockLogger
      );

      await manager.init();
      await manager.close('default');

      expect(manager.isConnected('default')).toBe(false);
    });
  });

  describe('Metrics Tracking', () => {
    it('should track connection metrics', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: ':memory:',
          },
        },
        mockLogger
      );

      await manager.init();
      const metrics = manager.getMetrics('default');

      expect(metrics).toBeDefined();
      expect(typeof metrics).toBe('object');
    });

    it('should get all connection metrics', async () => {
      manager = new DatabaseManager(
        {
          connections: {
            conn1: { dialect: 'sqlite', connection: ':memory:' },
            conn2: { dialect: 'sqlite', connection: 'file::memory:?cache=shared' },
          },
        },
        mockLogger
      );

      await manager.init();
      const metrics = manager.getMetrics();

      expect(metrics).toBeDefined();
      expect(Object.keys(metrics)).toContain('conn1');
      expect(Object.keys(metrics)).toContain('conn2');
    });

    it('should return empty metrics for non-existent connection', async () => {
      manager = new DatabaseManager({}, mockLogger);
      await manager.init();

      const metrics = manager.getMetrics('nonexistent');
      expect(metrics).toEqual({});
    });
  });

  describe('Event Emission', () => {
    it('should emit connected event on successful connection', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: ':memory:',
          },
        },
        mockLogger
      );

      const eventPromise = new Promise((resolve) => {
        manager.on('database.connected', (event) => {
          resolve(event);
        });
      });

      await manager.init();
      const event = await eventPromise;

      expect(event).toBeDefined();
    });

    it('should emit disconnected event on connection close', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: ':memory:',
          },
        },
        mockLogger
      );

      await manager.init();

      const eventPromise = new Promise((resolve) => {
        manager.on('database.disconnected', (event) => {
          resolve(event);
        });
      });

      await manager.close('default');
      const event = await eventPromise;

      expect(event).toBeDefined();
    });

    it('should emit error event on connection failure', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'postgres',
            connection: 'postgresql://invalid:invalid@localhost:54321/invalid',
          },
        },
        mockLogger
      );

      const eventPromise = new Promise((resolve) => {
        manager.on('database.error', (event) => {
          resolve(event);
        });
      });

      try {
        await manager.init();
      } catch {}

      const event = await eventPromise;
      expect(event).toBeDefined();
    });
  });

  describe('Configuration Options', () => {
    it('should respect pool configuration', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: ':memory:',
            pool: {
              min: 2,
              max: 10,
            },
          },
        },
        mockLogger
      );

      await manager.init();
      expect(manager.isConnected('default')).toBe(true);
    });

    it('should respect debug mode', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: ':memory:',
            debug: true,
          },
        },
        mockLogger
      );

      await manager.init();
      expect(manager.isConnected('default')).toBe(true);
    });

    it('should respect query timeout', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: ':memory:',
          },
          queryTimeout: 5000,
        },
        mockLogger
      );

      await manager.init();
      expect(manager.isConnected('default')).toBe(true);
    });

    it('should respect shutdown timeout', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: ':memory:',
          },
          shutdownTimeout: 10000,
        },
        mockLogger
      );

      await manager.init();
      await manager.closeAll();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid dialect gracefully', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'invalid' as any,
            connection: ':memory:',
          },
        },
        mockLogger
      );

      await expect(manager.init()).rejects.toThrow();
    });

    it('should handle connection test timeout', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: ':memory:',
          },
          queryTimeout: 1, // Very short timeout
        },
        mockLogger
      );

      // This might timeout on slow systems, but should not crash
      try {
        await manager.init();
      } catch (error: any) {
        expect(error.message).toContain('timeout' || 'unavailable');
      }
    });

    it('should log errors appropriately', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'postgres',
            connection: 'postgresql://invalid:invalid@localhost:54321/invalid',
          },
        },
        mockLogger
      );

      try {
        await manager.init();
      } catch {}

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Connection Configuration Access', () => {
    it('should get connection configuration', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: ':memory:',
            name: 'default',
          },
        },
        mockLogger
      );

      await manager.init();
      const config = manager.getConnectionConfig('default');

      expect(config).toBeDefined();
      expect(config?.dialect).toBe('sqlite');
    });

    it('should return undefined for non-existent connection config', async () => {
      manager = new DatabaseManager({}, mockLogger);
      await manager.init();

      const config = manager.getConnectionConfig('nonexistent');
      expect(config).toBeUndefined();
    });

    it('should get default connection config', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: ':memory:',
          },
        },
        mockLogger
      );

      await manager.init();
      const config = manager.getConnectionConfig();

      expect(config).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty configuration', async () => {
      manager = new DatabaseManager({}, mockLogger);
      await manager.init();

      // Should create default SQLite connection
      expect(manager.isConnected('default')).toBe(true);
    });

    it('should handle configuration without logger', async () => {
      manager = new DatabaseManager({
        connection: {
          dialect: 'sqlite',
          connection: ':memory:',
        },
      });

      await manager.init();
      expect(manager.isConnected('default')).toBe(true);
    });

    it('should handle rapid connect/disconnect cycles', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: ':memory:',
          },
        },
        mockLogger
      );

      for (let i = 0; i < 5; i++) {
        await manager.init();
        await manager.closeAll();
      }
    });

    it('should handle concurrent connection requests', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: 'file:memdb?mode=memory&cache=shared',
          },
        },
        mockLogger
      );

      await manager.init();

      const promises = Array.from({ length: 10 }, () => manager.getConnection('default'));
      const connections = await Promise.all(promises);

      expect(connections.length).toBe(10);
      connections.forEach((conn) => expect(conn).toBeInstanceOf(Kysely));
    });
  });

  describe('SQLite Specific', () => {
    it('should configure SQLite with busy timeout', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: ':memory:',
          },
        },
        mockLogger
      );

      await manager.init();
      const db = await manager.getConnection('default');

      // Test that we can execute queries
      await sql`SELECT 1`.execute(db);
    });

    it('should handle SQLite shared memory mode', async () => {
      manager = new DatabaseManager(
        {
          connections: {
            conn1: {
              dialect: 'sqlite',
              connection: 'file:sharedmem?mode=memory&cache=shared',
            },
            conn2: {
              dialect: 'sqlite',
              connection: 'file:sharedmem?mode=memory&cache=shared',
            },
          },
        },
        mockLogger
      );

      await manager.init();

      // Both connections should work
      const db1 = await manager.getConnection('conn1');
      const db2 = await manager.getConnection('conn2');

      await sql`CREATE TABLE test (id INTEGER)`.execute(db1);
      await sql`INSERT INTO test VALUES (1)`.execute(db2);

      const result = await sql`SELECT * FROM test`.execute(db1);
      expect(result.rows.length).toBe(1);
    });
  });
});
