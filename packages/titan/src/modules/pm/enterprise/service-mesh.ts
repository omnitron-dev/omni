/**
 * Service Mesh Capabilities
 *
 * Provides native service mesh features including circuit breaking,
 * rate limiting, retries, timeouts, and observability.
 */

import type { ILogger } from '../../logger/logger.types.js';
import { Errors } from '../../../errors/index.js';
import type { ServiceProxy } from '../types.js';
import type { ProcessMethod } from '../common-types.js';

/**
 * Service mesh configuration
 */
export interface IServiceMeshConfig {
  tracing?: boolean;
  metrics?: boolean;
  mtls?: boolean;
  rateLimit?: IRateLimitConfig;
  circuitBreaker?: ICircuitBreakerConfig;
  retry?: IRetryConfig;
  timeout?: number;
  bulkhead?: IBulkheadConfig;
  loadBalancing?: ILoadBalancingConfig;
}

/**
 * Rate limit configuration
 */
export interface IRateLimitConfig {
  rps?: number;
  burst?: number;
  strategy?: 'token-bucket' | 'sliding-window' | 'fixed-window';
  key?: string | ((context: any) => string);
}

/**
 * Circuit breaker configuration
 */
export interface ICircuitBreakerConfig {
  threshold?: number;
  timeout?: number;
  halfOpenRequests?: number;
  resetTimeout?: number;
  onOpen?: () => void;
  onClose?: () => void;
  onHalfOpen?: () => void;
}

/**
 * Retry configuration
 */
export interface IRetryConfig {
  attempts?: number;
  backoff?: 'exponential' | 'linear' | 'fixed';
  maxDelay?: number;
  factor?: number;
  jitter?: boolean;
}

/**
 * Bulkhead configuration
 */
export interface IBulkheadConfig {
  maxConcurrent?: number;
  maxQueue?: number;
  queueTimeout?: number;
}

/**
 * Load balancing configuration
 */
export interface ILoadBalancingConfig {
  strategy?: 'round-robin' | 'least-connections' | 'random' | 'weighted';
  healthCheck?: {
    interval?: number;
    timeout?: number;
    unhealthyThreshold?: number;
    healthyThreshold?: number;
  };
}

/**
 * Service mesh proxy that wraps services with mesh capabilities
 */
export class ServiceMeshProxy<T> {
  private circuitBreaker: CircuitBreaker;
  private rateLimiter: RateLimiter;
  private bulkhead: Bulkhead;
  private retryManager: RetryManager;
  private metrics: ServiceMetrics;

  constructor(
    private readonly service: ServiceProxy<T>,
    private readonly config: IServiceMeshConfig,
    private readonly logger: ILogger
  ) {
    // Initialize components
    this.circuitBreaker = new CircuitBreaker(config.circuitBreaker || {}, logger);
    this.rateLimiter = new RateLimiter(config.rateLimit || {}, logger);
    this.bulkhead = new Bulkhead(config.bulkhead || {}, logger);
    this.retryManager = new RetryManager(config.retry || {}, logger);
    this.metrics = new ServiceMetrics();
  }

  /**
   * Create a mesh-enabled proxy
   */
  createProxy(): ServiceProxy<T> {
    return new Proxy(this.service, {
      get: (target, property: string | symbol) => {
        // Pass through control methods
        if (
          property === '__processId' ||
          property === '__destroy' ||
          property === '__getMetrics' ||
          property === '__getHealth'
        ) {
          return target[property];
        }

        const original = target[property as keyof typeof target];
        if (typeof original !== 'function') {
          return original;
        }

        // Wrap method with mesh capabilities
        return async (...args: any[]) =>
          this.executeWithMesh(property as string, () => (original as ProcessMethod).apply(target, args), args);
      },
    }) as ServiceProxy<T>;
  }

  /**
   * Execute method with all mesh features
   */
  private async executeWithMesh(method: string, fn: () => Promise<any>, args: any[]): Promise<any> {
    const startTime = Date.now();
    const context = { method, args };

    try {
      // Check rate limit
      await this.rateLimiter.acquire(context);

      // Check bulkhead
      const ticket = await this.bulkhead.acquire();

      try {
        // Execute with circuit breaker
        const result = await this.circuitBreaker.execute(() =>
          this.executeWithTimeout(() => this.executeWithRetry(fn, context), this.config.timeout)
        );

        // Record success metrics
        this.metrics.recordSuccess(method, Date.now() - startTime);

        return result;
      } finally {
        // Release bulkhead ticket
        ticket.release();
      }
    } catch (error) {
      // Record failure metrics
      this.metrics.recordFailure(method, Date.now() - startTime, error as Error);
      throw error;
    }
  }

  /**
   * Execute with retry logic
   */
  private async executeWithRetry(fn: () => Promise<any>, context: any): Promise<any> {
    return this.retryManager.execute(fn, context);
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<R>(fn: () => Promise<R>, timeout?: number): Promise<R> {
    if (!timeout) {
      return fn();
    }

    return Promise.race([
      fn(),
      new Promise<R>((_, reject) =>
        setTimeout(() => reject(Errors.timeout('service mesh operation', timeout)), timeout)
      ),
    ]);
  }

  /**
   * Get mesh metrics
   */
  getMetrics(): any {
    return {
      circuitBreaker: this.circuitBreaker.getState(),
      rateLimiter: this.rateLimiter.getMetrics(),
      bulkhead: this.bulkhead.getMetrics(),
      service: this.metrics.getMetrics(),
    };
  }
}

/**
 * Circuit Breaker implementation
 */
class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failures = 0;
  private successes = 0;
  private lastFailTime = 0;
  private halfOpenRequests = 0;

  constructor(
    private readonly config: ICircuitBreakerConfig,
    private readonly logger: ILogger
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      const timeSinceLastFail = Date.now() - this.lastFailTime;
      const resetTimeout = this.config.resetTimeout || this.config.timeout || 60000;

      if (timeSinceLastFail > resetTimeout) {
        this.transitionToHalfOpen();
      } else {
        throw Errors.notFound('Circuit breaker is open');
      }
    }

    if (this.state === 'half-open') {
      if (this.halfOpenRequests >= (this.config.halfOpenRequests || 3)) {
        throw Errors.notFound('Circuit breaker is half-open, max requests reached');
      }
      this.halfOpenRequests++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.successes++;
      if (this.successes >= (this.config.halfOpenRequests || 3)) {
        this.transitionToClosed();
      }
    } else {
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailTime = Date.now();

    if (this.failures >= (this.config.threshold || 5)) {
      this.transitionToOpen();
    }
  }

  private transitionToOpen(): void {
    this.state = 'open';
    this.logger.warn('Circuit breaker opened');
    this.config.onOpen?.();
  }

  private transitionToHalfOpen(): void {
    this.state = 'half-open';
    this.halfOpenRequests = 0;
    this.successes = 0;
    this.logger.info('Circuit breaker half-open');
    this.config.onHalfOpen?.();
  }

  private transitionToClosed(): void {
    this.state = 'closed';
    this.failures = 0;
    this.halfOpenRequests = 0;
    this.logger.info('Circuit breaker closed');
    this.config.onClose?.();
  }

  getState(): any {
    return {
      state: this.state,
      failures: this.failures,
      lastFailTime: this.lastFailTime,
    };
  }
}

/**
 * Rate Limiter implementation
 */
class RateLimiter {
  private tokens: number;
  private lastRefill = Date.now();
  private windowStart = Date.now();
  private windowRequests = 0;

  constructor(
    private readonly config: IRateLimitConfig,
    private readonly logger: ILogger
  ) {
    this.tokens = config.burst || config.rps || 100;
  }

  async acquire(context?: any): Promise<void> {
    const strategy = this.config.strategy || 'token-bucket';

    switch (strategy) {
      case 'token-bucket':
        return this.tokenBucketAcquire();
      case 'sliding-window':
        return this.slidingWindowAcquire();
      case 'fixed-window':
        return this.fixedWindowAcquire();
      default:
        return this.tokenBucketAcquire();
    }
  }

  private async tokenBucketAcquire(): Promise<void> {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const rps = this.config.rps || 100;

    // Refill tokens
    const tokensToAdd = (timePassed / 1000) * rps;
    this.tokens = Math.min(this.tokens + tokensToAdd, this.config.burst || rps);
    this.lastRefill = now;

    // Check if we have tokens
    if (this.tokens < 1) {
      throw Errors.notFound('Rate limit exceeded');
    }

    this.tokens--;
  }

  private async slidingWindowAcquire(): Promise<void> {
    const now = Date.now();
    const windowSize = 1000; // 1 second window
    const maxRequests = this.config.rps || 100;

    // Sliding window logic
    if (now - this.windowStart > windowSize) {
      const overlap = (now - this.windowStart - windowSize) / windowSize;
      this.windowRequests = Math.floor(this.windowRequests * (1 - overlap));
      this.windowStart = now - windowSize;
    }

    if (this.windowRequests >= maxRequests) {
      throw Errors.notFound('Rate limit exceeded');
    }

    this.windowRequests++;
  }

  private async fixedWindowAcquire(): Promise<void> {
    const now = Date.now();
    const windowSize = 1000; // 1 second window
    const maxRequests = this.config.rps || 100;

    // Reset window if needed
    if (now - this.windowStart > windowSize) {
      this.windowStart = now;
      this.windowRequests = 0;
    }

    if (this.windowRequests >= maxRequests) {
      throw Errors.notFound('Rate limit exceeded');
    }

    this.windowRequests++;
  }

  getMetrics(): any {
    return {
      tokens: this.tokens,
      windowRequests: this.windowRequests,
      rps: this.config.rps,
    };
  }
}

/**
 * Bulkhead implementation
 */
class Bulkhead {
  private concurrent = 0;
  private queue: Array<{
    resolve: (value?: any) => void;
    reject: (error: Error) => void;
    timestamp: number;
  }> = [];

  constructor(
    private readonly config: IBulkheadConfig,
    private readonly logger: ILogger
  ) {}

  async acquire(): Promise<{ release: () => void }> {
    const maxConcurrent = this.config.maxConcurrent || 10;
    const maxQueue = this.config.maxQueue || 10;
    const queueTimeout = this.config.queueTimeout || 60000;

    if (this.concurrent < maxConcurrent) {
      this.concurrent++;
      return {
        release: () => {
          this.concurrent--;
          this.processQueue();
        },
      };
    }

    // Check queue size
    if (this.queue.length >= maxQueue) {
      throw Errors.notFound('Bulkhead queue full');
    }

    // Queue the request
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timestamp: Date.now() };
      this.queue.push(entry);

      // Set timeout
      setTimeout(() => {
        const index = this.queue.indexOf(entry);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(Errors.timeout('bulkhead queue', queueTimeout));
        }
      }, queueTimeout);
    }).then(() => ({
      release: () => {
        this.concurrent--;
        this.processQueue();
      },
    }));
  }

  private processQueue(): void {
    if (this.queue.length > 0 && this.concurrent < (this.config.maxConcurrent || 10)) {
      const entry = this.queue.shift()!;
      this.concurrent++;
      entry.resolve();
    }
  }

  getMetrics(): any {
    return {
      concurrent: this.concurrent,
      queueSize: this.queue.length,
      maxConcurrent: this.config.maxConcurrent,
    };
  }
}

/**
 * Retry Manager
 */
class RetryManager {
  constructor(
    private readonly config: IRetryConfig,
    private readonly logger: ILogger
  ) {}

  async execute<T>(fn: () => Promise<T>, context?: any): Promise<T> {
    const attempts = this.config.attempts || 3;
    const backoff = this.config.backoff || 'exponential';
    const maxDelay = this.config.maxDelay || 30000;
    const factor = this.config.factor || 2;
    const jitter = this.config.jitter !== false;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (attempt < attempts - 1) {
          const delay = this.calculateDelay(attempt, backoff, maxDelay, factor);
          const jitteredDelay = jitter ? this.addJitter(delay) : delay;

          this.logger.debug({ attempt, delay: jitteredDelay, context }, 'Retrying after failure');

          await this.sleep(jitteredDelay);
        }
      }
    }

    throw lastError || Errors.internal('Retry failed');
  }

  private calculateDelay(attempt: number, backoff: string, maxDelay: number, factor: number): number {
    let delay: number;

    switch (backoff) {
      case 'exponential':
        delay = Math.pow(factor, attempt) * 1000;
        break;
      case 'linear':
        delay = (attempt + 1) * 1000;
        break;
      case 'fixed':
      default:
        delay = 1000;
        break;
    }

    return Math.min(delay, maxDelay);
  }

  private addJitter(delay: number): number {
    return delay + Math.random() * delay * 0.1;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Service Metrics collector
 */
class ServiceMetrics {
  private requests = 0;
  private successes = 0;
  private failures = 0;
  private latencies: number[] = [];

  recordSuccess(method: string, latency: number): void {
    this.requests++;
    this.successes++;
    this.latencies.push(latency);

    // Keep only last 1000 measurements
    if (this.latencies.length > 1000) {
      this.latencies.shift();
    }
  }

  recordFailure(method: string, latency: number, error: Error): void {
    this.requests++;
    this.failures++;
    this.latencies.push(latency);

    // Keep only last 1000 measurements
    if (this.latencies.length > 1000) {
      this.latencies.shift();
    }
  }

  getMetrics(): any {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const len = sorted.length;

    return {
      requests: this.requests,
      successes: this.successes,
      failures: this.failures,
      successRate: this.requests > 0 ? this.successes / this.requests : 0,
      latency:
        len > 0
          ? {
              p50: sorted[Math.floor(len * 0.5)],
              p90: sorted[Math.floor(len * 0.9)],
              p99: sorted[Math.floor(len * 0.99)],
              mean: sorted.reduce((a, b) => a + b, 0) / len,
            }
          : null,
    };
  }
}
