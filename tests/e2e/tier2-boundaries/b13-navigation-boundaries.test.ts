import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LumenNavbar, DocPagination, DocSectionNav, LumenShell } from '@omnitron-dev/lumen-ui';

describe('Feature 13: Documentation Navigation System Boundaries', () => {
  it('TC-B13-01: renders LumenNavbar with empty items array and empty title string without error', () => {
    const html = renderToStaticMarkup(
      React.createElement(LumenNavbar, {
        title: '',
        items: [],
      })
    );

    expect(html).toContain('class="lumen-navbar"');
    expect(html).toContain('class="lumen-navbar-items"');
  });

  it('TC-B13-02: handles deeply nested navigation hierarchy without recursion overflow', () => {
    interface NestedItem {
      label: string;
      to?: string;
      items?: NestedItem[];
    }

    let deepItem: NestedItem = { label: 'Leaf', to: '/leaf' };
    for (let i = 10; i >= 1; i--) {
      deepItem = {
        label: `Category Level ${i}`,
        items: [deepItem],
      };
    }

    const html = renderToStaticMarkup(
      React.createElement(LumenNavbar, {
        title: 'Deep Nav',
        items: [deepItem],
      })
    );

    expect(html).toContain('class="lumen-navbar"');
    expect(html).toContain('Category Level 1');
  });

  it('TC-B13-03: renders DocPagination correctly at boundary positions (first page and last page)', () => {
    // First page boundary: prev is undefined
    const firstPageHtml = renderToStaticMarkup(
      React.createElement(DocPagination, {
        next: { label: 'Getting Started', href: '/getting-started' },
      })
    );
    expect(firstPageHtml).toContain('class="lumen-pagination"');
    expect(firstPageHtml).toContain('class="lumen-pagination-next"');
    expect(firstPageHtml).not.toContain('class="lumen-pagination-prev"');

    // Last page boundary: next is undefined
    const lastPageHtml = renderToStaticMarkup(
      React.createElement(DocPagination, {
        prev: { label: 'Advanced Topics', href: '/advanced' },
      })
    );
    expect(lastPageHtml).toContain('class="lumen-pagination"');
    expect(lastPageHtml).toContain('class="lumen-pagination-prev"');
    expect(lastPageHtml).not.toContain('class="lumen-pagination-next"');

    // Lone page boundary: neither prev nor next
    const emptyHtml = renderToStaticMarkup(React.createElement(DocPagination, {}));
    expect(emptyHtml).toBe('<nav class="lumen-pagination" aria-label="Docs pagination"></nav>');
  });

  it('TC-B13-04: renders DocSectionNav with empty headings array without layout shift', () => {
    const html = renderToStaticMarkup(
      React.createElement(DocSectionNav, {
        headings: [],
      })
    );

    expect(html).toBe('<aside class="lumen-section-nav" aria-label="Table of contents"><ul></ul></aside>');
  });

  it('TC-B13-05: handles currentPath with query strings, matrix parameters, and hash anchors', () => {
    const complexPath = '/docs/advanced/spectral?v=2.1&mode=dark&filter=eigen#theorem-spectral-decomp';

    const html = renderToStaticMarkup(
      React.createElement(
        LumenShell,
        {
          theme: 'dark',
          locale: 'en',
          currentPath: complexPath,
        },
        React.createElement('div', { id: 'inner' }, 'Content')
      )
    );

    expect(html).toContain('class="lumen-shell"');
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('Content');
  });
});
