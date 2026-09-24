/**
 * A row that scrolls: items side by side, snapped, scrolled by the browser.
 *
 * For a page reached over Tor, a slider that moves its track from script is
 * script the reader downloads and frames the page spends; a row the browser
 * scrolls is neither. Touch, trackpad, wheel and keyboard work because they
 * are the browser's own. The arrows appear only where there is somewhere to
 * go, and not at all on a screen without hover.
 *
 * @module components/rail
 */

'use client';

import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import type { ResponsiveStyleValue } from '@mui/system';
import type { SxProps, Theme } from '@mui/material/styles';

export interface RailProps {
  children: ReactNode;
  /** Name of the row, for assistive technology — a scrolling region needs one */
  'aria-label': string;
  /** Width of each item. Default: most of a phone, two on a tablet, three or four on a desktop. */
  itemWidth?: ResponsiveStyleValue<string | number> | undefined;
  /** Space between items, in theme spacing units. Default 2. */
  gap?: number | undefined;
  /** The arrows' names, translated by the caller */
  labels?: { previous?: string | undefined; next?: string | undefined } | undefined;
  sx?: SxProps<Theme> | undefined;
}

const DEFAULT_ITEM_WIDTH = { xs: '78%', sm: '46%', md: '31%', lg: '23.5%' };

function Chevron({ direction }: { direction: 'left' | 'right' }): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <polyline points={direction === 'left' ? '15 6 9 12 15 18' : '9 6 15 12 9 18'} />
    </svg>
  );
}

/**
 * @example
 * ```tsx
 * <Rail aria-label={t('home.showcase.products')}>
 *   {products.map((p) => <ProductCard key={p.id} product={p} />)}
 * </Rail>
 * ```
 */
export function Rail({
  children,
  'aria-label': ariaLabel,
  itemWidth = DEFAULT_ITEM_WIDTH,
  gap = 2,
  labels,
  sx,
}: RailProps): ReactNode {
  const track = useRef<HTMLUListElement>(null);
  const [reach, setReach] = useState({ back: false, forward: false });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setReach({ back: el.scrollLeft > 1, forward: el.scrollLeft < max - 1 });
  }, []);

  useEffect(() => {
    measure();
    const el = track.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const page = (direction: 1 | -1) => {
    const el = track.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: 'smooth' });
  };

  const arrow = (direction: 1 | -1, show: boolean, label: string) =>
    show ? (
      <IconButton
        size="small"
        aria-label={label}
        onClick={() => page(direction)}
        sx={{
          position: 'absolute',
          top: '50%',
          transform: 'translateY(-50%)',
          [direction === 1 ? 'right' : 'left']: -8,
          zIndex: 1,
          bgcolor: 'background.paper',
          boxShadow: 2,
          '&:hover': { bgcolor: 'background.paper' },
          '@media (hover: none)': { display: 'none' },
        }}
      >
        <Chevron direction={direction === 1 ? 'right' : 'left'} />
      </IconButton>
    ) : null;

  return (
    <Box
      component="section"
      aria-label={ariaLabel}
      data-testid="prism-rail"
      sx={[{ position: 'relative' }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {arrow(-1, reach.back, labels?.previous ?? 'Previous')}
      <Box
        component="ul"
        ref={track}
        tabIndex={0}
        onScroll={measure}
        sx={{
          display: 'grid',
          gridAutoFlow: 'column',
          gridAutoColumns: itemWidth,
          gap,
          m: 0,
          p: 0,
          listStyle: 'none',
          overflowX: 'auto',
          overscrollBehaviorX: 'contain',
          scrollSnapType: 'x mandatory',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
        }}
      >
        {Children.map(children, (child) =>
          child == null || child === false ? null : (
            <Box component="li" sx={{ scrollSnapAlign: 'start', minWidth: 0 }}>
              {child}
            </Box>
          )
        )}
      </Box>
      {arrow(1, reach.forward, labels?.next ?? 'Next')}
    </Box>
  );
}
