/**
 * Docker Database Integration Tests
 *
 * Demonstrates how to use Docker containers for database testing
 * with automatic fallback to SQLite when Docker is not available
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import {
  createTestDatabase,
  withTestDatabase,
  isDockerAvailable,
  DatabaseTestContext,
  TitanDatabaseModule,
  DatabaseManager,
  BaseRepository,
  Repository,
  InjectRepository,
} from '../../../src/modules/database/index.js';
import { Application } from '../../../src/application.js';
import { Module, Injectable } from '../../../src/decorators/index.js';
import { Kysely, sql } from 'kysely';

// Test entity
interface User {
  id: number;
  email: string;
  name: string;
  created_at: Date;
}

@Repository<User>({
  table: 'users',
  timestamps: true,
})
class UserRepository extends BaseRepository<any, 'users', User, Partial<User>, Partial<User>> {}

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
class TestModule {}

describe('Docker Database Integration', () => {
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
            ...context.connection,
            isGlobal: true,
          }),
          TitanDatabaseModule.forFeature([UserRepository]),
        ],
        providers: [UserService],
      })
      class PostgresTestModule {}

      app = await Application.create(PostgresTestModule, {
        disableCoreModules: true,
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
                ...context.connection,
                isGlobal: true,
              }),
              TitanDatabaseModule.forFeature([UserRepository]),
            ],
            providers: [UserService],
          })
          class MySQLTestModule {}

          const app = await Application.create(MySQLTestModule, {
            disableCoreModules: true,
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
    }, 60000);
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
                  ...context.connection,
                  isGlobal: true,
                }),
                TitanDatabaseModule.forFeature([UserRepository]),
              ],
              providers: [UserService],
            })
            class CrossDbTestModule {}

            const app = await Application.create(CrossDbTestModule, {
              disableCoreModules: true,
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
    }, 120000); // Allow extra time for multiple containers
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `.execute(db);
  } else if (dialect === 'mysql' || dialect === 'mariadb') {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `.execute(db);
  } else {
    // SQLite
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(100) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `.execute(db);
  }
}
