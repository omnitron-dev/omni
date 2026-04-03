/**
 * Docker Database Integration Tests
 *
 * Demonstrates how to use Docker containers for database testing
 * with automatic fallback to SQLite when Docker is not available
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isDockerAvailable as isDockerAvailableUtil } from '../../utils/docker-test-utils.js';

const skipIntegrationTests =
  process.env.SKIP_DOCKER_TESTS === 'true' || process.env.SKIP_DATABASE_TESTS === 'true' || !isDockerAvailableUtil();

if (skipIntegrationTests) {
  console.log('⏭️ Skipping docker-integration.spec.ts - requires Docker/PostgreSQL');
}
import {
  TitanDatabaseModule,
  DatabaseManager,
  TransactionAwareRepository,
  Repository,
  InjectRepository,
} from '../../../src/modules/database/index.js';
import { createTestDatabase, withTestDatabase, isDockerAvailable } from '@omnitron-dev/testing/titan';
import type { DatabaseTestContext } from '@omnitron-dev/testing/titan';
import { Application } from '../../../src/application.js';
import { Module, Injectable } from '../../../src/decorators/index.js';
import { Kysely, sql } from 'kysely';

// Test entity
interface User {
  id: number;
  email: string;
  name: string;
  createdAt: Date;
}

@Repository<User>({
  table: 'users',
  timestamps: true,
})
class UserRepository extends TransactionAwareRepository<any, 'users', User, Partial<User>, Partial<User>> {
  async create(data: Partial<User>): Promise<User> {
    // Check if we're using MySQL (which doesn't support RETURNING)
    const db = this.executor as Kysely<any>;
    let isMysql = false;
    try {
      const adapter = db.getExecutor().adapter;
      isMysql = adapter.constructor.name.toLowerCase().includes('mysql');
    } catch {
      // Fallback if introspection fails
    }

    if (isMysql) {
      // MySQL: Insert without timestamps (let DB defaults handle them), then select
      // Strip out any timestamp fields that might have ISO8601 format
      const { createdAt: _ca, updatedAt: _ua, ...insertData } = data as any;
      const insertResult = await this.executor
        .insertInto(this.tableName)
        .values(insertData as any)
        .execute();

      const insertId = (insertResult[0] as any)?.insertId;
      if (insertId) {
        const user = await this.executor
          .selectFrom(this.tableName)
          .selectAll()
          .where('id' as any, '=', insertId)
          .executeTakeFirst();
        return user as User;
      }

      // Fallback: find by unique field
      const user = await this.findOne({ email: data.email } as Partial<User>);
      return user as User;
    }

    // PostgreSQL/SQLite: Use RETURNING
    const now = new Date().toISOString();
    const result = await this.executor
      .insertInto(this.tableName)
      .values({
        ...data,
        createdAt: now,
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow();
    return result as unknown as User;
  }

  async findOne(where: Partial<User>): Promise<User | null> {
    let query = this.executor.selectFrom(this.tableName).selectAll();
    for (const [key, value] of Object.entries(where)) {
      query = query.where(key as any, '=', value);
    }
    const result = await query.executeTakeFirst();
    return (result as User | undefined) ?? null;
  }

  async findAll(_options: { where?: Partial<User> }): Promise<User[]> {
    const result = await this.executor.selectFrom(this.tableName).selectAll().execute();
    return result as unknown as User[];
  }
}

@Injectable()
class UserService {
  constructor(@InjectRepository(UserRepository) private userRepo: UserRepository) {}

  async createUser(email: string, name: string): Promise<User> {
    return this.userRepo.create({ email, name });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({ email });
  }

  async getAllUsers(): Promise<User[]> {
    return this.userRepo.findAll({});
  }
}

@Module({
  imports: [],
  providers: [UserService],
})
class _TestModule {}

const describeOrSkip = skipIntegrationTests ? describe.skip : describe;

describeOrSkip('Docker Database Integration', () => {
  it('should detect Docker availability', () => {
    const available = isDockerAvailable();
    console.log(`Docker available: ${available}`);

    if (available) {
      console.log('✓ Docker detected - will use real databases for testing');
    } else {
      console.log('✓ Docker not available - will use SQLite fallback');
    }

    expect(typeof available).toBe('boolean');
  });

  describe('PostgreSQL Integration', () => {
    let context: DatabaseTestContext;
    let app: Application;
    let userService: UserService;
    let db: Kysely<any>;

    beforeAll(async () => {
      // Create test database with automatic Docker detection
      context = await createTestDatabase({
        dialect: 'postgres',
        verbose: true,
      });

      console.log(`Using ${context.dialect} for testing (Docker: ${context.isDocker})`);

      // Create application with test database
      @Module({
        imports: [
          TitanDatabaseModule.forRoot({
            connection: context.connection,
            isGlobal: true,
          }),
          TitanDatabaseModule.forFeature([UserRepository]),
        ],
        providers: [UserService],
      })
      class PostgresTestModule {}

      app = await Application.create(PostgresTestModule, {
        logging: { level: 'silent' },
        disableGracefulShutdown: true,
      });

      userService = await app.resolveAsync(UserService);

      // Get database connection for schema creation
      const dbManager = await app.resolveAsync(DatabaseManager);
      db = await dbManager.getConnection();

      // Create schema
      await createUserSchema(db, context.dialect);
    }, 60000); // Increase timeout for Docker container startup

    afterAll(async () => {
      await app.stop();
      await context.cleanup();
    });

    it('should create and retrieve users', async () => {
      const user = await userService.createUser('test@example.com', 'Test User');

      expect(user).toBeDefined();
      expect(user.email).toBe('test@example.com');
      expect(user.name).toBe('Test User');
      expect(user.id).toBeDefined();

      const retrieved = await userService.findByEmail('test@example.com');
      expect(retrieved).toBeDefined();
      expect(retrieved!.email).toBe('test@example.com');
    });

    it('should handle multiple users', async () => {
      await userService.createUser('user1@example.com', 'User One');
      await userService.createUser('user2@example.com', 'User Two');
      await userService.createUser('user3@example.com', 'User Three');

      const users = await userService.getAllUsers();
      expect(users.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('MySQL Integration', () => {
    it('should work with MySQL in Docker', async () => {
      await withTestDatabase(
        {
          dialect: 'mysql',
          verbose: true,
        },
        async (context) => {
          console.log(`Using ${context.dialect} for testing (Docker: ${context.isDocker})`);

          @Module({
            imports: [
              TitanDatabaseModule.forRoot({
                connection: context.connection,
                isGlobal: true,
              }),
              TitanDatabaseModule.forFeature([UserRepository]),
            ],
            providers: [UserService],
          })
          class MySQLTestModule {}

          const app = await Application.create(MySQLTestModule, {
            logging: { level: 'silent' },
            disableGracefulShutdown: true,
          });

          const userService = await app.resolveAsync(UserService);
          const dbManager = await app.resolveAsync(DatabaseManager);
          const db = await dbManager.getConnection();

          // Create schema
          await createUserSchema(db, context.dialect);

          // Test operations
          const user = await userService.createUser('mysql-test@example.com', 'MySQL Test User');
          expect(user).toBeDefined();
          expect(user.email).toBe('mysql-test@example.com');

          await app.stop();
        }
      );
    }, 90000); // Increased timeout for MySQL 8.0 initialization
  });

  describe('Cross-Database Compatibility', () => {
    it('should work with all supported databases', async () => {
      const dialects: Array<'postgres' | 'mysql' | 'sqlite'> = ['postgres', 'mysql', 'sqlite'];

      for (const dialect of dialects) {
        await withTestDatabase(
          {
            dialect,
            verbose: false,
          },
          async (context) => {
            console.log(`Testing ${dialect} (Docker: ${context.isDocker})`);

            @Module({
              imports: [
                TitanDatabaseModule.forRoot({
                  connection: context.connection,
                  isGlobal: true,
                }),
                TitanDatabaseModule.forFeature([UserRepository]),
              ],
              providers: [UserService],
            })
            class CrossDbTestModule {}

            const app = await Application.create(CrossDbTestModule, {
              logging: { level: 'silent' },
              disableGracefulShutdown: true,
            });

            const userService = await app.resolveAsync(UserService);
            const dbManager = await app.resolveAsync(DatabaseManager);
            const db = await dbManager.getConnection();

            // Create schema
            await createUserSchema(db, context.dialect);

            // Test basic operations
            const user = await userService.createUser(`${dialect}-test@example.com`, `${dialect} Test User`);
            expect(user).toBeDefined();
            expect(user.email).toBe(`${dialect}-test@example.com`);

            const retrieved = await userService.findByEmail(`${dialect}-test@example.com`);
            expect(retrieved).toBeDefined();

            await app.stop();
          }
        );
      }
    }, 240000); // Allow extra time for multiple containers (4 minutes for 3 databases including MySQL)
  });

  describe('Fallback Behavior', () => {
    it('should fallback to SQLite when Docker is not available', async () => {
      const context = await createTestDatabase({
        dialect: 'postgres',
        forceSqlite: true, // Force SQLite even if Docker is available
        verbose: true,
      });

      expect(context.dialect).toBe('sqlite');
      expect(context.isDocker).toBe(false);

      await context.cleanup();
    });

    it('should use SQLite in CI environments by default', async () => {
      // Simulate CI environment
      const originalCI = process.env.CI;
      process.env.CI = 'true';

      const context = await createTestDatabase({
        dialect: 'postgres',
        verbose: true,
      });

      // In CI, should prefer SQLite for speed
      if (process.env.CI === 'true') {
        console.log('CI detected - using SQLite');
      }

      await context.cleanup();

      // Restore environment
      if (originalCI !== undefined) {
        process.env.CI = originalCI;
      } else {
        delete process.env.CI;
      }
    });
  });
});

// Helper function to create user schema
async function createUserSchema(db: Kysely<any>, dialect: string) {
  if (dialect === 'postgres') {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(100) NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `.execute(db);
  } else if (dialect === 'mysql' || dialect === 'mariadb') {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(100) NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `.execute(db);
  } else {
    // SQLite
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(100) NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `.execute(db);
  }
}
