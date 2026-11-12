import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import Button from '@mui/material/Button';
import { createPrismTheme } from '../theme/create-theme.js';
import { getContrastRatio } from '../theme/utils/color.js';
import { OmnitronMark } from './omnitron-mark.js';
import { OmnitronSplash } from './omnitron-splash.js';
import { omnitronTheme } from './theme.js';
import { omnitronTokens, omnitronCssVariables } from './tokens.js';

afterEach(cleanup);

describe('one readable palette in Console and the server-rendered website', () => {
  for (const mode of ['light', 'dark'] as const) {
    it(`keeps text, signals, controls and keyboard focus readable in ${mode}`, () => {
      const color = omnitronTokens.color[mode];
      const theme = createPrismTheme({ mode, overrides: omnitronTheme({ mode }) });
      for (const surface of [color.background, color.surface, color.raised]) {
        for (const foreground of [color.text, color.muted, color.accent, color.success, color.warning, color.error, color.info]) {
          expect(getContrastRatio(foreground, surface), `${foreground} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
        expect(getContrastRatio(color.controlBorder, surface)).toBeGreaterThanOrEqual(3);
        expect(getContrastRatio(color.accent, surface)).toBeGreaterThanOrEqual(3);
      }
      expect(getContrastRatio(color.onAccent, color.accent)).toBeGreaterThanOrEqual(4.5);
      expect(theme.palette.primary.main).toBe(omnitronCssVariables(mode)['--omni-accent']);
      expect(theme.palette.background.paper).toBe(omnitronCssVariables(mode)['--omni-surface']);
      expect(theme.typography.h3.fontFamily).toBe(omnitronTokens.font.sans);
    });
  }
});

describe('activity states describe what is actually known', () => {
  const theme = createPrismTheme({ mode: 'dark', overrides: omnitronTheme({ mode: 'dark' }) });
  const provider = ({ children }: { children: React.ReactNode }) => <ThemeProvider theme={theme}>{children}</ThemeProvider>;

  it('names unknown-duration activity without claiming a completion percentage', () => {
    render(<OmnitronSplash message="Checking your session…" />, { wrapper: provider });
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session…');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('exposes measured progress with the operation as its accessible name', () => {
    const { rerender } = render(<OmnitronSplash message="Uploading archive" progress={37} />, { wrapper: provider });
    expect(screen.getByRole('progressbar', { name: 'Uploading archive' })).toHaveAttribute('aria-valuenow', '37');
    rerender(<OmnitronSplash message="Uploading archive" progress={Number.NaN} />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN|%/)).not.toBeInTheDocument();
  });

  it('replaces activity with the actual failure and recovery action', () => {
    const { container } = render(<OmnitronSplash state="error" message="Connection lost" progress={37} action={<Button>Retry connection</Button>} />, { wrapper: provider });
    expect(screen.getByRole('alert')).toHaveTextContent('Connection lost');
    expect(screen.getByRole('button', { name: 'Retry connection' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(container.querySelector('[data-omnitron-mark]')).toHaveAttribute('data-omnitron-mark', 'error');
  });

  it('keeps repeated brand instances independently named and decorative instances silent', () => {
    render(<><OmnitronMark /><OmnitronMark label="Workspace" /><OmnitronMark label={null} /></>, { wrapper: provider });
    const marks = screen.getAllByRole('img');
    expect(marks).toHaveLength(2);
    expect(marks[0].getAttribute('aria-labelledby')).not.toBe(marks[1].getAttribute('aria-labelledby'));
    expect(screen.getByRole('img', { name: 'Omnitron' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Workspace' })).toBeInTheDocument();
  });
});
