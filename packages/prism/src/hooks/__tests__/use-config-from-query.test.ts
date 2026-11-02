import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useConfigFromQuery } from '../use-config-from-query.js';

afterEach(() => window.history.replaceState(null, '', '/'));

it('keeps router state, unrelated parameters and anchors when writing or clearing settings', () => {
  window.history.replaceState({ route: 1 }, '', '/?keep=yes#chart');
  const notify = vi.fn();
  const { result } = renderHook(() => useConfigFromQuery({ onConfigChange: notify }));
  act(() => result.current.updateUrl({ mode: 'dark' }));
  expect(result.current.configFromUrl.mode).toBe('dark');
  expect(window.history.state).toEqual({ route: 1 });
  expect(result.current.generateUrl({ density: 'compact' }, '/demo?keep=yes#chart')).toBe('/demo?keep=yes&density=compact#chart');
  act(() => result.current.clearUrl());
  expect(window.location.search + window.location.hash).toBe('?keep=yes#chart');
  expect(notify).toHaveBeenLastCalledWith({});
});

it('honors a shared URL, explicit changes and subsequent browser navigation', () => {
  window.history.replaceState(null, '', '/?mode=dark');
  const { result, rerender } = renderHook(({ density }: { density: 'compact' | 'standard' }) =>
    useConfigFromQuery({ syncToUrl: true, values: { density } }), { initialProps: { density: 'standard' } });
  expect(window.location.search).toBe('?mode=dark');
  rerender({ density: 'compact' });
  expect(result.current.configFromUrl).toEqual({ mode: 'dark', density: 'compact' });
  act(() => {
    window.history.replaceState(null, '', '/?mode=light');
    window.dispatchEvent(new Event('popstate'));
  });
  expect(result.current.configFromUrl).toEqual({ mode: 'light' });
});
