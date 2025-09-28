/**
 * Test Service Fixtures for Process Manager Testing
 *
 * These are real service classes that can be spawned as actual processes
 * for comprehensive testing with >96% coverage.
 */

import 'reflect-metadata';
import { Process, Public, HealthCheck, RateLimit, Metric } from '../../../../src/modules/pm/decorators.js';
import { EventEmitter } from 'events';

/**
 * Basic Calculator Service
 * Tests basic method invocation across process boundaries
 */
@Process({
  name: 'calculator-service',
  version: '1.0.0'
})
export class CalculatorService {
  private memory = 0;
  private callCount = 0;

  @Public()
  async add(a: number, b: number): Promise<number> {
    this.callCount++;
    return a + b;
  }

  @Public()
  async subtract(a: number, b: number): Promise<number> {
    this.callCount++;
    return a - b;
  }

  @Public()
  async multiply(a: number, b: number): Promise<number> {
    this.callCount++;
    return a * b;
  }

  @Public()
  async divide(a: number, b: number): Promise<number> {
    this.callCount++;
    if (b === 0) {
      throw new Error('Division by zero');
    }
    return a / b;
  }

  @Public()
  async storeInMemory(value: number): Promise<void> {
    this.memory = value;
  }

  @Public()
  async getMemory(): Promise<number> {
    return this.memory;
  }

  @Public()
  async getCallCount(): Promise<number> {
    return this.callCount;
  }

  @HealthCheck()
  async checkHealth() {
    return {
      status: 'healthy' as const,
      checks: [{
        name: 'calculator',
        status: 'pass' as const,
        data: { callCount: this.callCount }
      }]
    };
  }
}

/**
 * Stateful Counter Service
 * Tests state management across process boundaries
 */
@Process({
  name: 'counter-service',
  version: '1.0.0'
})
export class CounterService {
  private counter = 0;
  private history: number[] = [];

  @Public()
  async increment(): Promise<number> {
    this.counter++;
    this.history.push(this.counter);
    return this.counter;
  }

  @Public()
  async decrement(): Promise<number> {
    this.counter--;
    this.history.push(this.counter);
    return this.counter;
  }

  @Public()
  async getValue(): Promise<number> {
    return this.counter;
  }

  @Public()
  async reset(): Promise<void> {
    this.counter = 0;
    this.history = [0];
  }

  @Public()
  async getHistory(): Promise<number[]> {
    return [...this.history];
  }

  @Public()
  async setValue(value: number): Promise<void> {
    this.counter = value;
    this.history.push(value);
  }
}

/**
 * Async Stream Service
 * Tests async generators and streaming across processes
 */
@Process({
  name: 'stream-service',
  version: '1.0.0'
})
export class StreamService {

  @Public()
  async *streamNumbers(start: number, end: number, delay = 10): AsyncGenerator<number> {
    for (let i = start; i <= end; i++) {
      await new Promise(resolve => setTimeout(resolve, delay));
      yield i;
    }
  }

  @Public()
  async *streamFibonacci(n: number): AsyncGenerator<number> {
    let a = 0, b = 1;
    for (let i = 0; i < n; i++) {
      yield a;
      const temp = a;
      a = b;
      b = temp + b;
    }
  }

  @Public()
  async collectStream(generator: AsyncIterable<number>): Promise<number[]> {
    const results: number[] = [];
    for await (const value of generator) {
      results.push(value);
    }
    return results;
  }
}

/**
 * Error Handling Service
 * Tests error propagation across process boundaries
 */
@Process({
  name: 'error-service',
  version: '1.0.0'
})
export class ErrorService {
  private errorCount = 0;

  @Public()
  async throwError(message: string): Promise<void> {
    this.errorCount++;
    throw new Error(message);
  }

  @Public()
  async throwCustomError(code: string, message: string): Promise<void> {
    this.errorCount++;
    const error = new Error(message) as any;
    error.code = code;
    throw error;
  }

  @Public()
  async throwAfterDelay(delay: number, message: string): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, delay));
    this.errorCount++;
    throw new Error(message);
  }

  @Public()
  async maybeThrow(probability: number, message: string): Promise<string> {
    if (Math.random() < probability) {
      this.errorCount++;
      throw new Error(message);
    }
    return 'success';
  }

  @Public()
  async getErrorCount(): Promise<number> {
    return this.errorCount;
  }
}

/**
 * Rate Limited Service
 * Tests rate limiting and throttling
 */
@Process({
  name: 'rate-limited-service',
  version: '1.0.0'
})
export class RateLimitedService {
  private callTimestamps: number[] = [];

  @Public()
  @RateLimit({ rps: 10 })
  async limitedMethod(): Promise<number> {
    const now = Date.now();
    this.callTimestamps.push(now);
    return now;
  }

  @Public()
  @RateLimit({ rps: 5, burst: 10 })
  async burstMethod(): Promise<string> {
    return 'burst-allowed';
  }

  @Public()
  async unlimitedMethod(): Promise<string> {
    return 'unlimited';
  }

  @Public()
  async getCallHistory(): Promise<number[]> {
    return [...this.callTimestamps];
  }
}

/**
 * Event Emitter Service
 * Tests event-driven communication across processes
 */
@Process({
  name: 'event-service',
  version: '1.0.0'
})
export class EventService extends EventEmitter {
  private eventHistory: Array<{ event: string; data: any; timestamp: number }> = [];

  @Public()
  async emitEvent(eventName: string, data: any): Promise<void> {
    this.eventHistory.push({
      event: eventName,
      data,
      timestamp: Date.now()
    });
    this.emit(eventName, data);
  }

  @Public()
  async onEvent(eventName: string, callback: (data: any) => void): Promise<void> {
    this.on(eventName, callback);
  }

  @Public()
  async offEvent(eventName: string, callback: (data: any) => void): Promise<void> {
    this.off(eventName, callback);
  }

  @Public()
  async getEventHistory(): Promise<Array<{ event: string; data: any; timestamp: number }>> {
    return [...this.eventHistory];
  }

  @Public()
  async clearHistory(): Promise<void> {
    this.eventHistory = [];
  }
}

/**
 * CPU Intensive Service
 * Tests CPU-bound operations and load distribution
 */
@Process({
  name: 'cpu-intensive-service',
  version: '1.0.0'
})
export class CpuIntensiveService {

  @Public()
  async fibonacci(n: number): Promise<number> {
    if (n <= 1) return n;
    return this.fibonacciSync(n);
  }

  private fibonacciSync(n: number): number {
    if (n <= 1) return n;
    return this.fibonacciSync(n - 1) + this.fibonacciSync(n - 2);
  }

  @Public()
  async isPrime(n: number): Promise<boolean> {
    if (n <= 1) return false;
    if (n <= 3) return true;
    if (n % 2 === 0 || n % 3 === 0) return false;

    for (let i = 5; i * i <= n; i += 6) {
      if (n % i === 0 || n % (i + 2) === 0) {
        return false;
      }
    }
    return true;
  }

  @Public()
  async calculatePrimes(max: number): Promise<number[]> {
    const primes: number[] = [];
    for (let i = 2; i <= max; i++) {
      if (await this.isPrime(i)) {
        primes.push(i);
      }
    }
    return primes;
  }

  @Public()
  async sortLargeArray(size: number): Promise<number> {
    const arr = Array.from({ length: size }, () => Math.random());
    const start = Date.now();
    arr.sort((a, b) => a - b);
    return Date.now() - start;
  }
}

/**
 * Memory Intensive Service
 * Tests memory usage and garbage collection
 */
@Process({
  name: 'memory-intensive-service',
  version: '1.0.0'
})
export class MemoryIntensiveService {
  private buffers: Buffer[] = [];

  @Public()
  async allocateMemory(sizeMB: number): Promise<number> {
    const buffer = Buffer.alloc(sizeMB * 1024 * 1024);
    this.buffers.push(buffer);
    return this.buffers.length;
  }

  @Public()
  async freeMemory(): Promise<void> {
    this.buffers = [];
    if (global.gc) {
      global.gc();
    }
  }

  @Public()
  async getMemoryUsage(): Promise<NodeJS.MemoryUsage> {
    return process.memoryUsage();
  }

  @Public()
  async createLargeObject(properties: number): Promise<number> {
    const obj: any = {};
    for (let i = 0; i < properties; i++) {
      obj[`prop_${i}`] = `value_${i}_${Math.random()}`;
    }
    return Object.keys(obj).length;
  }
}

/**
 * Lifecycle Service
 * Tests process lifecycle hooks
 */
@Process({
  name: 'lifecycle-service',
  version: '1.0.0'
})
export class LifecycleService {
  private initialized = false;
  private shutdownCalled = false;
  private events: string[] = [];

  constructor() {
    this.events.push('constructor');
  }

  async onInit(): Promise<void> {
    this.initialized = true;
    this.events.push('onInit');
  }

  async onStart(): Promise<void> {
    this.events.push('onStart');
  }

  async onShutdown(): Promise<void> {
    this.shutdownCalled = true;
    this.events.push('onShutdown');
    // Cleanup resources
  }

  @Public()
  async isInitialized(): Promise<boolean> {
    return this.initialized;
  }

  @Public()
  async isShutdownCalled(): Promise<boolean> {
    return this.shutdownCalled;
  }

  @Public()
  async getLifecycleEvents(): Promise<string[]> {
    return [...this.events];
  }

  @Public()
  async doWork(): Promise<string> {
    this.events.push('doWork');
    return 'work-done';
  }
}

/**
 * Timeout Service
 * Tests timeout handling and long-running operations
 */
@Process({
  name: 'timeout-service',
  version: '1.0.0'
})
export class TimeoutService {

  @Public()
  async quickOperation(): Promise<string> {
    return 'quick';
  }

  @Public()
  async slowOperation(delay: number): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, delay));
    return 'slow-complete';
  }

  @Public()
  async neverComplete(): Promise<string> {
    return new Promise(() => {
      // Never resolves
    });
  }

  @Public()
  async conditionalTimeout(shouldTimeout: boolean, delay: number): Promise<string> {
    if (shouldTimeout) {
      return this.neverComplete();
    }
    await new Promise(resolve => setTimeout(resolve, delay));
    return 'completed';
  }
}

/**
 * Metrics Service
 * Tests metrics collection and reporting
 */
@Process({
  name: 'metrics-service',
  version: '1.0.0'
})
export class MetricsService {
  private metrics = {
    requests: 0,
    errors: 0,
    latencies: [] as number[]
  };

  @Public()
  @Metric('request_count')
  async handleRequest(): Promise<void> {
    const start = Date.now();
    this.metrics.requests++;
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
    this.metrics.latencies.push(Date.now() - start);
  }

  @Public()
  @Metric('error_count')
  async handleError(): Promise<void> {
    this.metrics.errors++;
    throw new Error('Simulated error');
  }

  @Public()
  async getMetrics(): Promise<any> {
    const latencies = this.metrics.latencies;
    return {
      ...this.metrics,
      avgLatency: latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0,
      p50: this.percentile(latencies, 0.5),
      p95: this.percentile(latencies, 0.95),
      p99: this.percentile(latencies, 0.99)
    };
  }

  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, index)];
  }

  @Public()
  async resetMetrics(): Promise<void> {
    this.metrics = {
      requests: 0,
      errors: 0,
      latencies: []
    };
  }
}