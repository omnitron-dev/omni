import React from 'react';
import clsx from 'clsx';

export interface DocSectionHeading {
  id: string;
  title: string;
  level: number;
  rawTitle?: string;
}

export interface DocSectionNavProps {
  headings?: DocSectionHeading[];
  activeId?: string | null;
  macros?: Record<string, string>;
  className?: string;
}

export function DocSectionNav({ headings = [], activeId, className }: DocSectionNavProps): React.JSX.Element {
  return React.createElement(
    'aside',
    { className: clsx('lumen-section-nav', className), 'aria-label': 'Table of contents' },
    React.createElement(
      'ul',
      null,
      ...headings.map((h) =>
        React.createElement(
          'li',
          {
            key: h.id,
            className: clsx(`lumen-toc-level-${h.level}`, activeId === h.id && 'is-active'),
          },
          React.createElement('a', { href: `#${h.id}` }, h.title)
        )
      )
    )
  );
}
