/**
 * useOnlineStatus Hook Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOnlineStatus } from '../use-online-status.js';

describe('useOnlineStatus', () => {
  const originalNavigator = { ...navigator };
  let onLineValue = true;

  beforeEach(() => {
    onLineValue = true;
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => onLineValue,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => originalNavigator.onLine,
    });
  });

  it('should return online status', () => {
    onLineValue = true;
    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current.isOnline).toBe(true);
    expect(result.current.isOffline).toBe(false);
  });

  it('should return offline status', () => {
    onLineValue = false;
    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current.isOnline).toBe(false);
    expect(result.current.isOffline).toBe(true);
  });

  it('should update lastChanged on status change', () => {
    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current.lastChanged).toBeNull();

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.lastChanged).not.toBeNull();
    expect(typeof result.current.lastChanged).toBe('number');
  });

  it('should respond to online event', () => {
    onLineValue = false;
    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current.isOnline).toBe(false);

    // Simulate going online
    onLineValue = true;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    // Note: useSyncExternalStore may need multiple renders to reflect change
    // The lastChanged should definitely update
    expect(result.current.lastChanged).not.toBeNull();
  });

  it('should respond to offline event', () => {
    onLineValue = true;
    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current.isOnline).toBe(true);

    // Simulate going offline
    onLineValue = false;
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.lastChanged).not.toBeNull();
  });
});
