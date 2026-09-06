/**
 * useLightbox — what it can actually control.
 *
 * The hook used to return `zoomLevel`, `zoomIn`, `zoomOut` and `zoomReset`.
 * `<Lightbox>` owns its zoom internally and has no prop to drive it, and
 * `getLightboxProps()` carries only `open`, `onClose`, `index` and
 * `onIndexChange` — so those four members moved a number nothing rendered.
 * A consumer following the hook's own example would have called them and
 * watched nothing happen.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useLightbox } from './use-lightbox.js';

describe('useLightbox', () => {
  it('offers no control it cannot exercise', () => {
    // Pinned as a list rather than as four `not.toHaveProperty` lines: the
    // claim is about the whole surface, and a fifth inert member added later
    // should break this too.
    const { result } = renderHook(() => useLightbox({ totalSlides: 3 }));

    expect(Object.keys(result.current).sort()).toEqual(
      ['getLightboxProps', 'goTo', 'index', 'next', 'onClose', 'onOpen', 'open', 'prev'].sort()
    );
  });

  it('hands the component exactly what the component accepts', () => {
    const { result } = renderHook(() => useLightbox({ totalSlides: 3 }));

    expect(Object.keys(result.current.getLightboxProps()).sort()).toEqual(
      ['index', 'onClose', 'onIndexChange', 'open'].sort()
    );
  });

  it('opens at a slide and closes', () => {
    const { result } = renderHook(() => useLightbox({ totalSlides: 3 }));

    expect(result.current.open).toBe(false);
    act(() => result.current.onOpen(2));
    expect(result.current.open).toBe(true);
    expect(result.current.index).toBe(2);

    act(() => result.current.onClose());
    expect(result.current.open).toBe(false);
    // The index survives a close — reopening returns to where the operator was.
    expect(result.current.index).toBe(2);
  });

  it('stops at the ends without loop', () => {
    const { result } = renderHook(() => useLightbox({ totalSlides: 3 }));

    act(() => result.current.goTo(2));
    act(() => result.current.next());
    expect(result.current.index).toBe(2);

    act(() => result.current.goTo(0));
    act(() => result.current.prev());
    expect(result.current.index).toBe(0);
  });

  it('wraps at the ends with loop', () => {
    const { result } = renderHook(() => useLightbox({ totalSlides: 3, loop: true }));

    act(() => result.current.goTo(2));
    act(() => result.current.next());
    expect(result.current.index).toBe(0);

    act(() => result.current.prev());
    expect(result.current.index).toBe(2);
  });

  it('does nothing with no slides rather than dividing by zero', () => {
    // `loop` wraps with a modulo; a total of zero would make that NaN and
    // put the component on slide "NaN".
    const { result } = renderHook(() => useLightbox({ totalSlides: 0, loop: true }));

    act(() => result.current.next());
    expect(result.current.index).toBe(0);
  });
});
