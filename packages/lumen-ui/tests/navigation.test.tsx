import { describe, it, expect, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { LumenNavbar, LumenFooter, DocPagination, DocSectionNav, DocLayout } from '../src/navigation/index.js';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe('Navigation Layout Components', () => {
  it('renders native links and invokes search through a mounted shared button', async () => {
    const search = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<LumenNavbar title="Quantum Framework"
        logo={{ src: '/logo.svg', alt: 'Quantum Logo', href: '/home' }}
        items={[{ label: 'Docs', to: '/docs', active: true }, { label: 'GitHub', href: 'https://github.com', external: true }]}
        onSearchClick={search} />));
      expect(container.querySelector('nav')?.getAttribute('aria-label')).toBe('Main navigation');
      expect(container.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('/docs');
      expect(container.querySelector('a[href="https://github.com"]')?.getAttribute('rel')).toBe('noopener noreferrer');
      const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent === 'Search')!;
      await act(async () => button.click());
      expect(search).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('keeps version and locale controls disabled when their changes have no handler', () => {
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(<LumenNavbar versions={['v1.0', 'v2.0']} currentVersion="v2.0"
      locales={['en', 'de']} currentLocale="de" />);
    const controls = container.querySelectorAll('[role="combobox"]');
    expect(controls).toHaveLength(2);
    for (const control of controls) expect(control.getAttribute('aria-disabled')).toBe('true');
    expect(controls[0]?.textContent).toBe('v2.0');
    expect(controls[1]?.textContent).toBe('de');
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

  it('renders semantic pagination with mirrored slots and single-side links', () => {
    const emptyHtml = renderToStaticMarkup(DocPagination({}));
    expect(emptyHtml).toContain('aria-label="Docs pagination"');
    expect(emptyHtml).not.toContain('href=');

    const prevOnly = renderToStaticMarkup(DocPagination({ prev: { label: 'Intro', href: '/intro' } }));
    expect(prevOnly).toContain('rel="prev"');
    expect(prevOnly).not.toContain('rel="next"');
    const previousLink = prevOnly.slice(prevOnly.indexOf('<a '));
    expect(previousLink.indexOf('lumen-pagination-arrow')).toBeLessThan(previousLink.indexOf('lumen-pagination-label'));
    const nextOnly = renderToStaticMarkup(DocPagination({ next: { label: 'Start', href: '/start' } }));
    expect(nextOnly).toContain('rel="next"');
    expect(nextOnly).not.toContain('rel="prev"');
    // Exclude Emotion's selector when checking the actual named slot order.
    const link = nextOnly.slice(nextOnly.indexOf('<a '));
    expect(link.indexOf('lumen-pagination-label')).toBeLessThan(link.indexOf('lumen-pagination-arrow'));
    expect(link).toContain('aria-hidden="true"');
    expect(link).toContain('>Next</span>');
    expect(previousLink).toContain('>Previous</span>');
  });

  it('localizes the landmark and both native links before hydration', () => {
    const html = renderToStaticMarkup(<DocPagination
      labels={{ navigation: 'Навигация по документации', previous: 'Назад', next: 'Далее' }}
      prev={{ href: '/one', label: 'Обзор' }} next={{ href: '/three', label: 'Модули' }} />);
    expect(html).toContain('aria-label="Навигация по документации"');
    expect(html).toMatch(/href="\/one"[^>]*rel="prev"[^>]*>.*>Назад<\/span>.*>Обзор<\/span>.*?<\/a>/);
    expect(html).toMatch(/href="\/three"[^>]*rel="next"[^>]*>.*>Далее<\/span>.*>Модули<\/span>.*?<\/a>/);
  });

  it('renders native SSR section links and an explicitly controlled current section', () => {
    const emptyHtml = renderToStaticMarkup(React.createElement(DocSectionNav, { headings: [] }));
    expect(emptyHtml).toBe('<div><aside class="lumen-section-nav" aria-label="Table of contents"><ul></ul></aside></div>');

    const withHeadings = renderToStaticMarkup(
      React.createElement(DocSectionNav, {
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
    expect(withHeadings).toContain('href="#h2" aria-current="location"');
    expect(withHeadings.match(/aria-current=/g)).toHaveLength(1);
    const uncontrolled = renderToStaticMarkup(React.createElement(DocSectionNav, {
      headings: [{ id: 'Раздел #1', title: 'Section', level: 2 }],
    }));
    expect(uncontrolled).toContain('href="#%D0%A0%D0%B0%D0%B7%D0%B4%D0%B5%D0%BB%20%231"');
    expect(uncontrolled).not.toContain('aria-current');
  });

  it('renders DocLayout with sidebar, content, and sectionNav', () => {
    const html = renderToStaticMarkup(
      <DocLayout sidebar={<div id="test-sidebar">Sidebar</div>} sectionNav={<div id="test-toc">ToC</div>}>
        <article>Main Article</article>
      </DocLayout>
    );

    expect(html).toContain('class="lumen-doc-layout"');
    expect(html).toContain('class="lumen-doc-sidebar"');
    expect(html).toContain('class="lumen-doc-main"');
    expect(html).toContain('class="lumen-doc-toc"');
    expect(html).toContain('Main Article');
  });
});
