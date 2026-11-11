import { describe, it, expect } from 'vitest';
import { parseDocument, compileTypst } from '@omnitron-dev/lumen-ast';

describe('Feature 11: Typst Academic PDF Compiler', () => {
  it('TC-F11-01: compiles document AST to Typst byte buffer', async () => {
    const doc = `---
title: Minimal Typst Document
---

# Introduction

This is an academic preprint.
`;

    const ast = await parseDocument(doc, 'docs/preprint.pdx');
    const buffer = await compileTypst(ast);

    expect(buffer).toBeDefined();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it('TC-F11-02: includes formal math environments in Typst output stream', async () => {
    const doc = `---
title: Formal Mathematical Typst
---

:::theorem{id="thm-spectral" title="Spectral Decomposition"}
Self-adjoint operators decompose on Hilbert spaces.
:::
`;

    const ast = await parseDocument(doc, 'docs/math-typst.pdx');
    const buffer = await compileTypst(ast);
    const text = new TextDecoder().decode(buffer);

    expect(text).toContain('Spectral Decomposition');
    expect(text).toContain('Self-adjoint operators');
  });

  it('TC-F11-03: applies document metadata and paper format configuration options', async () => {
    const doc = `---
title: Formatted Paper
---

Preprint body text.
`;

    const ast = await parseDocument(doc, 'docs/paper.pdx');
    const buffer = await compileTypst(ast, {
      title: 'Configured Academic Paper',
      paperSize: 'us-letter',
      author: 'LuxQuant Research',
    });

    const text = new TextDecoder().decode(buffer);
    expect(text).toContain('Configured Academic Paper');
    expect(text).toContain('us-letter');
  });

  it('TC-F11-04: handles document headings and sections properly in Typst markup', async () => {
    const doc = `---
title: Hierarchical Paper
---

# Abstract
Rigorous proofs.

## Methodology
Spectral projection.
`;

    const ast = await parseDocument(doc, 'docs/hierarchy.pdx');
    const buffer = await compileTypst(ast);
    const text = new TextDecoder().decode(buffer);

    expect(text).toContain('= Hierarchical Paper');
    expect(text).toContain('# Abstract');
    expect(text).toContain('## Methodology');
  });

  it('TC-F11-05: produces consistent binary output for unchanged documents', async () => {
    const doc = `---
title: Deterministic Compilation
---

Fixed text content for determinism test.
`;

    const ast = await parseDocument(doc, 'docs/det.pdx');
    const buffer1 = await compileTypst(ast);
    const buffer2 = await compileTypst(ast);

    expect(buffer1).toEqual(buffer2);
  });
});
