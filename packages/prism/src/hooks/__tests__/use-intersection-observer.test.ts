/**
 * useIntersectionObserver Hook Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, act } from '@testing-library/react';
import { createElement } from 'react';
import { useIntersectionObserver } from '../use-intersection-observer.js';

describe('useIntersectionObserver', () => {
  let observerCallback: (entries: IntersectionObserverEntry[]) => void;
  let mockObserve: ReturnType<typeof vi.fn>;
  let mockDisconnect: ReturnType<typeof vi.fn>;
  // Every options object the hook actually handed to `new IntersectionObserver`.
  // The mock used to drop this argument, which is why "should accept custom
  // options" could pass while the options never reached the observer.
  let constructedWith: (IntersectionObserverInit | undefined)[];

  beforeEach(() => {
    mockObserve = vi.fn();
    mockDisconnect = vi.fn();
    constructedWith = [];

    // Must use a class for the mock to work with `new`
    class MockIntersectionObserver {
      constructor(callback: (entries: IntersectionObserverEntry[]) => void, init?: IntersectionObserverInit) {
        observerCallback = callback;
        constructedWith.push(init);
      }
      observe = mockObserve;
      disconnect = mockDisconnect;
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
      root = null;
      rootMargin = '';
      thresholds = [0];
    }

    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return initial state', () => {
    const { result } = renderHook(() => useIntersectionObserver());

    expect(result.current.entry).toBeNull();
    expect(result.current.isIntersecting).toBe(false);
    expect(typeof result.current.ref).toBe('function');
    expect(typeof result.current.disconnect).toBe('function');
  });

  it('should observe element when ref is attached', () => {
    const { result } = renderHook(() => useIntersectionObserver());
    const element = document.createElement('div');

    act(() => {
      result.current.ref(element);
    });

    expect(mockObserve).toHaveBeenCalledWith(element);
  });

  it('should update isIntersecting when element intersects', () => {
    const { result } = renderHook(() => useIntersectionObserver());
    const element = document.createElement('div');

    act(() => {
      result.current.ref(element);
    });

    // Simulate intersection
    const mockEntry: IntersectionObserverEntry = {
      isIntersecting: true,
      intersectionRatio: 1,
      boundingClientRect: element.getBoundingClientRect(),
      intersectionRect: element.getBoundingClientRect(),
      rootBounds: null,
      target: element,
      time: Date.now(),
    };

    act(() => {
      observerCallback([mockEntry]);
    });

    expect(result.current.isIntersecting).toBe(true);
    expect(result.current.entry).toEqual(mockEntry);
  });

  it('should disconnect when triggerOnce is true and element intersects', () => {
    const { result } = renderHook(() => useIntersectionObserver({ triggerOnce: true }));
    const element = document.createElement('div');

    act(() => {
      result.current.ref(element);
    });

    // Simulate intersection
    const mockEntry: IntersectionObserverEntry = {
      isIntersecting: true,
      intersectionRatio: 1,
      boundingClientRect: element.getBoundingClientRect(),
      intersectionRect: element.getBoundingClientRect(),
      rootBounds: null,
      target: element,
      time: Date.now(),
    };

    act(() => {
      observerCallback([mockEntry]);
    });

    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('should not observe when enabled is false', () => {
    const { result } = renderHook(() => useIntersectionObserver({ enabled: false }));
    const element = document.createElement('div');

    act(() => {
      result.current.ref(element);
    });

    expect(mockObserve).not.toHaveBeenCalled();
  });

  it('should accept custom options', () => {
    const root = document.createElement('div');
    const options = {
      root,
      rootMargin: '10px',
      threshold: 0.5,
    };

    const { result } = renderHook(() => useIntersectionObserver(options));
    const element = document.createElement('div');

    act(() => {
      result.current.ref(element);
    });

    // Observer should be created and observing
    expect(mockObserve).toHaveBeenCalledWith(element);
    expect(constructedWith).toEqual([{ root, rootMargin: '10px', threshold: 0.5 }]);
  });

  it('rebuilds the observer when the options change after mount', () => {
    // The returned object is memoised. It used to omit `ref` from its
    // dependencies, so after mount the caller kept holding the FIRST `ref`
    // callback: React saw an unchanged ref, never re-attached, and the
    // observer went on using the options it was born with. A `threshold` (or
    // `rootMargin`, or `root`) raised in response to state simply did nothing
    // — silently, and for as long as no intersection event happened to change
    // `entry` and recompute the memo.
    const Subject = ({ threshold }: { threshold: number }) => {
      const { ref } = useIntersectionObserver({ threshold });
      return createElement('div', { ref });
    };

    const { rerender } = render(createElement(Subject, { threshold: 0 }));
    expect(constructedWith).toEqual([{ root: null, rootMargin: '0px', threshold: 0 }]);

    rerender(createElement(Subject, { threshold: 0.75 }));

    expect(constructedWith).toEqual([
      { root: null, rootMargin: '0px', threshold: 0 },
      { root: null, rootMargin: '0px', threshold: 0.75 },
    ]);
  });

  it('should disconnect when manually called', () => {
    const { result } = renderHook(() => useIntersectionObserver());
    const element = document.createElement('div');

    act(() => {
      result.current.ref(element);
    });

    act(() => {
      result.current.disconnect();
    });

    expect(mockDisconnect).toHaveBeenCalled();
  });
});
