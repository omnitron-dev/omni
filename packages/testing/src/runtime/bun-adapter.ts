/**
 * Bun adapter for running Jest tests
 * Provides compatibility layer for Jest API
 */

// @ts-ignore - Bun specific imports
import { mock, test as bunTest, expect as bunExpect, describe as bunDescribe, afterAll as bunAfterAll, afterEach as bunAfterEach, beforeAll as bunBeforeAll, beforeEach as bunBeforeEach } from "bun:test";

import { timerUtils } from './test-adapter.js';

// Make Jest-compatible APIs globally available
(global as any).describe = bunDescribe;
(global as any).test = bunTest;
(global as any).it = bunTest;
(global as any).expect = bunExpect;
(global as any).beforeEach = bunBeforeEach;
(global as any).afterEach = bunAfterEach;
(global as any).beforeAll = bunBeforeAll;
(global as any).afterAll = bunAfterAll;

// Use timer utilities from shared adapter
const fakeTimers = {
  useFakeTimers: () => {
    timerUtils.useFakeTimers();
    return fakeTimers;
  },
  useRealTimers: () => {
    timerUtils.useRealTimers();
    return fakeTimers;
  },
  advanceTimersByTime: (ms: number) => {
    timerUtils.advanceTimersByTime(ms);
  },
  runAllTimers: () => {
    timerUtils.runAllTimers();
  },
  clearAllTimers: () => {
    timerUtils.clearAllTimers();
  }
};

// Mock Jest APIs
(global as any).jest = {
  fn: mock,
  mock,
  useFakeTimers: fakeTimers.useFakeTimers,
  useRealTimers: fakeTimers.useRealTimers,
  advanceTimersByTime: fakeTimers.advanceTimersByTime,
  runAllTimers: fakeTimers.runAllTimers,
  clearAllTimers: fakeTimers.clearAllTimers
};

// Add missing expect matchers if needed
const originalExpect = bunExpect as any;
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

if (!originalExpect.toStrictEqual) {
  // toStrictEqual is an alias for toEqual in Bun
  originalExpect.toStrictEqual = originalExpect.toEqual;
}

if (!originalExpect.toThrowError) {
  originalExpect.extend({
    toThrowError(received: any, expected?: any) {
      let error: any;
      let pass = false;

      try {
        if (typeof received === 'function') {
          received();
        }
      } catch (e) {
        error = e;
        pass = true;

        if (expected !== undefined) {
          if (typeof expected === 'string') {
            pass = error.message.includes(expected);
          } else if (expected instanceof RegExp) {
            pass = expected.test(error.message);
          } else if (typeof expected === 'function') {
            pass = error instanceof expected;
          }
        }
      }

      return {
        pass,
        message: () => pass
          ? `expected function not to throw${expected ? ` ${expected}` : ''}`
          : `expected function to throw${expected ? ` ${expected}` : ''}`
      };
    }
  });
}