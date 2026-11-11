import { describe, it, expect } from 'vitest';
import { parseDocument, compileTypst, toTypst } from '../src/index.js';

describe('Typst PDF Compiler & Determinism', () => {
  it('compiles AST to deterministic Uint8Array binary output', async () => {
    const doc = `---
title: Deterministic Paper
---

# Section 1
Content for determinism check.
`;
    const ast = await parseDocument(doc, 'docs/det.pdx');
    const b1 = await compileTypst(ast);
    const b2 = await compileTypst(ast);

    expect(b1).toEqual(b2);
    expect(b1.byteLength).toBeGreaterThan(0);
  });

  it('supports custom paper formats and academic document metadata', async () => {
    const doc = `---
title: Relativity Paper
---

# Abstract
General relativity equations.
`;
    const ast = await parseDocument(doc, 'docs/relativity.pdx');
    const buffer = await compileTypst(ast, {
      title: 'General Relativity',
      paperSize: 'us-letter',
      author: 'Albert Einstein',
    });

    const decoded = new TextDecoder().decode(buffer);
    expect(decoded).toContain('= General Relativity');
    expect(decoded).toContain('paper: "us-letter"');
    expect(decoded).toContain('Albert Einstein');
  });

  it('formats formal math environments into Typst blocks with labels', async () => {
    const doc = `---
title: Formal Typst
---

:::theorem{id="thm-noether" title="Noether Theorem"}
Continuous symmetries yield conservation laws.
:::
`;
    const ast = await parseDocument(doc, 'docs/noether.pdx');
    const typstSource = toTypst(ast);

    expect(typstSource).toContain('#block(');
    expect(typstSource).toContain('Noether Theorem');
    expect(typstSource).toContain('<thm-noether>');
    expect(typstSource).toContain('Continuous symmetries yield conservation laws.');
  });
});
