/**
 * useCountdownSeconds — the third countdown in this package.
 *
 * Nothing visible was wrong with it, which is why it is worth a note: the
 * stop lived inside a `setValue` updater, the same shape that made
 * `useCountdown` fire `onComplete` four times. Here the side effect was
 * `setIsCounting(false)`, and stopping twice is stopping once — so the fault
 * was invisible until someone added a callback beside it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { StrictMode } from 'react';

import { useCountdownSeconds } from './use-countdown-seconds.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

describe('useCountdownSeconds', () => {
  it('holds still until started', async () => {
    const { result } = renderHook(() => useCountdownSeconds(5));

    await tick(3000);

    expect(result.current.value).toBe(5);
    expect(result.current.isCounting).toBe(false);
  });

  it('counts down once a second', async () => {
    const { result } = renderHook(() => useCountdownSeconds(5));

    await act(async () => result.current.start());
    await tick(2000);

    expect(result.current.value).toBe(3);
    expect(result.current.isCounting).toBe(true);
  });

  it('stops itself at zero rather than going negative', async () => {
    const { result } = renderHook(() => useCountdownSeconds(2));

    await act(async () => result.current.start());
    await tick(10_000);

    expect(result.current.value).toBe(0);
    expect(result.current.isCounting).toBe(false);
  });

  it('stops at zero under StrictMode too', async () => {
    // `StrictMode` double-invokes updaters deliberately. With the stop moved
    // out of the updater, the outcome must not depend on how many times an
    // updater ran.
    const { result } = renderHook(() => useCountdownSeconds(2), { wrapper: StrictMode });

    await act(async () => result.current.start());
    await tick(10_000);

    expect(result.current.value).toBe(0);
    expect(result.current.isCounting).toBe(false);
  });

  it('returns to the initial value on reset, stopped', async () => {
    const { result } = renderHook(() => useCountdownSeconds(4));

    await act(async () => result.current.start());
    await tick(2000);
    await act(async () => result.current.reset());

    expect(result.current.value).toBe(4);
    expect(result.current.isCounting).toBe(false);

    await tick(3000);
    expect(result.current.value).toBe(4);
  });

  it('can be driven directly', async () => {
    const { result } = renderHook(() => useCountdownSeconds(30));

    await act(async () => result.current.setValue(9));

    expect(result.current.value).toBe(9);
  });
});
