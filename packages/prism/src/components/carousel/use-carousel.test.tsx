/**
 * useCarousel — a slider's state for markup you write yourself.
 *
 * It does not drive `<Carousel>`: that component keeps its own copy of this
 * state and exposes no controlled props. The two are parallel
 * implementations, which is worth pinning because the hook's header used to
 * claim the opposite.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useCarousel } from './use-carousel.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useCarousel bounds', () => {
  it('stops at the last reachable index, not at the last slide', () => {
    // Showing three of ten, the last position is 7 — index 8 would leave a
    // gap at the end of the strip.
    const { result } = renderHook(() => useCarousel({ totalSlides: 10, slidesToShow: 3 }));

    act(() => result.current.goTo(99));
    expect(result.current.currentIndex).toBe(7);
    expect(result.current.canNext).toBe(false);
  });

  it('refuses to move before the first slide', () => {
    const { result } = renderHook(() => useCarousel({ totalSlides: 5 }));

    expect(result.current.canPrev).toBe(false);
    act(() => result.current.prev());
    expect(result.current.currentIndex).toBe(0);
  });

  it('wraps in both directions with loop', () => {
    const { result } = renderHook(() => useCarousel({ totalSlides: 4, loop: true }));

    act(() => result.current.goTo(3));
    act(() => result.current.next());
    expect(result.current.currentIndex).toBe(0);

    act(() => result.current.prev());
    expect(result.current.currentIndex).toBe(3);
  });

  it('scrolls by the configured step', () => {
    const { result } = renderHook(() => useCarousel({ totalSlides: 12, slidesToShow: 3, slidesToScroll: 3 }));

    act(() => result.current.next());
    expect(result.current.currentIndex).toBe(3);
  });

  it('reports the move once, with the index it settled on', () => {
    // Clamping happens before the callback: a caller told "99" would draw a
    // slide that is not on screen.
    const onSlideChange = vi.fn();
    const { result } = renderHook(() =>
      useCarousel({ totalSlides: 5, slidesToShow: 2, onSlideChange })
    );

    act(() => result.current.goTo(99));

    expect(onSlideChange).toHaveBeenCalledTimes(1);
    expect(onSlideChange).toHaveBeenCalledWith(3);
  });
});

describe('useCarousel autoplay', () => {
  it('advances on its own once started', () => {
    const { result } = renderHook(() =>
      useCarousel({ totalSlides: 5, autoplay: true, autoplayInterval: 100 })
    );

    expect(result.current.isPlaying).toBe(true);
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current.currentIndex).toBe(1);
  });

  it('stops on pause and resumes on play', () => {
    const { result } = renderHook(() =>
      useCarousel({ totalSlides: 5, autoplay: true, autoplayInterval: 100 })
    );

    act(() => result.current.pause());
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.isPlaying).toBe(false);

    act(() => result.current.play());
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current.currentIndex).toBe(1);
  });

  it('does not autoplay a strip that already fits', () => {
    // Three slides showing three: there is nowhere to advance to, and a
    // timer firing every hundred milliseconds to move nothing is load with
    // no effect.
    //
    // Asserted on `onSlideChange` rather than on the index: with nowhere to
    // go the index stays at 0 whether or not a timer is running, so the
    // index cannot tell the two apart. The callback can.
    const onSlideChange = vi.fn();
    const { result } = renderHook(() =>
      useCarousel({ totalSlides: 3, slidesToShow: 3, autoplay: true, autoplayInterval: 100, onSlideChange })
    );

    // No timer AT ALL, which is the claim the guard makes. The callback
    // assertion below cannot see it: with nowhere to advance, a running
    // timer clamps back to the current index and stays silent, so silence
    // is not evidence of absence. `getTimerCount` is.
    expect(vi.getTimerCount()).toBe(0);

    act(() => { vi.advanceTimersByTime(1000); });

    expect(result.current.currentIndex).toBe(0);
    expect(onSlideChange).not.toHaveBeenCalled();
  });

  it('stops reporting changes once it can go no further', () => {
    // Parked at the last slide with autoplay still on, every tick used to
    // call `onSlideChange` again with the index it already had.
    const onSlideChange = vi.fn();
    renderHook(() =>
      useCarousel({ totalSlides: 3, autoplay: true, autoplayInterval: 100, onSlideChange })
    );

    act(() => { vi.advanceTimersByTime(1000); });

    // Two moves to reach the end, and nothing after.
    expect(onSlideChange.mock.calls.flat()).toEqual([1, 2]);
  });

  it('stops at the end without loop rather than looping anyway', () => {
    const { result } = renderHook(() =>
      useCarousel({ totalSlides: 3, autoplay: true, autoplayInterval: 100 })
    );

    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.currentIndex).toBe(2);
  });

  it('leaves no timer behind when unmounted', () => {
    const { result, unmount } = renderHook(() =>
      useCarousel({ totalSlides: 5, autoplay: true, autoplayInterval: 100 })
    );

    act(() => { vi.advanceTimersByTime(100); });
    const before = result.current.currentIndex;
    unmount();

    // Nothing should still be scheduled; if something is, this throws or the
    // index moves under a hook nobody is rendering.
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.currentIndex).toBe(before);
  });
});
