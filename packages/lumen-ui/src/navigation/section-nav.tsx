import React, { useMemo } from 'react';
import clsx from 'clsx';
import { ScrollSpyProvider, useScrollSpy } from '@omnitron-dev/prism/components/doc-layout';

export interface DocSectionHeading {
  id: string;
  title: string;
  level: number;
  rawTitle?: string;
}

export interface DocSectionNavProps {
  headings?: DocSectionHeading[];
  activeId?: string | null;
  /** Optional scroll activation offset; otherwise uses the page's CSS scroll-padding-top. */
  offset?: number;
  macros?: Record<string, string>;
  className?: string;
}

function SectionLinks({ headings = [], activeId, className }: DocSectionNavProps): React.JSX.Element {
  const { activeId: observedId } = useScrollSpy();
  const current = activeId === undefined ? observedId : activeId;
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
            className: clsx(`lumen-toc-level-${h.level}`, current === h.id && 'is-active'),
          },
          React.createElement('a', { href: `#${encodeURIComponent(h.id)}`, 'aria-current': current === h.id ? 'location' : undefined }, h.title)
        )
      )
    )
  );
}

/** Render native SSR links; mount as a Lumen island to enable current-section tracking. */
export function DocSectionNav(props: DocSectionNavProps): React.JSX.Element {
  const ids = useMemo(() => props.headings?.map(heading => heading.id) ?? [], [props.headings]);
  return React.createElement(ScrollSpyProvider, { headingIds: ids, offset: props.offset, children: null },
    React.createElement(SectionLinks, props));
}
