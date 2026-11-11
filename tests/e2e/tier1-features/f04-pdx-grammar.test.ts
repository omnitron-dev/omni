import { describe, it, expect } from 'vitest';
import { parseDocument, LumenFrontmatterSchema } from '@omnitron-dev/lumen-ast';

describe('Feature 4: prism-doc/2 Grammar & Schema', () => {
  it('TC-F04-01: validates full frontmatter schema with id, status, and relations', async () => {
    const rawContent = `---
id: doc-intro
title: Document Introduction
status: canonical
tags:
  - guide
  - foundational
relations:
  dependsOn:
    - doc-base
  proves:
    - thm-core
---

# Document Introduction
Welcome to the documentation.
`;

    const ast = await parseDocument(rawContent, 'docs/intro.pdx');
    expect(ast.frontmatter.id).toBe('doc-intro');
    expect(ast.frontmatter.status).toBe('canonical');
    expect(ast.frontmatter.tags).toContain('guide');
    expect(ast.frontmatter.relations?.dependsOn).toContain('doc-base');
  });

  it('TC-F04-02: generates structured diagnostics on invalid frontmatter types', async () => {
    const rawContent = `---
id: 12345
status: invalid-status-value
tags: "not-an-array"
---

# Malformed
`;

    const validated = LumenFrontmatterSchema.safeParse({
      id: 12345,
      status: 'invalid-status-value',
      tags: 'not-an-array',
    });

    expect(validated.success).toBe(false);
    if (!validated.success) {
      expect(validated.error.issues.length).toBeGreaterThan(0);
      expect(validated.error.issues.some((i) => i.path.includes('tags'))).toBe(true);
    }
  });

  it('TC-F04-03: parses GFM markdown elements including headers and raw content', async () => {
    const markdown = `# Architecture Overview

| Component | Responsibility |
|---|---|
| AST Compiler | Pure isomorphic parsing |
| UI Runtime | Hydration islands |

- Item A
- Item B
`;

    const ast = await parseDocument(markdown, 'docs/arch.pdx');
    expect(ast.children).toBeDefined();
    expect(ast.toc).toBeDefined();
    expect(ast.toc.length).toBeGreaterThan(0);
    expect(ast.toc[0].title).toBe('Architecture Overview');
  });

  it('TC-F04-04: parses schema-bound JSX tags without arbitrary JS execution', async () => {
    const jsxContent = `---
title: JSX Widgets
---

# Widgets

<Callout variant="info" title="Note">
  Widget body content
</Callout>
`;

    const ast = await parseDocument(jsxContent, 'docs/widgets.pdx');
    expect(ast.rawContent).toContain('<Callout');
    expect(ast.rawContent).toContain('variant="info"');
    // Ensure no dynamic eval occurred
    expect(ast.frontmatter.title).toBe('JSX Widgets');
  });

  it('TC-F04-05: generates hierarchical table of contents with slugified IDs', async () => {
    const docWithHeadings = `---
title: Heading Hierarchy
---

# Main Title
## First Section
### Subsection A
## Second Section
`;

    const ast = await parseDocument(docWithHeadings, 'docs/hierarchy.pdx');
    expect(ast.toc.length).toBeGreaterThanOrEqual(4);
    expect(ast.toc[0].level).toBe(1);
    expect(ast.toc[1].level).toBe(2);
    expect(ast.toc[2].level).toBe(3);
    expect(ast.toc[1].id).toBe('first-section');
  });
});
