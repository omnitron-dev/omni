/**
 * Tests for test-adapter runtime detection and utilities
 */

import {
  isBun,
  sleep,
  isDeno,
  isNode,
  RUNTIME,
  timerUtils,
  supportsFakeTimers,
  skipIfNoFakeTimers,
  normalizeGlobalChecks
} from './test-adapter';

describe('test-adapter runtime detection', () => {
  it('should detect the current runtime', () => {
    const validRuntimes = ['bun', 'deno', 'node'];
    expect(validRuntimes).toContain(RUNTIME);
  });

  it('should have exactly one runtime flag set to true', () => {
    const flags = [isBun, isDeno, isNode];
    const trueFlags = flags.filter(flag => flag === true);
    expect(trueFlags.length).toBe(1);
  });

  it('should correctly detect Node.js runtime', () => {
    if (typeof process !== 'undefined' && process.versions?.node) {
      expect(isNode).toBe(true);
    }
  });

  it('should correctly detect Bun runtime', () => {
    if (typeof Bun !== 'undefined') {
      expect(isBun).toBe(true);
    }
  });

  it('should correctly detect Deno runtime', () => {
    if (typeof Deno !== 'undefined') {
      expect(isDeno).toBe(true);
    }
  });
});

describe('timer utilities', () => {
  it('should report fake timers support correctly', () => {
    const hasFakeTimers = supportsFakeTimers();
    if (isNode && typeof (global as any).jest !== 'undefined') {
      expect(hasFakeTimers).toBe(true);
    } else {
      expect(hasFakeTimers).toBe(false);
    }
  });

  it('should provide timer utility methods', () => {
    expect(typeof timerUtils.useFakeTimers).toBe('function');
    expect(typeof timerUtils.useRealTimers).toBe('function');
    expect(typeof timerUtils.advanceTimersByTime).toBe('function');
    expect(typeof timerUtils.runAllTimers).toBe('function');
    expect(typeof timerUtils.clearAllTimers).toBe('function');
    expect(typeof timerUtils.canUseFakeTimers).toBe('function');
  });

  it('should correctly report skipIfNoFakeTimers', () => {
    const shouldSkip = skipIfNoFakeTimers();
    const hasFakeTimers = timerUtils.canUseFakeTimers();

    // skipIfNoFakeTimers returns true if no fake timers, false if fake timers available
    if (hasFakeTimers) {
      expect(shouldSkip).toBe(false); // Don't skip if we have fake timers
    } else {
      expect(shouldSkip).toBe(true);  // Skip if no fake timers
    }
  });
});

describe('utility functions', () => {
  it('should provide sleep utility', async () => {
    const start = Date.now();
    await sleep(10);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(9); // Allow for small timing variations
  });

  it('should handle normalizeGlobalChecks correctly', () => {
    const result = normalizeGlobalChecks({});
    expect(result).toBe(true);

    if (isBun) {
      expect(normalizeGlobalChecks(globalThis)).toBe(false);
    } else {
      expect(normalizeGlobalChecks(globalThis)).toBe(true);
    }
  });
});