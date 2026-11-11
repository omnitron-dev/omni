import { describe, it, expect } from 'vitest';
import { parseDocument, toHtmlSsr } from '@omnitron-dev/lumen-ast';

describe('Feature 6: Smart Cross-References & Directives Boundaries', () => {
  it('TC-B06-01: handles malformed smart reference syntax and injection attempts safely', async () => {
    const malformedRefsDoc = `---
title: Malformed Smart References
---

Empty prefix: @thm:
Empty api: @api:
Colon hash: @thm:#
SQL injection attempt: @thm:valid;DROP TABLE users;--
Path traversal: @api:../../../etc/passwd
Special characters: @thm:αβγ!@#$%^&*()
`;

    const ast = await parseDocument(malformedRefsDoc, 'docs/malformed-refs.pdx');
    expect(ast).toBeDefined();
    expect(ast.rawContent).toContain('@thm:');
    expect(ast.rawContent).toContain('@thm:valid;DROP TABLE');

    const html = toHtmlSsr(ast);
    expect(html).toContain('lumen-doc');
  });

  it('TC-B06-02: parses document with unclosed admonition directive safely', async () => {
    const unclosedDoc = `---
title: Unclosed Admonition
---

:::warning
Critical system alert without closing delimiter.

Paragraph continuing after unclosed admonition.
`;

    const ast = await parseDocument(unclosedDoc, 'docs/unclosed-admon.pdx');
    expect(ast.rawContent).toContain(':::warning');

    const html = toHtmlSsr(ast);
    expect(html).toContain('Critical system alert');
  });

  it('TC-B06-03: escapes XSS payloads in directive title and attribute values in HTML SSR', async () => {
    const xssDoc = `---
title: "<script>alert('xss-frontmatter')</script>"
---

:::note{title="<script>alert('xss-directive')</script>"}
Directive body with <img src=x onerror=alert(1)> raw tag.
:::
`;

    const ast = await parseDocument(xssDoc, 'docs/xss.pdx');
    const html = toHtmlSsr(ast);

    // No unescaped executable script tags
    expect(html).not.toContain("<script>alert('xss-frontmatter')</script>");
    expect(html).not.toContain("<script>alert('xss-directive')</script>");
    expect(html).toContain('&lt;script&gt;');
  });

  it('TC-B06-04: handles extreme directive nesting depth (10 levels) without recursion overflow', async () => {
    let deeplyNestedDoc = '---\ntitle: Deeply Nested Directives\n---\n\n';
    const depth = 10;
    for (let i = 0; i < depth; i++) {
      deeplyNestedDoc += `${'  '.repeat(i)}:::container{level="${i + 1}"}\n`;
    }
    deeplyNestedDoc += `${'  '.repeat(depth)}Deeply nested content at level 10.\n`;
    for (let i = depth - 1; i >= 0; i--) {
      deeplyNestedDoc += `${'  '.repeat(i)}:::\n`;
    }

    const ast = await parseDocument(deeplyNestedDoc, 'docs/deep-nested.pdx');
    expect(ast.rawContent).toContain('level="10"');
    expect(ast.rawContent).toContain('Deeply nested content at level 10.');

    const html = toHtmlSsr(ast);
    expect(html).toContain('Deeply nested content');
  });

  it('TC-B06-05: resolves document containing dangling cross-reference to phantom ID without throwing', async () => {
    const phantomRefDoc = `---
title: Phantom Cross Reference
---

See @thm:phantom-theorem-does-not-exist and @api:UnknownPackage#phantomMethod for details.
`;

    const ast = await parseDocument(phantomRefDoc, 'docs/phantom.pdx');
    expect(ast.rawContent).toContain('@thm:phantom-theorem-does-not-exist');

    expect(() => toHtmlSsr(ast)).not.toThrow();
    const html = toHtmlSsr(ast);
    expect(html).toBeDefined();
    expect(typeof html).toBe('string');
    expect(html).toContain('lumen-doc');
    expect(html).toContain('Phantom Cross Reference');
  });
});
