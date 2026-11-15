import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { useTheme } from '@mui/material/styles';
import Button from '@mui/material/Button';
import { PrismProvider } from './provider.js';
import { usePrismContext } from './context.js';
import { useSettingsStore } from '../state/stores/settings.js';
import { omnitronTheme } from '../identity/theme.js';

function Probe() {
  const { toggleMode, settings } = usePrismContext();
  const theme = useTheme();
  return <>
    <button onClick={toggleMode}>Switch theme</button>
    <output data-testid="theme">{JSON.stringify({ requested: settings.mode, mode: theme.palette.mode, paper: theme.palette.background.paper, primary: theme.palette.primary.main })}</output>
  </>;
}
const state = () => JSON.parse(screen.getByTestId('theme').textContent!);
beforeEach(() => useSettingsStore.setState({ mode: 'light', direction: 'ltr' }));
afterEach(cleanup);

describe('mode-aware application themes at the provider boundary', () => {
  it('changes a branded palette together with the native Prism mode in both directions', () => {
    render(<PrismProvider themeOverrides={({ mode }) => ({ palette: {
      primary: { main: mode === 'dark' ? '#C9B2FF' : '#7446A6' },
      background: { paper: mode === 'dark' ? '#241E2C' : '#FFFCF8' },
    } })}><Probe /></PrismProvider>);
    expect(state()).toEqual({ requested: 'light', mode: 'light', paper: '#FFFCF8', primary: '#7446A6' });
    fireEvent.click(screen.getByText('Switch theme'));
    expect(state()).toEqual({ requested: 'dark', mode: 'dark', paper: '#241E2C', primary: '#C9B2FF' });
    fireEvent.click(screen.getByText('Switch theme'));
    expect(state()).toEqual({ requested: 'light', mode: 'light', paper: '#FFFCF8', primary: '#7446A6' });
  });
  it('keeps static overrides compatible while preserving native mode updates', () => {
    render(<PrismProvider themeOverrides={{ palette: { primary: { main: '#123456' } } }}><Probe /></PrismProvider>);
    expect(state().primary).toBe('#123456');
    act(() => useSettingsStore.setState({ mode: 'dark' }));
    expect(state().mode).toBe('dark');
    expect(state().primary).toBe('#123456');
  });
  it('compiles both palettes without passing system to the application theme', () => {
    useSettingsStore.setState({ mode: 'system' });
    const modes: string[] = [];
    render(<PrismProvider themeOverrides={({ mode }) => { modes.push(mode); return {}; }}><Probe /></PrismProvider>);
    expect(modes.length).toBeGreaterThan(0);
    expect(modes.every(mode => mode === 'light' || mode === 'dark')).toBe(true);
    expect(state().requested).toBe('system');
    expect(new Set(modes)).toEqual(new Set(['light', 'dark']));
  });
  it('renders independent explicit modes on the server without changing the shared store', () => {
    const theme = (mode: 'dark' | 'light') => renderToString(
      <PrismProvider mode={mode} themeOverrides={omnitronTheme} disableCssBaseline><Probe /></PrismProvider>
    );
    expect(theme('dark')).toContain('&quot;mode&quot;:&quot;dark&quot;');
    expect(theme('light')).toContain('&quot;mode&quot;:&quot;light&quot;');
    expect(theme('dark')).toContain('&quot;primary&quot;:&quot;#71DDE3&quot;');
    expect(useSettingsStore.getState().mode).toBe('light');
  });
  it('routes controlled mode changes to the owner and ignores unrelated store changes', () => {
    const onChange = vi.fn();
    function ControlledTheme() {
      const [mode, setMode] = useState<'dark' | 'light' | 'system'>('dark');
      return <PrismProvider mode={mode} defaultSettings={{ mode: 'dark' }}
        onModeChange={next => { onChange(next); setMode(next); }} themeOverrides={omnitronTheme}><Probe /></PrismProvider>;
    }
    render(<ControlledTheme />);
    expect(state().mode).toBe('dark');
    expect(useSettingsStore.getState().mode).toBe('light');
    fireEvent.click(screen.getByText('Switch theme'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('light');
    expect(state().requested).toBe('light');
    expect(state().mode).toBe('light');
    expect(useSettingsStore.getState().mode).toBe('light');
    act(() => useSettingsStore.setState({ mode: 'dark' }));
    expect(state().mode).toBe('light');
  });
  it('hydrates the explicit server mode while the persisted store requests a different palette', async () => {
    const recoverableErrors: unknown[] = [];
    const tree = <PrismProvider mode="dark" themeOverrides={omnitronTheme} disableCssBaseline><Probe /></PrismProvider>;
    const container = document.createElement('div');
    container.innerHTML = renderToString(tree);
    document.body.append(container);
    const root = hydrateRoot(container, tree, { onRecoverableError: error => recoverableErrors.push(error) });
    try {
      await act(async () => {});
      expect(state().requested).toBe('dark');
      expect(state().mode).toBe('dark');
      expect(recoverableErrors).toEqual([]);
      expect(useSettingsStore.getState().mode).toBe('light');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
  it('keeps RTL ownership and physical CSS transformation in the provider cache', () => {
    useSettingsStore.setState({ direction: 'rtl' });
    render(<PrismProvider mode="dark"><Button sx={{ paddingLeft: '9px' }}>RTL</Button></PrismProvider>);
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByText('RTL').className).toContain('prism-rtl-');
    expect(getComputedStyle(screen.getByText('RTL')).paddingRight).toBe('9px');
  });
  it('rejects competing controlled and persisted mode authorities', () => {
    expect(() => renderToString(<PrismProvider mode="dark" modeStorageKey="theme"><Probe /></PrismProvider>))
      .toThrow('choose controlled mode or modeStorageKey');
  });
  it('resolves system changes for applications that explicitly disable CSS variables', () => {
    const media = Object.assign(new EventTarget(), {
      matches: true, media: '(prefers-color-scheme: dark)', onchange: null,
      addListener() {}, removeListener() {},
    });
    const query = vi.spyOn(window, 'matchMedia').mockReturnValue(media);
    try {
      const { rerender } = render(<PrismProvider mode="system" config={{ theme: { cssVariables: { enabled: false } } }} themeOverrides={omnitronTheme}><Probe /></PrismProvider>);
      const original = screen.getByTestId('theme');
      expect(state()).toMatchObject({ requested: 'system', mode: 'dark', primary: '#71DDE3' });
      act(() => { media.matches = false; media.dispatchEvent(new Event('change')); });
      expect(state()).toMatchObject({ requested: 'system', mode: 'light', primary: '#006D75' });
      rerender(<PrismProvider mode="dark" config={{ theme: { cssVariables: { enabled: false } } }} themeOverrides={omnitronTheme}><Probe /></PrismProvider>);
      expect(state().mode).toBe('dark');
      expect(screen.getByTestId('theme')).toBe(original);
    } finally { query.mockRestore(); }
  });
  it('requires precompiled CSS schemes for the native persisted selection', () => {
    expect(() => renderToString(<PrismProvider modeStorageKey="theme" config={{ theme: { cssVariables: { enabled: false } } }}><Probe /></PrismProvider>))
      .toThrow('modeStorageKey requires CSS variables');
  });
});
