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

  it('never resurrects rawContent and rejects documents without their required AST children', () => {
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

    const invalidAst = {
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

    for (const transform of [toCleanMarkdown, toHtmlSsr, toTipTapDoc, toTypst]) {
      expect(() => transform(invalidAst)).toThrow(TypeError);
    }
  });

  it('keeps projected island content without serializing interaction metadata into Markdown', async () => {
    const ast = await parseDocument('<section data-lumen-island="private-runtime-id" data-props="{&quot;token&quot;:&quot;canary&quot;}"><span>Document fallback</span><script data-lumen-island="nested">NESTED_CANARY</script></section>');
    const markdown = toCleanMarkdown(ast);
    expect(markdown).toContain('Document fallback');
    expect(markdown).not.toMatch(/private-runtime-id|data-props|canary|NESTED_CANARY|data-lumen-island/);
  });

  it.each(['script', 'style', 'textarea', 'template', 'noscript', 'iframe', 'svg'])(
    'does not unwrap prohibited %s content disguised as an island', async (tag) => {
      const content = tag === 'svg' ? '<text>HIDDEN_CANARY</text>' : '<img src="x" onerror="CANARY()">HIDDEN_CANARY';
      const ast = await parseDocument(`Before\n\n<${tag} data-lumen-island="widget">${content}</${tag}>\n\nAfter`);
      const markdown = toCleanMarkdown(ast);
      expect(markdown).toContain('Before');
      expect(markdown).toContain('After');
      expect(markdown).not.toMatch(/CANARY|onerror|<img/);
    }
  );

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
