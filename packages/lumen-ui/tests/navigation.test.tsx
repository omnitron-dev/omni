import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LumenNavbar, LumenFooter, DocPagination, DocSectionNav, DocLayout } from '../src/navigation/index.js';

describe('Navigation Layout Components', () => {
  it('renders LumenNavbar with logo, items, and search button', () => {
    let searchTriggered = false;
    const el = LumenNavbar({
      title: 'Quantum Framework',
      logo: { src: '/logo.svg', alt: 'Quantum Logo', href: '/home' },
      items: [
        { label: 'Docs', to: '/docs', active: true },
        { label: 'GitHub', href: 'https://github.com', external: true },
      ],
      onSearchClick: () => {
        searchTriggered = true;
      },
    });

    const html = renderToStaticMarkup(el);
    expect(html).toContain('Quantum Framework');
    expect(html).toContain('src="/logo.svg"');
    expect(html).toContain('href="/docs"');
    expect(html).toContain('https://github.com');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('class="lumen-navbar-search-btn"');

    // Verify search button click compatibility at children[2]
    el.props.children[2].props.onClick();
    expect(searchTriggered).toBe(true);
  });

  it('renders LumenNavbar with version and locale selectors', () => {
    const onVersion = vi.fn();
    const onLocale = vi.fn();

    const html = renderToStaticMarkup(
      LumenNavbar({
        versions: ['v1.0', 'v2.0'],
        currentVersion: 'v2.0',
        onVersionChange: onVersion,
        locales: ['en', 'de'],
        currentLocale: 'de',
        onLocaleChange: onLocale,
        onThemeToggle: () => {},
      })
    );

    expect(html).toContain('class="lumen-navbar-version-select"');
    expect(html).toContain('v2.0');
    expect(html).toContain('class="lumen-navbar-locale-select"');
    expect(html).toContain('de');
    expect(html).toContain('class="lumen-navbar-theme-btn"');
  });

  it('renders LumenFooter with columns and operational status', () => {
    const html = renderToStaticMarkup(
      LumenFooter({
        copyright: '© 2026 Omnitron',
        columns: [
          {
            title: 'Resources',
            items: [
              { label: 'Docs', href: '/docs' },
              { label: 'Blog', to: '/blog' },
            ],
          },
        ],
        status: { operational: true, label: 'All Systems Normal', url: 'https://status.omni' },
        buildMetadata: { version: '1.2.3', commit: 'abcdef1234' },
      })
    );

    expect(html).toContain('class="lumen-footer"');
    expect(html).toContain('Resources');
    expect(html).toContain('All Systems Normal');
    expect(html).toContain('v1.2.3');
    expect(html).toContain('(abcdef1)');
    expect(html).toContain('© 2026 Omnitron');
  });

  it('renders DocPagination with exact empty match and single-side links', () => {
    const emptyHtml = renderToStaticMarkup(DocPagination({}));
    expect(emptyHtml).toBe('<nav class="lumen-pagination" aria-label="Docs pagination"></nav>');

    const prevOnly = renderToStaticMarkup(DocPagination({ prev: { label: 'Intro', href: '/intro' } }));
    expect(prevOnly).toContain('class="lumen-pagination-prev"');
    expect(prevOnly).not.toContain('class="lumen-pagination-next"');
  });

  it('renders DocSectionNav with exact empty match and active heading spy', () => {
    const emptyHtml = renderToStaticMarkup(DocSectionNav({ headings: [] }));
    expect(emptyHtml).toBe('<aside class="lumen-section-nav" aria-label="Table of contents"><ul></ul></aside>');

    const withHeadings = renderToStaticMarkup(
      DocSectionNav({
        headings: [
          { id: 'h1', title: 'Header 1', level: 1 },
          { id: 'h2', title: 'Header 2', level: 2 },
        ],
        activeId: 'h2',
      })
    );
    expect(withHeadings).toContain('href="#h1"');
    expect(withHeadings).toContain('href="#h2"');
    expect(withHeadings).toContain('is-active');
  });

  it('renders DocLayout with sidebar, content, and sectionNav', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        DocLayout,
        {
          sidebar: React.createElement('div', { id: 'test-sidebar' }, 'Sidebar'),
          sectionNav: React.createElement('div', { id: 'test-toc' }, 'ToC'),
        },
        React.createElement('article', null, 'Main Article')
      )
    );

    expect(html).toContain('class="lumen-doc-layout"');
    expect(html).toContain('class="lumen-doc-sidebar"');
    expect(html).toContain('class="lumen-doc-main"');
    expect(html).toContain('class="lumen-doc-toc"');
    expect(html).toContain('Main Article');
  });
});
