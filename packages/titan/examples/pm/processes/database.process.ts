/**
 * Example: Database Process with Dependencies
 *
 * This example shows how to create a process that manages database connections
 * and accepts dependencies through the init() method.
 */

import { Process, Public, HealthCheck, OnShutdown, Cache, RateLimit } from '../../../src/modules/pm/decorators.js';
import type { IHealthStatus } from '../../../src/modules/pm/types.js';

interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

interface DatabaseConfig {
  host?: string;
  port?: number;
  database?: string;
}

/**
 * Database service that manages user data
 */
@Process({
  name: 'database-service',
  version: '2.0.0',
  health: {
    enabled: true,
    interval: 30000,
    timeout: 5000
  }
})
export default class DatabaseProcess {
  private users = new Map<string, User>();
  private isConnected = false;
  private queryCount = 0;
  private config?: DatabaseConfig;

  /**
   * Initialize the process with dependencies
   * This method is called automatically if dependencies are provided during spawn
   */
  async init(config?: DatabaseConfig) {
    this.config = config || { host: 'localhost', port: 5432, database: 'test' };
    await this.connect();
  }

  private async connect(): Promise<void> {
    // Simulate database connection
    await new Promise(resolve => setTimeout(resolve, 100));
    this.isConnected = true;
    console.log(`Connected to database: ${this.config?.host}:${this.config?.port}/${this.config?.database}`);

    // Seed some data
    this.seedData();
  }

  private seedData(): void {
    const users: User[] = [
      { id: '1', name: 'Alice', email: 'alice@example.com', createdAt: new Date() },
      { id: '2', name: 'Bob', email: 'bob@example.com', createdAt: new Date() },
      { id: '3', name: 'Charlie', email: 'charlie@example.com', createdAt: new Date() }
    ];

    for (const user of users) {
      this.users.set(user.id, user);
    }
  }

  @Public()
  @Cache({ ttl: 5000 })
  async getUser(id: string): Promise<User | null> {
    this.ensureConnected();
    this.queryCount++;

    // Simulate query latency
    await new Promise(resolve => setTimeout(resolve, 10));

    return this.users.get(id) || null;
  }

  @Public()
  async getAllUsers(): Promise<User[]> {
    this.ensureConnected();
    this.queryCount++;

    // Simulate query latency
    await new Promise(resolve => setTimeout(resolve, 20));

    return Array.from(this.users.values());
  }

  @Public()
  @RateLimit({ rps: 10 })
  async createUser(data: Omit<User, 'id' | 'createdAt'>): Promise<User> {
    this.ensureConnected();
    this.queryCount++;

    const user: User = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...data,
      createdAt: new Date()
    };

    this.users.set(user.id, user);
    return user;
  }

  @Public()
  async updateUser(id: string, data: Partial<Omit<User, 'id' | 'createdAt'>>): Promise<User | null> {
    this.ensureConnected();
    this.queryCount++;

    const user = this.users.get(id);
    if (!user) {
      return null;
    }

    const updated = { ...user, ...data };
    this.users.set(id, updated);
    return updated;
  }

  @Public()
  async deleteUser(id: string): Promise<boolean> {
    this.ensureConnected();
    this.queryCount++;

    return this.users.delete(id);
  }

  @Public()
  async searchUsers(query: string): Promise<User[]> {
    this.ensureConnected();
    this.queryCount++;

    const lowerQuery = query.toLowerCase();
    return Array.from(this.users.values()).filter(
      user =>
        user.name.toLowerCase().includes(lowerQuery) ||
        user.email.toLowerCase().includes(lowerQuery)
    );
  }

  @Public()
  async getDatabaseStats(): Promise<{
    userCount: number;
    queryCount: number;
    isConnected: boolean;
    config?: DatabaseConfig;
  }> {
    return {
      userCount: this.users.size,
      queryCount: this.queryCount,
      isConnected: this.isConnected,
      config: this.config
    };
  }

  private ensureConnected(): void {
    if (!this.isConnected) {
      throw new Error('Database not connected');
    }
  }

  @HealthCheck()
  async checkHealth(): Promise<IHealthStatus> {
    const checks = [];

    // Check connection
    checks.push({
      name: 'database-connection',
      status: this.isConnected ? ('pass' as const) : ('fail' as const),
      message: this.isConnected ? 'Connected' : 'Disconnected'
    });

    // Check performance
    if (this.queryCount > 10000) {
      checks.push({
        name: 'query-load',
        status: 'warn' as const,
        message: `High query count: ${this.queryCount}`
      });
    }

    // Overall status
    const hasFailure = checks.some(c => c.status === 'fail');
    const hasWarning = checks.some(c => c.status === 'warn');

    return {
      status: hasFailure ? 'unhealthy' : hasWarning ? 'degraded' : 'healthy',
      checks,
      timestamp: Date.now()
    };
  }

  @OnShutdown()
  async cleanup(): Promise<void> {
    console.log(`Shutting down database service. Processed ${this.queryCount} queries.`);

    // Simulate closing database connection
    this.isConnected = false;
    this.users.clear();
  }
}
