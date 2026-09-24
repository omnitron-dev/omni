/**
 * A row the browser scrolls — the one the downstream home page lays its
 * showcase out in. Arrows only where there is somewhere to go.
 */
import type { ReactElement } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import { createPrismTheme } from '../../theme/create-theme.js';
import { Rail } from './rail.js';

function themed(node: ReactElement) {
  return render(<ThemeProvider theme={createPrismTheme()}>{node}</ThemeProvider>);
}

/** A track whose geometry says it can scroll — happy-dom lays nothing out. */
function scrollable(track: HTMLElement, { scrollWidth, clientWidth, scrollLeft }: Record<string, number>) {
  Object.defineProperty(track, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(track, 'clientWidth', { configurable: true, value: clientWidth });
  Object.defineProperty(track, 'scrollLeft', { configurable: true, writable: true, value: scrollLeft });
}

describe('Rail', () => {
  it('is a named region of list items, each snapped, empty children skipped', () => {
    themed(
      <Rail aria-label="Новые товары">
        <span>one</span>
        {null}
        <span>two</span>
      </Rail>
    );

    expect(screen.getByRole('region', { name: 'Новые товары' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows no arrows when there is nowhere to scroll', () => {
    themed(
      <Rail aria-label="row" labels={{ previous: 'Назад', next: 'Вперёд' }}>
        <span>one</span>
      </Rail>
    );

    expect(screen.queryByLabelText('Назад')).toBeNull();
    expect(screen.queryByLabelText('Вперёд')).toBeNull();
  });

  it('offers the way forward, then back, and pages by what is visible', () => {
    themed(
      <Rail aria-label="row" labels={{ previous: 'Назад', next: 'Вперёд' }}>
        <span>one</span>
        <span>two</span>
      </Rail>
    );
    const track = screen.getByRole('list');
    const scrollBy = vi.fn();
    track.scrollBy = scrollBy as never;

    scrollable(track, { scrollWidth: 1000, clientWidth: 400, scrollLeft: 0 });
    fireEvent.scroll(track);
    expect(screen.queryByLabelText('Назад')).toBeNull();
    fireEvent.click(screen.getByLabelText('Вперёд'));
    expect(scrollBy).toHaveBeenCalledWith({ left: 360, behavior: 'smooth' });

    scrollable(track, { scrollWidth: 1000, clientWidth: 400, scrollLeft: 600 });
    fireEvent.scroll(track);
    expect(screen.getByLabelText('Назад')).toBeTruthy();
    expect(screen.queryByLabelText('Вперёд')).toBeNull();
  });
});
