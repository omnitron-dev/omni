/**
 * Example User Repository Implementation
 *
 * Showcases repository pattern with soft delete, timestamps, and custom methods
 */

import { z } from 'zod';
import { Repository, SoftDelete, Timestamps } from '../database.decorators.js';
import { BaseRepository } from '../repository/base.repository.js';
import { Injectable } from '../../../decorators/index.js';
import type { Selectable } from 'kysely';

// Define schemas using Zod for validation
export const UserEntitySchema = z.object({
  id: z.number(),
  email: z.string().email(),
  username: z.string().min(3).max(20),
  password: z.string(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  isActive: z.boolean().default(true),
  lastLoginAt: z.date().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  deletedAt: z.date().nullable().optional(),
});

export const CreateUserSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(20),
  password: z.string().min(8),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  isActive: z.boolean().default(true),
});

export const UpdateUserSchema = z.object({
  email: z.string().email().optional(),
  username: z.string().min(3).max(20).optional(),
  password: z.string().min(8).optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  isActive: z.boolean().optional(),
  lastLoginAt: z.date().optional(),
});

// Type definitions
export type User = z.infer<typeof UserEntitySchema>;
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

// Database schema interface
interface Database {
  users: {
    id: number;
    email: string;
    username: string;
    password: string;
    first_name: string | null;
    last_name: string | null;
    is_active: boolean;
    last_login_at: Date | null;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
  };
}

/**
 * User Repository with full features
 */
@Injectable()
@Repository<User>({
  table: 'users',
  schema: UserEntitySchema,
  createSchema: CreateUserSchema,
  updateSchema: UpdateUserSchema,
})
@SoftDelete({ column: 'deleted_at' })
@Timestamps({ createdAt: 'created_at', updatedAt: 'updated_at' })
export class UserRepository extends BaseRepository<Database, 'users', User, CreateUserInput, UpdateUserInput> {
  /**
   * Map database row to entity
   */
  protected mapRow(row: Selectable<Database['users']>): User {
    return {
      id: row.id,
      email: row.email,
      username: row.username,
      password: row.password,
      firstName: row.first_name || undefined,
      lastName: row.last_name || undefined,
      isActive: row.is_active,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
  }

  /**
   * Map entity to database row
   */
  protected mapToDb(entity: Partial<User>): any {
    const dbRow: any = {};

    if (entity.email !== undefined) dbRow.email = entity.email;
    if (entity.username !== undefined) dbRow.username = entity.username;
    if (entity.password !== undefined) dbRow.password = entity.password;
    if (entity.firstName !== undefined) dbRow.first_name = entity.firstName;
    if (entity.lastName !== undefined) dbRow.last_name = entity.lastName;
    if (entity.isActive !== undefined) dbRow.is_active = entity.isActive;
    if (entity.lastLoginAt !== undefined) dbRow.last_login_at = entity.lastLoginAt;

    return dbRow;
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    const result = await this.query().where('email', '=', email).selectAll().executeTakeFirst();

    return result ? this.mapRow(result) : null;
  }

  /**
   * Find user by username
   */
  async findByUsername(username: string): Promise<User | null> {
    const result = await this.query().where('username', '=', username).selectAll().executeTakeFirst();

    return result ? this.mapRow(result) : null;
  }

  /**
   * Find all active users
   */
  async findActiveUsers(): Promise<User[]> {
    const results = await this.query()
      .where('is_active', '=', true)
      .where('deleted_at', 'is', null)
      .orderBy('username', 'asc')
      .selectAll()
      .execute();

    return results.map((row) => this.mapRow(row));
  }

  /**
   * Search users by name
   */
  async searchByName(searchTerm: string): Promise<User[]> {
    const term = `%${searchTerm}%`;

    const results = await this.query()
      .where((qb) => qb.where('first_name', 'like', term).or('last_name', 'like', term).or('username', 'like', term))
      .where('deleted_at', 'is', null)
      .selectAll()
      .execute();

    return results.map((row) => this.mapRow(row));
  }

  /**
   * Update last login timestamp
   */
  async updateLastLogin(userId: number): Promise<void> {
    await this.qb.updateTable('users').set({ last_login_at: new Date() }).where('id', '=', userId).execute();
  }

  /**
   * Get users with pagination and filtering
   */
  async findPaginated(options: {
    page?: number;
    limit?: number;
    isActive?: boolean;
    search?: string;
    orderBy?: 'username' | 'email' | 'created_at';
    orderDir?: 'asc' | 'desc';
  }) {
    let query = this.query().where('deleted_at', 'is', null);

    // Apply filters
    if (options.isActive !== undefined) {
      query = query.where('is_active', '=', options.isActive);
    }

    if (options.search) {
      const term = `%${options.search}%`;
      query = query.where((qb) =>
        qb
          .where('username', 'like', term)
          .or('email', 'like', term)
          .or('first_name', 'like', term)
          .or('last_name', 'like', term)
      );
    }

    // Apply ordering
    const orderBy = options.orderBy || 'username';
    const orderDir = options.orderDir || 'asc';
    query = query.orderBy(orderBy, orderDir);

    // Get paginated results
    return this.paginate({
      page: options.page,
      limit: options.limit,
    });
  }

  /**
   * Check if email is available
   */
  async isEmailAvailable(email: string): Promise<boolean> {
    const result = await this.query()
      .where('email', '=', email)
      .where('deleted_at', 'is', null)
      .select('id')
      .executeTakeFirst();

    return !result;
  }

  /**
   * Check if username is available
   */
  async isUsernameAvailable(username: string): Promise<boolean> {
    const result = await this.query()
      .where('username', '=', username)
      .where('deleted_at', 'is', null)
      .select('id')
      .executeTakeFirst();

    return !result;
  }

  /**
   * Bulk activate/deactivate users
   */
  async bulkUpdateStatus(userIds: number[], isActive: boolean): Promise<void> {
    await this.qb
      .updateTable('users')
      .set({ is_active: isActive, updated_at: new Date() })
      .where('id', 'in', userIds)
      .execute();
  }

  /**
   * Get user statistics
   */
  async getUserStatistics() {
    const db = this.qb;

    const [totalUsers, activeUsers, deletedUsers, recentLogins] = await Promise.all([
      // Total users
      db.selectFrom('users').select(db.fn.count('id').as('count')).executeTakeFirst(),

      // Active users
      db
        .selectFrom('users')
        .where('is_active', '=', true)
        .where('deleted_at', 'is', null)
        .select(db.fn.count('id').as('count'))
        .executeTakeFirst(),

      // Deleted users
      db
        .selectFrom('users')
        .where('deleted_at', 'is not', null)
        .select(db.fn.count('id').as('count'))
        .executeTakeFirst(),

      // Recent logins (last 7 days)
      db
        .selectFrom('users')
        .where('last_login_at', '>', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
        .select(db.fn.count('id').as('count'))
        .executeTakeFirst(),
    ]);

    return {
      total: Number(totalUsers?.count || 0),
      active: Number(activeUsers?.count || 0),
      deleted: Number(deletedUsers?.count || 0),
      recentLogins: Number(recentLogins?.count || 0),
    };
  }
}
