/**
 * Retry and timeout utilities for async testing
 */

import { TimeoutError } from '../errors.js';

/**
 * Options for retry behavior
 */
export interface RetryOptions {
  /**
   * Maximum number of retry attempts (default: 3)
   */
  retries?: number;

  /**
   * Initial delay between retries in milliseconds (default: 100)
   */
  delay?: number;

  /**
   * Backoff multiplier for exponential backoff (default: 2)
   */
  backoff?: number;

  /**
   * Callback invoked on each retry attempt
   */
  onRetry?: (error: Error, attempt: number) => void;
}

/**
 * Retry an async operation with exponential backoff
 *
 * Useful for testing operations that may temporarily fail,
 * such as network requests or resource availability checks.
 *
 * @param fn - Async function to retry
 * @param options - Retry configuration options
 * @returns Promise resolving to the function's result
 * @throws Last error if all retries are exhausted
 *
 * @example
 * ```ts
 * const result = await retry(
 *   async () => fetchData(),
 *   { retries: 5, delay: 200, backoff: 2 }
 * );
 * ```
 */
export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 3, delay = 100, backoff = 2, onRetry } = options;

  let lastError: Error;

  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (i < retries - 1) {
        if (onRetry) {
          onRetry(lastError, i + 1);
        }

        const waitTime = delay * Math.pow(backoff, i);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  throw lastError!;
}

/**
 * Wait for an async operation with timeout
 *
 * Races the provided promise against a timeout, throwing a TimeoutError
 * if the timeout is reached first.
 *
 * @param promise - Promise to race against timeout
 * @param timeout - Timeout in milliseconds (default: 5000)
 * @param errorMessage - Custom error message for timeout
 * @returns Promise resolving to the original promise's result
 * @throws TimeoutError if timeout is reached
 *
 * @example
 * ```ts
 * const result = await withTimeout(
 *   fetchData(),
 *   3000,
 *   'Data fetch timed out'
 * );
 * ```
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeout = 5000,
  errorMessage = 'Operation timed out'
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError(errorMessage, timeout));
    }, timeout);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}
