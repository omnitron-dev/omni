// @vitest-environment happy-dom

/**
 * The console's one polling loop, rendered.
 *
 * Rendered, because the defect this file was written for exists only in a
 * renderer: `StrictMode` mounts a component, runs its cleanups, and mounts it
 * again — deliberately, to catch effects that cannot survive it. Nine console
 * pages poll through this hook and every one of them sat on its loading state
 * forever in development, which is the build the console is looked at in
 * most.
 */

import { StrictMode, type ReactNode } from 'react';

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
// Imported here rather than from a package-wide setup file: the other ten
// suites in this package run under the `node` environment and have no DOM to
// match against.
import '@testing-library/jest-dom/vitest';

import { usePolledResource, usePollingEffect } from '../../webapp/src/hooks/use-polled-resource.js';

function Resource({ fetcher, enabled, paused = false, scope = null }: { scope?: string | null; fetcher: () => Promise<string>; enabled?: boolean; paused?: boolean }) {
  const { data, error, loading, refresh } = usePolledResource(fetcher, {
    intervalMs: 50, resourceKey: scope, paused,
    ...(enabled !== undefined && { enabled }),
  });

  return (
    <div>
      <output data-testid="state">{loading ? 'loading' : error ? `error:${error}` : String(data)}</output>
      {/* Rendered apart from `state` on purpose: the point of keeping the
          last good data is that it is still THERE behind the error, which a
          single combined readout cannot show. */}
      <output data-testid="data">{String(data)}</output>
      <button onClick={() => void refresh()}>refresh</button>
    </div>
  );
}

const strict = (node: ReactNode) => <StrictMode>{node}</StrictMode>;

describe('usePolledResource under StrictMode', () => {
  it('reads each permitted scope once while paused and preserves the selected reading', async () => {
    const first = vi.fn(async () => 'one');
    const next = vi.fn(async () => 'two');
    const root = render(strict(<Resource scope="one" paused fetcher={first} />));
    await screen.findByText('one', { selector: '[data-testid="state"]' });
    root.rerender(strict(<Resource scope="two" paused enabled={false} fetcher={next} />));
    expect(next).not.toHaveBeenCalled();
    root.rerender(strict(<Resource scope="two" paused fetcher={next} />));
    await screen.findByText('two', { selector: '[data-testid="state"]' });
    await new Promise((r) => setTimeout(r, 130));
    expect(first).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });
  it('delivers the first result', async () => {
    // The regression: the simulated unmount called `stop()`, which was
    // terminal, so the in-flight result was dropped AND every later tick
    // returned early. The page showed "loading" for as long as it was open.
    const fetcher = vi.fn(async () => 'ok');

    render(strict(<Resource fetcher={fetcher} />));

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('ok'));
  });

  it('keeps polling afterwards', async () => {
    let n = 0;
    const fetcher = vi.fn(async () => `v${++n}`);

    render(strict(<Resource fetcher={fetcher} />));

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('v1'));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('v2'), { timeout: 2000 });
  });

  it('stops for good once the component really unmounts', async () => {
    const fetcher = vi.fn(async () => 'ok');
    const { unmount } = render(strict(<Resource fetcher={fetcher} />));

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('ok'));
    unmount();

    const after = fetcher.mock.calls.length;
    await new Promise((r) => setTimeout(r, 200));
    expect(fetcher.mock.calls.length).toBe(after);
  });
});

describe('usePolledResource', () => {
  it('refreshes a paused resource after an already outstanding reading instead of losing the request', async () => {
    let finishOld!: (value: string) => void, finishNew!: (value: string) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<string>(resolve => { finishOld = resolve; }))
      .mockImplementationOnce(() => new Promise<string>(resolve => { finishNew = resolve; }));
    render(<Resource paused fetcher={fetcher} />);
    await act(async () => { screen.getByRole('button', { name: 'refresh' }).click(); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { finishOld('before mutation'); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => { finishNew('after mutation'); });
    expect(screen.getByTestId('state')).toHaveTextContent('after mutation');
  });

  it('drops a queued refresh when the selected scope changes', async () => {
    let finish!: (value: string) => void;
    const old = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const next = vi.fn(async () => 'new scope');
    const view = render(<Resource scope="old" paused fetcher={old} />);
    await act(async () => { screen.getByRole('button', { name: 'refresh' }).click(); });
    view.rerender(<Resource scope="new" paused fetcher={next} />);
    await screen.findByText('new scope', { selector: '[data-testid="state"]' });
    await act(async () => { finish('old scope'); });
    expect(old).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('state')).toHaveTextContent('new scope');
  });

  it('separates a new target immediately and ignores the previous target when it answers late', async () => {
    let finish!: (value: string) => void;
    const old = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const next = vi.fn(async () => 'second host');
    const view = render(strict(<Resource scope="a" fetcher={old} />));
    await waitFor(() => expect(old).toHaveBeenCalledTimes(1));
    view.rerender(strict(<Resource scope="b" fetcher={next} />));
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('second host'));
    await act(async () => finish('wrong host'));
    expect(screen.getByTestId('data')).toHaveTextContent('second host');
  });

  it('keeps the last good data when a poll fails', async () => {
    // A failed poll must not blank a table someone is reading.
    let attempt = 0;
    const fetcher = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) return 'first';
      throw new Error('daemon unreachable');
    });

    render(<Resource fetcher={fetcher} />);

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('first'));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('error:daemon unreachable'), {
      timeout: 2000,
    });

    // The table an operator is reading must still be there. Several pages
    // used to set `[]` on error, so one failed poll blanked the page.
    expect(screen.getByTestId('data')).toHaveTextContent('first');
  });

  it('fetches nothing while disabled', async () => {
    const fetcher = vi.fn(async () => 'ok');

    render(<Resource fetcher={fetcher} enabled={false} />);

    await new Promise((r) => setTimeout(r, 150));
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByTestId('state')).toHaveTextContent('loading');
  });

  it('fetches on demand through refresh', async () => {
    const fetcher = vi.fn(async () => 'ok');
    render(<Resource fetcher={fetcher} enabled={false} />);

    await act(async () => {
      screen.getByRole('button', { name: 'refresh' }).click();
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('ok'));
  });
});

describe('usePollingEffect', () => {
  function Ticker({ tick, enabled }: { tick: () => void; enabled?: boolean }) {
    usePollingEffect(tick, { intervalMs: 40, ...(enabled !== undefined && { enabled }) });
    return null;
  }

  it('ticks immediately and then on the interval, even under StrictMode', async () => {
    const tick = vi.fn();
    render(strict(<Ticker tick={tick} />));

    expect(tick).toHaveBeenCalled();
    const first = tick.mock.calls.length;
    await waitFor(() => expect(tick.mock.calls.length).toBeGreaterThan(first), { timeout: 2000 });
  });

  it('does not tick while disabled', async () => {
    const tick = vi.fn();
    render(<Ticker tick={tick} enabled={false} />);

    await new Promise((r) => setTimeout(r, 150));
    expect(tick).not.toHaveBeenCalled();
  });

  it('stops when the tab is hidden and catches up when it returns', async () => {
    const tick = vi.fn();
    render(<Ticker tick={tick} />);

    await waitFor(() => expect(tick.mock.calls.length).toBeGreaterThan(1), { timeout: 2000 });

    const hide = (state: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    };

    hide('hidden');
    const parked = tick.mock.calls.length;
    await new Promise((r) => setTimeout(r, 150));
    expect(tick.mock.calls.length).toBe(parked);

    // Coming back fetches at once rather than waiting out the interval: an
    // operator returning to the tab is looking at the data now.
    hide('visible');
    expect(tick.mock.calls.length).toBe(parked + 1);
  });
});
