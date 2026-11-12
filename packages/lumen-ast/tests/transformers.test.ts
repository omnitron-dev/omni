import { compileTypst } from '../src/typst/index.js';
import { describe, it, expect } from 'vitest';
import {
  parseDocument,
  toHtmlSsr,
  toCleanMarkdown,
  toTipTapDoc,
  toTypst,
  type LumenDocumentAst,
} from '../src/index.js';

describe('All 4 Output Target Transformers', () => {
  const sampleDoc = `---
id: doc-transforms
title: Quantum Computing Foundations
status: verified
---

# Quantum Computing Foundations

The unitary operator $U$ preserves inner product:
$$\\langle U\\psi, U\\phi \\rangle = \\langle \\psi, \\phi \\rangle$$

:::theorem{id="thm-unitary" title="Unitary Invariance"}
Unitary evolution is reversible.
:::
`;

  it('transforms AST to semantic SSR HTML', async () => {
    const ast = await parseDocument(sampleDoc, 'docs/qc.pdx');
    const html = toHtmlSsr(ast);

    expect(html).toContain('<article class="lumen-doc"');
    expect(html).toContain('data-status="verified"');
    expect(html).toContain('Quantum Computing Foundations');
    expect(html).toContain('lumen-math-theorem');
    expect(html).toContain('thm-unitary');
  });

  it('transforms AST to clean Markdown for LLMs and mirrors', async () => {
    const ast = await parseDocument(sampleDoc, 'docs/qc.pdx');
    const cleanMd = toCleanMarkdown(ast);

    expect(cleanMd).toContain('# Quantum Computing Foundations');
    expect(cleanMd).toContain('\\langle U\\psi, U\\phi \\rangle');
    expect(cleanMd).toContain('Unitary evolution is reversible.');
  });

  it('transforms AST to TipTap v3 JSON document', async () => {
    const ast = await parseDocument(sampleDoc, 'docs/qc.pdx');
    const tipTap = toTipTapDoc(ast);

    expect(tipTap.type).toBe('doc');
    expect(Array.isArray(tipTap.content)).toBe(true);
    expect(tipTap.content.some((n) => n.type === 'heading')).toBe(true);
    expect(tipTap.content.some((n) => n.type === 'mathEnvironment')).toBe(true);
  });

  it('transforms AST to Typst markup and byte buffer', async () => {
    const ast = await parseDocument(sampleDoc, 'docs/qc.pdx');
    const typstMarkup = toTypst(ast, { paperSize: 'a4', author: 'Quantum Lab' });

    expect(typstMarkup).toContain('#set page(paper: "a4")');
    expect(typstMarkup).toContain('= Quantum Computing Foundations');
    expect(typstMarkup).toContain('Quantum Lab');
    expect(typstMarkup).toContain('Unitary Invariance');

    const buffer = await compileTypst(ast, { paperSize: 'a4' });
    expect(buffer).toBeInstanceOf(Uint8Array);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('never resurrects rawContent when ast.children is an array (IA-01 redaction safety), and strips frontmatter only when children is absent', () => {
    const redactedAst: LumenDocumentAst = {
      frontmatter: { title: 'Restricted', access: 'confidential' },
      children: [],
      toc: [],
      diagnostics: [],
      rawContent: 'CONFIDENTIAL PAYLOAD THAT MUST NEVER LEAK',
    };

    expect(toHtmlSsr(redactedAst)).not.toContain('CONFIDENTIAL PAYLOAD');
    expect(toCleanMarkdown(redactedAst)).toBe('');
    expect(toTipTapDoc(redactedAst)).toEqual({ type: 'doc', content: [] });
    expect(toTypst(redactedAst)).not.toContain('CONFIDENTIAL PAYLOAD');

    const unparsedLegacyAst = {
      frontmatter: { title: 'Arbitrary Metadata Document' },
      children: undefined as unknown as LumenDocumentAst['children'],
      toc: [],
      diagnostics: [],
      rawContent: `---
customMetadataKey: "value-xyz"
arbitraryInternalTag: 9999
---

# Recovered Title
Recovered body text after generic frontmatter stripping.`,
    } satisfies LumenDocumentAst;

    const clean = toCleanMarkdown(unparsedLegacyAst);
    expect(clean).toContain('# Recovered Title');
    expect(clean).toContain('Recovered body text after generic frontmatter stripping.');
    expect(clean).not.toContain('customMetadataKey');
    expect(clean).not.toContain('arbitraryInternalTag');
  });

  it('supports node.raw in custom or unsupported AST nodes', () => {
    const rawNodeAst: LumenDocumentAst = {
      frontmatter: { title: 'Raw Node Document' },
      children: [
        {
          type: 'custom_latex_block',
          raw: 'Custom mathematical text content',
        },
      ],
      toc: [],
      diagnostics: [],
    };

    const clean = toCleanMarkdown(rawNodeAst);
    expect(clean).toBe('Custom mathematical text content');
  });

  it('formats Typst headings cleanly with source section tracing', async () => {
    const docWithHeadings = `---
title: Academic Structure
---

# Introduction
First section text.

## Background
Subsection text.

### Foundations
Subsubsection text.
`;
    const ast = await parseDocument(docWithHeadings, 'docs/academic.pdx');
    const typst = toTypst(ast);

    expect(typst).toContain('// Section: # Introduction\n= Introduction');
    expect(typst).toContain('// Section: ## Background\n== Background');
    expect(typst).toContain('// Section: ### Foundations\n=== Foundations');
    expect(typst).not.toContain('/* Heading');
    expect(typst).not.toContain('preserve markdown comments');
  });
});
