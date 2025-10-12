/**
 * Advanced Database Features Tests
 *
 * Tests for Phase 6 advanced features including health monitoring,
 * direct query builder access, and pagination
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import { Application } from '../../../src/application.js';
import { Module, Injectable } from '../../../src/decorators/index.js';
import { Kysely, sql } from 'kysely';
import {
  TitanDatabaseModule,
  InjectConnection,
  InjectDatabaseManager,
  InjectRepository,
  Repository,
  BaseRepository,
  Paginated,
  DatabaseHealthIndicator,
  DATABASE_MANAGER,
  DATABASE_TRANSACTION_MANAGER,
} from '../../../src/modules/database/index.js';
import { DockerTestManager, DockerContainer } from '../../utils/docker-test-manager.js';

// Test entity
interface User {
  id: number;
  email: string;
  name: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface Profile {
  id: number;
  user_id: number;
  bio: string;
  avatar_url?: string;
}

// Test repository
@Repository<User>({
  table: 'users',
  timestamps: true,
})
class UserRepository extends BaseRepository<any, 'users', User, any, any> {}

@Repository<Profile>({
  table: 'profiles',
})
class ProfileRepository extends BaseRepository<any, 'profiles', Profile, any, any> {}

// Test service with direct query builder access
@Injectable()
class AdvancedUserService {
  constructor(
    @InjectConnection() private db: Kysely<any>,
    @InjectConnection('replica') private replica?: Kysely<any>,
    @InjectRepository(UserRepository) private userRepo: UserRepository,
    @InjectRepository(ProfileRepository) private profileRepo: ProfileRepository,
    @InjectDatabaseManager() private dbManager: any
  ) {}

  /**
   * Complex query using direct Kysely query builder
   */
  async getUsersWithProfiles(): Promise<any[]> {
    return this.db
      .selectFrom('users')
      .innerJoin('profiles', 'users.id', 'profiles.user_id')
      .where('users.active', '=', true)
      .select(['users.id', 'users.email', 'users.name', 'profiles.bio', 'profiles.avatar_url'])
      .execute();
  }

  /**
   * Read from replica if available
   */
  async getUsersFromReplica(): Promise<User[]> {
    const db = this.replica || this.db;
    return db.selectFrom('users').selectAll().execute();
  }

  /**
   * Paginated user list
   */
  @Paginated({ defaultLimit: 10, maxLimit: 50 })
  async listUsers(options?: any): Promise<any> {
    return this.userRepo.paginate(options);
  }

  /**
   * Custom aggregation query
   */
  async getUserStatistics(): Promise<any> {
    const result = await this.db
      .selectFrom('users')
      .select([
        sql<number>`count(*)`.as('total'),
        sql<number>`count(case when active = true then 1 end)`.as('active'),
        sql<number>`count(case when active = false then 1 end)`.as('inactive'),
      ])
      .executeTakeFirst();

    return result;
  }

  /**
   * Batch insert users
   */
  async batchInsertUsers(users: Partial<User>[]): Promise<void> {
    await this.db
      .insertInto('users')
      .values(
        users.map((u) => ({
          ...u,
          created_at: new Date(),
          updated_at: new Date(),
        }))
      )
      .execute();
  }
}

// Test module
@Module({
  imports: [TitanDatabaseModule.forFeature([UserRepository, ProfileRepository])],
  providers: [AdvancedUserService],
})
class TestModule {}

describe('Advanced Database Features', () => {
  describe('Health Monitoring', () => {
    let app: Application;
    let healthIndicator: DatabaseHealthIndicator;

    beforeEach(async () => {
      app = await Application.create({
        imports: [
          TitanDatabaseModule.forRoot({
            connection: {
              dialect: 'sqlite',
              database: ':memory:',
            },
            isGlobal: true,
          }),
        ],
      });

      await app.start();
      healthIndicator = await app.get(DatabaseHealthIndicator);

      // Create test tables
      const dbManager = await app.get(DATABASE_MANAGER);
      const db = await dbManager.getConnection();

      await sql`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          active BOOLEAN DEFAULT 1,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `.execute(db);

      await sql`
        CREATE TABLE profiles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id),
          bio TEXT,
          avatar_url TEXT
        )
      `.execute(db);
    });

    afterEach(async () => {
      if (app) {
        await app.stop();
      }
    });

    it('should check overall database health', async () => {
      const health = await healthIndicator.check();

      expect(health.status).toBeDefined();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
      expect(health.connections).toBeDefined();
      expect(health.metrics).toBeDefined();
    });

    it('should test specific connection', async () => {
      const isHealthy = await healthIndicator.testConnection();
      expect(isHealthy).toBe(true);
    });

    it('should provide detailed health report', async () => {
      const report = await healthIndicator.getHealthReport();

      expect(report.status).toBeDefined();
      expect(report.connections).toBeInstanceOf(Array);
      expect(report.issues).toBeInstanceOf(Array);
      expect(report.recommendations).toBeInstanceOf(Array);
    });

    it('should track query metrics', async () => {
      const dbManager = await app.get(DATABASE_MANAGER);
      const db = await dbManager.getConnection();

      // Execute some queries
      await sql`SELECT 1`.execute(db);
      await sql`SELECT 2`.execute(db);

      const health = await healthIndicator.check();
      expect(health.metrics?.queryCount).toBeGreaterThanOrEqual(2);
    });

    it('should check migration status', async () => {
      const health = await healthIndicator.check();

      if (health.migrations) {
        expect(health.migrations.upToDate).toBeDefined();
        expect(health.migrations.pendingCount).toBeDefined();
      }
    });

    it('should provide transaction statistics', async () => {
      const txManager = await app.get(DATABASE_TRANSACTION_MANAGER);

      if (txManager) {
        // Execute a transaction
        await txManager.executeInTransaction(async (trx) => {
          await sql`SELECT 1`.execute(trx);
        });

        const health = await healthIndicator.check();

        if (health.transactions) {
          expect(health.transactions.total).toBeGreaterThanOrEqual(1);
          expect(health.transactions.committed).toBeGreaterThanOrEqual(1);
        }
      }
    });
  });

  describe('Direct Query Builder Access', () => {
    let app: Application;
    let userService: AdvancedUserService;
    let db: Kysely<any>;

    beforeEach(async () => {
      app = await Application.create({
        imports: [
          TitanDatabaseModule.forRoot({
            connection: {
              dialect: 'sqlite',
              database: ':memory:',
            },
            isGlobal: true,
          }),
          TestModule,
        ],
      });

      await app.start();
      userService = await app.get(AdvancedUserService);

      // Get direct DB access
      const dbManager = await app.get(DATABASE_MANAGER);
      db = await dbManager.getConnection();

      // Create tables
      await sql`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          active BOOLEAN DEFAULT 1,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `.execute(db);

      await sql`
        CREATE TABLE profiles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id),
          bio TEXT,
          avatar_url TEXT
        )
      `.execute(db);

      // Insert test data
      await sql`
        INSERT INTO users (email, name, active) VALUES
        ('john@example.com', 'John Doe', 1),
        ('jane@example.com', 'Jane Smith', 1),
        ('bob@example.com', 'Bob Johnson', 0)
      `.execute(db);

      await sql`
        INSERT INTO profiles (user_id, bio, avatar_url) VALUES
        (1, 'Software engineer', 'https://example.com/john.jpg'),
        (2, 'Product manager', 'https://example.com/jane.jpg')
      `.execute(db);
    });

    afterEach(async () => {
      if (app) {
        await app.stop();
      }
    });

    it('should execute complex queries with joins', async () => {
      const results = await userService.getUsersWithProfiles();

      expect(results).toHaveLength(2); // Only active users with profiles
      expect(results[0]).toHaveProperty('email');
      expect(results[0]).toHaveProperty('bio');
    });

    it('should perform aggregation queries', async () => {
      const stats = await userService.getUserStatistics();

      expect(stats.total).toBe(3);
      expect(stats.active).toBe(2);
      expect(stats.inactive).toBe(1);
    });

    it('should handle batch operations', async () => {
      const newUsers = [
        { email: 'user1@example.com', name: 'User 1', active: true },
        { email: 'user2@example.com', name: 'User 2', active: true },
        { email: 'user3@example.com', name: 'User 3', active: false },
      ];

      await userService.batchInsertUsers(newUsers);

      const stats = await userService.getUserStatistics();
      expect(stats.total).toBe(6);
    });

    it('should access replica connection when available', async () => {
      // In this test, replica is not configured, so it should fall back to primary
      const users = await userService.getUsersFromReplica();
      expect(users).toHaveLength(3);
    });
  });

  describe('Pagination', () => {
    let app: Application;
    let userService: AdvancedUserService;
    let db: Kysely<any>;

    beforeEach(async () => {
      app = await Application.create({
        imports: [
          TitanDatabaseModule.forRoot({
            connection: {
              dialect: 'sqlite',
              database: ':memory:',
            },
            isGlobal: true,
          }),
          TestModule,
        ],
      });

      await app.start();
      userService = await app.get(AdvancedUserService);

      const dbManager = await app.get(DATABASE_MANAGER);
      db = await dbManager.getConnection();

      // Create table
      await sql`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          active BOOLEAN DEFAULT 1,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `.execute(db);

      // Insert many test records
      const users = [];
      for (let i = 1; i <= 100; i++) {
        users.push({
          email: `user${i}@example.com`,
          name: `User ${i}`,
          active: i % 3 !== 0, // Every 3rd user is inactive
        });
      }

      for (const user of users) {
        await sql`
          INSERT INTO users (email, name, active)
          VALUES (${user.email}, ${user.name}, ${user.active})
        `.execute(db);
      }
    });

    afterEach(async () => {
      if (app) {
        await app.stop();
      }
    });

    it('should paginate results with default settings', async () => {
      const result = await userService.listUsers();

      expect(result.data).toHaveLength(10); // Default limit
      expect(result.pagination).toBeDefined();
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.total).toBe(100);
      expect(result.pagination.totalPages).toBe(10);
    });

    it('should paginate with custom page and limit', async () => {
      const result = await userService.listUsers({
        page: 2,
        limit: 20,
      });

      expect(result.data).toHaveLength(20);
      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(20);
      expect(result.pagination.totalPages).toBe(5);
    });

    it('should respect max limit', async () => {
      const result = await userService.listUsers({
        limit: 100, // Requesting more than max
      });

      expect(result.data).toHaveLength(50); // Max limit is 50
      expect(result.pagination.limit).toBe(50);
    });

    it('should handle last page correctly', async () => {
      const result = await userService.listUsers({
        page: 10,
        limit: 10,
      });

      expect(result.data).toHaveLength(10);
      expect(result.pagination.hasMore).toBe(false);
    });

    it('should apply ordering to paginated results', async () => {
      const result = await userService.listUsers({
        page: 1,
        limit: 5,
        orderBy: [{ column: 'name', direction: 'desc' }],
      });

      expect(result.data).toHaveLength(5);
      // Check that results are ordered
      const names = result.data.map((u) => u.name);
      const sortedNames = [...names].sort((a, b) => b.localeCompare(a));
      expect(names).toEqual(sortedNames);
    });
  });

  describe('PostgreSQL Integration', () => {
    let dockerManager: DockerTestManager;
    let pgContainer: DockerContainer;
    let app: Application;

    beforeAll(async () => {
      // Skip if PostgreSQL driver not available
      try {
        require('pg');
      } catch {
        return;
      }

      dockerManager = DockerTestManager.getInstance();

      // Start PostgreSQL container
      pgContainer = await dockerManager.startContainer({
        image: 'postgres:15-alpine',
        ports: { 5432: 'auto' },
        environment: {
          POSTGRES_USER: 'test',
          POSTGRES_PASSWORD: 'test',
          POSTGRES_DB: 'testdb',
        },
        waitFor: {
          port: 5432,
          timeout: 30000,
        },
      });
    }, 60000);

    afterAll(async () => {
      if (pgContainer) {
        await pgContainer.cleanup();
      }
    });

    it('should connect to PostgreSQL and perform operations', async () => {
      if (!pgContainer) {
        console.log('Skipping PostgreSQL test - container not available');
        return;
      }

      app = await Application.create({
        imports: [
          TitanDatabaseModule.forRoot({
            connection: {
              dialect: 'postgres',
              host: pgContainer.host,
              port: pgContainer.ports.get(5432),
              user: 'test',
              password: 'test',
              database: 'testdb',
            },
            isGlobal: true,
          }),
          TestModule,
        ],
      });

      await app.start();

      // Create tables
      const dbManager = await app.get(DATABASE_MANAGER);
      const db = await dbManager.getConnection();

      await sql`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `.execute(db);

      // Test operations
      const userService = await app.get(AdvancedUserService);

      await userService.batchInsertUsers([
        { email: 'pg1@example.com', name: 'PG User 1', active: true },
        { email: 'pg2@example.com', name: 'PG User 2', active: false },
      ]);

      const stats = await userService.getUserStatistics();
      expect(stats.total).toBe(2);

      await app.stop();
    }, 30000);
  });

  describe('MySQL Integration', () => {
    let dockerManager: DockerTestManager;
    let mysqlContainer: DockerContainer;
    let app: Application;

    beforeAll(async () => {
      // Skip if MySQL driver not available
      try {
        require('mysql2');
      } catch {
        return;
      }

      dockerManager = DockerTestManager.getInstance();

      // Start MySQL container
      mysqlContainer = await dockerManager.startContainer({
        image: 'mysql:8.0',
        ports: { 3306: 'auto' },
        environment: {
          MYSQL_ROOT_PASSWORD: 'root',
          MYSQL_USER: 'test',
          MYSQL_PASSWORD: 'test',
          MYSQL_DATABASE: 'testdb',
        },
        waitFor: {
          port: 3306,
          timeout: 60000, // MySQL takes longer to start
        },
      });
    }, 90000);

    afterAll(async () => {
      if (mysqlContainer) {
        await mysqlContainer.cleanup();
      }
    });

    it('should connect to MySQL and perform operations', async () => {
      if (!mysqlContainer) {
        console.log('Skipping MySQL test - container not available');
        return;
      }

      app = await Application.create({
        imports: [
          TitanDatabaseModule.forRoot({
            connection: {
              dialect: 'mysql',
              host: mysqlContainer.host,
              port: mysqlContainer.ports.get(3306),
              user: 'test',
              password: 'test',
              database: 'testdb',
            },
            isGlobal: true,
          }),
          TestModule,
        ],
      });

      await app.start();

      // Create tables
      const dbManager = await app.get(DATABASE_MANAGER);
      const db = await dbManager.getConnection();

      await sql`
        CREATE TABLE IF NOT EXISTS users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `.execute(db);

      // Test operations
      const userService = await app.get(AdvancedUserService);

      await userService.batchInsertUsers([
        { email: 'mysql1@example.com', name: 'MySQL User 1', active: true },
        { email: 'mysql2@example.com', name: 'MySQL User 2', active: false },
      ]);

      const stats = await userService.getUserStatistics();
      expect(stats.total).toBe(2);

      await app.stop();
    }, 30000);
  });
});
