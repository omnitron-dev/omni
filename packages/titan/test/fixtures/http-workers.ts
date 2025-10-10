/**
 * HTTP Worker Fixtures for PM Module Integration Tests
 *
 * These fixtures provide worker services for testing HTTP transport clustering
 */

import { Process, Public, HealthCheck } from '../../src/modules/pm/decorators.js';
import type { IHealthStatus } from '../../src/modules/pm/types.js';

/**
 * Calculator Service - Simple stateless service for load balancing tests
 */
@Process({
  name: 'calculator',
  version: '1.0.0',
  health: { enabled: true }
})
export class CalculatorWorker {
  private requestCount = 0;

  @Public()
  add(a: number, b: number): number {
    this.requestCount++;
    return a + b;
  }

  @Public()
  multiply(a: number, b: number): number {
    this.requestCount++;
    return a * b;
  }

  @Public()
  getPid(): number {
    return process.pid;
  }

  @Public()
  getRequestCount(): number {
    return this.requestCount;
  }

  @HealthCheck()
  async checkHealth(): Promise<IHealthStatus> {
    return {
      status: 'healthy',
      checks: [
        {
          name: 'requests',
          status: 'pass',
          details: { count: this.requestCount }
        }
      ],
      timestamp: Date.now()
    };
  }
}

/**
 * Stateful Counter Service - Tests state isolation between workers
 */
@Process({
  name: 'counter',
  version: '1.0.0'
})
export class StatefulCounterWorker {
  private counter = 0;
  private data = new Map<string, any>();

  @Public()
  increment(): number {
    return ++this.counter;
  }

  @Public()
  decrement(): number {
    return --this.counter;
  }

  @Public()
  getCounter(): number {
    return this.counter;
  }

  @Public()
  setData(key: string, value: any): void {
    this.data.set(key, value);
  }

  @Public()
  getData(key: string): any {
    return this.data.get(key);
  }

  @Public()
  getPid(): number {
    return process.pid;
  }

  @Public()
  reset(): void {
    this.counter = 0;
    this.data.clear();
  }
}

/**
 * Crashable Service - For testing crash recovery
 */
@Process({
  name: 'crashable',
  version: '1.0.0',
  health: { enabled: true }
})
export class CrashableWorker {
  private shouldCrash = false;
  private crashAfterCalls = -1;
  private callCount = 0;

  @Public()
  async doWork(input: string): Promise<string> {
    this.callCount++;

    if (this.shouldCrash) {
      throw new Error('Simulated crash');
    }

    if (this.crashAfterCalls > 0 && this.callCount >= this.crashAfterCalls) {
      throw new Error('Crash after N calls');
    }

    return `Processed: ${input}`;
  }

  @Public()
  setCrashMode(enabled: boolean): void {
    this.shouldCrash = enabled;
  }

  @Public()
  setCrashAfterCalls(count: number): void {
    this.crashAfterCalls = count;
  }

  @Public()
  getCallCount(): number {
    return this.callCount;
  }

  @Public()
  getPid(): number {
    return process.pid;
  }

  @HealthCheck()
  async checkHealth(): Promise<IHealthStatus> {
    return {
      status: this.shouldCrash ? 'unhealthy' : 'healthy',
      checks: [
        {
          name: 'crash-mode',
          status: this.shouldCrash ? 'fail' : 'pass',
          details: { crashMode: this.shouldCrash }
        }
      ],
      timestamp: Date.now()
    };
  }
}

/**
 * Heavy Computation Service - For testing load distribution
 */
@Process({
  name: 'heavy-compute',
  version: '1.0.0'
})
export class HeavyComputeWorker {
  @Public()
  async fibonacci(n: number): Promise<number> {
    if (n <= 1) return n;
    return await this.fibonacci(n - 1) + await this.fibonacci(n - 2);
  }

  @Public()
  async heavyTask(iterations: number): Promise<number> {
    let result = 0;
    for (let i = 0; i < iterations; i++) {
      result += Math.sqrt(i);
    }
    return result;
  }

  @Public()
  getPid(): number {
    return process.pid;
  }

  @Public()
  getMemoryUsage(): NodeJS.MemoryUsage {
    return process.memoryUsage();
  }
}

/**
 * Metrics Tracking Service - For testing metrics collection
 */
@Process({
  name: 'metrics-tracker',
  version: '1.0.0',
  health: { enabled: true },
  observability: { metrics: true }
})
export class MetricsTrackerWorker {
  private operations = new Map<string, number>();
  private latencies = new Map<string, number[]>();
  private errors = new Map<string, number>();

  @Public()
  async trackOperation(operation: string, duration: number): Promise<void> {
    const count = this.operations.get(operation) || 0;
    this.operations.set(operation, count + 1);

    const latencyList = this.latencies.get(operation) || [];
    latencyList.push(duration);
    this.latencies.set(operation, latencyList);
  }

  @Public()
  async recordError(operation: string): Promise<void> {
    const count = this.errors.get(operation) || 0;
    this.errors.set(operation, count + 1);
  }

  @Public()
  async getStats(operation: string): Promise<any> {
    const latencyList = this.latencies.get(operation) || [];
    const avg = latencyList.length > 0
      ? latencyList.reduce((a, b) => a + b, 0) / latencyList.length
      : 0;

    return {
      operation,
      count: this.operations.get(operation) || 0,
      errors: this.errors.get(operation) || 0,
      avgLatency: avg,
      p95: this.calculatePercentile(latencyList, 0.95),
      p99: this.calculatePercentile(latencyList, 0.99)
    };
  }

  @Public()
  getPid(): number {
    return process.pid;
  }

  @HealthCheck()
  async checkHealth(): Promise<IHealthStatus> {
    const totalOps = Array.from(this.operations.values()).reduce((a, b) => a + b, 0);
    const totalErrors = Array.from(this.errors.values()).reduce((a, b) => a + b, 0);
    const errorRate = totalOps > 0 ? totalErrors / totalOps : 0;

    return {
      status: errorRate > 0.5 ? 'unhealthy' : errorRate > 0.2 ? 'degraded' : 'healthy',
      checks: [
        {
          name: 'error-rate',
          status: errorRate > 0.5 ? 'fail' : errorRate > 0.2 ? 'warn' : 'pass',
          details: { errorRate, totalOps, totalErrors }
        }
      ],
      timestamp: Date.now()
    };
  }

  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[index] || 0;
  }
}
