/**
 * Example: Calculator Process
 *
 * This example demonstrates a simple calculator service that runs in its own process.
 * Each process is defined in a separate file with a default export.
 */

import { Process, Public, HealthCheck } from '../../../src/modules/pm/decorators.js';
import type { IHealthStatus } from '../../../src/modules/pm/types.js';

/**
 * Calculator service that performs basic arithmetic operations
 */
@Process({
  name: 'calculator-service',
  version: '1.0.0',
  description: 'Basic arithmetic calculator',
})
export default class CalculatorProcess {
  private operationCount = 0;
  private lastOperation?: string;

  @Public()
  async add(a: number, b: number): Promise<number> {
    this.operationCount++;
    this.lastOperation = `add(${a}, ${b})`;
    return a + b;
  }

  @Public()
  async subtract(a: number, b: number): Promise<number> {
    this.operationCount++;
    this.lastOperation = `subtract(${a}, ${b})`;
    return a - b;
  }

  @Public()
  async multiply(a: number, b: number): Promise<number> {
    this.operationCount++;
    this.lastOperation = `multiply(${a}, ${b})`;
    return a * b;
  }

  @Public()
  async divide(a: number, b: number): Promise<number> {
    if (b === 0) {
      throw new Error('Division by zero');
    }
    this.operationCount++;
    this.lastOperation = `divide(${a}, ${b})`;
    return a / b;
  }

  @Public()
  async power(base: number, exponent: number): Promise<number> {
    this.operationCount++;
    this.lastOperation = `power(${base}, ${exponent})`;
    return Math.pow(base, exponent);
  }

  @Public()
  async factorial(n: number): Promise<number> {
    if (n < 0) {
      throw new Error('Factorial is not defined for negative numbers');
    }
    if (n === 0 || n === 1) {
      return 1;
    }

    let result = 1;
    for (let i = 2; i <= n; i++) {
      result *= i;
    }

    this.operationCount++;
    this.lastOperation = `factorial(${n})`;
    return result;
  }

  @Public()
  async getStats(): Promise<{ operationCount: number; lastOperation?: string }> {
    return {
      operationCount: this.operationCount,
      lastOperation: this.lastOperation,
    };
  }

  @HealthCheck()
  async checkHealth(): Promise<IHealthStatus> {
    return {
      status: 'healthy',
      checks: [
        {
          name: 'calculator',
          status: 'pass',
          message: `Operations performed: ${this.operationCount}`,
        },
      ],
      timestamp: Date.now(),
    };
  }
}
