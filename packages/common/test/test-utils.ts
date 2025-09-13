/**
 * Test utilities for cross-runtime compatibility (Node.js and Bun)
 */

// Detect runtime environment
export const isBun = typeof Bun !== 'undefined';
export const isJest = !isBun && typeof jest !== 'undefined' && typeof jest.useFakeTimers === 'function';

// Timer utilities
export const setupFakeTimers = () => {
  if (isJest) {
    jest.useFakeTimers();
  }
  // Bun doesn't support fake timers in the same way
};

export const teardownFakeTimers = () => {
  if (isJest) {
    jest.useRealTimers();
  }
  // Bun doesn't support fake timers in the same way
};

export const advanceTimersByTime = (ms: number) => {
  if (isJest) {
    jest.advanceTimersByTime(ms);
  }
  // In Bun, we'll need to use real timers
  // Tests should check isBun and use sleep() instead
};

export const clearAllTimers = () => {
  if (isJest) {
    jest.clearAllTimers();
  }
  // Bun doesn't support this in the same way
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
        }
      };
    }
  } else {
    // Jest/Node.js
    return expect(fn()).rejects;
  }
};

// Sleep utility for real timer tests
export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));