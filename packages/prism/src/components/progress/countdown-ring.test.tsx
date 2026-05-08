import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CountdownRing } from './countdown-ring.js';

describe('CountdownRing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders remaining seconds in the center label', () => {
    const deadline = new Date(Date.now() + 30_000);
    render(<CountdownRing deadline={deadline} totalMs={60_000} />);
    expect(screen.getByText('30s')).toBeInTheDocument();
  });

  it('counts down on the configured tick interval', () => {
    const deadline = new Date(Date.now() + 5_000);
    render(<CountdownRing deadline={deadline} totalMs={10_000} tickIntervalMs={250} />);
    expect(screen.getByText('5s')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByText('3s')).toBeInTheDocument();
  });

  it('flips to expired label and fires onExpire exactly once', () => {
    const onExpire = vi.fn();
    const deadline = new Date(Date.now() + 1_000);
    render(
      <CountdownRing
        deadline={deadline}
        totalMs={5_000}
        tickIntervalMs={250}
        onExpire={onExpire}
        expiredLabel="Done"
      />,
    );
    expect(onExpire).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1_500);
    });

    expect(screen.getByText('Done')).toBeInTheDocument();
    // Subsequent ticks must not re-trigger the callback.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('renders nothing-driven indeterminate when deadline is null', () => {
    const { container } = render(<CountdownRing deadline={null} />);
    // Indeterminate: no center label rendered, just the spinner svg.
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('uses formatLabel override for custom rendering', () => {
    const deadline = new Date(Date.now() + 10_000);
    render(
      <CountdownRing
        deadline={deadline}
        totalMs={10_000}
        formatLabel={(ms, expired) => (expired ? 'EXP' : `${Math.ceil(ms / 1000)} sec`)}
      />,
    );
    expect(screen.getByText('10 sec')).toBeInTheDocument();
  });
});
