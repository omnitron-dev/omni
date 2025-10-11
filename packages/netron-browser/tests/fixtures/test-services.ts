/**
 * Test services for E2E and integration testing
 */

import { Service, Method } from '@omnitron-dev/titan/decorators';

/**
 * Calculator service for basic RPC testing
 */
@Service('calculator@1.0.0')
export class CalculatorService {
  @Method()
  add(a: number, b: number): number {
    return a + b;
  }

  @Method()
  subtract(a: number, b: number): number {
    return a - b;
  }

  @Method()
  multiply(a: number, b: number): number {
    return a * b;
  }

  @Method()
  divide(a: number, b: number): number {
    if (b === 0) {
      throw new Error('Division by zero');
    }
    return a / b;
  }

  @Method()
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

  @Method()
  getUser(id: string) {
    const user = this.users.get(id);
    if (!user) {
      throw new Error(`User not found: ${id}`);
    }
    return user;
  }

  @Method()
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

  @Method()
  listUsers() {
    return Array.from(this.users.values());
  }

  @Method()
  updateUser(id: string, data: Partial<{ name: string; email: string; role: string }>) {
    const user = this.users.get(id);
    if (!user) {
      throw new Error(`User not found: ${id}`);
    }
    Object.assign(user, data);
    return user;
  }

  @Method()
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
  @Method()
  echo(message: any): any {
    return message;
  }

  @Method()
  echoString(message: string): string {
    return message;
  }

  @Method()
  echoNumber(value: number): number {
    return value;
  }

  @Method()
  echoBoolean(value: boolean): boolean {
    return value;
  }

  @Method()
  echoObject(obj: any): any {
    return obj;
  }

  @Method()
  echoArray(arr: any[]): any[] {
    return arr;
  }

  @Method()
  async echoAsync(message: any): Promise<any> {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return message;
  }

  @Method()
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
  @Method()
  async generateNumbers(count: number): Promise<number[]> {
    const numbers: number[] = [];
    for (let i = 0; i < count; i++) {
      numbers.push(i);
    }
    return numbers;
  }

  @Method()
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
