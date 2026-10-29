import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { useChart } from '../use-chart.js';

afterEach(() => vi.unstubAllGlobals());

describe('chart theme and motion policy', () => {
  it.each(['light', 'dark'] as const)('uses the %s tooltip and retains caller formatters', (mode) => {
    const formatter = (value: number) => `${value} bytes`;
    const { result } = renderHook(
      () => useChart({ tooltip: { y: { formatter } }, chart: { animations: { enabled: false } } }),
      {
        wrapper: ({ children }) => <ThemeProvider theme={createTheme({ palette: { mode } })}>{children}</ThemeProvider>,
      }
    );
    expect(result.current.tooltip?.theme).toBe(mode);
    expect(result.current.tooltip?.y?.formatter?.(25)).toBe('25 bytes');
    expect(result.current.chart?.animations?.enabled).toBe(false);
    expect(result.current.chart?.toolbar?.show).toBe(false);
    expect(result.current.chart?.background).toBe('transparent');
  });

  it('honours reduced motion even when a caller requests animation', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const { result } = renderHook(() => useChart({ chart: { animations: { enabled: true } } }));
    expect(result.current.chart?.animations?.enabled).toBe(false);
  });
});
