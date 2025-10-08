/**
 * User Service - Test service for Netron e2e tests
 * Provides CRUD operations for testing HTTP transport
 */

import { Service, Public } from '../../../../../titan/src/decorators/core.js';

export interface User {
  id: string;
  name: string;
  email: string;
  age: number;
  active: boolean;
  createdAt: string;
}

export interface CreateUserDto {
  name: string;
  email: string;
  age: number;
}

export interface UpdateUserDto {
  name?: string;
  email?: string;
  age?: number;
  active?: boolean;
}

/**
 * Test User Service
 * Provides CRUD operations for testing
 */
@Service('UserService@1.0.0')
export class UserService {
  private users = new Map<string, User>();
  private idCounter = 0;

  constructor() {
    // Seed with test data
    this.seedTestData();
  }

  private seedTestData() {
    const testUsers: Omit<User, 'id' | 'createdAt'>[] = [
      { name: 'Alice Johnson', email: 'alice@example.com', age: 28, active: true },
      { name: 'Bob Smith', email: 'bob@example.com', age: 35, active: true },
      { name: 'Charlie Brown', email: 'charlie@example.com', age: 42, active: false },
    ];

    testUsers.forEach(userData => {
      const id = this.generateId();
      this.users.set(id, {
        id,
        ...userData,
        createdAt: new Date().toISOString()
      });
    });
  }

  private generateId(): string {
    return `user-${++this.idCounter}`;
  }

  /**
   * Get user by ID
   */
  @Public()
  async getUser(id: string): Promise<User | null> {
    // Simulate network delay
    await this.delay(50);

    const user = this.users.get(id);
    return user || null;
  }

  /**
   * Get all users
   */
  @Public()
  async getUsers(): Promise<User[]> {
    await this.delay(100);
    return Array.from(this.users.values());
  }

  /**
   * Get users with filters
   */
  @Public()
  async findUsers(filters: { active?: boolean; minAge?: number }): Promise<User[]> {
    await this.delay(75);

    let users = Array.from(this.users.values());

    if (filters.active !== undefined) {
      users = users.filter(u => u.active === filters.active);
    }

    if (filters.minAge !== undefined) {
      users = users.filter(u => u.age >= filters.minAge);
    }

    return users;
  }

  /**
   * Create new user
   */
  @Public()
  async createUser(dto: CreateUserDto): Promise<User> {
    await this.delay(100);

    const id = this.generateId();
    const user: User = {
      id,
      name: dto.name,
      email: dto.email,
      age: dto.age,
      active: true,
      createdAt: new Date().toISOString()
    };

    this.users.set(id, user);
    return user;
  }

  /**
   * Update user
   */
  @Public()
  async updateUser(id: string, dto: UpdateUserDto): Promise<User | null> {
    await this.delay(100);

    const user = this.users.get(id);
    if (!user) {
      return null;
    }

    const updated = {
      ...user,
      ...dto
    };

    this.users.set(id, updated);
    return updated;
  }

  /**
   * Delete user
   */
  @Public()
  async deleteUser(id: string): Promise<boolean> {
    await this.delay(50);
    return this.users.delete(id);
  }

  /**
   * Method that throws error (for testing retry)
   */
  @Public()
  async unreliableMethod(shouldFail: boolean): Promise<string> {
    await this.delay(50);

    if (shouldFail) {
      throw new Error('Simulated failure');
    }

    return 'success';
  }

  /**
   * Slow method (for testing timeout)
   */
  @Public()
  async slowMethod(delayMs: number): Promise<string> {
    await this.delay(delayMs);
    return `Completed after ${delayMs}ms`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
