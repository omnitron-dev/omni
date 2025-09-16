/**
 * Common test adapter utilities for cross-runtime testing
 */

// Detect runtime environment
export const RUNTIME = (() => {
  if (typeof (globalThis as any).Bun !== 'undefined') return 'bun';
  if (typeof (globalThis as any).Deno !== 'undefined') return 'deno';
  return 'node';
})();

// Timer utilities that work across runtimes
export const timerUtils = {
  useFakeTimers() {
    // Only Node.js with Jest supports fake timers
    if (RUNTIME === 'node' && typeof (global as any).jest !== 'undefined') {
      (global as any).jest.useFakeTimers();
    }
  },

  useRealTimers() {
    if (RUNTIME === 'node' && typeof (global as any).jest !== 'undefined') {
      (global as any).jest.useRealTimers();
    }
  },

  advanceTimersByTime(ms: number) {
    if (RUNTIME === 'node' && typeof (global as any).jest !== 'undefined') {
      (global as any).jest.advanceTimersByTime(ms);
    } else {
      // For Bun and Deno, we can't advance timers
      // Tests that rely on this should be skipped or use real timers
    }
  },

  runAllTimers() {
    if (RUNTIME === 'node' && typeof (global as any).jest !== 'undefined') {
      (global as any).jest.runAllTimers();
    }
  },

  clearAllTimers() {
    if (RUNTIME === 'node' && typeof (global as any).jest !== 'undefined') {
      (global as any).jest.clearAllTimers();
    }
  },

  canUseFakeTimers(): boolean {
    return RUNTIME === 'node';
  }
};

// Helper to skip tests that require features not available in current runtime
export function skipIfNoFakeTimers() {
  if (!timerUtils.canUseFakeTimers()) {
    return true; // Skip the test
  }
  return false;
}

// Normalize global object checks for different runtimes
export function normalizeGlobalChecks(value: any): boolean {
  // In Bun, globalThis is considered a plain object, which differs from Node/Deno
  if (RUNTIME === 'bun' && value === globalThis) {
    return false;
  }
  return true;
}

// Export runtime detection utilities
export const isBun = RUNTIME === 'bun';
export const isDeno = RUNTIME === 'deno';
export const isNode = RUNTIME === 'node';
export const isJest = isNode && typeof (globalThis as any).jest !== 'undefined' && typeof (globalThis as any).jest.useFakeTimers === 'function';

// Check if fake timers are supported
export const supportsFakeTimers = () => {
  return isJest;
};

// Timer utilities
export const setupFakeTimers = () => {
  timerUtils.useFakeTimers();
};

export const teardownFakeTimers = () => {
  timerUtils.useRealTimers();
};

export const advanceTimersByTime = (ms: number) => {
  timerUtils.advanceTimersByTime(ms);
};

export const clearAllTimers = () => {
  timerUtils.clearAllTimers();
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
            (globalThis as any).expect(error).toEqual(expectedError);
          } else {
            (globalThis as any).expect(error).toBeDefined();
          }
        },
      };
    }
  } else {
    // Jest/Node.js
    return (globalThis as any).expect(fn()).rejects;
  }
};

// Sleep utility for real timer tests
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));