/**
 * useCountdownDate — counting down to an instant.
 *
 * The interesting property is not the arithmetic but the dependency. A
 * `Date` is compared by identity, and the documented call builds one inline:
 * `useCountdownDate(new Date('2024-12-31T23:59:59'))`. That made every
 * render produce a new dependency, re-arm the effect, set state, and render
 * again — measured at 5003 renders in 200 ms before the probe capped it. The
 * numbers on screen were correct the whole time, which is how something like
 * this ships as "the page feels sluggish".
 */

import { useState } from 'react';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import { useCountdownDate } from './use-countdown-date.js';

let renders = 0;

function InlineDate({ iso }: { iso: string }) {
  renders += 1;
  // Deliberately inline — the shape the hook's own documentation shows.
  const { days, hours, minutes, seconds } = useCountdownDate(new Date(iso));
  return <output data-testid="out">{`${days}:${hours}:${minutes}:${seconds}`}</output>;
}

beforeEach(() => {
  renders = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('useCountdownDate', () => {
  it('settles instead of re-rendering forever with an inline Date', async () => {
    render(<InlineDate iso="2026-01-02T01:02:03Z" />);

    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    // Two renders: the initial one and the one caused by the first update.
    // Any number that grows with time means the dependency is still an
    // identity comparison.
    expect(renders).toBeLessThanOrEqual(4);
  });

  it('does not re-render again when nothing has changed', async () => {
    render(<InlineDate iso="2026-01-02T01:02:03Z" />);
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    const settled = renders;

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // Under a second: no tick has fired, so nothing should have changed.
    expect(renders).toBe(settled);
  });

  it('does not re-arm its interval when the parent re-renders', async () => {
    // The loop above is stopped by the bail-out alone, so it cannot tell
    // whether the DEPENDENCY was fixed too. This can: with a `Date` object
    // as the dependency, every render of the consumer builds a new one, the
    // effect tears down and re-arms, and `handleUpdate` runs again outside
    // the schedule. A primitive instant makes the same call the same
    // dependency.
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    function Parent() {
      const [n, setN] = useState(0);
      return (
        <div>
          <InlineDate iso="2026-01-02T01:02:03Z" />
          <button onClick={() => setN(n + 1)}>bump {n}</button>
        </div>
      );
    }

    render(<Parent />);
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    const armed = setIntervalSpy.mock.calls.length;

    for (let i = 0; i < 3; i++) {
      await act(async () => screen.getByRole('button', { name: /bump/ }).click());
    }

    expect(setIntervalSpy.mock.calls.length).toBe(armed);
    setIntervalSpy.mockRestore();
  });

  it('reports the remaining time', async () => {
    render(<InlineDate iso="2026-01-02T01:02:03Z" />);
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(screen.getByTestId('out')).toHaveTextContent('01:01:02:03');
  });

  it('advances once a second', async () => {
    render(<InlineDate iso="2026-01-02T01:02:03Z" />);
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByTestId('out')).toHaveTextContent('01:01:02:02');
  });

  it('rests at zero once the instant has passed', async () => {
    render(<InlineDate iso="2025-12-31T23:59:59Z" />);
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(screen.getByTestId('out')).toHaveTextContent('00:00:00:00');

    // And keeps resting there. The first tick after settling still costs one
    // render — React re-renders once before honouring a bail-out — so the
    // count is taken after it, and every tick from then on must be free.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    const settled = renders;

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(renders).toBe(settled);
    expect(screen.getByTestId('out')).toHaveTextContent('00:00:00:00');
  });
});
