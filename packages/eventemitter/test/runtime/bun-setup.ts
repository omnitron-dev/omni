/**
 * Bun setup file - preloaded before all tests
 * Sets up Jest compatibility for Bun runtime
 */

import { describe, test, expect, mock, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";

// Setup global test functions for Jest compatibility
(global as any).describe = describe;
(global as any).test = test;
(global as any).it = test;
(global as any).expect = expect;
(global as any).beforeEach = beforeEach;
(global as any).afterEach = afterEach;
(global as any).beforeAll = beforeAll;
(global as any).afterAll = afterAll;

// Timer utilities that work with Bun
const timerUtils = {
  useFakeTimers() {
    // Bun doesn't support fake timers
    return this;
  },
  useRealTimers() {
    return this;
  },
  advanceTimersByTime(ms: number) {
    // Can't advance timers in Bun
    // Tests that rely on this should be skipped or use real timers
  },
  runAllTimers() {
    // Can't run all timers in Bun
  },
  clearAllTimers() {
    // Can't clear all timers in Bun
  }
};

// Setup Jest mock functions
const jestMock = {
  fn: mock,
  useFakeTimers: () => timerUtils.useFakeTimers(),
  useRealTimers: () => timerUtils.useRealTimers(),
  advanceTimersByTime: (ms: number) => timerUtils.advanceTimersByTime(ms),
  runAllTimers: () => timerUtils.runAllTimers(),
  clearAllTimers: () => timerUtils.clearAllTimers(),
  now: () => Date.now()
};

(global as any).jest = jestMock;

// Add missing expect matchers for Bun
const originalExpect = expect as any;
if (!originalExpect.toBeInstanceOf) {
  originalExpect.extend({
    toBeInstanceOf(received: any, constructor: any) {
      const pass = received instanceof constructor;
      return {
        pass,
        message: () => pass
          ? `expected ${received} not to be instance of ${constructor.name}`
          : `expected ${received} to be instance of ${constructor.name}`
      };
    }
  });
}