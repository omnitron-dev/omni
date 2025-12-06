/**
 * Resilience Utilities Module
 *
 * Consolidated utilities for building resilient applications including:
 * - Circuit Breaker pattern for fault tolerance
 * - Timeout utilities for operation deadlines
 * - Retry strategies with configurable backoff
 *
 * @module utils/resilience
 * @packageDocumentation
 */

import { EventEmitter } from 'events';

/**
 * Circuit breaker state enumeration
 */
export enum CircuitState {
  /**
   * Circuit is closed - requests are allowed through normally
   */
  Closed = 'closed',
  /**
   * Circuit is open - requests fail fast without attempting the operation
   */
  Open = 'open',
  /**
   * Circuit is half-open - allowing limited test requests to check if service recovered
   */
  HalfOpen = 'half-open',
}

/**
 * Configuration options for the CircuitBreaker
 */
export interface CircuitBreakerConfig {
  /**
   * Number of consecutive failures required to open the circuit
   * @default 5
   */
  failureThreshold?: number;

  /**
   * Time in milliseconds to wait before transitioning from open to half-open
   * @default 30000 (30 seconds)
   */
  resetTimeout?: number;

  /**
   * Number of successful calls needed to close from half-open state
   * @default 1
   */
  successThreshold?: number;

  /**
   * Timeout for individual requests in milliseconds
   * @default undefined (no timeout)
   */
  requestTimeout?: number;

  /**
   * Minimum number of calls before circuit can trip (prevents premature opening)
   * @default 10
   */
  volumeThreshold?: number;

  /**
   * Failure rate percentage (0-100) required to open circuit
   * @default undefined (use absolute threshold instead)
   */
  failureRateThreshold?: number;

  /**
   * Size of the sliding window for metrics tracking
   * @default 100
   */
  slidingWindowSize?: number;

  /**
   * Optional name for identification in logs and metrics
   */
  name?: string;
}

/**
 * Metrics tracked by the circuit breaker
 */
export interface CircuitBreakerMetrics {
  /** Current state of the circuit */
  state: CircuitState;
  /** Total number of calls attempted */
  totalCalls: number;
  /** Number of successful calls */
  successfulCalls: number;
  /** Number of failed calls */
  failedCalls: number;
  /** Number of calls rejected due to open circuit */
  rejectedCalls: number;
  /** Timestamp of last failure */
  lastFailureTime?: number;
  /** Timestamp of last state change */
  lastStateChangeTime: number;
  /** Current failure rate percentage */
  failureRate: number;
}

/**
 * Internal call result for sliding window tracking
 */
interface CallResult {
  timestamp: number;
  success: boolean;
  duration: number;
}

/**
 * CircuitBreaker - Prevents cascading failures by failing fast when a service is unhealthy
 *
 * The circuit breaker pattern protects your application from repeatedly trying operations
 * that are likely to fail. It transitions through three states:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failures detected, requests fail fast
 * - HALF_OPEN: Testing if service recovered, limited requests allowed
 *
 * @example
 * ```typescript
 * const breaker = new CircuitBreaker({
 *   failureThreshold: 5,
 *   resetTimeout: 60000,
 *   requestTimeout: 3000,
 *   name: 'api-service'
 * });
 *
 * breaker.on('stateChange', ({ previousState, newState }) => {
 *   console.log(`Circuit ${previousState} -> ${newState}`);
 * });
 *
 * try {
 *   const result = await breaker.execute(() => callExternalAPI());
 *   console.log('Success:', result);
 * } catch (error) {
 *   console.error('Circuit breaker rejected or operation failed:', error);
 * }
 * ```
 */
export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = CircuitState.Closed;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime?: number;
  private lastStateChangeTime: number = Date.now();
  private totalCalls = 0;
  private rejectedCalls = 0;
  private slidingWindow: CallResult[] = [];
  private halfOpenInProgress = false;
  private readonly config: Required<CircuitBreakerConfig>;

  /**
   * Creates a new CircuitBreaker instance
   *
   * @param config - Configuration options for the circuit breaker
   */
  constructor(config: CircuitBreakerConfig = {}) {
    super();
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      resetTimeout: config.resetTimeout ?? 30000,
      successThreshold: config.successThreshold ?? 1,
      requestTimeout: config.requestTimeout ?? 0,
      volumeThreshold: config.volumeThreshold ?? 10,
      failureRateThreshold: config.failureRateThreshold ?? 0,
      slidingWindowSize: config.slidingWindowSize ?? 100,
      name: config.name ?? 'CircuitBreaker',
    };
  }

  /**
   * Execute a function through the circuit breaker
   *
   * @param fn - Async function to execute
   * @returns Promise resolving to the function's result
   * @throws Error if circuit is open or function fails
   *
   * @emits rejected - When a call is rejected due to open circuit
   * @emits success - When a call succeeds
   * @emits failure - When a call fails
   * @emits stateChange - When circuit state changes
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      this.rejectedCalls++;
      this.emit('rejected', {
        name: this.config.name,
        state: this.state,
        metrics: this.getMetrics(),
      });
      throw new Error(`Circuit breaker '${this.config.name}' is ${this.state}`);
    }

    // In half-open state, only allow one call at a time to test recovery
    if (this.state === CircuitState.HalfOpen) {
      if (this.halfOpenInProgress) {
        this.rejectedCalls++;
        this.emit('rejected', {
          name: this.config.name,
          state: this.state,
          reason: 'half-open-test-in-progress',
        });
        throw new Error(`Circuit breaker '${this.config.name}' is testing recovery`);
      }
      this.halfOpenInProgress = true;
    }

    const startTime = Date.now();
    this.totalCalls++;

    try {
      const result = this.config.requestTimeout > 0
        ? await this.executeWithTimeout(fn, this.config.requestTimeout)
        : await fn();

      this.recordSuccess(Date.now() - startTime);
      return result;
    } catch (error) {
      this.recordFailure(Date.now() - startTime);
      throw error;
    } finally {
      if (this.state === CircuitState.HalfOpen) {
        this.halfOpenInProgress = false;
      }
    }
  }

  /**
   * Get the current state of the circuit
   *
   * @returns Current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get comprehensive metrics about circuit breaker operation
   *
   * @returns Current metrics
   */
  getMetrics(): CircuitBreakerMetrics {
    const successfulCalls = this.slidingWindow.filter((c) => c.success).length;
    const failedCalls = this.slidingWindow.filter((c) => !c.success).length;
    const total = successfulCalls + failedCalls;

    return {
      state: this.state,
      totalCalls: this.totalCalls,
      successfulCalls,
      failedCalls,
      rejectedCalls: this.rejectedCalls,
      lastFailureTime: this.lastFailureTime,
      lastStateChangeTime: this.lastStateChangeTime,
      failureRate: total > 0 ? (failedCalls / total) * 100 : 0,
    };
  }

  /**
   * Force the circuit to open state (useful for testing or manual intervention)
   */
  forceOpen(): void {
    this.transitionTo(CircuitState.Open);
    this.lastFailureTime = Date.now();
  }

  /**
   * Force the circuit to closed state (useful for testing or manual intervention)
   */
  forceClosed(): void {
    this.transitionTo(CircuitState.Closed);
  }

  /**
   * Reset the circuit breaker to initial state
   */
  reset(): void {
    this.state = CircuitState.Closed;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = undefined;
    this.lastStateChangeTime = Date.now();
    this.totalCalls = 0;
    this.rejectedCalls = 0;
    this.slidingWindow = [];
    this.halfOpenInProgress = false;
    this.emit('reset', { name: this.config.name });
  }

  /**
   * Execute function with timeout
   */
  private async executeWithTimeout<T>(fn: () => Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Operation timed out after ${timeout}ms`)), timeout)
      ),
    ]);
  }

  /**
   * Check if execution is allowed based on current circuit state
   */
  private canExecute(): boolean {
    switch (this.state) {
      case CircuitState.Closed:
        return true;

      case CircuitState.Open:
        // Check if reset timeout has passed
        if (this.lastFailureTime && Date.now() - this.lastFailureTime >= this.config.resetTimeout) {
          this.transitionTo(CircuitState.HalfOpen);
          return true;
        }
        return false;

      case CircuitState.HalfOpen:
        return true;

      default:
        return false;
    }
  }

  /**
   * Record a successful call
   */
  private recordSuccess(duration: number): void {
    this.addToSlidingWindow({ timestamp: Date.now(), success: true, duration });

    if (this.state === CircuitState.HalfOpen) {
      this.successCount++;

      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo(CircuitState.Closed);
      }
    } else if (this.state === CircuitState.Closed) {
      // Reset failure count on success in closed state
      this.failureCount = 0;
    }

    this.emit('success', { name: this.config.name, duration });
  }

  /**
   * Record a failed call
   */
  private recordFailure(duration: number): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.addToSlidingWindow({ timestamp: Date.now(), success: false, duration });

    if (this.state === CircuitState.HalfOpen) {
      // Any failure in half-open state reopens the circuit
      this.transitionTo(CircuitState.Open);
    } else if (this.state === CircuitState.Closed) {
      this.checkThreshold();
    }

    this.emit('failure', {
      name: this.config.name,
      duration,
      failureCount: this.failureCount,
    });
  }

  /**
   * Check if failure threshold is exceeded
   */
  private checkThreshold(): void {
    // Check volume threshold
    if (this.slidingWindow.length < this.config.volumeThreshold) {
      return;
    }

    // Check failure rate threshold if configured
    if (this.config.failureRateThreshold > 0) {
      const recentCalls = this.slidingWindow.slice(-this.config.slidingWindowSize);
      const failures = recentCalls.filter((c) => !c.success).length;
      const failureRate = (failures / recentCalls.length) * 100;

      if (failureRate >= this.config.failureRateThreshold) {
        this.transitionTo(CircuitState.Open);
        return;
      }
    }

    // Check absolute failure threshold
    if (this.failureCount >= this.config.failureThreshold) {
      this.transitionTo(CircuitState.Open);
    }
  }

  /**
   * Add call result to sliding window
   */
  private addToSlidingWindow(result: CallResult): void {
    this.slidingWindow.push(result);

    if (this.slidingWindow.length > this.config.slidingWindowSize) {
      this.slidingWindow.shift();
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const previousState = this.state;
    this.state = newState;
    this.lastStateChangeTime = Date.now();

    if (newState === CircuitState.Closed) {
      this.failureCount = 0;
      this.successCount = 0;
    } else if (newState === CircuitState.HalfOpen) {
      this.successCount = 0;
    }

    this.emit('stateChange', {
      name: this.config.name,
      previousState,
      newState,
      timestamp: this.lastStateChangeTime,
    });
  }
}

/**
 * Configuration options for timeout operations
 */
export interface TimeoutOptions {
  /**
   * Timeout duration in milliseconds
   */
  timeout: number;

  /**
   * Custom error message for timeout
   */
  errorMessage?: string;
}

/**
 * Execute a promise with a timeout
 *
 * Wraps a promise to reject if it doesn't resolve within the specified timeout.
 * The original promise continues to execute but its result is ignored.
 *
 * @param promise - The promise to execute
 * @param timeout - Timeout in milliseconds or TimeoutOptions object
 * @param errorMessage - Optional custom error message (deprecated, use TimeoutOptions)
 * @returns Promise that rejects on timeout or resolves with the original result
 *
 * @example
 * ```typescript
 * // Basic usage with timeout value
 * const result = await withTimeout(fetchData(), 5000);
 *
 * // With custom error message
 * const result = await withTimeout(
 *   fetchData(),
 *   { timeout: 5000, errorMessage: 'Data fetch timeout' }
 * );
 * ```
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeout: number | TimeoutOptions,
  errorMessage?: string
): Promise<T> {
  const timeoutMs = typeof timeout === 'number' ? timeout : timeout.timeout;
  const message = typeof timeout === 'object' && timeout.errorMessage
    ? timeout.errorMessage
    : errorMessage || `Operation timed out after ${timeoutMs}ms`;

  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(message);
      error.name = 'TimeoutError';
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/**
 * Backoff strategy for retry operations
 */
export enum BackoffStrategy {
  /**
   * Fixed delay between retries
   */
  Fixed = 'fixed',

  /**
   * Linear increase in delay (delay * attempt)
   */
  Linear = 'linear',

  /**
   * Exponential increase in delay (delay * multiplier^attempt)
   */
  Exponential = 'exponential',

  /**
   * Exponential with random jitter to avoid thundering herd
   */
  ExponentialWithJitter = 'exponential-with-jitter',
}

/**
 * Configuration options for retry operations
 */
export interface RetryOptions {
  /**
   * Maximum number of retry attempts
   * @default 3
   */
  maxRetries?: number;

  /**
   * Initial delay in milliseconds before first retry
   * @default 100
   */
  initialDelay?: number;

  /**
   * Maximum delay in milliseconds between retries
   * @default 30000 (30 seconds)
   */
  maxDelay?: number;

  /**
   * Backoff strategy to use
   * @default BackoffStrategy.Exponential
   */
  backoffStrategy?: BackoffStrategy;

  /**
   * Multiplier for exponential backoff
   * @default 2
   */
  backoffMultiplier?: number;

  /**
   * Jitter factor (0-1) for random variance
   * @default 0.1
   */
  jitterFactor?: number;

  /**
   * Predicate to determine if error should be retried
   * @default () => true (retry all errors)
   */
  shouldRetry?: (error: Error, attempt: number) => boolean;

  /**
   * Callback invoked before each retry
   */
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

/**
 * Retry a function with configurable backoff strategy
 *
 * Executes a function and retries on failure using the specified backoff strategy.
 * Useful for handling transient errors in network calls, database operations, etc.
 *
 * @param fn - Async function to retry
 * @param options - Retry configuration options
 * @returns Promise resolving to the function's result
 * @throws The last error if all retries are exhausted
 *
 * @example
 * ```typescript
 * // Basic retry with defaults (3 attempts, exponential backoff)
 * const data = await retry(() => fetchData());
 *
 * // Custom retry configuration
 * const data = await retry(
 *   () => fetchData(),
 *   {
 *     maxRetries: 5,
 *     initialDelay: 200,
 *     backoffStrategy: BackoffStrategy.ExponentialWithJitter,
 *     shouldRetry: (error) => error.message.includes('timeout'),
 *     onRetry: (error, attempt, delay) => {
 *       console.log(`Retry ${attempt} after ${delay}ms: ${error.message}`);
 *     }
 *   }
 * );
 * ```
 */
export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 100,
    maxDelay = 30000,
    backoffStrategy = BackoffStrategy.Exponential,
    backoffMultiplier = 2,
    jitterFactor = 0.1,
    shouldRetry = () => true,
    onRetry,
  } = options;

  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if it's the last attempt or error is not retryable
      if (attempt > maxRetries || !shouldRetry(lastError, attempt)) {
        throw lastError;
      }

      // Calculate delay for next retry
      const delay = calculateBackoffDelay(attempt, {
        initialDelay,
        maxDelay,
        backoffStrategy,
        backoffMultiplier,
        jitterFactor,
      });

      // Invoke retry callback if provided
      if (onRetry) {
        onRetry(lastError, attempt, delay);
      }

      // Wait before next retry
      await sleep(delay);
    }
  }

  throw lastError!;
}

/**
 * Configuration for retryWithBackoff (legacy compatibility)
 */
export interface RetryWithBackoffOptions {
  /**
   * Maximum number of retry attempts
   * @default 3
   */
  maxAttempts?: number;

  /**
   * Initial delay in milliseconds
   * @default 1000
   */
  initialDelay?: number;

  /**
   * Maximum delay in milliseconds
   * @default 30000
   */
  maxDelay?: number;

  /**
   * Backoff factor (multiplier)
   * @default 2
   */
  backoffFactor?: number;

  /**
   * Predicate to determine if error should be retried
   */
  shouldRetry?: (error: Error, attempt: number) => boolean;

  /**
   * Callback invoked before each retry
   */
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

/**
 * Retry with exponential backoff (legacy API for backward compatibility)
 *
 * This is a legacy wrapper around the `retry` function for backward compatibility.
 * New code should use the `retry` function directly.
 *
 * @param fn - Async function to retry
 * @param options - Retry configuration options
 * @returns Promise resolving to the function's result
 * @throws The last error if all retries are exhausted
 *
 * @deprecated Use `retry` function instead
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryWithBackoffOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffFactor = 2,
    shouldRetry,
    onRetry,
  } = options;

  return retry(fn, {
    maxRetries: maxAttempts,
    initialDelay,
    maxDelay,
    backoffMultiplier: backoffFactor,
    backoffStrategy: BackoffStrategy.Exponential,
    shouldRetry,
    onRetry,
  });
}

/**
 * Calculate delay for a retry attempt based on backoff strategy
 *
 * @internal
 */
function calculateBackoffDelay(
  attempt: number,
  options: {
    initialDelay: number;
    maxDelay: number;
    backoffStrategy: BackoffStrategy;
    backoffMultiplier: number;
    jitterFactor: number;
  }
): number {
  const { initialDelay, maxDelay, backoffStrategy, backoffMultiplier, jitterFactor } = options;

  let delay: number;

  switch (backoffStrategy) {
    case BackoffStrategy.Fixed:
      delay = initialDelay;
      break;

    case BackoffStrategy.Linear:
      delay = initialDelay * attempt;
      break;

    case BackoffStrategy.Exponential:
      delay = initialDelay * Math.pow(backoffMultiplier, attempt - 1);
      break;

    case BackoffStrategy.ExponentialWithJitter:
      delay = initialDelay * Math.pow(backoffMultiplier, attempt - 1);
      const jitter = delay * jitterFactor * (Math.random() * 2 - 1);
      delay = delay + jitter;
      break;

    default:
      delay = initialDelay;
  }

  return Math.min(Math.max(0, delay), maxDelay);
}

/**
 * Sleep for specified milliseconds
 *
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the specified time
 *
 * @example
 * ```typescript
 * await sleep(1000); // Wait for 1 second
 * ```
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a timeout error
 *
 * @param operation - Name of the operation that timed out
 * @param timeout - Timeout duration in milliseconds
 * @returns Error object with timeout information
 */
export function createTimeoutError(operation: string, timeout: number): Error {
  const error = new Error(`${operation} timed out after ${timeout}ms`);
  error.name = 'TimeoutError';
  return error;
}

/**
 * Check if an error is a timeout error
 *
 * @param error - Error to check
 * @returns True if the error is a timeout error
 */
export function isTimeoutError(error: Error): boolean {
  return error.name === 'TimeoutError' || error.message.includes('timed out');
}
