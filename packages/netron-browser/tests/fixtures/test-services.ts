/**
 * Test services for E2E and integration testing
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';

/**
 * Calculator service for basic RPC testing
 */
@Service('calculator@1.0.0')
export class CalculatorService {
  @Public()
  add(a: number, b: number): number {
    return a + b;
  }

  @Public()
  subtract(a: number, b: number): number {
    return a - b;
  }

  @Public()
  multiply(a: number, b: number): number {
    return a * b;
  }

  @Public()
  divide(a: number, b: number): number {
    if (b === 0) {
      throw new Error('Division by zero');
    }
    return a / b;
  }

  @Public()
  async addAsync(a: number, b: number): Promise<number> {
    // Simulate async operation
    await new Promise((resolve) => setTimeout(resolve, 10));
    return a + b;
  }
}

/**
 * User service for testing object operations
 */
@Service('user@1.0.0')
export class UserService {
  private users = new Map<string, any>([
    ['1', { id: '1', name: 'Alice', email: 'alice@example.com', role: 'admin' }],
    ['2', { id: '2', name: 'Bob', email: 'bob@example.com', role: 'user' }],
    ['3', { id: '3', name: 'Charlie', email: 'charlie@example.com', role: 'user' }],
  ]);

  @Public()
  getUser(id: string) {
    const user = this.users.get(id);
    if (!user) {
      throw new Error(`User not found: ${id}`);
    }
    return user;
  }

  @Public()
  createUser(data: { name: string; email: string; role?: string }) {
    const id = String(this.users.size + 1);
    const user = {
      id,
      name: data.name,
      email: data.email,
      role: data.role || 'user',
    };
    this.users.set(id, user);
    return user;
  }

  @Public()
  listUsers() {
    return Array.from(this.users.values());
  }

  @Public()
  updateUser(id: string, data: Partial<{ name: string; email: string; role: string }>) {
    const user = this.users.get(id);
    if (!user) {
      throw new Error(`User not found: ${id}`);
    }
    Object.assign(user, data);
    return user;
  }

  @Public()
  deleteUser(id: string) {
    const user = this.users.get(id);
    if (!user) {
      throw new Error(`User not found: ${id}`);
    }
    this.users.delete(id);
    return { deleted: true, id };
  }
}

/**
 * Echo service for testing various data types
 */
@Service('echo@1.0.0')
export class EchoService {
  @Public()
  echo(message: any): any {
    return message;
  }

  @Public()
  echoString(message: string): string {
    return message;
  }

  @Public()
  echoNumber(value: number): number {
    return value;
  }

  @Public()
  echoBoolean(value: boolean): boolean {
    return value;
  }

  @Public()
  echoObject(obj: any): any {
    return obj;
  }

  @Public()
  echoArray(arr: any[]): any[] {
    return arr;
  }

  @Public()
  async echoAsync(message: any): Promise<any> {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return message;
  }

  @Public()
  throwError(message: string): never {
    throw new Error(message);
  }
}

/**
 * Stream service for future streaming tests
 * Note: Streaming will be implemented in a future iteration
 */
@Service('stream@1.0.0')
export class StreamService {
  @Public()
  async generateNumbers(count: number): Promise<number[]> {
    const numbers: number[] = [];
    for (let i = 0; i < count; i++) {
      numbers.push(i);
    }
    return numbers;
  }

  @Public()
  async generateData(count: number): Promise<any[]> {
    const data: any[] = [];
    for (let i = 0; i < count; i++) {
      data.push({
        id: i,
        timestamp: Date.now(),
        value: Math.random(),
      });
    }
    return data;
  }
}
