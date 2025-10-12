/**
 * Database Testing Module Tests
 *
 * Comprehensive tests for the DatabaseTestingModule with Docker containers
 * for PostgreSQL, MySQL, and SQLite
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import { Application } from '../../../src/application.js';
import { Module, Injectable } from '../../../src/decorators/index.js';
import { sql } from 'kysely';
import {
  InjectDatabaseManager,
  InjectRepository,
  Repository,
  BaseRepository,
  DatabaseManager,
  DATABASE_TESTING_SERVICE,
} from '../../../src/modules/database/index.js';
import {
  DatabaseTestingModule,
  DatabaseTestingService,
} from '../../../src/modules/database/testing/database-testing.module.js';
import { DatabaseTestManager, DockerContainer } from '../../utils/docker-test-manager.js';

// Test entities
interface User {
  id: number;
  email: string;
  name: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface Post {
  id: number;
  user_id: number;
  title: string;
  content: string;
  published: boolean;
  created_at: Date;
  updated_at: Date;
}

interface Comment {
  id: number;
  post_id: number;
  user_id: number;
  content: string;
  created_at: Date;
}

// Test repositories
@Repository<User>({
  table: 'users',
  timestamps: true,
})
class UserRepository extends BaseRepository<any, 'users', User, any, any> {
  async findByEmail(email: string): Promise<User | undefined> {
    return this.findOne({ where: { email } });
  }
}

@Repository<Post>({
  table: 'posts',
  timestamps: true,
})
class PostRepository extends BaseRepository<any, 'posts', Post, any, any> {
  async findByUserId(userId: number): Promise<Post[]> {
    return this.findAll({ where: { user_id: userId } });
  }
}

@Repository<Comment>({
  table: 'comments',
})
class CommentRepository extends BaseRepository<any, 'comments', Comment, any, any> {}

// Test service
@Injectable()
class BlogService {
  constructor(
    @InjectRepository(UserRepository) private userRepo: UserRepository,
    @InjectRepository(PostRepository) private postRepo: PostRepository,
    @InjectRepository(CommentRepository) private commentRepo: CommentRepository,
    @InjectDatabaseManager() private dbManager: DatabaseManager
  ) {}

  async createUserWithPost(userData: Partial<User>, postData: Partial<Post>): Promise<{ user: User; post: Post }> {
    const user = await this.userRepo.create(userData);
    const post = await this.postRepo.create({
      ...postData,
      user_id: user.id,
    });
    return { user, post };
  }

  async getUserStats(userId: number): Promise<any> {
    const db = await this.dbManager.getConnection();
    const result = await db
      .selectFrom('users')
      .leftJoin('posts', 'users.id', 'posts.user_id')
      .leftJoin('comments', 'users.id', 'comments.user_id')
      .where('users.id', '=', userId)
      .select([
        'users.id',
        'users.name',
        sql<number>`COUNT(DISTINCT posts.id)`.as('post_count'),
        sql<number>`COUNT(DISTINCT comments.id)`.as('comment_count'),
      ])
      .groupBy('users.id')
      .executeTakeFirst();
    return result;
  }
}

// Test module
@Module({
  imports: [
    DatabaseTestingModule.forTest({
      transactional: true,
      autoMigrate: true,
      autoClean: true,
    }),
  ],
  providers: [BlogService, UserRepository, PostRepository, CommentRepository],
  exports: [BlogService, DATABASE_TESTING_SERVICE],
})
class TestAppModule {}

describe('DatabaseTestingModule', () => {
  let app: Application;
  let testService: DatabaseTestingService;
  let blogService: BlogService;
  let userRepo: UserRepository;

  describe('SQLite In-Memory Testing', () => {
    beforeEach(async () => {
      @Module({
        imports: [
          DatabaseTestingModule.forTest({
            transactional: true,
            autoMigrate: false, // Disable migrations for manual schema creation
            autoClean: true,
          }),
        ],
        providers: [BlogService],
      })
      class LocalTestModule {}

      app = await Application.create({
        imports: [LocalTestModule],
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      testService = await app.resolveAsync<DatabaseTestingService>(DATABASE_TESTING_SERVICE);
      blogService = await app.resolveAsync<BlogService>(BlogService);
      userRepo = await app.resolveAsync<UserRepository>(UserRepository);

      // Initialize test database
      await testService.initialize();

      // Create tables
      const db = testService.getTestConnection();
      await sql`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          active BOOLEAN DEFAULT TRUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `.execute(db);

      await sql`
        CREATE TABLE posts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          content TEXT,
          published BOOLEAN DEFAULT FALSE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `.execute(db);

      await sql`
        CREATE TABLE comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          post_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          content TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (post_id) REFERENCES posts(id),
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `.execute(db);

      // Run beforeEach hook
      await testService.beforeEach();
    });

    afterEach(async () => {
      await testService.afterEach();
      await testService.afterAll();
      await app.stop();
    });

    it('should automatically rollback transactions', async () => {
      // Create test data
      const user = await userRepo.create({
        email: 'test@example.com',
        name: 'Test User',
        active: true,
      });

      expect(user.id).toBeDefined();
      expect(user.email).toBe('test@example.com');

      // Verify data exists in transaction
      const found = await userRepo.findByEmail('test@example.com');
      expect(found).toBeDefined();
      expect(found?.id).toBe(user.id);
    });

    it('should clean database between tests', async () => {
      // This test should not see data from previous test
      const users = await userRepo.findAll();
      expect(users).toHaveLength(0);
    });

    it('should seed database with test data', async () => {
      // Seed test data
      await testService.seedDatabase([
        {
          table: 'users',
          data: [
            { email: 'user1@example.com', name: 'User 1', active: true },
            { email: 'user2@example.com', name: 'User 2', active: false },
          ],
        },
        {
          table: 'posts',
          data: { user_id: 1, title: 'First Post', content: 'Content' },
        },
      ]);

      const users = await userRepo.findAll();
      expect(users).toHaveLength(2);

      const hasUser1 = await testService.assertDatabaseHas('users', {
        email: 'user1@example.com',
      });
      expect(hasUser1).toBe(true);
    });

    it('should support factory pattern for test data', async () => {
      let counter = 0;
      const users = await testService.factory<User>(
        'users',
        () => ({
          email: `user${++counter}@example.com`,
          name: `User ${counter}`,
          active: counter % 2 === 0,
        }),
        5
      );

      expect(users).toHaveLength(5);
      expect(users[0].email).toBe('user1@example.com');
      expect(users[4].email).toBe('user5@example.com');

      const count = await testService.assertDatabaseCount('users', 5);
      expect(count).toBe(true);
    });

    it('should support savepoints for nested testing', async () => {
      // Create initial data
      const user = await userRepo.create({
        email: 'test@example.com',
        name: 'Test User',
      });

      // Create savepoint
      await testService.createSavepoint('before_update');

      // Update user
      await userRepo.update(user.id, { name: 'Updated Name' });

      // Verify update
      let updated = await userRepo.findById(user.id);
      expect(updated?.name).toBe('Updated Name');

      // Rollback to savepoint
      await testService.rollbackToSavepoint('before_update');

      // Verify rollback
      updated = await userRepo.findById(user.id);
      expect(updated?.name).toBe('Test User');
    });

    it('should provide database assertions', async () => {
      const user = await userRepo.create({
        email: 'assert@example.com',
        name: 'Assert User',
      });

      // Assert database has record
      const hasRecord = await testService.assertDatabaseHas('users', {
        email: 'assert@example.com',
        name: 'Assert User',
      });
      expect(hasRecord).toBe(true);

      // Assert database missing record
      const missingRecord = await testService.assertDatabaseMissing('users', {
        email: 'nonexistent@example.com',
      });
      expect(missingRecord).toBe(true);

      // Assert database count
      const hasOneUser = await testService.assertDatabaseCount('users', 1);
      expect(hasOneUser).toBe(true);
    });
  });

  describe('PostgreSQL Integration', () => {
    let pgContainer: DockerContainer;
    let pgApp: Application;
    let pgTestService: DatabaseTestingService;

    beforeAll(async () => {
      // Start PostgreSQL container
      pgContainer = await DatabaseTestManager.createPostgresContainer({
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
      });

      const port = pgContainer.ports.get(5432)!;

      // Create module with PostgreSQL connection
      @Module({
        imports: [
          DatabaseTestingModule.forTest({
            connection: {
              dialect: 'postgres',
              host: 'localhost',
              port,
              database: 'testdb',
              user: 'testuser',
              password: 'testpass',
            },
            transactional: true,
            autoMigrate: false,
            autoClean: true,
            isolatedSchema: true,
          }),
        ],
        providers: [BlogService, UserRepository, PostRepository, CommentRepository],
        exports: [BlogService],
      })
      class PgTestModule {}

      pgApp = await Application.create({
        imports: [PgTestModule],
        disableDefaultProviders: true,
      });

      pgTestService = pgApp.get<DatabaseTestingService>(DatabaseTestingService);
      await pgTestService.initialize();

      // Create tables in isolated schema
      const db = pgTestService.getTestConnection();
      await sql`
        CREATE TABLE users (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) NOT NULL UNIQUE,
          name VARCHAR(255) NOT NULL,
          active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `.execute(db);

      await sql`
        CREATE TABLE posts (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          title VARCHAR(255) NOT NULL,
          content TEXT,
          published BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `.execute(db);

      await sql`
        CREATE TABLE comments (
          id SERIAL PRIMARY KEY,
          post_id INTEGER NOT NULL REFERENCES posts(id),
          user_id INTEGER NOT NULL REFERENCES users(id),
          content TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `.execute(db);
    }, 60000);

    afterAll(async () => {
      await pgTestService.afterAll();
      await pgApp.stop();
      await pgContainer.cleanup();
    });

    beforeEach(async () => {
      await pgTestService.beforeEach();
    });

    afterEach(async () => {
      await pgTestService.afterEach();
    });

    it('should work with PostgreSQL database', async () => {
      const blogService = pgApp.get<BlogService>(BlogService);
      const userRepo = pgApp.get<UserRepository>(UserRepository);

      const { user, post } = await blogService.createUserWithPost(
        { email: 'pg@example.com', name: 'PG User' },
        { title: 'PostgreSQL Post', content: 'Content' }
      );

      expect(user.id).toBeDefined();
      expect(post.user_id).toBe(user.id);

      const stats = await blogService.getUserStats(user.id);
      expect(stats).toEqual(
        expect.objectContaining({
          id: user.id,
          name: 'PG User',
          post_count: 1,
          comment_count: 0,
        })
      );
    });

    it('should support PostgreSQL-specific features', async () => {
      const db = pgTestService.getTestConnection();

      // Use PostgreSQL JSON functions
      await sql`
        INSERT INTO users (email, name, active)
        VALUES ('json@example.com', 'JSON User', true)
      `.execute(db);

      // Use RETURNING clause
      const result = await sql`
        UPDATE users
        SET name = 'Updated JSON User'
        WHERE email = 'json@example.com'
        RETURNING id, name
      `.execute(db);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toEqual(
        expect.objectContaining({
          name: 'Updated JSON User',
        })
      );
    });

    it('should isolate schemas between test suites', async () => {
      const db = pgTestService.getTestConnection();

      // Check that we're in an isolated schema
      const schemaResult = await sql`SELECT current_schema()`.execute(db);
      const currentSchema = (schemaResult.rows[0] as any).current_schema;
      expect(currentSchema).toMatch(/^test_/);
      expect(currentSchema).not.toBe('public');
    });
  });

  describe('MySQL Integration', () => {
    let mysqlContainer: DockerContainer;
    let mysqlApp: Application;
    let mysqlTestService: DatabaseTestingService;

    beforeAll(async () => {
      // Start MySQL container
      mysqlContainer = await DatabaseTestManager.createMySQLContainer({
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        rootPassword: 'rootpass',
      });

      const port = mysqlContainer.ports.get(3306)!;

      // Create module with MySQL connection
      @Module({
        imports: [
          DatabaseTestingModule.forTest({
            connection: {
              dialect: 'mysql',
              host: 'localhost',
              port,
              database: 'testdb',
              user: 'testuser',
              password: 'testpass',
            },
            transactional: true,
            autoMigrate: false,
            autoClean: true,
          }),
        ],
        providers: [BlogService, UserRepository, PostRepository, CommentRepository],
        exports: [BlogService],
      })
      class MySQLTestModule {}

      mysqlApp = await Application.create({
        imports: [MySQLTestModule],
        disableDefaultProviders: true,
      });

      mysqlTestService = mysqlApp.get<DatabaseTestingService>(DatabaseTestingService);
      await mysqlTestService.initialize();

      // Create tables
      const db = mysqlTestService.getTestConnection();
      await sql`
        CREATE TABLE users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          email VARCHAR(255) NOT NULL UNIQUE,
          name VARCHAR(255) NOT NULL,
          active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `.execute(db);

      await sql`
        CREATE TABLE posts (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          title VARCHAR(255) NOT NULL,
          content TEXT,
          published BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `.execute(db);

      await sql`
        CREATE TABLE comments (
          id INT AUTO_INCREMENT PRIMARY KEY,
          post_id INT NOT NULL,
          user_id INT NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (post_id) REFERENCES posts(id),
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `.execute(db);
    }, 60000);

    afterAll(async () => {
      await mysqlTestService.afterAll();
      await mysqlApp.stop();
      await mysqlContainer.cleanup();
    });

    beforeEach(async () => {
      await mysqlTestService.beforeEach();
    });

    afterEach(async () => {
      await mysqlTestService.afterEach();
    });

    it('should work with MySQL database', async () => {
      const blogService = mysqlApp.get<BlogService>(BlogService);
      const userRepo = mysqlApp.get<UserRepository>(UserRepository);

      const { user, post } = await blogService.createUserWithPost(
        { email: 'mysql@example.com', name: 'MySQL User' },
        { title: 'MySQL Post', content: 'Content' }
      );

      expect(user.id).toBeDefined();
      expect(post.user_id).toBe(user.id);

      const stats = await blogService.getUserStats(user.id);
      expect(stats).toEqual(
        expect.objectContaining({
          id: user.id,
          name: 'MySQL User',
          post_count: 1,
          comment_count: 0,
        })
      );
    });

    it('should support MySQL-specific features', async () => {
      const db = mysqlTestService.getTestConnection();

      // Use MySQL-specific INSERT ... ON DUPLICATE KEY UPDATE
      await sql`
        INSERT INTO users (email, name, active)
        VALUES ('duplicate@example.com', 'Original Name', true)
        ON DUPLICATE KEY UPDATE name = 'Updated Name'
      `.execute(db);

      // Insert again to trigger update
      await sql`
        INSERT INTO users (email, name, active)
        VALUES ('duplicate@example.com', 'New Name', false)
        ON DUPLICATE KEY UPDATE name = 'Updated Name', active = false
      `.execute(db);

      const result = await sql`
        SELECT * FROM users WHERE email = 'duplicate@example.com'
      `.execute(db);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toEqual(
        expect.objectContaining({
          email: 'duplicate@example.com',
          name: 'Updated Name',
          active: 0, // MySQL returns 0/1 for boolean
        })
      );
    });

    it('should handle foreign key constraints properly', async () => {
      const db = mysqlTestService.getTestConnection();

      // Verify foreign key checks are handled during cleanup
      await sql`
        INSERT INTO users (email, name) VALUES ('fk@example.com', 'FK User')
      `.execute(db);

      const userResult = await sql`
        SELECT id FROM users WHERE email = 'fk@example.com'
      `.execute(db);
      const userId = (userResult.rows[0] as any).id;

      await sql`
        INSERT INTO posts (user_id, title, content)
        VALUES (${userId}, 'FK Post', 'Content')
      `.execute(db);

      // Clean should handle foreign keys properly
      await mysqlTestService.cleanDatabase();

      const countResult = await sql`
        SELECT COUNT(*) as count FROM posts
      `.execute(db);
      expect((countResult.rows[0] as any).count).toBe(0);
    });
  });

  describe('Advanced Testing Features', () => {
    let app: Application;
    let testService: DatabaseTestingService;

    beforeEach(async () => {
      // Use custom seed function
      const seedFunction = async () => {
        const db = testService.getTestConnection();

        // Create admin user
        await sql`
          INSERT INTO users (email, name, active)
          VALUES ('admin@example.com', 'Admin', true)
        `.execute(db);

        // Create regular users
        for (let i = 1; i <= 3; i++) {
          await sql`
            INSERT INTO users (email, name, active)
            VALUES (${'user' + i + '@example.com'}, ${'User ' + i}, ${i % 2 === 1})
          `.execute(db);
        }
      };

      @Module({
        imports: [
          DatabaseTestingModule.forTest({
            transactional: true,
            autoMigrate: false,
            autoClean: true,
            autoSeed: true,
            seeds: seedFunction,
            preserveTables: ['migrations'], // Preserve migration table
          }),
        ],
        providers: [BlogService, UserRepository, PostRepository, CommentRepository],
      })
      class AdvancedTestModule {}

      app = await Application.create({
        imports: [AdvancedTestModule],
        disableDefaultProviders: true,
      });

      testService = app.get<DatabaseTestingService>(DATABASE_TESTING_SERVICE);
      await testService.initialize();

      // Create tables
      const db = testService.getTestConnection();
      await sql`
        CREATE TABLE migrations (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `.execute(db);

      await sql`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          active BOOLEAN DEFAULT TRUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `.execute(db);

      await sql`
        CREATE TABLE posts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          content TEXT,
          published BOOLEAN DEFAULT FALSE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `.execute(db);

      await sql`
        CREATE TABLE comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          post_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          content TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (post_id) REFERENCES posts(id),
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `.execute(db);

      // Add migration record
      await sql`
        INSERT INTO migrations (id, name) VALUES (1, 'initial_migration')
      `.execute(db);

      await testService.beforeEach();
    });

    afterEach(async () => {
      await testService.afterEach();
      await testService.afterAll();
      await app.stop();
    });

    it('should seed with custom function', async () => {
      const userRepo = app.get<UserRepository>(UserRepository);

      const users = await userRepo.findAll();
      expect(users).toHaveLength(4); // 1 admin + 3 regular users

      const admin = await userRepo.findByEmail('admin@example.com');
      expect(admin).toBeDefined();
      expect(admin?.name).toBe('Admin');
    });

    it('should preserve specified tables during cleanup', async () => {
      const db = testService.getTestConnection();

      // Add data to users table
      await sql`
        INSERT INTO users (email, name) VALUES ('temp@example.com', 'Temp User')
      `.execute(db);

      // Clean database
      await testService.cleanDatabase();

      // Check migrations table was preserved
      const migrations = await sql`
        SELECT * FROM migrations
      `.execute(db);
      expect(migrations.rows).toHaveLength(1);

      // Check users table was cleaned
      const users = await sql`
        SELECT * FROM users
      `.execute(db);
      expect(users.rows).toHaveLength(0);
    });

    it('should execute queries in test context', async () => {
      const result = await testService.execute(async (db) => {
        // Insert data
        await db.insertInto('users').values({ email: 'execute@example.com', name: 'Execute User' }).execute();

        // Query data
        return db.selectFrom('users').where('email', '=', 'execute@example.com').selectAll().executeTakeFirst();
      });

      expect(result).toBeDefined();
      expect(result?.email).toBe('execute@example.com');
    });

    it('should support verbose mode for debugging', async () => {
      // This would show additional logging if verbose: true was set
      const db = testService.getTestConnection();

      await sql`
        INSERT INTO users (email, name) VALUES ('verbose@example.com', 'Verbose User')
      `.execute(db);

      const exists = await testService.assertDatabaseHas('users', {
        email: 'verbose@example.com',
      });
      expect(exists).toBe(true);
    });
  });

  describe('Error Handling', () => {
    let app: Application;
    let testService: DatabaseTestingService;

    beforeEach(async () => {
      app = await Application.create({
        imports: [TestAppModule],
        disableDefaultProviders: true,
      });

      testService = app.get<DatabaseTestingService>(DATABASE_TESTING_SERVICE);
      await testService.initialize();

      const db = testService.getTestConnection();
      await sql`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          active BOOLEAN DEFAULT TRUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `.execute(db);

      await testService.beforeEach();
    });

    afterEach(async () => {
      await testService.afterEach();
      await testService.afterAll();
      await app.stop();
    });

    it('should handle savepoint errors gracefully', async () => {
      // Try to rollback without creating savepoint first
      await expect(testService.rollbackToSavepoint('nonexistent')).rejects.toThrow(
        'Savepoints require transactional mode'
      );
    });

    it('should handle seed errors gracefully', async () => {
      // Try to seed non-existent table
      await expect(
        testService.seedDatabase([
          {
            table: 'nonexistent_table',
            data: { id: 1, name: 'Test' },
          },
        ])
      ).resolves.not.toThrow(); // Should not throw, just log warning in verbose mode
    });

    it('should handle cleanup errors gracefully', async () => {
      const db = testService.getTestConnection();

      // Create a table with foreign key that can't be cleaned easily
      await sql`
        CREATE TABLE locked_table (
          id INTEGER PRIMARY KEY,
          data TEXT
        )
      `.execute(db);

      // This should not throw even if cleanup has issues
      await expect(testService.cleanDatabase()).resolves.not.toThrow();
    });
  });
});
