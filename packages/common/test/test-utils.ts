/**
 * Test utilities for cross-runtime compatibility (Node.js and Bun)
 */

// Detect runtime environment
export const isBun = typeof Bun !== 'undefined';
export const isJest = !isBun && typeof jest !== 'undefined' && typeof jest.useFakeTimers === 'function';

// Check if fake timers are supported
export const supportsFakeTimers = () => {
  return isJest;
};

// Timer utilities
export const setupFakeTimers = () => {
  if (isJest) {
    jest.useFakeTimers();
  }
  // Bun doesn't support fake timers - tests should be skipped or use real timers
};

export const teardownFakeTimers = () => {
  if (isJest) {
    jest.useRealTimers();
  }
  // Bun doesn't support fake timers
};

export const advanceTimersByTime = (ms: number) => {
  if (isJest) {
    jest.advanceTimersByTime(ms);
  }
  // In Bun, we can't advance fake timers
};

export const clearAllTimers = () => {
  if (isJest) {
    jest.clearAllTimers();
  }
  // Bun doesn't support this
};

// Promise utilities for cross-runtime compatibility
export const expectAsync = async (fn: () => Promise<any>) => {
  if (isBun) {
    // Bun has different handling for async expectations
    try {
      await fn();
      throw new Error('Expected promise to reject but it resolved');
    } catch (error) {
      return {
        toThrow: (expectedError?: any) => {
          if (expectedError) {
            expect(error).toEqual(expectedError);
          } else {
            expect(error).toBeDefined();
          }
        },
      };
    }
  } else {
    // Jest/Node.js
    return expect(fn()).rejects;
  }
};

// Sleep utility for real timer tests
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
