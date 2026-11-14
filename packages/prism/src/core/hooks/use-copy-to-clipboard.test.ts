import { StrictMode, createElement, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCopyToClipboard } from './use-copy-to-clipboard.js';

function pendingWrite() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('clipboard request ownership', () => {
  it.each(['success', 'error'] as const)(
    'reset invalidates a pending %s without changing its actual write result',
    async (outcome) => {
      const write = pendingWrite();
      vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(() => write.promise) } });
      const onSuccess = vi.fn();
      const onError = vi.fn();
      const { result } = renderHook(() => useCopyToClipboard({ onSuccess, onError }));
      let copied!: Promise<boolean>;
      act(() => {
        copied = result.current.copy('previous source');
      });
      act(() => result.current.reset());
      await act(async () => {
        if (outcome === 'success') write.resolve();
        else write.reject(new Error('Denied'));
        expect(await copied).toBe(outcome === 'success');
      });
      expect(result.current.state).toBe('idle');
      expect(result.current.copiedText).toBeNull();
      expect(onSuccess).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each(['success', 'error'] as const)(
    'an older %s cannot replace the latest completed copy or its timer',
    async (outcome) => {
      const old = pendingWrite();
      const latest = pendingWrite();
      const writeText = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      const onSuccess = vi.fn();
      const onError = vi.fn();
      const { result } = renderHook(() => useCopyToClipboard({ onSuccess, onError, resetTimeout: 1000 }));
      let first!: Promise<boolean>;
      let second!: Promise<boolean>;
      act(() => {
        first = result.current.copy('A');
        second = result.current.copy('B');
      });
      await act(async () => {
        latest.resolve();
        expect(await second).toBe(true);
      });
      act(() => vi.advanceTimersByTime(500));
      await act(async () => {
        if (outcome === 'success') old.resolve();
        else old.reject(new Error('Old denial'));
        expect(await first).toBe(outcome === 'success');
      });
      expect(result.current.state).toBe('success');
      expect(result.current.copiedText).toBe('B');
      expect(writeText.mock.calls).toEqual([['A'], ['B']]);
      expect(onSuccess.mock.calls).toEqual([['B']]);
      expect(onError).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(500));
      expect(result.current.state).toBe('idle');
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('keeps a newer pending request idle and reports its own failure', async () => {
    const old = pendingWrite();
    const latest = pendingWrite();
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise) },
    });
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useCopyToClipboard({ onSuccess, onError }));
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.copy('A');
      second = result.current.copy('B');
    });
    await act(async () => {
      old.resolve();
      await first;
    });
    expect(result.current.state).toBe('idle');
    expect(result.current.copiedText).toBeNull();
    const denied = new Error('Current denial');
    await act(async () => {
      latest.reject(denied);
      expect(await second).toBe(false);
    });
    expect(result.current.state).toBe('error');
    expect(result.current.copiedText).toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledExactlyOnceWith(denied);
  });

  it.each(['success', 'error'] as const)(
    'unmount invalidates a pending %s and prevents later writes',
    async (outcome) => {
      const write = pendingWrite();
      const writeText = vi.fn(() => write.promise);
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      const onSuccess = vi.fn();
      const onError = vi.fn();
      const { result, unmount } = renderHook(() => useCopyToClipboard({ onSuccess, onError }));
      const copy = result.current.copy;
      let pending!: Promise<boolean>;
      act(() => {
        pending = copy('A');
      });
      unmount();
      await act(async () => {
        if (outcome === 'success') write.resolve();
        else write.reject(new Error('Denied'));
        expect(await pending).toBe(outcome === 'success');
      });
      expect(await copy('B')).toBe(false);
      expect(writeText).toHaveBeenCalledExactlyOnceWith('A');
      expect(onSuccess).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('does not schedule a stale timer when the completion callback resets the source', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useCopyToClipboard({ onSuccess }));
    onSuccess.mockImplementation(() => result.current.reset());
    await act(async () => {
      expect(await result.current.copy('A')).toBe(true);
    });
    expect(result.current.state).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('copies exact source after StrictMode reactivation and cancels the reset timer on a new request', async () => {
    const next = pendingWrite();
    const source = '// [!code highlight]\r\nПривет 🌐\r\n';
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockReturnValueOnce(next.promise);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { result } = renderHook(() => useCopyToClipboard({ resetTimeout: 1000 }), {
      wrapper: ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children),
    });
    await act(async () => {
      expect(await result.current.copy(source)).toBe(true);
    });
    expect(result.current.copiedText).toBe(source);
    act(() => vi.advanceTimersByTime(500));
    let second!: Promise<boolean>;
    act(() => {
      second = result.current.copy('B');
    });
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.state).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      next.resolve();
      await second;
    });
    expect(result.current.copiedText).toBe('B');
    act(() => vi.advanceTimersByTime(999));
    expect(result.current.state).toBe('success');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.state).toBe('idle');
    expect(writeText.mock.calls).toEqual([[source], ['B']]);
  });

  it('reports unavailable clipboard through the same error and reset path', async () => {
    vi.stubGlobal('navigator', undefined);
    const onError = vi.fn();
    const { result } = renderHook(() => useCopyToClipboard({ onError, resetTimeout: 100 }));
    await act(async () => {
      expect(await result.current.copy('A')).toBe(false);
    });
    expect(result.current.state).toBe('error');
    expect(onError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'Clipboard API not available' })
    );
    act(() => vi.advanceTimersByTime(100));
    expect(result.current.state).toBe('idle');
  });
});
