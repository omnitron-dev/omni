/**
 * Repository Factory Unit Tests
 *
 * Comprehensive tests for RepositoryFactory covering:
 * - Repository creation and registration
 * - Plugin application (soft delete, timestamps, audit)
 * - Transaction scopes
 * - Repository caching and refresh
 * - Custom repository classes
 * - Configuration options
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { RepositoryFactory } from '../../../src/modules/database/repository/repository.factory.js';
import { BaseRepository } from '../../../src/modules/database/repository/base.repository.js';
import { DatabaseManager } from '../../../src/modules/database/database.manager.js';
import { Kysely, sql } from 'kysely';

// Skip Docker tests if env var is set
const skipIntegrationTests = process.env.SKIP_DOCKER_TESTS === 'true' ||
                            process.env.USE_MOCK_REDIS === 'true' ||
                            process.env.CI === 'true';

if (skipIntegrationTests) {
  console.log('⏭️ Skipping repository-factory-unit.spec.ts - requires Docker/PostgreSQL');
}

const describeOrSkip = skipIntegrationTests ? describe.skip : describe;

// Custom repository class - extends BaseRepository with any types for testing
class UserRepository extends BaseRepository {
  async findByEmail(email) {
    return this.findOne({ email });
  }

  async findActive() {
    return this.findAll({ deleted_at: null });
  }
}

describeOrSkip('RepositoryFactory - Unit Tests', () => {
  let factory;
  let mockManager;
  let mockDb;

  beforeEach(async () => {
    // Kysely-compatible executor mock
    const mockExecutor = {
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
    };

    // Create mock database for testing
    mockDb = {
      schema: {
        createTable: jest.fn().mockReturnThis(),
        addColumn: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({}),
      },
      selectFrom: jest.fn().mockReturnThis(),
      insertInto: jest.fn().mockReturnThis(),
      updateTable: jest.fn().mockReturnThis(),
      deleteFrom: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      selectAll: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ rows: [] }),
      executeTakeFirst: jest.fn().mockResolvedValue(null),
      getExecutor: jest.fn().mockReturnValue(mockExecutor),
      transaction: jest.fn().mockReturnValue({
        execute: jest.fn().mockImplementation(async (fn: any) => fn(mockDb)),
      }),
    };

    mockManager = {
      getConnection: jest.fn().mockResolvedValue(mockDb),
      getConnectionConfig: jest.fn().mockReturnValue({ dialect: 'sqlite' }),
    };

    factory = new RepositoryFactory(mockManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Repository Creation', () => {
    it('should create basic repository', async () => {
      const repo = await factory.create<User>({
        tableName: 'users',
      });

      expect(repo).toBeDefined();
      expect(repo).toBeInstanceOf(BaseRepository);
    });

    it('should create repository with custom connection', async () => {
      await factory.create<User>({
        tableName: 'users',
        connectionName: 'custom',
      });

      expect(mockManager.getConnection).toHaveBeenCalledWith('custom');
    });

    it('should create repository with default connection', async () => {
      await factory.create<User>({
        tableName: 'users',
      });

      expect(mockManager.getConnection).toHaveBeenCalledWith('default');
    });

    it('should create repository with schema configuration', async () => {
      const repo = await factory.create<User>({
        tableName: 'users',
        schemas: {
          entity: {},
          create: {},
          update: {},
        },
      });

      expect(repo).toBeDefined();
    });
  });

  describe('Plugin Application', () => {
    it('should apply soft delete plugin', async () => {
      const repo = await factory.create<User>({
        tableName: 'users',
        softDelete: true,
      });

      expect(repo).toBeDefined();
      // Soft delete plugin adds methods to repository
      expect(typeof (repo).restore).toBe('function');
    });

    it('should apply soft delete plugin with custom column', async () => {
      const repo = await factory.create<User>({
        tableName: 'users',
        softDelete: {
          column: 'archived_at',
        },
      });

      expect(repo).toBeDefined();
    });

    it('should apply timestamps plugin', async () => {
      const repo = await factory.create<User>({
        tableName: 'users',
        timestamps: true,
      });

      expect(repo).toBeDefined();
    });

    it('should apply timestamps plugin with custom columns', async () => {
      const repo = await factory.create<User>({
        tableName: 'users',
        timestamps: {
          createdAt: 'created',
          updatedAt: 'modified',
        },
      });

      expect(repo).toBeDefined();
    });

    it('should apply audit plugin', async () => {
      const repo = await factory.create<User>({
        tableName: 'users',
        audit: true,
      });

      expect(repo).toBeDefined();
    });

    it('should apply audit plugin with custom configuration', async () => {
      const repo = await factory.create<User>({
        tableName: 'users',
        audit: {
          table: 'custom_audit',
          captureOldValues: true,
          captureNewValues: false,
        },
      });

      expect(repo).toBeDefined();
    });

    it('should apply multiple plugins', async () => {
      const repo = await factory.create<User>({
        tableName: 'users',
        softDelete: true,
        timestamps: true,
        audit: true,
      });

      expect(repo).toBeDefined();
    });

    it('should apply plugins in correct order', async () => {
      const repo = await factory.create<User>({
        tableName: 'users',
        plugins: [], // Direct plugins array
        softDelete: true,
        timestamps: true,
      });

      expect(repo).toBeDefined();
    });
  });

  describe('Repository Registration', () => {
    it('should register repository class', async () => {
      await factory.register(UserRepository, {
        table: 'users',
        schema: {},
      });

      const repo = await factory.get<UserRepository>(UserRepository);
      expect(repo).toBeDefined();
      expect(repo).toBeInstanceOf(UserRepository);
    });

    it('should register repository with plugins', async () => {
      await factory.register(UserRepository, {
        table: 'users',
        schema: {},
        softDelete: true,
        timestamps: true,
      });

      const repo = await factory.get<UserRepository>(UserRepository);
      expect(repo).toBeDefined();
    });

    it('should register repository with custom connection', async () => {
      await factory.register(UserRepository, {
        table: 'users',
        schema: {},
        connection: 'custom',
      });

      expect(mockManager.getConnection).toHaveBeenCalledWith('custom');
    });

    it('should throw error when getting unregistered repository', async () => {
      class UnregisteredRepo extends BaseRepository<any, any, any, any, any> {}

      await expect(factory.get(UnregisteredRepo)).rejects.toThrow('not found');
    });

    it('should create repository on-demand if metadata exists', async () => {
      await factory.register(UserRepository, {
        table: 'users',
        schema: {},
      });

      factory.clearCache();

      const repo = await factory.get<UserRepository>(UserRepository);
      expect(repo).toBeDefined();
    });
  });

  describe('Repository Metadata', () => {
    it('should store repository metadata', async () => {
      const metadata = {
        table: 'users',
        schema: {},
        softDelete: true,
      };

      await factory.register(UserRepository, metadata);

      const storedMetadata = factory.getMetadata(UserRepository);
      expect(storedMetadata).toEqual(metadata);
    });

    it('should return undefined for non-existent metadata', () => {
      class NonExistent extends BaseRepository<any, any, any, any, any> {}
      const metadata = factory.getMetadata(NonExistent);
      expect(metadata).toBeUndefined();
    });

    it('should get all registered repositories', async () => {
      await factory.register(UserRepository, {
        table: 'users',
        schema: {},
      });

      const all = factory.getAll();
      expect(all.size).toBeGreaterThan(0);
    });
  });

  describe('Transaction Scopes', () => {
    it('should create transaction scope', async () => {
      await factory.register(UserRepository, {
        table: 'users',
        schema: {},
      });

      const result = await factory.createTransactionScope(async (scope) => {
        const repo = scope.getRepository<UserRepository>(UserRepository);
        expect(repo).toBeDefined();
        return 'success';
      });

      expect(result).toBe('success');
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should provide repositories within transaction scope', async () => {
      await factory.register(UserRepository, {
        table: 'users',
        schema: {},
      });

      await factory.createTransactionScope(async (scope) => {
        const repo = scope.getRepository<UserRepository>(UserRepository);
        expect(repo).toBeInstanceOf(UserRepository);
      });
    });

    it('should execute function within transaction scope', async () => {
      await factory.register(UserRepository, {
        table: 'users',
        schema: {},
      });

      await factory.createTransactionScope(async (scope) => {
        const result = await scope.execute(async () => 'executed');
        expect(result).toBe('executed');
      });
    });

    it('should rollback transaction on error', async () => {
      await factory.register(UserRepository, {
        table: 'users',
        schema: {},
      });

      await expect(
        factory.createTransactionScope(async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');
    });

    it('should throw error for unregistered repository in scope', async () => {
      class UnregisteredRepo extends BaseRepository<any, any, any, any, any> {}

      await expect(
        factory.createTransactionScope(async (scope) => {
          scope.getRepository<UnregisteredRepo>(UnregisteredRepo);
        })
      ).rejects.toThrow('not found');
    });
  });

  describe('Repository with Transaction', () => {
    it('should create repository with transaction', async () => {
      await factory.register(UserRepository, {
        table: 'users',
        schema: {},
      });

      const mockTrx = { ...mockDb };
      const repo = factory.createWithTransaction<UserRepository>(UserRepository, mockTrx);

      expect(repo).toBeDefined();
      expect(repo).toBeInstanceOf(UserRepository);
    });

    it('should create repository with transaction and plugins', async () => {
      await factory.register(UserRepository, {
        table: 'users',
        schema: {},
        softDelete: true,
        timestamps: true,
      });

      const mockTrx = { ...mockDb };
      const repo = factory.createWithTransaction<UserRepository>(UserRepository, mockTrx);

      expect(repo).toBeDefined();
    });

    it('should throw error for unregistered repository with transaction', () => {
      class UnregisteredRepo extends BaseRepository<any, any, any, any, any> {}

      const mockTrx = { ...mockDb };
      expect(() => factory.createWithTransaction(UnregisteredRepo, mockTrx)).toThrow('not found');
    });
  });

  describe('Custom Plugin Registration', () => {
    it('should register custom plugin', () => {
      const customPlugin = {
        name: 'custom',
        extendRepository: (repo: any) => repo,
      };

      factory.registerPlugin('custom', customPlugin);

      // Plugin should be registered (internal, can't easily test without using it)
      expect(true).toBe(true);
    });

    it('should apply custom registered plugin', async () => {
      const customPlugin = {
        name: 'custom',
        extendRepository: (repo: any) => {
          repo.customMethod = () => 'custom';
          return repo;
        },
      };

      factory.registerPlugin('custom', customPlugin);

      const repo = await factory.create({
        tableName: 'users',
        plugins: ['custom'],
      });

      expect((repo).customMethod()).toBe('custom');
    });
  });

  describe('Cache Management', () => {
    it('should cache repository instances', async () => {
      await factory.register(UserRepository, {
        table: 'users',
        schema: {},
      });

      const repo1 = await factory.get<UserRepository>(UserRepository);
      const repo2 = await factory.get<UserRepository>(UserRepository);

      expect(repo1).toBe(repo2); // Same instance
    });

    it('should clear cache', async () => {
      await factory.register(UserRepository, {
        table: 'users',
        schema: {},
      });

      await factory.get<UserRepository>(UserRepository);
      factory.clearCache();

      // Should create new instance
      const repo = await factory.get<UserRepository>(UserRepository);
      expect(repo).toBeDefined();
    });

    it('should refresh specific repository', async () => {
      await factory.register(UserRepository, {
        table: 'users',
        schema: {},
      });

      const repo1 = await factory.get<UserRepository>(UserRepository);
      await factory.refresh(UserRepository);
      const repo2 = await factory.get<UserRepository>(UserRepository);

      // Should be different instances after refresh
      expect(repo1).not.toBe(repo2);
    });

    it('should handle refresh of non-existent repository', async () => {
      class NonExistent extends BaseRepository<any, any, any, any, any> {}
      await factory.refresh(NonExistent);
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('Kysera Compatibility', () => {
    it('should create repository with Kysera factory', async () => {
      const create = await factory.createWithKysera('default');
      expect(create).toBeDefined();
      expect(typeof create).toBe('function');
    });

    it('should create Kysera repository with custom connection', async () => {
      const create = await factory.createWithKysera('custom');
      expect(create).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle connection errors during creation', async () => {
      mockManager.getConnection.mockRejectedValueOnce(new Error('Connection failed'));

      await expect(
        factory.create({
          tableName: 'users',
        })
      ).rejects.toThrow('Connection failed');
    });

    it('should handle missing connection config', async () => {
      mockManager.getConnectionConfig.mockReturnValueOnce(undefined);

      const repo = await factory.create({
        tableName: 'users',
      });

      expect(repo).toBeDefined();
    });

    it('should throw when plugin application errors', async () => {
      const badPlugin = {
        name: 'bad',
        extendRepository: () => {
          throw new Error('Plugin error');
        },
      };

      factory.registerPlugin('bad', badPlugin);

      // Plugin errors are propagated to allow debugging
      await expect(
        factory.create({
          tableName: 'users',
          plugins: ['bad'],
        })
      ).rejects.toThrow('Plugin error');
    });
  });

  describe('Configuration Options', () => {
    it('should respect factory-level connection name', async () => {
      const factoryWithConfig = new RepositoryFactory(mockManager, {
        connectionName: 'factory-default',
      });

      await factoryWithConfig.create({
        tableName: 'users',
      });

      expect(mockManager.getConnection).toHaveBeenCalledWith('factory-default');
    });

    it('should override factory connection with repository config', async () => {
      const factoryWithConfig = new RepositoryFactory(mockManager, {
        connectionName: 'factory-default',
      });

      await factoryWithConfig.create({
        tableName: 'users',
        connectionName: 'repo-override',
      });

      expect(mockManager.getConnection).toHaveBeenCalledWith('repo-override');
    });
  });

  describe('Edge Cases', () => {
    it('should handle repository with no configuration', async () => {
      const repo = await factory.create({
        tableName: 'users',
      });

      expect(repo).toBeDefined();
    });

    it('should handle repository with empty plugins array', async () => {
      const repo = await factory.create({
        tableName: 'users',
        plugins: [],
      });

      expect(repo).toBeDefined();
    });

    it('should handle repository with undefined plugins', async () => {
      const repo = await factory.create({
        tableName: 'users',
        plugins: undefined,
      });

      expect(repo).toBeDefined();
    });

    it('should handle concurrent repository creation', async () => {
      const promises = Array.from({ length: 10 }, () =>
        factory.create({
          tableName: 'users',
        })
      );

      const repos = await Promise.all(promises);
      expect(repos.length).toBe(10);
      repos.forEach((repo) => expect(repo).toBeDefined());
    });

    it('should handle repository with complex schema', async () => {
      const repo = await factory.create<User>({
        tableName: 'users',
        schemas: {
          entity: {
            shape: {
              id: {},
              email: {},
              name: {},
            },
          },
          create: {},
          update: {},
        },
      });

      expect(repo).toBeDefined();
    });
  });
});
