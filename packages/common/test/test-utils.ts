/**
 * Test utilities for cross-runtime compatibility (Node.js and Bun)
 * Vitest-native implementations for packages/common
 */

import { vi } from 'vitest';

export const isBun = typeof (globalThis as any).Bun !== 'undefined';
export const isJest = false;

export const supportsFakeTimers = () => true;

export const setupFakeTimers = () => {
  vi.useFakeTimers();
};

export const teardownFakeTimers = () => {
  vi.useRealTimers();
};

export const advanceTimersByTime = (ms: number) => {
  vi.advanceTimersByTime(ms);
};

export const clearAllTimers = () => {
  vi.clearAllTimers();
};

export const expectAsync = async (fn: () => Promise<any>) => (globalThis as any).expect(fn()).rejects;

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
