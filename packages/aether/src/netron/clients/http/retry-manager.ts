/**
 * Retry Manager for HTTP requests
 *
 * Provides intelligent retry logic with:
 * - Exponential, linear, and constant backoff strategies
 * - Customizable retry conditions
 * - Jitter to prevent thundering herd
 * - Circuit breaker integration
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import { TitanError, ErrorCode } from '../../errors.js';

/**
 * Retry options
 */
export interface RetryOptions {
  /** Maximum retry attempts */
  attempts: number;
  /** Backoff strategy */
  backoff?: 'exponential' | 'linear' | 'constant';
  /** Initial delay in milliseconds */
  initialDelay?: number;
  /** Maximum delay between retries in milliseconds */
  maxDelay?: number;
  /** Jitter factor (0-1) to randomize delays */
  jitter?: number;
  /** Custom retry condition */
  shouldRetry?: (error: any, attempt: number) => boolean | Promise<boolean>;
  /** Callback on retry */
  onRetry?: (attempt: number, error: any) => void;
  /** Timeout for each attempt in milliseconds */
  attemptTimeout?: number;
  /** Factor for exponential backoff */
  factor?: number;
}

/**
 * Retry statistics
 */
export interface RetryStats {
  /** Total retry attempts */
  totalAttempts: number;
  /** Successful retries */
  successfulRetries: number;
  /** Failed retries */
  failedRetries: number;
  /** Average retry delay */
  avgRetryDelay: number;
  /** Current circuit breaker state */
  circuitState?: 'closed' | 'open' | 'half-open';
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerOptions {
  /** Failure threshold to open circuit */
  threshold: number;
  /** Time window for counting failures in milliseconds */
  windowTime: number;
  /** Cool down period before half-open state in milliseconds */
  cooldownTime: number;
  /** Success threshold to close circuit from half-open */
  successThreshold?: number;
}

/**
 * Retry Manager implementation
 */
export class RetryManager extends EventEmitter {
  private stats = {
    totalAttempts: 0,
    successfulRetries: 0,
    failedRetries: 0,
    retryDelays: [] as number[]
  };

  // Circuit breaker state
  private circuitBreaker?: {
    state: 'closed' | 'open' | 'half-open';
    failures: number;
    successes: number;
    lastFailureTime: number;
    nextAttemptTime: number;
    options: CircuitBreakerOptions;
  };

  constructor(
    private options: {
      /** Default retry options */
      defaultOptions?: Partial<RetryOptions>;
      /** Enable circuit breaker */
      circuitBreaker?: CircuitBreakerOptions;
      /** Enable debug logging */
      debug?: boolean;
    } = {}
  ) {
    super();

    // Initialize circuit breaker if configured
    if (options.circuitBreaker) {
      this.circuitBreaker = {
        state: 'closed',
        failures: 0,
        successes: 0,
        lastFailureTime: 0,
        nextAttemptTime: 0,
        options: options.circuitBreaker
      };
    }
  }

  /**
   * Execute function with retry logic
   */
  async execute<T>(
    fn: () => Promise<T>,
    options: RetryOptions
  ): Promise<T> {
    // Merge with default options
    const retryOptions: Required<RetryOptions> = {
      attempts: options.attempts,
      backoff: options.backoff || this.options.defaultOptions?.backoff || 'exponential',
      initialDelay: options.initialDelay || this.options.defaultOptions?.initialDelay || 1000,
      maxDelay: options.maxDelay || this.options.defaultOptions?.maxDelay || 30000,
      jitter: options.jitter ?? this.options.defaultOptions?.jitter ?? 0.1,
      shouldRetry: options.shouldRetry || this.options.defaultOptions?.shouldRetry || this.defaultShouldRetry,
      onRetry: options.onRetry || this.options.defaultOptions?.onRetry || (() => {}),
      attemptTimeout: options.attemptTimeout || this.options.defaultOptions?.attemptTimeout || 0,
      factor: options.factor || this.options.defaultOptions?.factor || 2
    };

    // Check circuit breaker
    if (this.circuitBreaker) {
      this.checkCircuitBreaker();
      if (this.circuitBreaker.state === 'open') {
        throw new TitanError({
          code: ErrorCode.SERVICE_UNAVAILABLE,
          message: 'Circuit breaker is open',
          details: {
            nextAttemptTime: this.circuitBreaker.nextAttemptTime
          }
        });
      }
    }

    let lastError: any;
    let delay = retryOptions.initialDelay;

    // attempts = number of retries, so we try initial + retries
    for (let attempt = 0; attempt <= retryOptions.attempts; attempt++) {
      try {
        if (this.options.debug) {
          console.log(`[Retry] Attempt ${attempt + 1}/${retryOptions.attempts + 1}`);
        }

        // Execute with timeout if specified
        const result = await this.executeWithTimeout(fn, retryOptions.attemptTimeout);

        // Record success
        if (attempt > 0) {
          this.stats.successfulRetries++;
          this.emit('retry-success', { attempt, delay });
        }

        // Update circuit breaker on success
        if (this.circuitBreaker) {
          this.onCircuitBreakerSuccess();
        }

        return result;
      } catch (error: any) {
        lastError = error;
        this.stats.totalAttempts++;

        // Check if we should retry
        const shouldRetry = await retryOptions.shouldRetry(error, attempt);

        if (!shouldRetry) {
          if (this.options.debug) {
            console.log(`[Retry] Error not retryable:`, error.message);
          }
          this.stats.failedRetries++;
          this.updateCircuitBreakerOnFailure();
          throw error;
        }

        if (attempt < retryOptions.attempts) {
          // Calculate delay with jitter
          const jitteredDelay = this.addJitter(delay, retryOptions.jitter);
          this.stats.retryDelays.push(jitteredDelay);

          if (this.options.debug) {
            console.log(`[Retry] Attempt ${attempt + 1} failed, retrying in ${jitteredDelay}ms:`, error.message);
          }

          // Call retry callback
          retryOptions.onRetry(attempt + 1, error);

          // Emit retry event
          this.emit('retry', {
            attempt: attempt + 1,
            error: error.message,
            delay: jitteredDelay
          });

          // Wait before retry
          await this.delay(jitteredDelay);

          // Calculate next delay based on backoff strategy
          delay = this.calculateNextDelay(
            delay,
            retryOptions.backoff,
            retryOptions.factor,
            retryOptions.maxDelay,
            retryOptions.initialDelay
          );
        } else {
          // Max retries exceeded
          this.stats.failedRetries++;
          this.updateCircuitBreakerOnFailure();

          if (this.options.debug) {
            console.log(`[Retry] Max attempts exceeded`);
          }

          this.emit('retry-exhausted', {
            attempts: retryOptions.attempts + 1,
            error: error.message
          });
        }
      }
    }

    throw lastError;
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout: number
  ): Promise<T> {
    if (!timeout || timeout <= 0) {
      return fn();
    }

    return Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new TitanError({
            code: ErrorCode.REQUEST_TIMEOUT,
            message: `Request timeout after ${timeout}ms`
          }));
        }, timeout);
      })
    ]);
  }

  /**
   * Default retry condition
   */
  private defaultShouldRetry(error: any, attempt: number): boolean {
    // Don't retry on programming errors
    if (error instanceof TypeError || error instanceof ReferenceError) {
      return false;
    }

    // Network errors are retryable
    if (error.code === 'ECONNREFUSED' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'ENETUNREACH') {
      return true;
    }

    // HTTP status-based retry logic
    if (error.status) {
      // 5xx errors are retryable
      if (error.status >= 500) {
        return true;
      }

      // 429 (Rate Limit) is retryable
      if (error.status === 429) {
        return true;
      }

      // 408 (Request Timeout) is retryable
      if (error.status === 408) {
        return true;
      }

      // 4xx errors (except above) are not retryable
      if (error.status >= 400 && error.status < 500) {
        return false;
      }
    }

    // TitanError-based retry logic
    if (error instanceof TitanError) {
      switch (error.code) {
        case ErrorCode.SERVICE_UNAVAILABLE:
        case ErrorCode.REQUEST_TIMEOUT:
        case ErrorCode.TOO_MANY_REQUESTS:
        case ErrorCode.INTERNAL_ERROR:
          return true;
        case ErrorCode.INVALID_ARGUMENT:
        case ErrorCode.NOT_FOUND:
        case ErrorCode.UNAUTHORIZED:
        case ErrorCode.FORBIDDEN:
        case ErrorCode.CONFLICT:
          return false;
        default:
          return attempt < 2; // Retry once for unknown errors
      }
    }

    // Default: retry for unknown errors
    return true;
  }

  /**
   * Calculate next delay based on backoff strategy
   */
  private calculateNextDelay(
    currentDelay: number,
    backoff: 'exponential' | 'linear' | 'constant',
    factor: number,
    maxDelay: number,
    initialDelay: number
  ): number {
    let nextDelay: number;

    switch (backoff) {
      case 'exponential':
        nextDelay = currentDelay * factor;
        break;
      case 'linear':
        nextDelay = currentDelay + initialDelay;
        break;
      case 'constant':
        nextDelay = currentDelay;
        break;
      default:
        nextDelay = currentDelay * 2;
    }

    return Math.min(nextDelay, maxDelay);
  }

  /**
   * Add jitter to delay
   */
  private addJitter(delay: number, jitterFactor: number): number {
    if (jitterFactor <= 0) {
      return delay;
    }

    const jitter = delay * jitterFactor * (Math.random() - 0.5) * 2;
    return Math.max(0, delay + jitter);
  }

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check circuit breaker state
   */
  private checkCircuitBreaker(): void {
    if (!this.circuitBreaker) return;

    const now = Date.now();

    // Check if we should transition from open to half-open
    if (this.circuitBreaker.state === 'open' && now >= this.circuitBreaker.nextAttemptTime) {
      this.circuitBreaker.state = 'half-open';
      this.circuitBreaker.successes = 0;
      this.emit('circuit-breaker-half-open');

      if (this.options.debug) {
        console.log('[CircuitBreaker] Transitioned to HALF-OPEN');
      }
    }

    // Clean up old failures outside the window
    if (now - this.circuitBreaker.lastFailureTime > this.circuitBreaker.options.windowTime) {
      this.circuitBreaker.failures = 0;
    }
  }

  /**
   * Update circuit breaker on success
   */
  private onCircuitBreakerSuccess(): void {
    if (!this.circuitBreaker) return;

    if (this.circuitBreaker.state === 'half-open') {
      this.circuitBreaker.successes++;

      const threshold = this.circuitBreaker.options.successThreshold || 3;
      if (this.circuitBreaker.successes >= threshold) {
        this.circuitBreaker.state = 'closed';
        this.circuitBreaker.failures = 0;
        this.circuitBreaker.successes = 0;
        this.emit('circuit-breaker-closed');

        if (this.options.debug) {
          console.log('[CircuitBreaker] Transitioned to CLOSED');
        }
      }
    }
  }

  /**
   * Update circuit breaker on failure
   */
  private updateCircuitBreakerOnFailure(): void {
    if (!this.circuitBreaker) return;

    const now = Date.now();
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailureTime = now;

    // If in half-open state, go back to open (check this first)
    if (this.circuitBreaker.state === 'half-open') {
      this.circuitBreaker.state = 'open';
      this.circuitBreaker.nextAttemptTime = now + this.circuitBreaker.options.cooldownTime;
      this.emit('circuit-breaker-open', { nextAttemptTime: this.circuitBreaker.nextAttemptTime });

      if (this.options.debug) {
        console.log('[CircuitBreaker] Transitioned back to OPEN from HALF-OPEN');
      }
      return; // Early return to avoid duplicate processing
    }

    // Check if we should open the circuit from closed state
    if (this.circuitBreaker.state === 'closed' &&
        this.circuitBreaker.failures >= this.circuitBreaker.options.threshold) {
      this.circuitBreaker.state = 'open';
      this.circuitBreaker.nextAttemptTime = now + this.circuitBreaker.options.cooldownTime;
      this.emit('circuit-breaker-open', { nextAttemptTime: this.circuitBreaker.nextAttemptTime });

      if (this.options.debug) {
        console.log('[CircuitBreaker] Transitioned to OPEN');
      }
    }
  }

  /**
   * Get retry statistics
   */
  getStats(): RetryStats {
    const avgRetryDelay = this.stats.retryDelays.length > 0
      ? this.stats.retryDelays.reduce((a, b) => a + b, 0) / this.stats.retryDelays.length
      : 0;

    return {
      totalAttempts: this.stats.totalAttempts,
      successfulRetries: this.stats.successfulRetries,
      failedRetries: this.stats.failedRetries,
      avgRetryDelay,
      circuitState: this.circuitBreaker?.state
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalAttempts: 0,
      successfulRetries: 0,
      failedRetries: 0,
      retryDelays: []
    };

    if (this.circuitBreaker) {
      this.circuitBreaker.state = 'closed';
      this.circuitBreaker.failures = 0;
      this.circuitBreaker.successes = 0;
      this.circuitBreaker.lastFailureTime = 0;
      this.circuitBreaker.nextAttemptTime = 0;
    }

    this.emit('stats-reset');
  }

  /**
   * Get circuit breaker state
   */
  getCircuitBreakerState(): 'closed' | 'open' | 'half-open' | undefined {
    return this.circuitBreaker?.state;
  }

  /**
   * Manually trip the circuit breaker
   */
  tripCircuitBreaker(): void {
    if (!this.circuitBreaker) return;

    this.circuitBreaker.state = 'open';
    this.circuitBreaker.nextAttemptTime = Date.now() + this.circuitBreaker.options.cooldownTime;
    this.emit('circuit-breaker-tripped');

    if (this.options.debug) {
      console.log('[CircuitBreaker] Manually tripped to OPEN');
    }
  }

  /**
   * Manually reset the circuit breaker
   */
  resetCircuitBreaker(): void {
    if (!this.circuitBreaker) return;

    this.circuitBreaker.state = 'closed';
    this.circuitBreaker.failures = 0;
    this.circuitBreaker.successes = 0;
    this.circuitBreaker.lastFailureTime = 0;
    this.circuitBreaker.nextAttemptTime = 0;
    this.emit('circuit-breaker-reset');

    if (this.options.debug) {
      console.log('[CircuitBreaker] Manually reset to CLOSED');
    }
  }
}