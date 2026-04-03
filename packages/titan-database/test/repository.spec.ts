/**
 * Repository Integration Tests
 *
 * Tests for repository pattern integration with database module
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { Application } from '@omnitron-dev/titan/application';
import { Module, Injectable } from '@omnitron-dev/titan/decorators';
import {
  TitanDatabaseModule,
  Repository,
  SoftDelete,
  Timestamps,
  TransactionAwareRepository,
  InjectRepository,
  DatabaseManager,
  DATABASE_MANAGER,
} from '../src/index.js';
import type { BaseRepository } from '@kysera/repository';
import { Kysely, sql } from 'kysely';
import { z } from 'zod';
import { DatabaseTestManager } from '@omnitron-dev/testing/titan';
import { isDockerAvailable } from '@omnitron-dev/testing/titan';
import { createLogger } from '@omnitron-dev/testing/titan';

// Skip Docker tests if env var is set or Docker is not available
const skipIntegrationTests =
  process.env.SKIP_DOCKER_TESTS === 'true' || process.env.SKIP_DATABASE_TESTS === 'true' || !isDockerAvailable();

if (skipIntegrationTests) {
  console.log('⏭️ Skipping repository.spec.ts - requires Docker/PostgreSQL');
}

const describeOrSkip = skipIntegrationTests ? describe.skip : describe;

// Test entities and schemas
const UserSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  name: z.string(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
  deletedAt: z.date().nullable().optional(),
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
class UserRepository
  extends TransactionAwareRepository<any, 'users', User, CreateUser, UpdateUser>
  implements BaseRepository<User, CreateUser, UpdateUser>
{
  // Standard CRUD methods
  async create(data: CreateUser): Promise<User> {
    const now = new Date().toISOString();
    const result = await this.executor
      .insertInto(this.tableName)
      .values({
        ...data,
        createdAt: now,
        updatedAt: now,
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow();
    return result as unknown as User;
  }

  async findById(id: number): Promise<User | null> {
    const result = await this.executor.selectFrom(this.tableName).where('id', '=', id).selectAll().executeTakeFirst();
    return (result as User | null) ?? null;
  }

  async update(id: number, data: UpdateUser): Promise<User> {
    const now = new Date().toISOString();
    const result = await this.executor
      .updateTable(this.tableName)
      .set({
        ...data,
        updatedAt: now,
      } as any)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return result as unknown as User;
  }

  async delete(id: number): Promise<void> {
    await this.executor.deleteFrom(this.tableName).where('id', '=', id).execute();
  }

  async softDelete(id: number): Promise<void> {
    const now = new Date().toISOString();
    await this.executor
      .updateTable(this.tableName)
      .set({ deletedAt: now } as any)
      .where('id', '=', id)
      .execute();
  }

  async paginate(options: { page: number; limit: number }): Promise<{
    data: User[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const { page, limit } = options;
    const offset = (page - 1) * limit;

    const [data, countResult] = await Promise.all([
      this.executor.selectFrom(this.tableName).selectAll().offset(offset).limit(limit).execute(),
      this.executor
        .selectFrom(this.tableName)
        .select(({ fn }) => fn.count<number>('id').as('count'))
        .executeTakeFirst(),
    ]);

    const total = Number(countResult?.count ?? 0);
    const totalPages = Math.ceil(total / limit);

    return {
      data: data as unknown as User[],
      pagination: { page, limit, total, totalPages },
    };
  }

  // Custom methods
  async findByEmail(email: string): Promise<User | null> {
    const result = await this.executor
      .selectFrom('users' as any)
      .where('email', '=', email)
      .selectAll()
      .executeTakeFirst();

    return result as User | null;
  }

  async findActive(): Promise<User[]> {
    const results = await this.executor
      .selectFrom('users' as any)
      .where('deletedAt', 'is', null)
      .selectAll()
      .execute();

    return results as User[];
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

describeOrSkip('Repository Integration', () => {
  describe('SQLite (in-memory) - Direct Repository', () => {
    let dbManager: DatabaseManager;
    let userRepo: UserRepository;
    let db: Kysely<any>;
    let mockLogger: ReturnType<typeof createLogger>;

    beforeEach(async () => {
      mockLogger = createLogger();

      // Create database manager directly
      const options = {
        connection: {
          dialect: 'sqlite' as const,
          connection: ':memory:',
        },
      };

      dbManager = new DatabaseManager(options, mockLogger as any);
      await dbManager.init();

      db = await dbManager.getConnection();

      // Create the table first
      await sql`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          deletedAt TIMESTAMP
        )
      `.execute(db);

      // Create the UserRepository instance directly with tableName
      userRepo = new UserRepository(db, 'users');
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
      expect(user.createdAt).toBeDefined();
      expect(user.updatedAt).toBeDefined();
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

      // Manually soft delete by setting deletedAt
      await sql`
        UPDATE users SET deletedAt = CURRENT_TIMESTAMP WHERE id = ${user.id}
      `.execute(db);

      // User should not appear in active users
      const activeUsers = await userRepo.findActive();
      expect(activeUsers.find((u) => u.id === user.id)).toBeUndefined();

      // But should still exist in database with deletedAt
      const deletedUser = await sql`
        SELECT * FROM users WHERE id = ${user.id}
      `.execute(db);

      expect(deletedUser.rows.length).toBe(1);
      expect(deletedUser.rows[0].deletedAt).not.toBeNull();
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
          createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          deletedAt TIMESTAMP
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
  });
});
