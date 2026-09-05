/**
 * useInfiniteScroll — the sentinel, and how often it is rebuilt.
 *
 * `sentinelRef` is a ref callback, and React invokes a ref callback with
 * `null` and then with the element every time its identity changes. So the
 * question that matters is not what the observer does but how often it is
 * replaced: a fresh `IntersectionObserver` whose target is already
 * intersecting fires immediately, and a sentinel at the bottom of a short
 * list always is.
 */

import { useState } from 'react';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { useInfiniteScroll } from './use-infinite-scroll.js';

let observersCreated = 0;
let live: FakeObserver[] = [];

class FakeObserver {
  private readonly cb: (entries: Array<{ isIntersecting: boolean }>) => void;
  /** A disconnected observer never fires again — the browser drops it. */
  connected = true;

  constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
    observersCreated += 1;
    this.cb = cb;
    live.push(this);
  }

  /** The real one fires straight away when the target already intersects. */
  observe() {
    if (this.connected) this.cb([{ isIntersecting: true }]);
  }

  unobserve() {}

  disconnect() {
    this.connected = false;
  }
}

const originalIO = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;

beforeEach(() => {
  observersCreated = 0;
  live = [];
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeObserver;
});
afterEach(() => {
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = originalIO;
});

/** A host that writes its callbacks inline, as every real caller does. */
function Host({ onPage }: { onPage?: () => void }) {
  const { sentinelRef, items, isLoading } = useInfiniteScroll(
    async ({ cursor }) => ({
      items: [`item-${cursor ?? 0}`],
      pageInfo: { hasNextPage: false },
    }),
    {
      onSuccess: () => onPage?.(),
      onError: () => {},
    }
  );

  return (
    <div>
      <output data-testid="count">{items.length}</output>
      <output data-testid="loading">{isLoading ? 'loading' : 'idle'}</output>
      <div ref={sentinelRef} data-testid="sentinel" />
    </div>
  );
}

describe('useInfiniteScroll', () => {
  it('does not rebuild its observer when the parent re-renders', async () => {
    // The isolating measurement. `sentinelRef` is a ref callback, so React
    // re-invokes it — `null`, then the element — every time its identity
    // changes, and each invocation disconnects the observer and builds a new
    // one. A new observer whose target already intersects fires at once.
    //
    // Every input the caller writes inline made that happen once per render:
    // `fetchFn` as an arrow, `onSuccess` as an arrow, and `observerOptions`
    // not written at all, so its `{ threshold: 0.1 }` default was a fresh
    // object each time. Probed against the original with an observer that
    // fires on `observe`, React aborted the tree with "Maximum update depth
    // exceeded" after 53 observers.
    function Parent() {
      const [n, setN] = useState(0);
      return (
        <div>
          <Host />
          <button onClick={() => setN(n + 1)}>bump {n}</button>
        </div>
      );
    }

    render(<Parent />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const settled = observersCreated;

    for (let i = 0; i < 5; i++) {
      await act(async () => screen.getByRole('button', { name: /bump/ }).click());
    }

    expect(observersCreated).toBe(settled);
  });

  it('loads the first page and settles', async () => {
    const onPage = vi.fn();
    render(<Host onPage={onPage} />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(screen.getByTestId('count')).toHaveTextContent('1');
    expect(screen.getByTestId('loading')).toHaveTextContent('idle');

    const settled = observersCreated;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(observersCreated).toBe(settled);
  });

  it('does not fetch again once there is no next page', async () => {
    const onPage = vi.fn();
    render(<Host onPage={onPage} />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const after = onPage.mock.calls.length;

    // Poke only the observers still attached — a disconnected one is gone
    // as far as the browser is concerned, and firing it would be testing a
    // condition that cannot occur.
    await act(async () => {
      for (const observer of live.filter((o) => o.connected)) observer.observe();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(onPage).toHaveBeenCalledTimes(after);
  });
});
