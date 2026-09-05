/**
 * useCountdown — how many times a countdown finishes.
 *
 * Once, is the answer. It used to be four times, or eight under
 * `StrictMode`, because the tick did its work inside a `setSeconds` updater:
 * an updater must be pure, React is entitled to run it more than once, and
 * under `StrictMode` it does so deliberately to surface exactly this. The
 * hook's own documentation calls `submitQuiz()` from `onComplete`.
 */

import { StrictMode, type ReactNode } from 'react';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import { useCountdown, type UseCountdownOptions } from './use-countdown.js';

function Probe(options: UseCountdownOptions) {
  const { formatted, seconds, isRunning, isFinished, start, pause, reset, setDuration } = useCountdown(options);
  return (
    <div>
      <output data-testid="formatted">{formatted}</output>
      <output data-testid="seconds">{seconds}</output>
      <output data-testid="flags">{`${isRunning ? 'running' : 'stopped'}/${isFinished ? 'finished' : 'pending'}`}</output>
      <button onClick={start}>start</button>
      <button onClick={pause}>pause</button>
      <button onClick={reset}>reset</button>
      <button onClick={() => setDuration(90)}>set90</button>
    </div>
  );
}

const strict = (node: ReactNode) => <StrictMode>{node}</StrictMode>;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Advance the fake clock inside act, so React flushes what it triggers. */
async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe('useCountdown completion', () => {
  it('completes exactly once, and keeps ticking no further', async () => {
    const onComplete = vi.fn();
    const onTick = vi.fn();

    render(<Probe duration={2} autoStart interval={10} onComplete={onComplete} onTick={onTick} />);

    await tick(200);

    expect(onComplete).toHaveBeenCalledTimes(1);
    // Every tick is a distinct second on the way down, and none is negative:
    // the old version reported `[1, 0, -1, -1, -1]`, so a caller watching for
    // `remaining === 60` could be told about a time that never existed.
    expect(onTick.mock.calls.flat()).toEqual([1, 0]);
  });

  it('completes exactly once under StrictMode too', async () => {
    // `StrictMode` double-invokes updaters on purpose. With the work moved
    // out of the updater the count must not change at all.
    const onComplete = vi.fn();
    const onTick = vi.fn();

    render(strict(<Probe duration={2} autoStart interval={10} onComplete={onComplete} onTick={onTick} />));

    await tick(200);

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onTick.mock.calls.flat()).toEqual([1, 0]);
  });

  it('stops itself at zero', async () => {
    render(<Probe duration={1} autoStart interval={10} />);

    await tick(200);

    expect(screen.getByTestId('seconds')).toHaveTextContent('0');
    expect(screen.getByTestId('flags')).toHaveTextContent('stopped/finished');
  });
});

describe('useCountdown controls', () => {
  it('does not run until started', async () => {
    const onTick = vi.fn();
    render(<Probe duration={5} interval={10} onTick={onTick} />);

    await tick(100);

    expect(onTick).not.toHaveBeenCalled();
    expect(screen.getByTestId('seconds')).toHaveTextContent('5');
  });

  it('pauses where it stands and resumes from there', async () => {
    render(<Probe duration={10} autoStart interval={10} />);

    await tick(30);
    const atPause = screen.getByTestId('seconds').textContent;
    await act(async () => screen.getByRole('button', { name: 'pause' }).click());

    await tick(100);
    expect(screen.getByTestId('seconds')).toHaveTextContent(atPause!);

    await act(async () => screen.getByRole('button', { name: 'start' }).click());
    await tick(20);
    expect(Number(screen.getByTestId('seconds').textContent)).toBeLessThan(Number(atPause));
  });

  it('can complete again after a reset', async () => {
    // The completion latch has to be released, or a countdown that an
    // operator restarts never reports finishing a second time — the "Resend
    // OTP" case from this hook's own documentation.
    const onComplete = vi.fn();
    render(<Probe duration={1} autoStart interval={10} onComplete={onComplete} />);

    await tick(100);
    expect(onComplete).toHaveBeenCalledTimes(1);

    await act(async () => screen.getByRole('button', { name: 'reset' }).click());
    await act(async () => screen.getByRole('button', { name: 'start' }).click());
    await tick(100);

    expect(onComplete).toHaveBeenCalledTimes(2);
  });

  it('counts down from a duration set later', async () => {
    render(<Probe duration={5} interval={10} />);

    await act(async () => screen.getByRole('button', { name: 'set90' }).click());
    expect(screen.getByTestId('formatted')).toHaveTextContent('01:30');

    await act(async () => screen.getByRole('button', { name: 'start' }).click());
    await tick(20);

    expect(screen.getByTestId('seconds')).toHaveTextContent('88');
  });

  it('refuses to start once finished, until reset', async () => {
    render(<Probe duration={1} autoStart interval={10} />);
    await tick(100);

    await act(async () => screen.getByRole('button', { name: 'start' }).click());
    await tick(50);

    expect(screen.getByTestId('flags')).toHaveTextContent('stopped/finished');
  });
});

describe('useCountdown formatting', () => {
  it('writes MM:SS below an hour and HH:MM:SS above it', () => {
    const { rerender } = render(<Probe duration={59} interval={10} />);
    expect(screen.getByTestId('formatted')).toHaveTextContent('00:59');

    rerender(<Probe duration={3661} interval={10} />);
    // Duration is read once, so the remount below is what applies it — the
    // hook deliberately ignores a changed `duration` until `reset`.
    expect(screen.getByTestId('formatted')).toHaveTextContent('00:59');
  });

  it('pads both fields', () => {
    render(<Probe duration={3661} interval={10} />);
    expect(screen.getByTestId('formatted')).toHaveTextContent('01:01:01');
  });
});
