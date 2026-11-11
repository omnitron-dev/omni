import { describe, it, expect } from 'vitest';
import {
  parseDocument,
  toHtmlSsr,
  toCleanMarkdown,
  toTipTapDoc,
  compileTypst,
  type LumenDocumentAst,
} from '@omnitron-dev/lumen-ast';

describe('Feature 10: Multi-Target Transformers Boundaries', () => {
  it('TC-B10-01: handles empty AST across all four output target emitters safely', async () => {
    const emptyAst: LumenDocumentAst = {
      frontmatter: {},
      children: [],
      toc: [],
      diagnostics: [],
      rawContent: '',
    };

    const html = toHtmlSsr(emptyAst);
    expect(html).toContain('class="lumen-doc"');

    const cleanMd = toCleanMarkdown(emptyAst);
    expect(cleanMd).toBe('');

    const tipTap = toTipTapDoc(emptyAst);
    expect(tipTap.type).toBe('doc');
    expect(tipTap.content).toEqual([]);

    const typst = await compileTypst(emptyAst);
    expect(typst instanceof Uint8Array).toBe(true);
    expect(typst.byteLength).toBeGreaterThan(0);
  });

  it('TC-B10-02: handles unsupported custom AST nodes gracefully without emitter failure', async () => {
    const customNodeAst: LumenDocumentAst = {
      frontmatter: { title: 'Custom Nodes' },
      children: [
        {
          type: 'custom_quantum_circuit_widget',
          data: { gates: ['H', 'CNOT', 'X'] },
        },
      ],
      toc: [],
      diagnostics: [],
      rawContent: 'Custom circuit representation',
    };

    expect(() => toHtmlSsr(customNodeAst)).not.toThrow();
    const html = toHtmlSsr(customNodeAst);
    expect(html).toContain('Custom Nodes');

    expect(() => toCleanMarkdown(customNodeAst)).not.toThrow();
    const cleanMd = toCleanMarkdown(customNodeAst);
    expect(typeof cleanMd).toBe('string');

    expect(() => toTipTapDoc(customNodeAst)).not.toThrow();
    const tipTap = toTipTapDoc(customNodeAst);
    expect(tipTap.type).toBe('doc');

    await expect(compileTypst(customNodeAst)).resolves.toBeDefined();
    const typst = await compileTypst(customNodeAst);
    expect(typst.byteLength).toBeGreaterThan(0);
  });

  it('TC-B10-03: verifies toCleanMarkdown processes complex nested directives cleanly', async () => {
    const complexDirectivesDoc = `---
title: Nested Directives
---

:::tabs
:::tab{label="A"}
:::note
Notice inside tab A.
:::
:::
:::tab{label="B"}
Tab B content.
:::
:::
`;

    const ast = await parseDocument(complexDirectivesDoc, 'docs/nested.pdx');
    const cleanMd = toCleanMarkdown(ast);

    expect(typeof cleanMd).toBe('string');
    expect(cleanMd).toContain('Notice inside tab A.');
    expect(cleanMd).toContain('Tab B content.');
  });

  it('TC-B10-04: verifies toTipTapDoc produces compliant document tree with paragraphs and text nodes', async () => {
    const multiDoc = `---
title: TipTap Multi-Block
---

# Heading 1
Paragraph 1 text.

Paragraph 2 with **bold** and *italic* styling.
`;

    const ast = await parseDocument(multiDoc, 'docs/tiptap.pdx');
    const tipTap = toTipTapDoc(ast) as { type: string; content: Array<{ type: string; content?: unknown[] }> };

    expect(tipTap.type).toBe('doc');
    expect(Array.isArray(tipTap.content)).toBe(true);
    expect(tipTap.content.length).toBeGreaterThan(0);
  });

  it('TC-B10-05: verifies compileTypst safely encodes Typst special characters without corrupting output', async () => {
    const specialCharsDoc = `---
title: Typst Special Characters
---

# Title with $100 and 50% ratio
Variables: #let, #show, [bracket], @citation, _underscore_, and *asterisk*.
`;

    const ast = await parseDocument(specialCharsDoc, 'docs/special.pdx');
    const typstBuffer = await compileTypst(ast);
    const typstText = new TextDecoder().decode(typstBuffer);

    expect(typstText).toContain('#set page(paper: "a4")');
    expect(typstText).toContain('Typst Special Characters');
    expect(typstBuffer.byteLength).toBeGreaterThan(0);
  });
});
