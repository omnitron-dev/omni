/**
 * usePasswordVisibility Hook Tests
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePasswordVisibility } from '../use-password-visibility.js';

describe('usePasswordVisibility', () => {
  it('should return hidden state by default', () => {
    const { result } = renderHook(() => usePasswordVisibility());

    expect(result.current.visible).toBe(false);
    expect(result.current.type).toBe('password');
  });

  it('should respect initialVisible option', () => {
    const { result } = renderHook(() => usePasswordVisibility({ initialVisible: true }));

    expect(result.current.visible).toBe(true);
    expect(result.current.type).toBe('text');
  });

  it('should toggle visibility', () => {
    const { result } = renderHook(() => usePasswordVisibility());

    expect(result.current.visible).toBe(false);

    act(() => {
      result.current.toggle();
    });

    expect(result.current.visible).toBe(true);
    expect(result.current.type).toBe('text');

    act(() => {
      result.current.toggle();
    });

    expect(result.current.visible).toBe(false);
    expect(result.current.type).toBe('password');
  });

  it('should show password', () => {
    const { result } = renderHook(() => usePasswordVisibility());

    act(() => {
      result.current.show();
    });

    expect(result.current.visible).toBe(true);
    expect(result.current.type).toBe('text');
  });

  it('should hide password', () => {
    const { result } = renderHook(() => usePasswordVisibility({ initialVisible: true }));

    act(() => {
      result.current.hide();
    });

    expect(result.current.visible).toBe(false);
    expect(result.current.type).toBe('password');
  });

  it('should return stable function references', () => {
    const { result, rerender } = renderHook(() => usePasswordVisibility());

    const firstToggle = result.current.toggle;
    const firstShow = result.current.show;
    const firstHide = result.current.hide;

    rerender();

    expect(result.current.toggle).toBe(firstToggle);
    expect(result.current.show).toBe(firstShow);
    expect(result.current.hide).toBe(firstHide);
  });
});
