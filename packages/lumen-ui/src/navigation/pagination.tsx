import React from 'react';
import clsx from 'clsx';
import { ArrowLeftIcon, ArrowRightIcon } from '@omnitron-dev/prism/icons';
import { Box, Link } from '@omnitron-dev/prism/ui';

export interface DocPaginationItem {
  label: string;
  href: string;
}

export interface DocPaginationProps {
  prev?: DocPaginationItem;
  next?: DocPaginationItem;
  /** Translated navigation landmark and link directions. Document titles come from the adjacent items. */
  labels?: { navigation?: string; previous?: string; next?: string };
  className?: string;
}

/** Direction remains explicit when either neighbour is absent, including RTL layouts. */
export function DocPagination({ prev, next, labels, className }: DocPaginationProps): React.JSX.Element {
  const link = (item: DocPaginationItem, direction: 'prev' | 'next') => {
    const previous = direction === 'prev';
    const Arrow = previous ? ArrowLeftIcon : ArrowRightIcon;
    const arrow = <Arrow className="lumen-pagination-arrow" aria-hidden="true" sx={{ flexShrink: 0, fontSize: 18 }} />;
    return <Link href={item.href} rel={direction} color="inherit" underline="none" variant="inherit" className={`lumen-pagination-${direction}`} sx={{
      gridColumn: previous ? 1 : 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5,
      minWidth: 0, textAlign: previous ? 'start' : 'end',
      '&:focus-visible': { outline: '2px solid currentColor', outlineOffset: 2 },
    }}>
      {previous && arrow}
      <span className="lumen-pagination-label" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        <span className="lumen-pagination-direction" style={{ display: 'block' }}>
          {previous ? labels?.previous ?? 'Previous' : labels?.next ?? 'Next'}
        </span>
        <span className="lumen-pagination-title">{item.label}</span>
      </span>
      {!previous && arrow}
    </Link>;
  };
  return <Box component="nav" className={clsx('lumen-pagination', className)} aria-label={labels?.navigation ?? 'Docs pagination'} sx={{
    display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 2,
    '&:dir(rtl) .lumen-pagination-arrow': { transform: 'scaleX(-1)' },
  }}>
    {prev && link(prev, 'prev')}
    {next && link(next, 'next')}
  </Box>;
}
