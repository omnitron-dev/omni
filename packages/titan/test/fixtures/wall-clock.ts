import { onTestFinished, vi } from 'vitest';

/** Advance the wall clock used by lifecycle metrics while native timers keep running. */
export function useWallClock() {
  let now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  onTestFinished(() => {
    clock.mockRestore();
  });
  return {
    advance(milliseconds: number) {
      now += milliseconds;
    },
  };
}
