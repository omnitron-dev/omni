/**
 * useKeyboardShortcut Hook Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKeyboardShortcut, useEscapeKey, useEnterKey } from '../use-keyboard-shortcut.js';

describe('useKeyboardShortcut', () => {
  const dispatchKeyEvent = (key: string, options: Partial<KeyboardEventInit> = {}) => {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      ...options,
    });
    document.dispatchEvent(event);
    return event;
  };

  it('should trigger callback on matching key', () => {
    const callback = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: 'k' }, callback));

    act(() => {
      dispatchKeyEvent('k');
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should not trigger callback on non-matching key', () => {
    const callback = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: 'k' }, callback));

    act(() => {
      dispatchKeyEvent('j');
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it('should respect ctrl modifier', () => {
    const callback = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: 'k', ctrl: true }, callback));

    // Without ctrl
    act(() => {
      dispatchKeyEvent('k');
    });
    expect(callback).not.toHaveBeenCalled();

    // With ctrl
    act(() => {
      dispatchKeyEvent('k', { ctrlKey: true });
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should respect shift modifier', () => {
    const callback = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: 'k', shift: true }, callback));

    // Without shift
    act(() => {
      dispatchKeyEvent('k');
    });
    expect(callback).not.toHaveBeenCalled();

    // With shift
    act(() => {
      dispatchKeyEvent('k', { shiftKey: true });
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should be case-insensitive for letter keys', () => {
    const callback = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: 'K' }, callback));

    act(() => {
      dispatchKeyEvent('k');
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should respect enabled option', () => {
    const callback = vi.fn();
    const { rerender } = renderHook(({ enabled }) => useKeyboardShortcut({ key: 'k' }, callback, { enabled }), {
      initialProps: { enabled: false },
    });

    act(() => {
      dispatchKeyEvent('k');
    });
    expect(callback).not.toHaveBeenCalled();

    rerender({ enabled: true });

    act(() => {
      dispatchKeyEvent('k');
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should call callback with event when preventDefault is specified', () => {
    const callback = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: 'k' }, callback, { preventDefault: true }));

    act(() => {
      dispatchKeyEvent('k');
    });

    // Callback should receive the event
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(expect.any(KeyboardEvent));
  });
});

describe('useEscapeKey', () => {
  it('should trigger callback on Escape key', () => {
    const callback = vi.fn();
    renderHook(() => useEscapeKey(callback));

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe('useEnterKey', () => {
  it('should trigger callback on Enter key', () => {
    const callback = vi.fn();
    renderHook(() => useEnterKey(callback));

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });
});
