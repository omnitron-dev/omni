/**
 * Database Client Service Process
 * Used in resilience pattern tests for retry with exponential backoff
 */

import { Process, Public, HealthCheck } from '../../src/decorators.js';
import type { IHealthStatus } from '../../src/types.js';

@Process({ name: 'database-client', version: '1.0.0' })
export default class DatabaseClientService {
  private attemptCounts = new Map<string, number>();
  private isHealthy = true;
  private connectionAttempts = 0;

  @Public()
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

  /**
   * Number of upcoming attempts that must fail, set by `failNext()`.
   *
   * Without a script this fixture is random — 30% on the first two attempts
   * plus 10% on every one — so a test asserting that a query SUCCEEDS is
   * asserting the outcome of a coin toss.
   *
   * The first fix removed the randomness from the failures and left it on the
   * success, and the comment here recorded a guarantee the code did not give:
   * "a test asking for two failures gets two, then a success". Only the prefix
   * was exact. `failNext(2)` scripted attempts 1 and 2; attempt 3 then fell
   * through to the 10% branch, so the test still failed about one run in ten —
   * worse than the one-in-seventy the first fix was aimed at. (Caught by
   * omni-4b with the log saved.)
   */
  private scriptedFailures = 0;

  /**
   * Set by `failNext()` and never cleared: once a test scripts this fixture,
   * NEITHER random branch fires again for the life of the instance.
   *
   * Scripting only the failures is not enough — `failNext(0)` means "fail
   * nothing", and two attempts without a script still meet the 30% branch. The
   * point of a script is that the whole scenario is determined, not its prefix.
   */
  private scripted = false;

  @Public()
  async failNext(count: number): Promise<void> {
    this.scripted = true;
    this.scriptedFailures = count;
  }

  private async simulateQuery(): Promise<void> {
    this.connectionAttempts++;

    // A scripted failure takes precedence and is exact: a test asking for two
    // failures gets two, then a success — and the success is now as certain as
    // the failures, because `scripted` silences both random branches below.
    if (this.scriptedFailures > 0) {
      this.scriptedFailures--;
      throw new Error('Connection timeout');
    }

    // Simulate connection issues (30% failure rate on first 2 attempts)
    if (!this.scripted && this.connectionAttempts <= 2 && Math.random() < 0.3) {
      throw new Error('Connection timeout');
    }

    // Simulate query execution
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Occasionally fail
    if (!this.scripted && Math.random() < 0.1) {
      throw new Error('Query execution failed');
    }
  }

  @Public()
  async getAttemptCount(query: string): Promise<number> {
    return this.attemptCounts.get(query) || 0;
  }

  @Public()
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
