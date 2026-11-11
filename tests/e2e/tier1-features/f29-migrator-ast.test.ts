import { describe, it, expect } from 'vitest';
import { parseDocument } from '@omnitron-dev/lumen-ast';

describe('Feature 29: AST & Macro Migrator', () => {
  it('TC-F29-01: parses migrated Docusaurus markdown frontmatter with sidebar_position', async () => {
    const migratedMdx = `---
id: intro
title: Welcome to Classic Docs
sidebar_position: 1
---

# Welcome
This document was migrated from Docusaurus.
`;

    const ast = await parseDocument(migratedMdx, 'docs/intro.pdx');
    expect(ast.frontmatter.id).toBe('intro');
    expect(ast.frontmatter.sidebar_position).toBe(1);
    expect(ast.frontmatter.title).toBe('Welcome to Classic Docs');
  });

  it('TC-F29-02: parses migrated Docusaurus admonition blocks', async () => {
    const doc = `---
title: Migrated Admonitions
---

:::note
This is a standard informational note.
:::

:::tip
Use pnpm for faster installation.
:::

:::warning
Legacy API v1 will be deprecated soon.
:::
`;

    const ast = await parseDocument(doc, 'docs/admonitions.pdx');
    expect(ast.rawContent).toContain(':::note');
    expect(ast.rawContent).toContain(':::tip');
    expect(ast.rawContent).toContain(':::warning');
  });

  it('TC-F29-03: preserves Docusaurus custom heading anchors {#custom-id}', async () => {
    const doc = `---
title: Anchors
---

# Welcome

## System Overview {#system-overview}

Section body.
`;

    const ast = await parseDocument(doc, 'docs/anchors.pdx');
    expect(ast.rawContent).toContain('{#system-overview}');
    expect(ast.toc).toBeDefined();
    expect(ast.toc.some((h) => h.id.includes('system-overview') || h.title.includes('system-overview'))).toBe(true);
  });

  it('TC-F29-04: parses JSX <Tabs> and <TabItem> blocks migrated from MDX', async () => {
    const mdxDoc = `---
title: Tabbed Installation
---

# Installation

<Tabs>
  <TabItem value="pnpm" label="pnpm" default>
    pnpm add my-library
  </TabItem>
  <TabItem value="npm" label="npm">
    npm install my-library
  </TabItem>
</Tabs>
`;

    const ast = await parseDocument(mdxDoc, 'docs/tabs.pdx');
    expect(ast.rawContent).toContain('<Tabs>');
    expect(ast.rawContent).toContain('<TabItem value="pnpm"');
    expect(ast.rawContent).toContain('<TabItem value="npm"');
  });

  it('TC-F29-05: parses migrated KaTeX math formulas containing macros', async () => {
    const doc = `---
title: Quantum Foundations
---

# Quantum Foundations

We consider state vectors in $\\mathcal{H}$ with inner product $\\langle \\psi | \\phi \\rangle$.
`;

    const ast = await parseDocument(doc, 'docs/quantum.pdx');
    expect(ast.rawContent).toContain('$\\mathcal{H}$');
    expect(ast.rawContent).toContain('$\\langle \\psi | \\phi \\rangle$');
  });
});
