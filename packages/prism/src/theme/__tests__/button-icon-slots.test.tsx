import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import Button from '@mui/material/Button';
import { describe, expect, it, vi } from 'vitest';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { createPrismTheme } from '../create-theme.js';

function icon(id: string, wrapped: boolean) {
  const graphic = <svg data-testid={wrapped ? undefined : id} aria-hidden width="1em" height="1em" />;
  return (
    <>
      <style data-emotion={`server-${id}`}>{`.server-${id} { display: block; }`}</style>
      {wrapped ? <span data-testid={id}>{graphic}</span> : graphic}
    </>
  );
}

describe('button icon slot geometry with SSR-inserted styles', () => {
  it.each(['small', 'medium', 'large'] as const)(
    'sizes both %s icon slots consistently for SVG and custom wrapper roots',
    (size) => {
      const { getByTestId } = render(
        <ThemeProvider theme={createPrismTheme()}>
          <Button size={size} startIcon={icon('start-svg', false)} endIcon={icon('end-wrapper', true)}>
            Next
          </Button>
          <Button size={size} startIcon={icon('start-wrapper', true)} endIcon={icon('end-svg', false)}>
            Previous
          </Button>
        </ThemeProvider>
      );
      for (const id of ['start-svg', 'end-svg', 'start-wrapper', 'end-wrapper']) {
        expect(getComputedStyle(getByTestId(id)).fontSize).toBe('16px');
      }
    }
  );

  it('emits no SSR-unsafe selector warning when compiling both native MUI icon slots', () => {
    // Do not suppress warnings; compile into a fresh cache and assert the output.
    const errors = vi.spyOn(console, 'error');
    const cache = createCache({ key: 'button-icons-ssr-regression' });
    try {
      render(
        <CacheProvider value={cache}>
          <ThemeProvider theme={createPrismTheme()}>
            <Button startIcon={icon('leading', false)} endIcon={icon('trailing', true)}>
              Open source
            </Button>
          </ThemeProvider>
        </CacheProvider>
      );
      expect(errors.mock.calls.flat().join('\n')).not.toMatch(/potentially unsafe when doing server-side rendering/);
    } finally {
      errors.mockRestore();
      cache.sheet.flush();
    }
  });
});
