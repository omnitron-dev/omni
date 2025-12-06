/**
 * Comprehensive Kysera Integration Tests
 *
 * Tests the full integration of @kysera/* packages with Titan Database Module
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Kysely, sql } from 'kysely';
import {
  // Core services
  DatabaseManager,
  DatabaseService,
  RepositoryFactory,
  BaseRepository,
  DatabaseTestingService,

  // Kysera core utilities
  withRetry,
  isTransientError,
  CircuitBreaker,
  parseDatabaseError,
  paginate,
  paginateCursor,
  UniqueConstraintError,
  ForeignKeyError,

  // Kysera testing utilities
  testInTransaction,
  cleanDatabase,
  snapshotTable,
  countRows,
  createFactory,

  // Kysera plugins
  softDeletePlugin,
  timestampsPlugin,
  auditPlugin,

  // Multi-repository factory
  createMultiRepositoryFactory,
  createKyseraRepositoryFactory,
} from '../../../src/modules/database/index.js';

// Test database interface
interface TestDatabase {
  users: {
    id: number;
    email: string;
    name: string;
    created_at?: string;
    updated_at?: string;
    deleted_at?: string | null;
  };
  posts: {
    id: number;
    user_id: number;
    title: string;
    content: string;
    created_at?: string;
  };
}

describe('Kysera Integration Tests', () => {
  let manager: DatabaseManager;
  let db: Kysely<TestDatabase>;

  beforeAll(async () => {
    // Create in-memory SQLite database for testing
    manager = new DatabaseManager({
      connection: {
        dialect: 'sqlite',
        connection: ':memory:',
      },
    });
    await manager.init();
    db = (await manager.getConnection()) as Kysely<TestDatabase>;

    // Create test tables
    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('email', 'text', (col) => col.notNull().unique())
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('created_at', 'text')
      .addColumn('updated_at', 'text')
      .addColumn('deleted_at', 'text')
      .execute();

    await db.schema
      .createTable('posts')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('user_id', 'integer', (col) => col.notNull())
      .addColumn('title', 'text', (col) => col.notNull())
      .addColumn('content', 'text')
      .addColumn('created_at', 'text')
      .execute();
  });

  afterAll(async () => {
    await manager.closeAll();
  });

  beforeEach(async () => {
    // Clean tables before each test
    await db.deleteFrom('posts').execute();
    await db.deleteFrom('users').execute();
  });

  // ===========================================================================
  // KYSERA CORE: Error Handling Tests
  // ===========================================================================
  describe('@kysera/core - Error Handling', () => {
    it('should parse unique constraint errors correctly', async () => {
      await db.insertInto('users').values({ email: 'test@example.com', name: 'Test' }).execute();

      try {
        await db.insertInto('users').values({ email: 'test@example.com', name: 'Duplicate' }).execute();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        const parsed = parseDatabaseError(error, 'sqlite');
        expect(parsed).toBeDefined();
        // SQLite unique constraint error
        expect(parsed.message).toContain('UNIQUE');
      }
    });

    it('should detect transient errors correctly', () => {
      const transientError = { code: 'ECONNREFUSED' };
      const nonTransientError = { code: 'SYNTAX_ERROR' };

      expect(isTransientError(transientError)).toBe(true);
      expect(isTransientError(nonTransientError)).toBe(false);
    });
  });

  // ===========================================================================
  // KYSERA CORE: Retry & Circuit Breaker Tests
  // ===========================================================================
  describe('@kysera/core - Retry & Circuit Breaker', () => {
    it('should retry on transient errors', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 3) {
          const error = new Error('Connection refused') as Error & { code: string };
          error.code = 'ECONNREFUSED';
          throw error;
        }
        return 'success';
      };

      const result = await withRetry(fn, {
        maxAttempts: 5,
        delayMs: 10,
        shouldRetry: isTransientError,
      });

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should implement circuit breaker pattern', async () => {
      const breaker = new CircuitBreaker(3, 1000);

      // Fail 3 times to open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch {
          // Expected
        }
      }

      // Circuit should be open now
      const state = breaker.getState();
      expect(state.state).toBe('open');

      // Should fail fast without executing
      await expect(
        breaker.execute(async () => 'should not run')
      ).rejects.toThrow('Circuit breaker is open');

      // Reset and verify
      breaker.reset();
      expect(breaker.getState().state).toBe('closed');
    });
  });

  // ===========================================================================
  // KYSERA CORE: Pagination Tests
  // ===========================================================================
  describe('@kysera/core - Pagination', () => {
    beforeEach(async () => {
      // Insert test data
      for (let i = 1; i <= 25; i++) {
        await db.insertInto('users').values({
          email: `user${i}@example.com`,
          name: `User ${i}`,
        }).execute();
      }
    });

    it('should paginate with offset', async () => {
      const query = db.selectFrom('users').selectAll().orderBy('id');
      const result = await paginate(query, { page: 2, limit: 10 });

      expect(result.data.length).toBe(10);
      expect(result.pagination.page).toBe(2);
      expect(result.pagination.total).toBe(25);
      expect(result.pagination.totalPages).toBe(3);
      expect(result.pagination.hasNext).toBe(true);
    });

    it('should paginate with cursor', async () => {
      const query = db.selectFrom('users').selectAll();
      const result = await paginateCursor(query, {
        limit: 10,
        orderBy: [{ column: 'id', direction: 'asc' }],
      });

      expect(result.data.length).toBe(10);
      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.nextCursor).toBeDefined();
    });
  });

  // ===========================================================================
  // KYSERA CORE: Testing Utilities Tests
  // ===========================================================================
  describe('@kysera/core - Testing Utilities', () => {
    it('should run test in transaction with auto-rollback', async () => {
      // Insert a user before the transaction test
      await db.insertInto('users').values({ email: 'before@test.com', name: 'Before' }).execute();
      const beforeCount = await countRows(db, 'users');
      expect(beforeCount).toBe(1);

      // Run in transaction - changes should rollback
      await testInTransaction(db, async (trx) => {
        await trx.insertInto('users').values({ email: 'inside@test.com', name: 'Inside' }).execute();
        const insideCount = Number(
          (await trx.selectFrom('users').select(sql`count(*)`.as('count')).executeTakeFirst())?.count || 0
        );
        expect(insideCount).toBe(2);
      });

      // Verify rollback - only original user should exist
      const afterCount = await countRows(db, 'users');
      expect(afterCount).toBe(1);
    });

    it('should snapshot table data', async () => {
      await db.insertInto('users').values([
        { email: 'user1@test.com', name: 'User 1' },
        { email: 'user2@test.com', name: 'User 2' },
      ]).execute();

      const snapshot = await snapshotTable(db, 'users');
      expect(snapshot.length).toBe(2);
    });

    it('should create test data with factory', () => {
      let counter = 0;
      const createUser = createFactory({
        id: () => ++counter,
        email: () => `user${counter}@factory.com`,
        name: 'Factory User',
      });

      const user1 = createUser();
      const user2 = createUser({ name: 'Custom Name' });

      expect(user1.id).toBe(1);
      expect(user1.email).toBe('user1@factory.com');
      expect(user1.name).toBe('Factory User');

      expect(user2.id).toBe(2);
      expect(user2.name).toBe('Custom Name');
    });
  });

  // ===========================================================================
  // KYSERA PLUGINS: Soft Delete Tests
  // ===========================================================================
  describe('@kysera/soft-delete - Plugin', () => {
    it('should soft delete records', async () => {
      // Create plugin
      const plugin = softDeletePlugin({
        deletedAtColumn: 'deleted_at',
        tables: ['users'],
      });

      expect(plugin.name).toBe('soft-delete');

      // Insert a user
      const [user] = await db.insertInto('users')
        .values({ email: 'soft@test.com', name: 'Soft Delete Test' })
        .returningAll()
        .execute();

      // Verify plugin methods
      const mockRepo = {
        tableName: 'users',
        executor: db,
        findById: async (id: number) => {
          return db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
        },
        update: async (id: number, data: unknown) => {
          return db.updateTable('users').set(data as never).where('id', '=', id).returningAll().executeTakeFirst();
        },
      };

      const extended = plugin.extendRepository!(mockRepo);
      expect(extended.softDelete).toBeDefined();
      expect(extended.restore).toBeDefined();
      expect(extended.hardDelete).toBeDefined();
    });
  });

  // ===========================================================================
  // KYSERA PLUGINS: Timestamps Tests
  // ===========================================================================
  describe('@kysera/timestamps - Plugin', () => {
    it('should add timestamp methods', () => {
      const plugin = timestampsPlugin({
        createdAtColumn: 'created_at',
        updatedAtColumn: 'updated_at',
        tables: ['users'],
      });

      expect(plugin.name).toBe('timestamps');

      const mockRepo = {
        tableName: 'users',
        executor: db,
        create: async (data: unknown) => data,
        update: async (_id: number, data: unknown) => data,
      };

      const extended = plugin.extendRepository!(mockRepo);
      expect(extended.findRecentlyCreated).toBeDefined();
      expect(extended.findRecentlyUpdated).toBeDefined();
      expect(extended.touch).toBeDefined();
    });
  });

  // ===========================================================================
  // MULTI-REPOSITORY FACTORY Tests
  // ===========================================================================
  describe('Multi-Repository Factory Pattern', () => {
    it('should create repositories from factory', async () => {
      // Define simple repository factories
      const createUserRepo = (executor: Kysely<unknown>) => ({
        tableName: 'users',
        findAll: () => executor.selectFrom('users' as never).selectAll().execute(),
        create: (data: { email: string; name: string }) =>
          executor.insertInto('users' as never).values(data as never).returningAll().executeTakeFirst(),
      });

      const createPostRepo = (executor: Kysely<unknown>) => ({
        tableName: 'posts',
        findAll: () => executor.selectFrom('posts' as never).selectAll().execute(),
        create: (data: { user_id: number; title: string; content: string }) =>
          executor.insertInto('posts' as never).values(data as never).returningAll().executeTakeFirst(),
      });

      // Create multi-repository factory
      const createRepos = createMultiRepositoryFactory<TestDatabase, {
        users: ReturnType<typeof createUserRepo>;
        posts: ReturnType<typeof createPostRepo>;
      }>({
        users: createUserRepo as never,
        posts: createPostRepo as never,
      });

      // Use factory
      const repos = createRepos(db);

      // Create user
      await repos.users.create({ email: 'multi@test.com', name: 'Multi Test' });
      const users = await repos.users.findAll();
      expect(users.length).toBe(1);

      // Create post
      await repos.posts.create({ user_id: 1, title: 'Test Post', content: 'Content' });
      const posts = await repos.posts.findAll();
      expect(posts.length).toBe(1);
    });

    it('should work with transactions', async () => {
      const createUserRepo = (executor: Kysely<unknown>) => ({
        findAll: () => executor.selectFrom('users' as never).selectAll().execute(),
        create: (data: { email: string; name: string }) =>
          executor.insertInto('users' as never).values(data as never).execute(),
      });

      const createRepos = createMultiRepositoryFactory<TestDatabase, {
        users: ReturnType<typeof createUserRepo>;
      }>({
        users: createUserRepo as never,
      });

      // Use in transaction
      await db.transaction().execute(async (trx) => {
        const txRepos = createRepos(trx);
        await txRepos.users.create({ email: 'tx@test.com', name: 'TX User' });

        const users = await txRepos.users.findAll();
        expect(users.length).toBe(1);
      });

      // Verify commit
      const finalUsers = await db.selectFrom('users').selectAll().execute();
      expect(finalUsers.length).toBe(1);
    });
  });

  // ===========================================================================
  // DATABASE SERVICE: Kysera Integration Tests
  // ===========================================================================
  describe('DatabaseService - Kysera Integration', () => {
    let service: DatabaseService;

    beforeAll(() => {
      service = new DatabaseService(manager);
    });

    it('should execute with retry', async () => {
      let attempts = 0;
      const result = await service.executeWithRetry(
        async (dbConn) => {
          attempts++;
          return dbConn.selectFrom('users' as never).selectAll().execute();
        },
        { maxAttempts: 3, delayMs: 10 }
      );

      expect(Array.isArray(result)).toBe(true);
      expect(attempts).toBe(1); // Should succeed on first try
    });

    it('should manage circuit breakers', () => {
      const breaker = service.getCircuitBreaker('default', { threshold: 5 });
      expect(breaker).toBeDefined();

      const state = service.getCircuitBreakerState('default');
      expect(state).toBeDefined();
      expect(state?.state).toBe('closed');

      service.resetCircuitBreaker('default');
      expect(service.getCircuitBreakerState('default')?.failures).toBe(0);
    });

    it('should check transient errors', () => {
      const transient = { code: 'ETIMEDOUT' };
      const nonTransient = { message: 'Syntax error' };

      expect(service.isTransientError(transient)).toBe(true);
      expect(service.isTransientError(nonTransient)).toBe(false);
    });
  });

  // ===========================================================================
  // REPOSITORY FACTORY: Kysera Integration Tests
  // ===========================================================================
  describe('RepositoryFactory - Kysera Integration', () => {
    let factory: RepositoryFactory;

    beforeAll(() => {
      factory = new RepositoryFactory(manager);
    });

    it('should create repository with plugins', async () => {
      const repo = await factory.create({
        tableName: 'users',
        softDelete: true,
        timestamps: true,
      });

      expect(repo).toBeDefined();
      expect(repo.tableName).toBe('users');
    });

    it('should create multi-repository factory', async () => {
      const createRepos = factory.createRepositoriesFactory({
        users: async (executor) => new BaseRepository(executor, { tableName: 'users' }),
      });

      const repos = await createRepos();
      expect(repos.users).toBeDefined();
    });

    it('should get Kysera factory for direct usage', async () => {
      const kyseraFactory = await factory.getKyseraFactory();
      expect(kyseraFactory).toBeDefined();
      expect(typeof kyseraFactory.create).toBe('function');
    });
  });
});
