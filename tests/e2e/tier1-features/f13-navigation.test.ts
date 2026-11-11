import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LumenNavbar, LumenFooter, DocPagination, DocSectionNav } from '@omnitron-dev/lumen-ui';

describe('Feature 13: Documentation Navigation System', () => {
  it('TC-F13-01: renders LumenNavbar with title and navigation items', () => {
    const html = renderToStaticMarkup(
      React.createElement(LumenNavbar, {
        title: 'Lumen Platform',
        items: [
          { label: 'Documentation', to: '/docs' },
          { label: 'API Reference', to: '/api' },
        ],
      })
    );

    expect(html).toContain('class="lumen-navbar"');
    expect(html).toContain('Lumen Platform');
    expect(html).toContain('href="/docs"');
    expect(html).toContain('href="/api"');
  });

  it('TC-F13-02: renders LumenNavbar with optional search button trigger', () => {
    const html = renderToStaticMarkup(
      React.createElement(LumenNavbar, {
        title: 'Searchable Docs',
        onSearchClick: () => {},
      })
    );

    expect(html).toContain('class="lumen-navbar-search-btn"');
    expect(html).toContain('Search');
  });

  it('TC-F13-03: renders DocPagination with previous and next navigation links', () => {
    const html = renderToStaticMarkup(
      React.createElement(DocPagination, {
        prev: { label: 'Getting Started', href: '/getting-started' },
        next: { label: 'Core Concepts', href: '/concepts' },
      })
    );

    expect(html).toContain('class="lumen-pagination"');
    expect(html).toContain('href="/getting-started"');
    expect(html).toContain('href="/concepts"');
    expect(html).toContain('Getting Started');
    expect(html).toContain('Core Concepts');
  });

  it('TC-F13-04: renders DocSectionNav with heading table of contents links', () => {
    const html = renderToStaticMarkup(
      React.createElement(DocSectionNav, {
        headings: [
          { id: 'sec-overview', title: 'System Overview', level: 2 },
          { id: 'sec-install', title: 'Installation Guide', level: 3 },
        ],
      })
    );

    expect(html).toContain('class="lumen-section-nav"');
    expect(html).toContain('href="#sec-overview"');
    expect(html).toContain('href="#sec-install"');
    expect(html).toContain('System Overview');
    expect(html).toContain('Installation Guide');
  });

  it('TC-F13-05: renders LumenFooter with copyright notice', () => {
    const html = renderToStaticMarkup(
      React.createElement(LumenFooter, {
        copyright: '© 2026 LuxQuant Omnitron. All rights reserved.',
      })
    );

    expect(html).toContain('class="lumen-footer"');
    expect(html).toContain('© 2026 LuxQuant Omnitron');
  });
});
