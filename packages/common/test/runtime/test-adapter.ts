/**
 * Common test adapter utilities for cross-runtime testing
 */

// Detect runtime environment
export const RUNTIME = (() => {
  if (typeof Bun !== 'undefined') return 'bun';
  if (typeof Deno !== 'undefined') return 'deno';
  return 'node';
})();

// Timer utilities that work across runtimes
export const timerUtils = {
  useFakeTimers() {
    // Only Node.js with Jest supports fake timers
    if (RUNTIME === 'node' && typeof jest !== 'undefined') {
      (global as any).jest.useFakeTimers();
    }
  },

  useRealTimers() {
    if (RUNTIME === 'node' && typeof jest !== 'undefined') {
      (global as any).jest.useRealTimers();
    }
  },

  advanceTimersByTime(ms: number) {
    if (RUNTIME === 'node' && typeof jest !== 'undefined') {
      (global as any).jest.advanceTimersByTime(ms);
    } else {
      // For Bun and Deno, we can't advance timers
      // Tests that rely on this should be skipped or use real timers
    }
  },

  runAllTimers() {
    if (RUNTIME === 'node' && typeof jest !== 'undefined') {
      (global as any).jest.runAllTimers();
    }
  },

  clearAllTimers() {
    if (RUNTIME === 'node' && typeof jest !== 'undefined') {
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