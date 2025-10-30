/**
 * Database Client Service Process
 * Used in resilience pattern tests for retry with exponential backoff
 */

import { Process, Method, HealthCheck } from '../../../../src/modules/pm/decorators.js';
import type { IHealthStatus } from '../../../../src/modules/pm/types.js';

@Process({ name: 'database-client', version: '1.0.0' })
export default class DatabaseClientService {
  private attemptCounts = new Map<string, number>();
  private isHealthy = true;
  private connectionAttempts = 0;

  @Method()
  async executeQuery(
    query: string,
    options?: { maxRetries?: number }
  ): Promise<{ success: boolean; result: any; attempts: number }> {
    const maxRetries = options?.maxRetries || 3;
    let attempts = 0;
    let lastError: Error | null = null;

    while (attempts < maxRetries) {
      attempts++;
      this.attemptCounts.set(query, attempts);

      try {
        // Simulate database query
        await this.simulateQuery();

        return {
          success: true,
          result: { query, rows: Math.floor(Math.random() * 100) },
          attempts,
        };
      } catch (error) {
        lastError = error as Error;

        if (attempts < maxRetries) {
          // Exponential backoff: 100ms, 200ms, 400ms, etc.
          const delay = Math.min(100 * Math.pow(2, attempts - 1), 2000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`Query failed after ${attempts} attempts: ${lastError?.message}`);
  }

  private async simulateQuery(): Promise<void> {
    this.connectionAttempts++;

    // Simulate connection issues (30% failure rate on first 2 attempts)
    if (this.connectionAttempts <= 2 && Math.random() < 0.3) {
      throw new Error('Connection timeout');
    }

    // Simulate query execution
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Occasionally fail
    if (Math.random() < 0.1) {
      throw new Error('Query execution failed');
    }
  }

  @Method()
  async getAttemptCount(query: string): Promise<number> {
    return this.attemptCounts.get(query) || 0;
  }

  @Method()
  async resetStats(): Promise<void> {
    this.attemptCounts.clear();
    this.connectionAttempts = 0;
  }

  @HealthCheck()
  async checkHealth(): Promise<IHealthStatus> {
    return {
      status: this.isHealthy ? 'healthy' : 'unhealthy',
      checks: [
        {
          name: 'database-connection',
          status: this.isHealthy ? 'pass' : 'fail',
          message: this.isHealthy ? 'Connected' : 'Disconnected',
        },
      ],
      timestamp: Date.now(),
    };
  }
}
