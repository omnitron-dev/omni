/**
 * Node.js adapter for Jest tests
 * This is mostly a passthrough since Jest natively runs in Node.js
 */

import { timerUtils } from './test-adapter.js';

// Export timer utilities for consistency
export const fakeTimers = {
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

// Re-export Jest globals for consistency with other adapters
export const describe = (global as any).describe;
export const it = (global as any).it;
export const test = (global as any).test;
export const expect = (global as any).expect;
export const beforeEach = (global as any).beforeEach;
export const afterEach = (global as any).afterEach;
export const beforeAll = (global as any).beforeAll;
export const afterAll = (global as any).afterAll;

// Re-export Jest object
export const jest = (global as any).jest;