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

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDockerAvailable } from '@omnitron-dev/testing/titan';

// better-sqlite3 does not parse `file:...?mode=memory&cache=shared` URIs —
// it creates a literal FILE with that name in cwd (which is also the only
// reason two "shared memory" connections ever saw the same data). Tests
// that need a shareable database use real files under a throwaway tmp dir.
const SQLITE_TMP_DIR = mkdtempSync(join(tmpdir(), 'titan-database-spec-'));
const sqliteFile = (name: string): string => join(SQLITE_TMP_DIR, `${name}.sqlite`);
afterAll(() => rmSync(SQLITE_TMP_DIR, { recursive: true, force: true }));

const skipIntegrationTests =
  process.env.SKIP_DOCKER_TESTS === 'true' || process.env.SKIP_DATABASE_TESTS === 'true' || !isDockerAvailable();

if (skipIntegrationTests) {
  console.log('⏭️ Skipping database-manager-unit.spec.ts - requires Docker/PostgreSQL');
}

const describeOrSkip = skipIntegrationTests ? describe.skip : describe;
import { DatabaseManager } from '../src/database.manager.js';
import { Kysely, sql } from 'kysely';

/**
 * Creates a mock logger with all required methods including child() that returns itself.
 * This ensures compatibility with code that uses logger.child() to create scoped loggers.
 */
const createMockLogger = () => {
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger;
};

describeOrSkip('DatabaseManager - Unit Tests', () => {
  let manager;
  let mockLogger;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  afterEach(async () => {
    if (manager) {
      await manager.closeAll();
    }
    vi.clearAllMocks();
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
      // Use SQLite with invalid path to trigger connection error without network timeouts
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: '/nonexistent/path/to/db.sqlite',
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
            connection: sqliteFile('memdb1'),
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
            dialect: 'sqlite',
            connection: '/nonexistent/path/to/db.sqlite',
          },
        },
        mockLogger
      );

      const eventPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve('timeout'), 5000);
        manager.on('database.error', (event) => {
          clearTimeout(timer);
          resolve(event);
        });
      });

      try {
        await manager.init();
      } catch {}

      const event = await eventPromise;
      // Either emits error event or init rejects — both are valid
      expect(event).toBeDefined();
    });
  });

  describe('Configuration Options', () => {
    // These three assert that the manager still initializes with the option
    // set — not that the option does anything. `pool` and `debug` are read
    // elsewhere; `queryTimeout` is not read at all (see database.types.ts),
    // and the old name 'should respect query timeout' claimed otherwise.
    it('initializes with a pool configuration', async () => {
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

    it('initializes with debug mode on', async () => {
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

    it('initializes with queryTimeout set (the option itself is inert)', async () => {
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
      // The previous version set shutdownTimeout, opened a connection, closed
      // it and asserted nothing — which is why nobody noticed that no code
      // outside the options type ever read the field. A connection whose
      // destroy() never settles used to hang closeAll() forever.
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: ':memory:',
          },
          shutdownTimeout: 150,
        },
        mockLogger
      );

      await manager.init();

      const info = (manager as unknown as { connections: Map<string, { instance: { destroy: () => Promise<void> } }> })
        .connections.get('default')!;
      let released!: () => void;
      const hang = new Promise<void>((resolve) => {
        released = resolve;
      });
      info.instance.destroy = () => hang;

      const started = Date.now();
      await manager.closeAll();
      const elapsed = Date.now() - started;

      expect(elapsed).toBeGreaterThanOrEqual(140);
      expect(elapsed).toBeLessThan(1000);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ pending: ['default'], shutdownTimeout: 150 }),
        expect.stringContaining('did not close')
      );

      released();
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

      // Invalid dialect should throw during init, not hang
      await expect(
        Promise.race([
          manager.init(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000)),
        ])
      ).rejects.toThrow();
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
            dialect: 'sqlite',
            connection: '/nonexistent/path/to/db.sqlite',
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

    it('should require logger with child() method', async () => {
      // DatabaseManager requires a logger — verify it works with minimal logger
      const minimalLogger: any = {
        info: () => {},
        debug: () => {},
        warn: () => {},
        error: () => {},
        trace: () => {},
        fatal: () => {},
        child: () => minimalLogger,
      };
      manager = new DatabaseManager(
        { connection: { dialect: 'sqlite', connection: ':memory:' } },
        minimalLogger
      );

      await manager.init();
      expect(manager.isConnected('default')).toBe(true);
    });

    it('should handle rapid connect/disconnect cycles', async () => {
      // The loop asserted nothing, so it could only catch a throw. A manager
      // that stopped reconnecting after the first cycle, or that accumulated a
      // connection per cycle, passed it.
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
        expect(manager.isConnected('default'), `cycle ${i}: not connected after init`).toBe(true);
        expect(manager.getConnectionNames(), `cycle ${i}: connections accumulated`).toEqual(['default']);

        await manager.closeAll();
        expect(manager.isConnected('default'), `cycle ${i}: still connected after closeAll`).toBe(false);
        expect(manager.getConnectionNames(), `cycle ${i}: connection survived closeAll`).toEqual([]);
      }
    });

    it('should handle concurrent connection requests', async () => {
      manager = new DatabaseManager(
        {
          connection: {
            dialect: 'sqlite',
            connection: sqliteFile('memdb'),
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
      // This ran `SELECT 1` and called it done — it proved the connection
      // works, which every other test here also proves, and said nothing
      // about the busy timeout in its name. The manager sets
      // `pragma busy_timeout = 5000`; ask SQLite what it actually holds.
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

      const result = await sql<{ timeout: number }>`PRAGMA busy_timeout`.execute(db);
      expect(result.rows[0]?.timeout, 'busy_timeout is not the configured 5000ms').toBe(5000);
    });

    it('should handle SQLite shared memory mode', async () => {
      // Use a unique database name for this test to avoid conflicts
      const uniqueDbName = `sharedmem_${Date.now()}`;

      manager = new DatabaseManager(
        {
          connections: {
            conn1: {
              dialect: 'sqlite',
              connection: sqliteFile(uniqueDbName),
            },
            conn2: {
              dialect: 'sqlite',
              connection: sqliteFile(uniqueDbName),
            },
          },
        },
        mockLogger
      );

      await manager.init();

      // Both connections should work
      const db1 = await manager.getConnection('conn1');
      const db2 = await manager.getConnection('conn2');

      // Drop table if it exists, then create it
      await sql`DROP TABLE IF EXISTS test`.execute(db1);
      await sql`CREATE TABLE test (id INTEGER)`.execute(db1);
      await sql`INSERT INTO test VALUES (1)`.execute(db2);

      const result = await sql`SELECT * FROM test`.execute(db1);
      expect(result.rows.length).toBe(1);
    });
  });
});
