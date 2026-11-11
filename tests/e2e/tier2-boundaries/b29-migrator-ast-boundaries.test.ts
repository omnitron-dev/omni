import { describe, it, expect } from 'vitest';
import { parseDocument, toHtmlSsr } from '@omnitron-dev/lumen-ast';

describe('Feature 29: AST & Macro Migrator Boundaries', () => {
  it('TC-B29-01: parses unescaped curly braces in MDX prose safely without dynamic JS evaluation', async () => {
    const mdxProse = `---
title: MDX Curly Braces
---

In React JSX, we write expressions like {user.name} or {new Date().getFullYear()}.
Properties object: { a: 1, b: "two" }.
`;

    const ast = await parseDocument(mdxProse, 'docs/mdx-braces.pdx');
    expect(ast.rawContent).toContain('{user.name}');
    expect(ast.rawContent).toContain('{new Date().getFullYear()}');

    const html = toHtmlSsr(ast);
    expect(html).toContain('lumen-doc');
  });

  it('TC-B29-02: preserves Cyrillic and non-ASCII custom heading anchors {#custom-anchor} without distortion', async () => {
    const unicodeAnchorDoc = `---
title: Русская документация
---

# Начало работы

## Обзор архитектуры системы {#обзор-архитектуры}

### Квантовые вычисления {#квантовые-вычисления}
`;

    const ast = await parseDocument(unicodeAnchorDoc, 'docs/ru-anchors.pdx');
    expect(ast.rawContent).toContain('{#обзор-архитектуры}');
    expect(ast.rawContent).toContain('{#квантовые-вычисления}');
    expect(ast.toc).toHaveLength(3);
    expect(ast.toc[1].title).toContain('Обзор архитектуры системы');
  });

  it('TC-B29-03: parses deeply nested migrated Docusaurus admonitions preserving content hierarchy', async () => {
    const nestedAdmonitionsDoc = `---
title: Nested Admonitions
---

:::info
Outer info notice.

:::tip
Inner tip suggestion with *emphasis*.
:::

Follow-up paragraph inside outer admonition.
:::
`;

    const ast = await parseDocument(nestedAdmonitionsDoc, 'docs/nested-admon.pdx');
    expect(ast.rawContent).toContain(':::info');
    expect(ast.rawContent).toContain(':::tip');
    expect(ast.rawContent).toContain('Inner tip suggestion');

    const html = toHtmlSsr(ast);
    expect(html).toContain('Outer info notice');
    expect(html).toContain('Inner tip suggestion');
  });

  it('TC-B29-04: recovers document body when migrated document has unclosed frontmatter delimiter', async () => {
    const unclosedFrontmatterDoc = `---
title: Malformed Frontmatter Delimiter
sidebar_position: 5

# Body Content After Malformed Delimiter
Migrated documentation body text.
`;

    const ast = await parseDocument(unclosedFrontmatterDoc, 'docs/unclosed-fm.pdx');
    expect(ast).toBeDefined();
    expect(ast.rawContent).toBeDefined();
    expect(ast.diagnostics.length).toBeGreaterThan(0);
  });

  it('TC-B29-05: parses custom React component tags without executing arbitrary runtime code', async () => {
    const customComponentMdx = `---
title: MDX React Components
---

# Interactive Component

<DocCardList items={['/docs/intro', '/docs/guides']} />
<VersionBadge version="3.0.0" variant="experimental" />
<Highlight color="#25c2a0">Highlighted text</Highlight>
`;

    const ast = await parseDocument(customComponentMdx, 'docs/custom-components.pdx');
    expect(ast.rawContent).toContain('<DocCardList');
    expect(ast.rawContent).toContain('<VersionBadge');
    expect(ast.rawContent).toContain('<Highlight');

    const html = toHtmlSsr(ast);
    expect(html).toContain('lumen-doc');
  });
});
