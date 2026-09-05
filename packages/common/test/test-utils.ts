/**
 * Test utilities for cross-runtime compatibility (Node.js and Bun)
 * Vitest-native implementations for packages/common
 */

/**
 * `vi` from the global, not from an import.
 *
 * These helpers run under three runtimes. `import { vi } from 'vitest'`
 * resolves to REAL vitest under Bun — the package is installed here — so
 * `vi.clearAllTimers()` reached vitest's implementation with no fake timers
 * installed and threw "Fake timers are not active", while the adapter that was
 * supposed to answer sat unused in the global. Every runtime's adapter sets
 * `globalThis.vi`, and vitest does the same under `globals: true`.
 */
const vi = () => {
  const g = (globalThis as { vi?: any }).vi;
  if (!g) throw new Error('no `vi` on globalThis — the runtime adapter did not load');
  return g;
};

export const isBun = typeof (globalThis as any).Bun !== 'undefined';
export const isDeno = typeof (globalThis as any).Deno !== 'undefined';
export const isJest = false;

/**
 * This said `true` unconditionally, and it is not true under Bun: the shared
 * `timerUtils` guards every timer helper with `RUNTIME === 'node'`, so
 * `advanceTimersByTime(1000)` advanced nothing there and the assertion failed
 * as though TimedMap had not expired its entry. The real-time branch those
 * specs already carry is the correct one under Bun.
 *
 * Deno is NOT excluded, and the first version of this fix wrongly excluded it:
 * the Deno adapter implements fake timers itself with std's `FakeTime`, so the
 * fake-timer branch is both available and preferable — sending Deno down the
 * real-time path instead left pending timers that aborted the run.
 */
export const supportsFakeTimers = () => !isBun;

export const setupFakeTimers = () => {
  vi().useFakeTimers();
};

export const teardownFakeTimers = () => {
  vi().useRealTimers();
};

export const advanceTimersByTime = (ms: number) => {
  vi().advanceTimersByTime(ms);
};

export const clearAllTimers = () => {
  vi().clearAllTimers();
};

export const expectAsync = async (fn: () => Promise<any>) => (globalThis as any).expect(fn()).rejects;

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
