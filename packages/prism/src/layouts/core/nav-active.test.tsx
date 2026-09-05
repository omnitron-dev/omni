/**
 * Which navigation entry is highlighted.
 *
 * The sidebar's highlight is how an operator knows where they are, and both
 * shells build their nav from this. It fails quietly in both directions: a
 * wrong highlight sends someone looking for the page they are already on,
 * and a missing one makes a section look unvisited.
 *
 * The matcher has three modes that interact — exact, deep (a path prefix
 * bounded at a segment), and `selectionPrefix` (a raw prefix, for entries
 * spanning disjoint URL spaces). The interesting cases are where they
 * disagree, and none of them were covered.
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import { LayoutProvider, useNavActive } from './context.js';
import type { LayoutNavItem } from '../types.js';

const wrapper = ({ children }: { children: ReactNode }) => <LayoutProvider>{children}</LayoutProvider>;

/** Is `item` highlighted when the browser is at `pathname`? */
function active(item: LayoutNavItem, pathname: string): boolean {
  const { result } = renderHook(() => useNavActive(pathname), { wrapper });
  return result.current.isItemActive(item);
}

const item = (path: string, extra: Partial<LayoutNavItem> = {}): LayoutNavItem =>
  ({ id: path, title: path, path, ...extra }) as LayoutNavItem;

describe('exact and deep matching', () => {
  it('highlights the entry for the page you are on', () => {
    expect(active(item('/apps'), '/apps')).toBe(true);
  });

  it('keeps the parent highlighted on a child route', () => {
    expect(active(item('/apps'), '/apps/main')).toBe(true);
  });

  it('does not highlight a sibling whose path is a string prefix', () => {
    // `/product` must not match `/products` — the deep match is bounded at a
    // segment boundary, not at an arbitrary character.
    expect(active(item('/product'), '/products')).toBe(false);
    expect(active(item('/apps'), '/appstore')).toBe(false);
  });

  it('honours deepMatch: false', () => {
    expect(active(item('/apps', { deepMatch: false }), '/apps/main')).toBe(false);
    expect(active(item('/apps', { deepMatch: false }), '/apps')).toBe(true);
  });

  it('ignores query and hash', () => {
    expect(active(item('/apps'), '/apps?tab=logs')).toBe(true);
    expect(active(item('/apps'), '/apps#section')).toBe(true);
    expect(active(item('/apps'), '/apps/main?tab=logs#top')).toBe(true);
  });

  it('ignores a trailing slash', () => {
    expect(active(item('/apps'), '/apps/')).toBe(true);
  });

  it('treats the root as exactly the root', () => {
    // `/` is a prefix of everything, so a dashboard entry that stayed lit on
    // every page would make the highlight meaningless.
    expect(active(item('/'), '/')).toBe(true);
    expect(active(item('/'), '/apps')).toBe(false);
  });

  it('never highlights an entry with no path', () => {
    expect(active({ id: 'group', title: 'Group' } as LayoutNavItem, '/apps')).toBe(false);
  });
});

describe('selectionPrefix', () => {
  it('spans a disjoint URL space', () => {
    // The case it exists for: one entry covering both `/communities` and the
    // short `/c/:slug` permalinks.
    const nav = item('/communities', { selectionPrefix: ['/communities', '/c/'] });

    expect(active(nav, '/c/abc')).toBe(true);
    expect(active(nav, '/communities/new')).toBe(true);
  });

  it('accepts a single string as well as an array', () => {
    expect(active(item('/x', { selectionPrefix: '/c/' }), '/c/abc')).toBe(true);
  });

  it('matches as a raw prefix, unlike the deep match', () => {
    // Deliberately different from deep matching, which stops at a segment
    // boundary: a selectionPrefix of `/comm` DOES light up on
    // `/communities`. Pinned because the asymmetry is easy to trip over —
    // write the prefix without its trailing slash and it will match more
    // than intended.
    expect(active(item('/x', { selectionPrefix: '/comm' }), '/communities')).toBe(true);
    expect(active(item('/x', { selectionPrefix: '/comm/' }), '/communities')).toBe(false);
  });
});
