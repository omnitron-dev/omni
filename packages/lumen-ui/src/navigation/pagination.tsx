import React from 'react';
import clsx from 'clsx';

export interface DocPaginationItem {
  label: string;
  href: string;
}

export interface DocPaginationProps {
  prev?: DocPaginationItem;
  next?: DocPaginationItem;
  className?: string;
}

export function DocPagination({ prev, next, className }: DocPaginationProps): React.JSX.Element {
  return React.createElement(
    'nav',
    { className: clsx('lumen-pagination', className), 'aria-label': 'Docs pagination' },
    prev ? React.createElement('a', { href: prev.href, className: 'lumen-pagination-prev' }, prev.label) : null,
    next ? React.createElement('a', { href: next.href, className: 'lumen-pagination-next' }, next.label) : null
  );
}
