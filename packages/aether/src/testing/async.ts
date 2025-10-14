/**
 * Async Utilities
 */
import type { WaitForOptions } from './types.js';

export async function waitFor<T>(
  callback: () => T | Promise<T>,
  options: WaitForOptions = {}
): Promise<T> {
  const { timeout = 1000, interval = 50 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const result = await callback();

      // If result is truthy (or 0, empty string, etc that might be valid),
      // consider it a success. Only retry if explicitly falsy (false, null, undefined)
      if (result !== false && result !== null && result !== undefined) {
        return result;
      }

      // Result was explicitly falsy, treat as failure and retry
      await new Promise(resolve => setTimeout(resolve, interval));
    } catch (_error) {
      // Callback threw or assertion failed, wait and retry
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }

  // One final attempt
  try {
    const result = await callback();
    return result;
  } catch (_error) {
    throw new Error('Timeout waiting for condition');
  }
}

export async function waitForElementToBeRemoved<T>(
  callback: () => T,
  options?: WaitForOptions
): Promise<void> {
  return waitFor(() => {
    const result = callback();
    if (result) throw new Error('Element still present');
  }, options);
}

export async function act<T>(callback: () => T | Promise<T>): Promise<T> {
  return await callback();
}
