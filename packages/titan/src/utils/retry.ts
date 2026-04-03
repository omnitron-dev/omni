/**
 * Unified Retry Strategy Utilities
 *
 * Provides generic retry strategy implementations that can be used across
 * the entire Titan framework (Rotif, Notifications, HTTP clients, etc.)
 *
 * @module utils/retry
 * @packageDocumentation
 */

/**
 * Retry strategy type enumeration
 */
export type RetryStrategyType = 'exponential' | 'linear' | 'fixed' | 'fibonacci' | 'custom';

/**
 * Generic retry strategy configuration
 *
 * @typeParam TContext - Context type passed to custom delay functions (e.g., message, notification)
 */
export interface RetryStrategyConfig<TContext = unknown> {
  /** Strategy type */
  strategy?: RetryStrategyType;
  /** Base delay in milliseconds */
  baseDelay?: number;
  /** Maximum delay in milliseconds */
  maxDelay?: number;
  /** Multiplier for exponential strategy */
  multiplier?: number;
  /** Jitter to add randomness (0-1, where 0.1 = 10% jitter) */
  jitter?: number;
  /** Custom retry delay function */
  customDelayFn?: (attempt: number, context: TContext) => number;
}

/**
 * Retry delay function signature
 */
export type RetryDelayFn<TContext = unknown> = (attempt: number, context: TContext) => number;

/**
 * Calculate Fibonacci number at index n
 * Uses iterative approach for better performance
 *
 * @param n - Fibonacci index (1-based for attempt compatibility)
 * @returns Fibonacci number
 */
export function getFibonacci(n: number): number {
  if (n <= 1) return 1;
  if (n === 2) return 2;

  let prev = 1;
  let curr = 2;

  for (let i = 3; i <= n; i++) {
    const next = prev + curr;
    prev = curr;
    curr = next;
  }

  return curr;
}

/**
 * Calculate Fibonacci delay for retry attempts
 *
 * @param attempt - Retry attempt number (1-based)
 * @param baseDelay - Base delay in milliseconds
 * @returns Delay in milliseconds
 */
export function getFibonacciDelay(attempt: number, baseDelay: number): number {
  return baseDelay * getFibonacci(attempt);
}

/**
 * Add jitter to a delay value
 *
 * @param delay - Base delay in milliseconds
 * @param jitterFactor - Jitter factor (0-1, where 0.1 = +/- 10%)
 * @returns Delay with jitter applied
 */
export function addJitter(delay: number, jitterFactor: number): number {
  if (jitterFactor <= 0) {
    return delay;
  }

  const jitterAmount = delay * jitterFactor;
  const jitteredDelay = delay + (Math.random() * 2 - 1) * jitterAmount;
  return Math.max(0, Math.round(jitteredDelay));
}

/**
 * Calculate delay for a specific strategy
 *
 * @param strategy - Retry strategy type
 * @param attempt - Retry attempt number (1-based)
 * @param baseDelay - Base delay in milliseconds
 * @param maxDelay - Maximum delay in milliseconds
 * @param multiplier - Multiplier for exponential strategy
 * @returns Calculated delay in milliseconds
 */
export function calculateStrategyDelay(
  strategy: RetryStrategyType,
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  multiplier: number
): number {
  let delay: number;

  switch (strategy) {
    case 'exponential':
      // Exponential backoff: baseDelay * (multiplier ^ (attempt - 1))
      delay = baseDelay * Math.pow(multiplier, attempt - 1);
      break;

    case 'linear':
      // Linear backoff: baseDelay * attempt
      delay = baseDelay * attempt;
      break;

    case 'fixed':
      // Fixed delay: always the same delay
      delay = baseDelay;
      break;

    case 'fibonacci':
      // Fibonacci sequence backoff
      delay = getFibonacciDelay(attempt, baseDelay);
      break;

    case 'custom':
      // Custom strategy should use customDelayFn, default to exponential
      delay = baseDelay * Math.pow(multiplier, attempt - 1);
      break;

    default:
      // Default to exponential
      delay = baseDelay * Math.pow(multiplier, attempt - 1);
  }

  return Math.min(delay, maxDelay);
}

/**
 * Creates a retry delay function based on the specified strategy configuration
 *
 * @typeParam TContext - Context type passed to the delay function
 * @param config - Retry strategy configuration
 * @returns Retry delay function
 *
 * @example
 * ```typescript
 * // Basic exponential backoff
 * const delayFn = createRetryDelayFn({ strategy: 'exponential', baseDelay: 1000 });
 * const delay = delayFn(3, {}); // Returns ~4000ms (1000 * 2^2)
 *
 * // With custom context type
 * interface MyMessage { id: string; priority: number; }
 * const customDelayFn = createRetryDelayFn<MyMessage>({
 *   customDelayFn: (attempt, msg) => msg.priority === 1 ? 100 : 1000 * attempt
 * });
 * ```
 */
export function createRetryDelayFn<TContext = unknown>(
  config: RetryStrategyConfig<TContext> = {}
): RetryDelayFn<TContext> {
  const {
    strategy = 'exponential',
    baseDelay = 1000,
    maxDelay = 60000,
    multiplier = 2,
    jitter = 0.1,
    customDelayFn,
  } = config;

  // If custom function provided, use it
  if (customDelayFn) {
    return customDelayFn;
  }

  return (attempt: number, _context: TContext): number => {
    const delay = calculateStrategyDelay(strategy, attempt, baseDelay, maxDelay, multiplier);

    // Add jitter if specified
    if (jitter > 0) {
      return addJitter(delay, jitter);
    }

    return Math.round(delay);
  };
}

/**
 * Preset retry strategies for common use cases
 *
 * @example
 * ```typescript
 * // Use aggressive preset
 * const config = RetryStrategies.aggressive();
 * const delayFn = createRetryDelayFn(config);
 *
 * // Use linear preset with custom base delay
 * const linearConfig = RetryStrategies.linear(2000);
 * ```
 */
export const RetryStrategies = {
  /**
   * Aggressive retry: starts fast, backs off quickly
   * Good for transient failures that should resolve quickly
   */
  aggressive: <TContext = unknown>(): RetryStrategyConfig<TContext> => ({
    strategy: 'exponential',
    baseDelay: 100,
    maxDelay: 10000,
    multiplier: 3,
    jitter: 0.2,
  }),

  /**
   * Conservative retry: starts slow, backs off slowly
   * Good for external service failures where patience is needed
   */
  conservative: <TContext = unknown>(): RetryStrategyConfig<TContext> => ({
    strategy: 'exponential',
    baseDelay: 5000,
    maxDelay: 120000,
    multiplier: 1.5,
    jitter: 0.1,
  }),

  /**
   * Immediate retry with fixed delay
   * Good for testing or quick recovery scenarios
   */
  immediate: <TContext = unknown>(): RetryStrategyConfig<TContext> => ({
    strategy: 'fixed',
    baseDelay: 100,
    jitter: 0,
  }),

  /**
   * Linear backoff for predictable delays
   * Good when you need consistent progression
   *
   * @param baseDelay - Base delay in milliseconds (default: 1000)
   */
  linear: <TContext = unknown>(baseDelay = 1000): RetryStrategyConfig<TContext> => ({
    strategy: 'linear',
    baseDelay,
    maxDelay: 30000,
    jitter: 0.1,
  }),

  /**
   * Fibonacci backoff for gradual increase
   * Good for medium-term retries with natural progression
   *
   * @param baseDelay - Base delay in milliseconds (default: 500)
   */
  fibonacci: <TContext = unknown>(baseDelay = 500): RetryStrategyConfig<TContext> => ({
    strategy: 'fibonacci',
    baseDelay,
    maxDelay: 60000,
    jitter: 0.15,
  }),

  /**
   * No delay retry (immediate retry, no backoff)
   * Use with caution - mainly for testing
   */
  none: <TContext = unknown>(): RetryStrategyConfig<TContext> => ({
    strategy: 'fixed',
    baseDelay: 0,
    jitter: 0,
  }),

  /**
   * Create custom exponential backoff preset
   *
   * @param baseDelay - Base delay in milliseconds
   * @param multiplier - Backoff multiplier
   * @param maxDelay - Maximum delay cap
   * @param jitter - Jitter factor (0-1)
   */
  exponential: <TContext = unknown>(
    baseDelay = 1000,
    multiplier = 2,
    maxDelay = 60000,
    jitter = 0.1
  ): RetryStrategyConfig<TContext> => ({
    strategy: 'exponential',
    baseDelay,
    multiplier,
    maxDelay,
    jitter,
  }),
} as const;

/**
 * Type helper for extracting context type from a RetryStrategyConfig
 */
export type ExtractRetryContext<T> = T extends RetryStrategyConfig<infer C> ? C : unknown;
