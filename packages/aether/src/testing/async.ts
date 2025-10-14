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
      return result;
    } catch (_error) {
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }

  throw new Error('Timeout waiting for condition');
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

export function act<T>(callback: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(callback());
}
