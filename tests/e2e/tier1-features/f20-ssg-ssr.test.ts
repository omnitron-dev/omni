import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LumenShell } from '@omnitron-dev/lumen-ui';
import { parseDocument, toHtmlSsr } from '@omnitron-dev/lumen-ast';

describe('Feature 20: Static HTML & Emotion SSR', () => {
  it('TC-F20-01: generates static HTML article markup from parsed document AST', async () => {
    const doc = `---
title: SSG Page
---

# Page Heading
Static content rendered for SSG distribution.
`;

    const ast = await parseDocument(doc, 'docs/page.pdx');
    const html = toHtmlSsr(ast);

    expect(html).toContain('<article class="lumen-doc"');
    expect(html).toContain('Page Heading');
    expect(html).toContain('Static content rendered');
  });

  it('TC-F20-02: renders critical theme data attribute on root shell container', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        LumenShell,
        { theme: 'dark', locale: 'en' },
        React.createElement('main', { id: 'lumen-main' }, 'Main Body')
      )
    );

    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('id="lumen-main"');
  });

  it('TC-F20-03: formats OpenGraph and SEO metadata from frontmatter properties', async () => {
    const doc = `---
title: SEO Title
description: High-level overview of distributed SSG architecture
---

Content.
`;

    const ast = await parseDocument(doc, 'docs/seo.pdx');
    expect(ast.frontmatter.title).toBe('SEO Title');
    expect(ast.frontmatter.description).toContain('High-level overview');
  });

  it('TC-F20-04: ensures HTML shell wrapper produces valid semantic container tags', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        'html',
        { lang: 'en' },
        React.createElement('head', null, React.createElement('title', null, 'Lumen Docs')),
        React.createElement('body', null, React.createElement(LumenShell, { theme: 'light' }, 'SSR Content'))
      )
    );

    expect(html).toMatch(/^<html lang="en">/);
    expect(html).toContain('<head><title>Lumen Docs</title></head>');
    expect(html).toContain('data-theme="light"');
  });

  it('TC-F20-05: escapes HTML special characters in frontmatter titles during SSR', async () => {
    const doc = `---
title: "A <B> & 'C' \\"Test\\""
---

Body.
`;

    const ast = await parseDocument(doc, 'docs/escape.pdx');
    const html = toHtmlSsr(ast);

    expect(html).not.toContain('<B>');
    expect(html).toContain('&lt;B&gt;');
    expect(html).toContain('&amp;');
  });
});
