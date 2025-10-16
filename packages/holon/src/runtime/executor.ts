/**
 * Flow executor with sequential, parallel, and streaming execution modes
 */

import type { Flow } from '@holon/flow';
import type { ExecutionOptions } from '../types.js';
import { EventEmitter } from 'eventemitter3';

export interface ExecutorConfig {
  /** Maximum concurrent executions */
  maxConcurrency?: number;
  /** Enable streaming mode */
  streaming?: boolean;
  /** Backpressure threshold */
  backpressureThreshold?: number;
}

export interface ExecutorEvents {
  'task:start': (taskId: string) => void;
  'task:complete': (taskId: string, result: unknown) => void;
  'task:error': (taskId: string, error: Error) => void;
  backpressure: (queueSize: number) => void;
}

/**
 * Flow executor with advanced execution modes
 *
 * Supports:
 * - Sequential execution
 * - Parallel execution with concurrency control
 * - Streaming execution for large datasets
 * - Backpressure handling
 * - Progress tracking
 */
export class Executor extends EventEmitter<ExecutorEvents> {
  private readonly config: Required<ExecutorConfig>;
  private activeExecutions: number = 0;
  private readonly queue: ExecutionTask[] = [];
  private readonly activeTasks: Map<string, ExecutionTask> = new Map();

  constructor(config: ExecutorConfig = {}) {
    super();

    this.config = {
      maxConcurrency: config.maxConcurrency ?? 4,
      streaming: config.streaming ?? false,
      backpressureThreshold: config.backpressureThreshold ?? 100,
    };
  }

  /**
   * Execute flow in sequential mode
   */
  async executeSequential<In, Out>(flow: Flow<In, Out>, inputs: In[], options: ExecutionOptions = {}): Promise<Out[]> {
    const results: Out[] = [];

    for (const input of inputs) {
      const result = await flow(input);
      results.push(result);
    }

    return results;
  }

  /**
   * Execute flow in parallel mode
   */
  async executeParallel<In, Out>(flow: Flow<In, Out>, inputs: In[], options: ExecutionOptions = {}): Promise<Out[]> {
    const chunks = this.chunkArray(inputs, this.config.maxConcurrency);
    const results: Out[] = [];

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(chunk.map((input) => flow(input)));
      results.push(...chunkResults);
    }

    return results;
  }

  /**
   * Execute flow in streaming mode
   */
  async *executeStreaming<In, Out>(
    flow: Flow<In, Out>,
    inputs: AsyncIterable<In> | Iterable<In>,
    options: ExecutionOptions = {}
  ): AsyncGenerator<Out, void, unknown> {
    const buffer: Promise<Out>[] = [];
    const iterator = this.toAsyncIterable(inputs);

    for await (const input of iterator) {
      // Check backpressure
      if (buffer.length >= this.config.backpressureThreshold) {
        this.emit('backpressure', buffer.length);
        // Wait for some promises to complete
        const result = await Promise.race(buffer);
        yield result;
        buffer.splice(
          buffer.findIndex((p) => p === result),
          1
        );
      }

      // Add new execution to buffer
      const promise = Promise.resolve(flow(input));
      buffer.push(promise);

      // Yield completed results
      while (buffer.length > 0) {
        try {
          const result = await Promise.race(buffer);
          yield result;
          buffer.splice(
            buffer.findIndex((p) => p === result),
            1
          );
        } catch {
          break;
        }
      }
    }

    // Yield remaining buffered results
    while (buffer.length > 0) {
      const result = await buffer.shift()!;
      yield result;
    }
  }

  /**
   * Execute flow with batching
   */
  async executeBatch<In, Out>(
    flow: Flow<In[], Out[]>,
    inputs: In[],
    batchSize: number,
    options: ExecutionOptions = {}
  ): Promise<Out[]> {
    const batches = this.chunkArray(inputs, batchSize);
    const results: Out[] = [];

    for (const batch of batches) {
      const batchResults = await flow(batch);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Execute flow with progress tracking
   */
  async executeWithProgress<In, Out>(
    flow: Flow<In, Out>,
    inputs: In[],
    onProgress: (completed: number, total: number) => void,
    options: ExecutionOptions = {}
  ): Promise<Out[]> {
    const total = inputs.length;
    let completed = 0;
    const results: Out[] = [];

    const chunks = this.chunkArray(inputs, this.config.maxConcurrency);

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(async (input) => {
          const result = await flow(input);
          completed++;
          onProgress(completed, total);
          return result;
        })
      );
      results.push(...chunkResults);
    }

    return results;
  }

  /**
   * Execute flow with rate limiting
   */
  async executeRateLimited<In, Out>(
    flow: Flow<In, Out>,
    inputs: In[],
    maxRequestsPerSecond: number,
    options: ExecutionOptions = {}
  ): Promise<Out[]> {
    const results: Out[] = [];
    const delay = 1000 / maxRequestsPerSecond;

    for (const input of inputs) {
      const result = await flow(input);
      results.push(result);
      await this.sleep(delay);
    }

    return results;
  }

  /**
   * Execute with timeout for each item
   */
  async executeWithTimeout<In, Out>(
    flow: Flow<In, Out>,
    inputs: In[],
    timeout: number,
    options: ExecutionOptions = {}
  ): Promise<Array<Out | Error>> {
    return Promise.all(
      inputs.map((input) =>
        Promise.race([
          flow(input),
          this.sleep(timeout).then(() => {
            throw new Error(`Execution timeout after ${timeout}ms`);
          }),
        ]).catch((error) => error as Error)
      )
    );
  }

  /**
   * Execute with retry for failed items
   */
  async executeWithRetry<In, Out>(
    flow: Flow<In, Out>,
    inputs: In[],
    maxRetries: number = 3,
    options: ExecutionOptions = {}
  ): Promise<Array<Out | Error>> {
    const results: Array<Out | Error> = [];

    for (const input of inputs) {
      let lastError: Error | undefined;
      let success = false;

      for (let attempt = 0; attempt <= maxRetries && !success; attempt++) {
        try {
          const result = await flow(input);
          results.push(result);
          success = true;
        } catch (error) {
          lastError = error as Error;
          if (attempt < maxRetries) {
            await this.sleep(Math.pow(2, attempt) * 100); // Exponential backoff
          }
        }
      }

      if (!success && lastError) {
        results.push(lastError);
      }
    }

    return results;
  }

  /**
   * Execute with circuit breaker
   */
  async executeWithCircuitBreaker<In, Out>(
    flow: Flow<In, Out>,
    inputs: In[],
    options: {
      failureThreshold?: number;
      resetTimeout?: number;
    } = {}
  ): Promise<Array<Out | Error>> {
    const failureThreshold = options.failureThreshold ?? 5;
    const resetTimeout = options.resetTimeout ?? 60000;

    let consecutiveFailures = 0;
    let circuitOpen = false;
    let lastFailureTime = 0;

    const results: Array<Out | Error> = [];

    for (const input of inputs) {
      // Check if circuit should be closed
      if (circuitOpen && Date.now() - lastFailureTime > resetTimeout) {
        circuitOpen = false;
        consecutiveFailures = 0;
      }

      // Skip execution if circuit is open
      if (circuitOpen) {
        results.push(new Error('Circuit breaker is open'));
        continue;
      }

      try {
        const result = await flow(input);
        results.push(result);
        consecutiveFailures = 0;
      } catch (error) {
        results.push(error as Error);
        consecutiveFailures++;
        lastFailureTime = Date.now();

        if (consecutiveFailures >= failureThreshold) {
          circuitOpen = true;
        }
      }
    }

    return results;
  }

  /**
   * Get executor statistics
   */
  getStats(): ExecutorStats {
    return {
      activeExecutions: this.activeExecutions,
      queuedExecutions: this.queue.length,
      maxConcurrency: this.config.maxConcurrency,
      utilization: this.activeExecutions / this.config.maxConcurrency,
    };
  }

  /**
   * Chunk array into smaller arrays
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Convert iterable to async iterable
   */
  private async *toAsyncIterable<T>(iterable: AsyncIterable<T> | Iterable<T>): AsyncGenerator<T, void, unknown> {
    if (Symbol.asyncIterator in iterable) {
      yield* iterable as AsyncIterable<T>;
    } else {
      for (const item of iterable as Iterable<T>) {
        yield item;
      }
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Shutdown executor
   */
  async shutdown(): Promise<void> {
    // Wait for active executions to complete
    while (this.activeExecutions > 0) {
      await this.sleep(100);
    }
    this.removeAllListeners();
  }
}

interface ExecutionTask {
  id: string;
  flow: Flow<unknown, unknown>;
  input: unknown;
  options?: ExecutionOptions;
}

export interface ExecutorStats {
  activeExecutions: number;
  queuedExecutions: number;
  maxConcurrency: number;
  utilization: number;
}

/**
 * Create a new executor instance
 */
export function createExecutor(config?: ExecutorConfig): Executor {
  return new Executor(config);
}
