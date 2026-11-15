import React, { useMemo } from 'react';
import { ScrollSpyProvider, DocSectionNav as PrismSectionNav } from '@omnitron-dev/prism/components/doc-layout';

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
  ariaLabel?: string;
}

/** Render native SSR links; mount as a Lumen island to enable current-section tracking. */
export function DocSectionNav(props: DocSectionNavProps): React.JSX.Element {
  const ids = useMemo(() => props.headings?.map(heading => heading.id) ?? [], [props.headings]);
  const headings = useMemo(() => props.headings?.map(({ id, title, level }) => ({ id, text: title, level })) ?? [], [props.headings]);
  return React.createElement(ScrollSpyProvider, { headingIds: ids, offset: props.offset, children: null },
    React.createElement(PrismSectionNav, { headings, title: null, activeId: props.activeId, className: props.className, ariaLabel: props.ariaLabel }));
}
