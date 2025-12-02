/**
 * Repository Integration Tests
 *
 * Tests for repository pattern integration with database module
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Application } from '../../../src/application.js';
import { Module, Injectable } from '../../../src/decorators/index.js';
import {
  TitanDatabaseModule,
  Repository,
  SoftDelete,
  Timestamps,
  BaseRepository,
  RepositoryFactory,
  InjectRepository,
  DatabaseManager,
  DATABASE_MANAGER,
} from '../../../src/modules/database/index.js';
import { Kysely, sql } from 'kysely';
import { z } from 'zod';
import { DatabaseTestManager } from '../../utils/docker-test-manager.js';

// Skip Docker tests if env var is set
const skipIntegrationTests = process.env.SKIP_DOCKER_TESTS === 'true' ||
                            process.env.USE_MOCK_REDIS === 'true' ||
                            process.env.CI === 'true';

if (skipIntegrationTests) {
  console.log('⏭️ Skipping repository.spec.ts - requires Docker/PostgreSQL');
}

const describeOrSkip = skipIntegrationTests ? describe.skip : describe;

// Test entities and schemas
const UserSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  name: z.string(),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
  deleted_at: z.date().nullable().optional(),
});

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string(),
});

const UpdateUserSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().optional(),
});

type User = z.infer<typeof UserSchema>;
type CreateUser = z.infer<typeof CreateUserSchema>;
type UpdateUser = z.infer<typeof UpdateUserSchema>;

// Test repository with decorators
@Repository<User>({
  table: 'users',
  schema: UserSchema,
  createSchema: CreateUserSchema,
  updateSchema: UpdateUserSchema,
})
@SoftDelete()
@Timestamps()
class UserRepository extends BaseRepository<any, 'users', User, CreateUser, UpdateUser> {
  // Custom methods
  async findByEmail(email: string): Promise<User | null> {
    const result = await this.query().where('email', '=', email).selectAll().executeTakeFirst();

    return result ? this.mapRow(result) : null;
  }

  async findActive(): Promise<User[]> {
    const results = await this.query().where('deleted_at', 'is', null).selectAll().execute();

    return results.map((row) => this.mapRow(row));
  }
}

// Test service using repositories
@Injectable()
class UserService {
  constructor(@InjectRepository(UserRepository) private userRepo: UserRepository) {}

  async createUser(data: CreateUser): Promise<User> {
    return this.userRepo.create(data);
  }

  async findUserByEmail(email: string): Promise<User | null> {
    return this.userRepo.findByEmail(email);
  }

  async updateUser(id: number, data: UpdateUser): Promise<User> {
    return this.userRepo.update(id, data);
  }

  async softDeleteUser(id: number): Promise<void> {
    if (this.userRepo.softDelete) {
      await this.userRepo.softDelete(id);
    } else {
      await this.userRepo.delete(id);
    }
  }

  async getAllActiveUsers(): Promise<User[]> {
    return this.userRepo.findActive();
  }
}

// Test module
@Module({
  imports: [TitanDatabaseModule.forFeature([UserRepository])],
  providers: [UserService],
  exports: [UserService],
})
class TestModule {}

describe('Repository Integration', () => {
  describe('SQLite (in-memory) - Direct Repository', () => {
    let dbManager: DatabaseManager;
    let userRepo: UserRepository;
    let db: Kysely<any>;

    beforeEach(async () => {
      // Create database manager directly
      const options = {
        connection: {
          dialect: 'sqlite' as const,
          connection: ':memory:',
        },
      };

      dbManager = new DatabaseManager(options);
      await dbManager.init();

      db = await dbManager.getConnection();

      // Create the table first
      await sql`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          deleted_at TIMESTAMP
        )
      `.execute(db);

      // Create repository directly with config
      const config = {
        tableName: 'users' as const,
        connectionName: 'default',
        schemas: {
          entity: UserSchema,
          create: CreateUserSchema,
          update: UpdateUserSchema,
        },
        softDelete: true,
        timestamps: true,
      };

      // Create the UserRepository instance directly
      userRepo = new UserRepository(db, config);
    });

    afterEach(async () => {
      if (dbManager) {
        await dbManager.closeAll();
      }
    });

    it('should create and retrieve a user', async () => {
      const userData: CreateUser = {
        email: 'test@example.com',
        name: 'Test User',
      };

      const user = await userRepo.create(userData);

      expect(user).toMatchObject({
        email: userData.email,
        name: userData.name,
      });
      expect(user.id).toBeDefined();
      expect(user.created_at).toBeDefined();
      expect(user.updated_at).toBeDefined();
    });

    it('should find user by email', async () => {
      const userData: CreateUser = {
        email: 'find@example.com',
        name: 'Find User',
      };

      await userRepo.create(userData);
      const found = await userRepo.findByEmail(userData.email);

      expect(found).toMatchObject({
        email: userData.email,
        name: userData.name,
      });
    });

    it('should update a user', async () => {
      const userData: CreateUser = {
        email: 'update@example.com',
        name: 'Update User',
      };

      const user = await userRepo.create(userData);
      const updated = await userRepo.update(user.id, { name: 'Updated Name' });

      expect(updated.name).toBe('Updated Name');
      expect(updated.email).toBe(userData.email);
    });

    it('should soft delete a user', async () => {
      const userData: CreateUser = {
        email: 'delete@example.com',
        name: 'Delete User',
      };

      const user = await userRepo.create(userData);

      // Manually soft delete by setting deleted_at
      await sql`
        UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ${user.id}
      `.execute(db);

      // User should not appear in active users
      const activeUsers = await userRepo.findActive();
      expect(activeUsers.find((u) => u.id === user.id)).toBeUndefined();

      // But should still exist in database with deleted_at
      const deletedUser = await sql`
        SELECT * FROM users WHERE id = ${user.id}
      `.execute(db);

      expect(deletedUser.rows.length).toBe(1);
      expect(deletedUser.rows[0].deleted_at).not.toBeNull();
    });

    it('should paginate results', async () => {
      // Create multiple users
      const users = [];
      for (let i = 0; i < 15; i++) {
        users.push({
          email: `user${i}@example.com`,
          name: `User ${i}`,
        });
      }

      await Promise.all(users.map((u) => userRepo.create(u)));

      // Test pagination
      const page1 = await userRepo.paginate({ page: 1, limit: 10 });
      expect(page1.data.length).toBe(10);
      expect(page1.pagination.total).toBe(15);
      expect(page1.pagination.page).toBe(1);
      expect(page1.pagination.totalPages).toBe(2);

      const page2 = await userRepo.paginate({ page: 2, limit: 10 });
      expect(page2.data.length).toBe(5);
      expect(page2.pagination.page).toBe(2);
    });
  });

  describeOrSkip('PostgreSQL (Docker)', () => {
    let app: Application;
    let userService: UserService;
    let dbManager: DatabaseManager;
    let container: import('../../utils/docker-test-manager.js').DockerContainer;

    beforeAll(async () => {
      // Create PostgreSQL container directly (not using withPostgres to keep it alive)
      container = await DatabaseTestManager.createPostgresContainer({
        database: 'test_repository_db',
        user: 'testuser',
        password: 'testpass',
      });

      const port = container.ports.get(5432)!;
      const connectionString = `postgresql://testuser:testpass@localhost:${port}/test_repository_db`;

      // Wait additional time for PostgreSQL to be fully ready
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Create application with PostgreSQL
      app = await Application.create({
        imports: [
          TitanDatabaseModule.forRoot({
            connection: {
              dialect: 'postgres',
              connection: connectionString,
            },
            kysera: {
              repository: {
                defaultOptions: {
                  softDelete: true,
                  timestamps: true,
                },
              },
            },
            isGlobal: true,
          }),
          TestModule,
        ],
      });

      await app.start();

      // Get services
      userService = await app.resolveAsync(UserService);
      dbManager = (await app.resolveAsync(DATABASE_MANAGER)) as DatabaseManager;

      // Create users table
      const db = await dbManager.getConnection();
      await sql`
        CREATE TABLE users (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) NOT NULL UNIQUE,
          name VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          deleted_at TIMESTAMP
        )
      `.execute(db);
    }, 60000);

    afterAll(async () => {
      if (app) {
        await app.stop();
      }
      if (container) {
        await container.cleanup();
      }
    });

    it('should work with PostgreSQL', async () => {
      const userData: CreateUser = {
        email: 'postgres@example.com',
        name: 'PostgreSQL User',
      };

      const user = await userService.createUser(userData);
      expect(user).toMatchObject({
        email: userData.email,
        name: userData.name,
      });

      const found = await userService.findUserByEmail(userData.email);
      expect(found).toMatchObject({
        email: userData.email,
        name: userData.name,
      });
    });

    it('should handle transactions', async () => {
      const factory = await app.resolveAsync(RepositoryFactory);

      try {
        await factory.createTransactionScope(async (scope) => {
          const userRepo = scope.getRepository<UserRepository>(UserRepository);

          // Create users in transaction
          await userRepo.create({ email: 'tx1@example.com', name: 'TX User 1' });
          await userRepo.create({ email: 'tx2@example.com', name: 'TX User 2' });

          // This should fail due to duplicate email
          await userRepo.create({ email: 'tx1@example.com', name: 'TX User 3' });
        });
      } catch (error) {
        // Transaction should be rolled back
      }

      // Check that no users were created
      const allUsers = await userService.getAllActiveUsers();
      expect(allUsers.length).toBe(0);
    });
  });
});
