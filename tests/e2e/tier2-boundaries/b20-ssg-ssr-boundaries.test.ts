import { describe, it, expect } from 'vitest';
import { parseDocument, toHtmlSsr } from '@omnitron-dev/lumen-ast';

describe('Feature 20: Static HTML & Emotion SSR Boundaries', () => {
  it('TC-B20-01: renders plain markdown document without custom styles into valid HTML article container', async () => {
    const plainDoc = `---
title: Plain Unstyled Document
---

Standard paragraph with basic CommonMark formatting.
`;

    const ast = await parseDocument(plainDoc, 'docs/plain.pdx');
    const html = toHtmlSsr(ast);

    expect(html).toContain('<article class="lumen-doc"');
    expect(html).toContain('Plain Unstyled Document');
    expect(html).toContain('Standard paragraph');
  });

  it('TC-B20-02: normalizes authored HTML and removes active content while retaining document text', async () => {
    const rawHtmlDoc = `---
title: Unclosed HTML Tags
---

<div class="unclosed" onclick="alert('handler')">
  <span>Text inside unclosed tag
<script>alert("injection")</script>
`;

    const ast = await parseDocument(rawHtmlDoc, 'docs/raw-html.pdx');
    const html = toHtmlSsr(ast);

    expect(html).toContain('<div class="unclosed">');
    expect(html).toContain('Text inside unclosed tag');
    expect(html).toContain('</span></div>');
    expect(html).not.toMatch(/<script|onclick|alert\(/);
  });

  it('TC-B20-03: renders 100 documents concurrently via Promise.all without state corruption', async () => {
    const pageCount = 100;
    const docs = Array.from({ length: pageCount }, (_, idx) => ({
      path: `docs/page-${idx}.pdx`,
      content: `---\ntitle: Concurrent Page ${idx}\n---\n\nContent for page ${idx}.`,
    }));

    const renderPromises = docs.map(async (d) => {
      const ast = await parseDocument(d.content, d.path);
      return toHtmlSsr(ast);
    });

    const results = await Promise.all(renderPromises);
    expect(results).toHaveLength(pageCount);

    for (let i = 0; i < pageCount; i++) {
      expect(results[i]).toContain(`Concurrent Page ${i}`);
      expect(results[i]).toContain(`Content for page ${i}`);
    }
  });

  it('TC-B20-04: parses and renders deepest heading level (H6) into ToC and SSR markup', async () => {
    const h6Doc = `---
title: Deep Headings
---

# Level 1
## Level 2
### Level 3
#### Level 4
##### Level 5
###### Level 6 Deepest Subsection
`;

    const ast = await parseDocument(h6Doc, 'docs/h6.pdx');
    expect(ast.toc).toHaveLength(6);
    expect(ast.toc[5].level).toBe(6);
    expect(ast.toc[5].title).toBe('Level 6 Deepest Subsection');

    const html = toHtmlSsr(ast);
    expect(html).toContain('Level 6 Deepest Subsection');
  });

  it('TC-B20-05: escapes special HTML characters in frontmatter description and title properties', async () => {
    const specialDoc = `---
title: "Physics & Chemistry <Inorganic> \\"Edition\\""
description: "High-precision calculations & observations: <T > 300K>"
---

Scientific body text.
`;

    const ast = await parseDocument(specialDoc, 'docs/special-entities.pdx');
    const html = toHtmlSsr(ast);

    expect(html).not.toContain('<Inorganic>');
    expect(html).toContain('&lt;Inorganic&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });
});
