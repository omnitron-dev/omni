/**
 * Retry strategy implementations for Rotif
 */

import type { RotifMessage } from './types.js';

/**
 * Retry strategy type
 */
export type RetryStrategy = 'exponential' | 'linear' | 'fixed' | 'fibonacci';

/**
 * Retry strategy configuration
 */
export interface RetryStrategyConfig {
  /** Strategy type */
  strategy?: RetryStrategy;
  /** Base delay in milliseconds */
  baseDelay?: number;
  /** Maximum delay in milliseconds */
  maxDelay?: number;
  /** Multiplier for exponential strategy */
  multiplier?: number;
  /** Jitter to add randomness (0-1, where 0.1 = 10% jitter) */
  jitter?: number;
  /** Custom retry delay function */
  customDelayFn?: (attempt: number, msg: RotifMessage) => number;
}

/**
 * Creates a retry delay function based on the specified strategy
 */
export function createRetryDelayFn(config: RetryStrategyConfig = {}): (attempt: number, msg: RotifMessage) => number {
  const {
    strategy = 'exponential',
    baseDelay = 1000,
    maxDelay = 60000,
    multiplier = 2,
    jitter = 0.1,
    customDelayFn
  } = config;

  // If custom function provided, use it
  if (customDelayFn) {
    return customDelayFn;
  }

  return (attempt: number, msg: RotifMessage): number => {
    let delay: number;

    switch (strategy) {
      case 'exponential':
        // Exponential backoff: baseDelay * (multiplier ^ attempt)
        delay = Math.min(baseDelay * Math.pow(multiplier, attempt - 1), maxDelay);
        break;

      case 'linear':
        // Linear backoff: baseDelay * attempt
        delay = Math.min(baseDelay * attempt, maxDelay);
        break;

      case 'fixed':
        // Fixed delay: always the same delay
        delay = baseDelay;
        break;

      case 'fibonacci':
        // Fibonacci sequence backoff
        delay = Math.min(getFibonacciDelay(attempt, baseDelay), maxDelay);
        break;

      default:
        // Default to exponential
        delay = Math.min(baseDelay * Math.pow(multiplier, attempt - 1), maxDelay);
    }

    // Add jitter if specified
    if (jitter > 0) {
      const jitterAmount = delay * jitter;
      delay = delay + (Math.random() * 2 - 1) * jitterAmount;
      delay = Math.max(0, delay); // Ensure non-negative
    }

    return Math.round(delay);
  };
}

/**
 * Calculate Fibonacci delay
 */
function getFibonacciDelay(attempt: number, baseDelay: number): number {
  if (attempt <= 1) return baseDelay;
  if (attempt === 2) return baseDelay * 2;

  let prev = 1;
  let curr = 2;

  for (let i = 3; i <= attempt; i++) {
    const next = prev + curr;
    prev = curr;
    curr = next;
  }

  return baseDelay * curr;
}

/**
 * Preset retry strategies
 */
export const RetryStrategies = {
  /**
   * Aggressive retry: starts fast, backs off quickly
   */
  aggressive: (): RetryStrategyConfig => ({
    strategy: 'exponential',
    baseDelay: 100,
    maxDelay: 10000,
    multiplier: 3,
    jitter: 0.2
  }),

  /**
   * Conservative retry: starts slow, backs off slowly
   */
  conservative: (): RetryStrategyConfig => ({
    strategy: 'exponential',
    baseDelay: 5000,
    maxDelay: 120000,
    multiplier: 1.5,
    jitter: 0.1
  }),

  /**
   * Immediate retry with fixed delay
   */
  immediate: (): RetryStrategyConfig => ({
    strategy: 'fixed',
    baseDelay: 100,
    jitter: 0
  }),

  /**
   * Linear backoff for predictable delays
   */
  linear: (baseDelay = 1000): RetryStrategyConfig => ({
    strategy: 'linear',
    baseDelay,
    maxDelay: 30000,
    jitter: 0.1
  }),

  /**
   * Fibonacci backoff for gradual increase
   */
  fibonacci: (baseDelay = 500): RetryStrategyConfig => ({
    strategy: 'fibonacci',
    baseDelay,
    maxDelay: 60000,
    jitter: 0.15
  })
};