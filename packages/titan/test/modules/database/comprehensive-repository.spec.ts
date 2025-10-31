/**
 * Comprehensive Repository Tests
 *
 * Tests all repository functionality including CRUD operations,
 * querying, pagination, batch operations, and edge cases
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { Application } from '../../../src/application.js';
import { Module, Injectable } from '../../../src/decorators/index.js';
import { Kysely, sql } from 'kysely';
import {
  InjectConnection,
  InjectRepository,
  Repository,
  BaseRepository,
  TitanDatabaseModule,
  DatabaseTestingModule,
  DatabaseTestingService,
} from '../../../src/modules/database/index.js';
import { DatabaseTestManager, DockerContainer } from '../../utils/docker-test-manager.js';

// Test entities
interface User {
  id: number;
  email: string;
  username: string;
  full_name: string;
  age: number;
  is_active: boolean;
  metadata?: any;
  created_at: Date;
  updated_at: Date;
}

interface Post {
  id: number;
  user_id: number;
  title: string;
  content: string;
  slug: string;
  status: 'draft' | 'published' | 'archived';
  view_count: number;
  tags?: string[];
  published_at?: Date;
  created_at: Date;
  updated_at: Date;
}

interface Comment {
  id: number;
  post_id: number;
  user_id: number;
  parent_id?: number;
  content: string;
  likes: number;
  is_approved: boolean;
  created_at: Date;
}

// Repository definitions
@Repository<User>({
  table: 'users',
  timestamps: true,
  softDelete: false,
})
class UserRepository extends BaseRepository<any, 'users', User, Partial<User>, Partial<User>> {
  async findByEmail(email: string): Promise<User | null> {
    return this.findOne({ email });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.findOne({ username });
  }

  async findActiveUsers(): Promise<User[]> {
    return this.findAll({ where: { is_active: true } });
  }

  async findByAgeRange(minAge: number, maxAge: number): Promise<User[]> {
    const db = await this.getDb();
    return db
      .selectFrom('users')
      .selectAll()
      .where('age', '>=', minAge)
      .where('age', '<=', maxAge)
      .orderBy('age', 'asc')
      .execute() as Promise<User[]>;
  }

  async incrementAge(userId: number): Promise<User | null> {
    const db = await this.getDb();
    const result = await db
      .updateTable('users')
      .set((eb: any) => ({ age: eb('age', '+', 1) }))
      .where('id', '=', userId)
      .returningAll()
      .executeTakeFirst();
    return result as User | null;
  }

  async searchUsers(query: string): Promise<User[]> {
    const db = await this.getDb();
    return db
      .selectFrom('users')
      .selectAll()
      .where((eb: any) =>
        eb.or([
          eb('username', 'like', `%${query}%`),
          eb('full_name', 'like', `%${query}%`),
          eb('email', 'like', `%${query}%`),
        ])
      )
      .execute() as Promise<User[]>;
  }

  private async getDb() {
    // Access the injected database connection through the base class
    return (this as any).qb || (this as any).db;
  }
}

@Repository<Post>({
  table: 'posts',
  timestamps: true,
  softDelete: true,
})
class PostRepository extends BaseRepository<any, 'posts', Post, Partial<Post>, Partial<Post>> {
  async findBySlug(slug: string): Promise<Post | null> {
    return this.findOne({ slug });
  }

  async findPublished(): Promise<Post[]> {
    return this.findAll({
      where: { status: 'published' },
      orderBy: [{ column: 'published_at', direction: 'desc' }],
    });
  }

  async findByUserId(userId: number): Promise<Post[]> {
    return this.findAll({ where: { user_id: userId } });
  }

  async incrementViewCount(postId: number): Promise<void> {
    const db = await this.getDb();
    await db
      .updateTable('posts')
      .set((eb: any) => ({ view_count: eb('view_count', '+', 1) }))
      .where('id', '=', postId)
      .execute();
  }

  async findByTags(tags: string[]): Promise<Post[]> {
    const db = await this.getDb();
    return db
      .selectFrom('posts')
      .selectAll()
      .where((eb: any) => {
        const conditions = tags.map((tag) => sql`${sql.ref('tags')} @> ${JSON.stringify([tag])}`);
        return eb.or(conditions);
      })
      .execute() as Promise<Post[]>;
  }

  async getPopularPosts(limit: number = 10): Promise<Post[]> {
    const db = await this.getDb();
    return db
      .selectFrom('posts')
      .selectAll()
      .where('status', '=', 'published')
      .orderBy('view_count', 'desc')
      .limit(limit)
      .execute() as Promise<Post[]>;
  }

  private async getDb() {
    return (this as any).qb || (this as any).db;
  }
}

@Repository<Comment>({
  table: 'comments',
  timestamps: false,
})
class CommentRepository extends BaseRepository<any, 'comments', Comment, Partial<Comment>, Partial<Comment>> {
  async findByPostId(postId: number): Promise<Comment[]> {
    return this.findAll({
      where: { post_id: postId },
      orderBy: [{ column: 'created_at', direction: 'desc' }],
    });
  }

  async findApprovedComments(postId: number): Promise<Comment[]> {
    return this.findAll({
      where: { post_id: postId, is_approved: true },
    });
  }

  async findThreadedComments(postId: number): Promise<Comment[]> {
    const db = await this.getDb();
    return db
      .selectFrom('comments')
      .selectAll()
      .where('post_id', '=', postId)
      .where('parent_id', 'is', null)
      .orderBy('created_at', 'asc')
      .execute() as Promise<Comment[]>;
  }

  async findReplies(parentId: number): Promise<Comment[]> {
    return this.findAll({ where: { parent_id: parentId } });
  }

  async incrementLikes(commentId: number): Promise<void> {
    const db = await this.getDb();
    await db
      .updateTable('comments')
      .set((eb: any) => ({ likes: eb('likes', '+', 1) }))
      .where('id', '=', commentId)
      .execute();
  }

  private async getDb() {
    return (this as any).qb || (this as any).db;
  }
}

// Service that uses repositories
@Injectable()
class BlogService {
  constructor(
    @InjectRepository(UserRepository) private userRepo: UserRepository,
    @InjectRepository(PostRepository) private postRepo: PostRepository,
    @InjectRepository(CommentRepository) private commentRepo: CommentRepository,
    @InjectConnection() private db: Kysely<any>
  ) {}

  async createBlogPost(userId: number, data: Partial<Post>): Promise<Post> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const slug = this.generateSlug(data.title || '');
    return this.postRepo.create({
      ...data,
      user_id: userId,
      slug,
      status: data.status || 'draft',
      view_count: 0,
    });
  }

  async publishPost(postId: number): Promise<Post> {
    return this.postRepo.update(postId, {
      status: 'published',
      published_at: new Date(),
    });
  }

  async getUserWithPosts(userId: number): Promise<any> {
    const user = await this.userRepo.findById(userId);
    if (!user) return null;

    const posts = await this.postRepo.findByUserId(userId);
    return { ...user, posts };
  }

  async getPostWithComments(postId: number): Promise<any> {
    const post = await this.postRepo.findById(postId);
    if (!post) return null;

    const comments = await this.commentRepo.findByPostId(postId);
    await this.postRepo.incrementViewCount(postId);

    return { ...post, comments };
  }

  async getStatistics(): Promise<any> {
    const totalUsers = await this.userRepo.count();
    const activeUsers = await this.userRepo.count({ is_active: true });
    const totalPosts = await this.postRepo.count();
    const publishedPosts = await this.postRepo.count({ status: 'published' });
    const totalComments = await this.commentRepo.count();

    return {
      users: { total: totalUsers, active: activeUsers },
      posts: { total: totalPosts, published: publishedPosts },
      comments: { total: totalComments },
    };
  }

  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}

// Test module
@Module({
  imports: [
    DatabaseTestingModule.forTest({
      transactional: true,
      autoMigrate: false,
      autoClean: true,
    }),
    TitanDatabaseModule.forFeature([UserRepository, PostRepository, CommentRepository]),
  ],
  providers: [BlogService],
})
class TestModule {}

describe('Comprehensive Repository Tests', () => {
  describe('SQLite In-Memory Tests', () => {
    let app: Application;
    let testService: DatabaseTestingService;
    let userRepo: UserRepository;
    let postRepo: PostRepository;
    let commentRepo: CommentRepository;
    let blogService: BlogService;
    let db: Kysely<any>;

    beforeAll(async () => {
      app = await Application.create(TestModule, {
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      testService = await app.resolveAsync(DatabaseTestingService);
      userRepo = await app.resolveAsync(UserRepository);
      postRepo = await app.resolveAsync(PostRepository);
      commentRepo = await app.resolveAsync(CommentRepository);
      blogService = await app.resolveAsync(BlogService);

      await testService.initialize();
      // Get connection asynchronously via execute() helper
      db = await new Promise(async (resolve) => {
        await testService.execute(async (connection) => {
          resolve(connection);
          return connection;
        });
      });

      // Create schema
      await createSchema(db);
    });

    afterAll(async () => {
      await testService.afterAll();
      await app.stop();
    });

    beforeEach(async () => {
      await testService.beforeEach();
    });

    afterEach(async () => {
      await testService.afterEach();
    });

    describe('Basic CRUD Operations', () => {
      it('should create entities', async () => {
        const user = await userRepo.create({
          email: 'john@example.com',
          username: 'johndoe',
          full_name: 'John Doe',
          age: 30,
          is_active: true,
        });

        expect(user).toBeDefined();
        expect(user.id).toBeDefined();
        expect(user.email).toBe('john@example.com');
        expect(user.created_at).toBeDefined();
        expect(user.updated_at).toBeDefined();
      });

      it('should read entities by ID', async () => {
        const created = await userRepo.create({
          email: 'jane@example.com',
          username: 'janedoe',
          full_name: 'Jane Doe',
          age: 28,
          is_active: true,
        });

        const found = await userRepo.findById(created.id);
        expect(found).toBeDefined();
        expect(found?.id).toBe(created.id);
        expect(found?.email).toBe('jane@example.com');
      });

      it('should update entities', async () => {
        const user = await userRepo.create({
          email: 'update@example.com',
          username: 'updateuser',
          full_name: 'Update User',
          age: 25,
          is_active: true,
        });

        const updated = await userRepo.update(user.id, {
          full_name: 'Updated Name',
          age: 26,
        });

        expect(updated.full_name).toBe('Updated Name');
        expect(updated.age).toBe(26);
        expect(updated.email).toBe('update@example.com');
      });

      it('should delete entities', async () => {
        const user = await userRepo.create({
          email: 'delete@example.com',
          username: 'deleteuser',
          full_name: 'Delete User',
          age: 30,
          is_active: true,
        });

        await userRepo.delete(user.id);

        const found = await userRepo.findById(user.id);
        expect(found).toBeNull();
      });
    });

    describe('Querying and Filtering', () => {
      beforeEach(async () => {
        // Seed test data
        await userRepo.create({
          email: 'alice@example.com',
          username: 'alice',
          full_name: 'Alice Smith',
          age: 25,
          is_active: true,
        });

        await userRepo.create({
          email: 'bob@example.com',
          username: 'bob',
          full_name: 'Bob Johnson',
          age: 35,
          is_active: true,
        });

        await userRepo.create({
          email: 'charlie@example.com',
          username: 'charlie',
          full_name: 'Charlie Brown',
          age: 45,
          is_active: false,
        });
      });

      it('should find entities by conditions', async () => {
        const user = await userRepo.findOne({ email: 'alice@example.com' });
        expect(user).toBeDefined();
        expect(user?.username).toBe('alice');
      });

      it('should find all entities matching conditions', async () => {
        const activeUsers = await userRepo.findAll({
          where: { is_active: true },
        });
        expect(activeUsers).toHaveLength(2);
      });

      it('should support custom query methods', async () => {
        const users = await userRepo.findByAgeRange(30, 40);
        expect(users).toHaveLength(1);
        expect(users[0].username).toBe('bob');
      });

      it('should support search functionality', async () => {
        const results = await userRepo.searchUsers('john');
        expect(results).toHaveLength(1);
        expect(results[0].username).toBe('bob');
      });

      it('should count entities', async () => {
        const total = await userRepo.count();
        expect(total).toBe(3);

        const activeCount = await userRepo.count({ is_active: true });
        expect(activeCount).toBe(2);
      });

      it('should support ordering', async () => {
        const users = await userRepo.findAll({
          orderBy: [{ column: 'age', direction: 'desc' }],
        });

        expect(users[0].age).toBe(45);
        expect(users[1].age).toBe(35);
        expect(users[2].age).toBe(25);
      });

      it('should support limiting results', async () => {
        const users = await userRepo.findAll({
          limit: 2,
          orderBy: [{ column: 'age', direction: 'asc' }],
        });

        expect(users).toHaveLength(2);
        expect(users[0].age).toBe(25);
        expect(users[1].age).toBe(35);
      });
    });

    describe('Batch Operations', () => {
      it('should create multiple entities', async () => {
        const users = await userRepo.createMany([
          { email: 'user1@example.com', username: 'user1', full_name: 'User 1', age: 20, is_active: true },
          { email: 'user2@example.com', username: 'user2', full_name: 'User 2', age: 21, is_active: true },
          { email: 'user3@example.com', username: 'user3', full_name: 'User 3', age: 22, is_active: true },
        ]);

        expect(users).toHaveLength(3);
        users.forEach((user, index) => {
          expect(user.username).toBe(`user${index + 1}`);
        });
      });

      it('should update multiple entities', async () => {
        const users = await userRepo.createMany([
          { email: 'batch1@example.com', username: 'batch1', full_name: 'Batch 1', age: 30, is_active: false },
          { email: 'batch2@example.com', username: 'batch2', full_name: 'Batch 2', age: 31, is_active: false },
        ]);

        const updated = await userRepo.updateMany({ is_active: false }, { is_active: true });

        expect(updated).toBe(2);

        const activeUsers = await userRepo.findAll({ where: { is_active: true } });
        expect(activeUsers.length).toBeGreaterThanOrEqual(2);
      });

      it('should delete multiple entities', async () => {
        await userRepo.createMany([
          { email: 'del1@example.com', username: 'del1', full_name: 'Del 1', age: 40, is_active: true },
          { email: 'del2@example.com', username: 'del2', full_name: 'Del 2', age: 41, is_active: true },
        ]);

        const deleted = await userRepo.deleteMany({ age: 40 });
        expect(deleted).toBe(1);

        const remaining = await userRepo.findOne({ username: 'del1' });
        expect(remaining).toBeNull();
      });
    });

    describe('Pagination', () => {
      beforeEach(async () => {
        // Create 20 users for pagination tests
        const users = [];
        for (let i = 1; i <= 20; i++) {
          users.push({
            email: `page${i}@example.com`,
            username: `page${i}`,
            full_name: `Page User ${i}`,
            age: 20 + i,
            is_active: true,
          });
        }
        await userRepo.createMany(users);
      });

      it('should paginate with offset-based pagination', async () => {
        const page1 = await userRepo.paginate({
          page: 1,
          limit: 5,
        });

        expect(page1.data).toHaveLength(5);
        expect(page1.pagination.total).toBe(20);
        expect(page1.pagination.totalPages).toBe(4);
        expect(page1.pagination.currentPage).toBe(1);

        const page2 = await userRepo.paginate({
          page: 2,
          limit: 5,
        });

        expect(page2.data).toHaveLength(5);
        expect(page2.pagination.currentPage).toBe(2);
      });

      it('should paginate with cursor-based pagination', async () => {
        const firstPage = await userRepo.paginate({
          limit: 5,
          cursor: undefined,
        });

        expect(firstPage.data).toHaveLength(5);
        expect(firstPage.pagination.hasMore).toBe(true);
        expect(firstPage.pagination.nextCursor).toBeDefined();

        if (firstPage.pagination.nextCursor) {
          const secondPage = await userRepo.paginate({
            limit: 5,
            cursor: firstPage.pagination.nextCursor,
          });

          expect(secondPage.data).toHaveLength(5);
          expect(secondPage.pagination.prevCursor).toBeDefined();
        }
      });
    });

    describe('Relationships and Complex Queries', () => {
      let user1: User, user2: User;
      let post1: Post, post2: Post;

      beforeEach(async () => {
        user1 = await userRepo.create({
          email: 'author1@example.com',
          username: 'author1',
          full_name: 'Author One',
          age: 30,
          is_active: true,
        });

        user2 = await userRepo.create({
          email: 'author2@example.com',
          username: 'author2',
          full_name: 'Author Two',
          age: 35,
          is_active: true,
        });

        post1 = await postRepo.create({
          user_id: user1.id,
          title: 'First Post',
          content: 'Content of first post',
          slug: 'first-post',
          status: 'published',
          view_count: 0,
          tags: ['tech', 'tutorial'],
          published_at: new Date(),
        });

        post2 = await postRepo.create({
          user_id: user1.id,
          title: 'Second Post',
          content: 'Content of second post',
          slug: 'second-post',
          status: 'draft',
          view_count: 0,
          tags: ['news'],
        });

        await commentRepo.create({
          post_id: post1.id,
          user_id: user2.id,
          content: 'Great post!',
          likes: 0,
          is_approved: true,
          created_at: new Date(),
        });
      });

      it('should handle one-to-many relationships', async () => {
        const userPosts = await postRepo.findByUserId(user1.id);
        expect(userPosts).toHaveLength(2);
        expect(userPosts[0].user_id).toBe(user1.id);
      });

      it('should handle complex service operations', async () => {
        const userWithPosts = await blogService.getUserWithPosts(user1.id);
        expect(userWithPosts).toBeDefined();
        expect(userWithPosts.posts).toHaveLength(2);
      });

      it('should aggregate data across entities', async () => {
        const stats = await blogService.getStatistics();
        expect(stats.users.total).toBeGreaterThanOrEqual(2);
        expect(stats.posts.total).toBeGreaterThanOrEqual(2);
        expect(stats.comments.total).toBeGreaterThanOrEqual(1);
      });

      it('should handle post-specific queries', async () => {
        const publishedPosts = await postRepo.findPublished();
        expect(publishedPosts).toHaveLength(1);
        expect(publishedPosts[0].slug).toBe('first-post');

        const postBySlug = await postRepo.findBySlug('first-post');
        expect(postBySlug).toBeDefined();
        expect(postBySlug?.title).toBe('First Post');
      });

      it('should handle comment operations', async () => {
        const comments = await commentRepo.findByPostId(post1.id);
        expect(comments).toHaveLength(1);

        const approvedComments = await commentRepo.findApprovedComments(post1.id);
        expect(approvedComments).toHaveLength(1);
      });

      it('should increment counters correctly', async () => {
        await postRepo.incrementViewCount(post1.id);
        const updatedPost = await postRepo.findById(post1.id);
        expect(updatedPost?.view_count).toBe(1);

        await userRepo.incrementAge(user1.id);
        const updatedUser = await userRepo.findById(user1.id);
        expect(updatedUser?.age).toBe(31);
      });
    });

    describe('Error Handling', () => {
      it('should handle duplicate key errors', async () => {
        await userRepo.create({
          email: 'unique@example.com',
          username: 'uniqueuser',
          full_name: 'Unique User',
          age: 30,
          is_active: true,
        });

        await expect(
          userRepo.create({
            email: 'unique@example.com',
            username: 'anotheruser',
            full_name: 'Another User',
            age: 25,
            is_active: true,
          })
        ).rejects.toThrow();
      });

      it('should handle not found errors', async () => {
        const notFound = await userRepo.findById(999999);
        expect(notFound).toBeNull();

        await expect(userRepo.update(999999, { full_name: 'Test' })).rejects.toThrow();
      });

      it('should handle invalid data types', async () => {
        await expect(
          userRepo.create({
            email: 'invalid@example.com',
            username: 'invaliduser',
            full_name: 'Invalid User',
            age: 'not a number' as any,
            is_active: true,
          })
        ).rejects.toThrow();
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty results', async () => {
        const noResults = await userRepo.findAll({
          where: { email: 'nonexistent@example.com' },
        });
        expect(noResults).toHaveLength(0);
      });

      it('should handle null values', async () => {
        const post = await postRepo.create({
          user_id: 1,
          title: 'Post without published date',
          content: 'Content',
          slug: 'no-publish-date',
          status: 'draft',
          view_count: 0,
          published_at: undefined,
        });

        expect(post.published_at).toBeUndefined();
      });

      it('should handle JSON fields', async () => {
        const user = await userRepo.create({
          email: 'json@example.com',
          username: 'jsonuser',
          full_name: 'JSON User',
          age: 30,
          is_active: true,
          metadata: { preferences: { theme: 'dark' } },
        });

        const found = await userRepo.findById(user.id);
        expect(found?.metadata).toBeDefined();
        expect(found?.metadata?.preferences?.theme).toBe('dark');
      });

      it('should handle array fields', async () => {
        const post = await postRepo.create({
          user_id: 1,
          title: 'Post with tags',
          content: 'Content',
          slug: 'post-with-tags',
          status: 'published',
          view_count: 0,
          tags: ['javascript', 'typescript', 'node'],
        });

        const found = await postRepo.findById(post.id);
        expect(found?.tags).toHaveLength(3);
        expect(found?.tags).toContain('typescript');
      });
    });
  });

  describe('PostgreSQL Tests', () => {
    let container: DockerContainer;
    let app: Application;
    let testService: DatabaseTestingService;
    let userRepo: UserRepository;
    let postRepo: PostRepository;
    let blogService: BlogService;

    beforeAll(async () => {
      // Start PostgreSQL container
      container = await DatabaseTestManager.createPostgresContainer({
        database: 'test_repo',
        user: 'test',
        password: 'test',
      });

      const port = container.ports.get(5432)!;

      // Create test module
      @Module({
        imports: [
          DatabaseTestingModule.forTest({
            connection: {
              dialect: 'postgres',
              connection: {
                host: 'localhost',
                port,
                database: 'test_repo',
                user: 'test',
                password: 'test',
              },
            },
            transactional: true,
            autoClean: true,
          }),
        ],
        providers: [BlogService, UserRepository, PostRepository, CommentRepository],
      })
      class PgTestModule {}

      app = await Application.create(PgTestModule, {
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      testService = await app.resolveAsync(DatabaseTestingService);
      userRepo = await app.resolveAsync(UserRepository);
      postRepo = await app.resolveAsync(PostRepository);
      blogService = await app.resolveAsync(BlogService);

      await testService.initialize();
      const db = testService.getTestConnection();
      await createPostgresSchema(db);
    }, 60000);

    afterAll(async () => {
      await testService.afterAll();
      await app.stop();
      await container.cleanup();
    });

    beforeEach(async () => {
      await testService.beforeEach();
    });

    afterEach(async () => {
      await testService.afterEach();
    });

    it('should handle PostgreSQL-specific features', async () => {
      // Test JSONB operations
      const user = await userRepo.create({
        email: 'pg@example.com',
        username: 'pguser',
        full_name: 'PG User',
        age: 30,
        is_active: true,
        metadata: {
          preferences: {
            language: 'en',
            notifications: true,
          },
        },
      });

      const found = await userRepo.findById(user.id);
      expect(found?.metadata?.preferences?.language).toBe('en');

      // Test array operations
      const post = await postRepo.create({
        user_id: user.id,
        title: 'PostgreSQL Arrays',
        content: 'Testing array support',
        slug: 'pg-arrays',
        status: 'published',
        view_count: 0,
        tags: ['postgres', 'arrays', 'json'],
      });

      const foundPost = await postRepo.findById(post.id);
      expect(foundPost?.tags).toHaveLength(3);
    });

    it('should handle PostgreSQL transactions', async () => {
      const user = await userRepo.create({
        email: 'tx@example.com',
        username: 'txuser',
        full_name: 'TX User',
        age: 25,
        is_active: true,
      });

      const postWithComments = await blogService.createBlogPost(user.id, {
        title: 'Transaction Test',
        content: 'Testing transactions',
        status: 'published',
      });

      expect(postWithComments).toBeDefined();
      expect(postWithComments.user_id).toBe(user.id);
    });

    it('should handle PostgreSQL text search', async () => {
      await userRepo.createMany([
        {
          email: 'search1@example.com',
          username: 'searchuser1',
          full_name: 'John Search Smith',
          age: 30,
          is_active: true,
        },
        {
          email: 'search2@example.com',
          username: 'searchuser2',
          full_name: 'Jane Finding Doe',
          age: 25,
          is_active: true,
        },
        {
          email: 'search3@example.com',
          username: 'searchuser3',
          full_name: 'Bob Query Johnson',
          age: 35,
          is_active: true,
        },
      ]);

      const results = await userRepo.searchUsers('John');
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('MySQL Tests', () => {
    let container: DockerContainer;
    let app: Application;
    let testService: DatabaseTestingService;
    let userRepo: UserRepository;
    let postRepo: PostRepository;

    beforeAll(async () => {
      // Start MySQL container
      container = await DatabaseTestManager.createMySQLContainer({
        database: 'test_repo',
        user: 'test',
        password: 'test',
        rootPassword: 'root',
      });

      const port = container.ports.get(3306)!;

      // Create test module
      @Module({
        imports: [
          DatabaseTestingModule.forTest({
            connection: {
              dialect: 'mysql',
              connection: {
                host: 'localhost',
                port,
                database: 'test_repo',
                user: 'test',
                password: 'test',
              },
            },
            transactional: true,
            autoClean: true,
          }),
        ],
        providers: [BlogService, UserRepository, PostRepository, CommentRepository],
      })
      class MySQLTestModule {}

      app = await Application.create(MySQLTestModule, {
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      testService = await app.resolveAsync(DatabaseTestingService);
      userRepo = await app.resolveAsync(UserRepository);
      postRepo = await app.resolveAsync(PostRepository);

      await testService.initialize();
      const db = testService.getTestConnection();
      await createMySQLSchema(db);
    }, 60000);

    afterAll(async () => {
      await testService.afterAll();
      await app.stop();
      await container.cleanup();
    });

    beforeEach(async () => {
      await testService.beforeEach();
    });

    afterEach(async () => {
      await testService.afterEach();
    });

    it('should handle MySQL-specific features', async () => {
      const user = await userRepo.create({
        email: 'mysql@example.com',
        username: 'mysqluser',
        full_name: 'MySQL User',
        age: 30,
        is_active: true,
        metadata: JSON.stringify({ test: 'data' }),
      });

      const found = await userRepo.findById(user.id);
      expect(found).toBeDefined();

      // MySQL returns boolean as 0/1
      expect(found?.is_active).toBeTruthy();
    });

    it('should handle MySQL auto-increment', async () => {
      const user1 = await userRepo.create({
        email: 'auto1@example.com',
        username: 'auto1',
        full_name: 'Auto 1',
        age: 20,
        is_active: true,
      });

      const user2 = await userRepo.create({
        email: 'auto2@example.com',
        username: 'auto2',
        full_name: 'Auto 2',
        age: 21,
        is_active: true,
      });

      expect(user2.id).toBeGreaterThan(user1.id);
    });
  });
});

// Helper functions for schema creation
async function createSchema(db: Kysely<any>) {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      age INTEGER NOT NULL,
      is_active BOOLEAN DEFAULT 1,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      slug TEXT NOT NULL UNIQUE,
      status TEXT CHECK(status IN ('draft', 'published', 'archived')),
      view_count INTEGER DEFAULT 0,
      tags TEXT,
      published_at DATETIME,
      deleted_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      parent_id INTEGER,
      content TEXT NOT NULL,
      likes INTEGER DEFAULT 0,
      is_approved BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (parent_id) REFERENCES comments(id)
    )
  `.execute(db);
}

async function createPostgresSchema(db: Kysely<any>) {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      username VARCHAR(255) NOT NULL UNIQUE,
      full_name VARCHAR(255) NOT NULL,
      age INTEGER NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      metadata JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      title VARCHAR(255) NOT NULL,
      content TEXT,
      slug VARCHAR(255) NOT NULL UNIQUE,
      status VARCHAR(20) CHECK(status IN ('draft', 'published', 'archived')),
      view_count INTEGER DEFAULT 0,
      tags TEXT[],
      published_at TIMESTAMP,
      deleted_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      parent_id INTEGER REFERENCES comments(id),
      content TEXT NOT NULL,
      likes INTEGER DEFAULT 0,
      is_approved BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `.execute(db);
}

async function createMySQLSchema(db: Kysely<any>) {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      username VARCHAR(255) NOT NULL UNIQUE,
      full_name VARCHAR(255) NOT NULL,
      age INT NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      metadata JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS posts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      content TEXT,
      slug VARCHAR(255) NOT NULL UNIQUE,
      status ENUM('draft', 'published', 'archived'),
      view_count INT DEFAULT 0,
      tags JSON,
      published_at TIMESTAMP NULL,
      deleted_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS comments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      post_id INT NOT NULL,
      user_id INT NOT NULL,
      parent_id INT,
      content TEXT NOT NULL,
      likes INT DEFAULT 0,
      is_approved BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (parent_id) REFERENCES comments(id)
    )
  `.execute(db);
}
