/**
 * Test Service for E2E Tests
 * Provides comprehensive RPC, streaming, and event capabilities
 */

import { Service, Method } from '../../../src/netron/index.js';
import { Readable } from 'stream';

export interface User {
  id: string;
  name: string;
  email: string;
  age: number;
}

export interface Message {
  id: string;
  text: string;
  timestamp: number;
}

@Service('TestService@1.0.0')
export class TestService {
  private users: User[] = [
    { id: '1', name: 'Alice', email: 'alice@test.com', age: 30 },
    { id: '2', name: 'Bob', email: 'bob@test.com', age: 25 },
    { id: '3', name: 'Charlie', email: 'charlie@test.com', age: 35 },
  ];

  /**
   * Simple RPC method - returns hello message
   */
  @Method()
  async hello(name: string): Promise<string> {
    await this.delay(50);
    return `Hello, ${name}!`;
  }

  /**
   * Get all users
   */
  @Method()
  async getUsers(): Promise<User[]> {
    await this.delay(100);
    return this.users;
  }

  /**
   * Get user by ID
   */
  @Method()
  async getUser(id: string): Promise<User | null> {
    await this.delay(50);
    return this.users.find((u) => u.id === id) || null;
  }

  /**
   * Create user
   */
  @Method()
  async createUser(user: Omit<User, 'id'>): Promise<User> {
    await this.delay(100);
    const newUser = {
      id: String(this.users.length + 1),
      ...user,
    };
    this.users.push(newUser);
    return newUser;
  }

  /**
   * Update user
   */
  @Method()
  async updateUser(id: string, updates: Partial<User>): Promise<User | null> {
    await this.delay(100);
    const index = this.users.findIndex((u) => u.id === id);
    if (index === -1) return null;

    this.users[index] = { ...this.users[index], ...updates };
    return this.users[index];
  }

  /**
   * Delete user
   */
  @Method()
  async deleteUser(id: string): Promise<boolean> {
    await this.delay(50);
    const index = this.users.findIndex((u) => u.id === id);
    if (index === -1) return false;

    this.users.splice(index, 1);
    return true;
  }

  /**
   * Method that throws an error
   */
  @Method()
  async throwError(message: string): Promise<never> {
    await this.delay(50);
    throw new Error(message);
  }

  /**
   * Method with timeout
   */
  @Method()
  async slowMethod(delayMs: number): Promise<string> {
    await this.delay(delayMs);
    return `Completed after ${delayMs}ms`;
  }

  /**
   * Stream numbers - returns stream of numbers
   */
  @Method()
  async getNumbersStream(count: number): Promise<Readable> {
    const stream = new Readable({
      objectMode: true,
      read() {},
    });

    let current = 0;
    const interval = setInterval(() => {
      if (current >= count) {
        clearInterval(interval);
        stream.push(null);
        return;
      }
      stream.push({ value: current++ });
    }, 100);

    return stream;
  }

  /**
   * Process stream - receives stream and returns count
   */
  @Method()
  async processNumbersStream(stream: Readable): Promise<{ count: number; sum: number }> {
    let count = 0;
    let sum = 0;

    for await (const chunk of stream) {
      count++;
      sum += chunk.value || 0;
    }

    return { count, sum };
  }

  /**
   * Batch operation - for testing batch requests
   */
  @Method()
  async batchOperation(items: string[]): Promise<{ processed: string[]; count: number }> {
    await this.delay(100);
    return {
      processed: items.map((item) => item.toUpperCase()),
      count: items.length,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
