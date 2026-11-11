import { describe, it, expect } from 'vitest';
import { parseDocument, toHtmlSsr, toCleanMarkdown, toTipTapDoc, compileTypst } from '@omnitron-dev/lumen-ast';

describe('Feature 10: Multi-Target Transformers', () => {
  const sampleDoc = `---
id: doc-transforms
title: Quantum Operators
status: canonical
---

# Quantum Operators

The operator $\\hat{H}\\psi = E\\psi$ governs the energy spectrum.
`;

  it('TC-F10-01: transforms AST to static HTML via toHtmlSsr', async () => {
    const ast = await parseDocument(sampleDoc, 'docs/transforms.pdx');
    const html = toHtmlSsr(ast);

    expect(html).toContain('<article class="lumen-doc"');
    expect(html).toContain('data-status="canonical"');
    expect(html).toContain('Quantum Operators');
  });

  it('TC-F10-02: transforms AST to clean markdown via toCleanMarkdown', async () => {
    const ast = await parseDocument(sampleDoc, 'docs/transforms.pdx');
    const cleanMd = toCleanMarkdown(ast);

    expect(cleanMd).toContain('# Quantum Operators');
    expect(cleanMd).toContain('\\hat{H}\\psi = E\\psi');
    expect(typeof cleanMd).toBe('string');
  });

  it('TC-F10-03: transforms AST to TipTap document schema via toTipTapDoc', async () => {
    const ast = await parseDocument(sampleDoc, 'docs/transforms.pdx');
    const tipTapDoc = toTipTapDoc(ast);

    expect(tipTapDoc).toHaveProperty('type', 'doc');
    expect(Array.isArray(tipTapDoc.content)).toBe(true);
  });

  it('TC-F10-04: transforms AST to Typst format via compileTypst', async () => {
    const ast = await parseDocument(sampleDoc, 'docs/transforms.pdx');
    const typstBuffer = await compileTypst(ast, { title: 'Quantum Operators', paperSize: 'a4' });

    expect(typstBuffer instanceof Uint8Array).toBe(true);
    const typstSource = new TextDecoder().decode(typstBuffer);
    expect(typstSource).toContain('= Quantum Operators');
    expect(typstSource).toContain('#set page(paper: "a4")');
  });

  it('TC-F10-05: guarantees core content integrity across all four emitter targets', async () => {
    const ast = await parseDocument(sampleDoc, 'docs/transforms.pdx');

    const html = toHtmlSsr(ast);
    const cleanMd = toCleanMarkdown(ast);
    const tipTap = toTipTapDoc(ast);
    const typstBuffer = await compileTypst(ast);
    const typstText = new TextDecoder().decode(typstBuffer);

    expect(html).toContain('Quantum Operators');
    expect(cleanMd).toContain('Quantum Operators');
    expect(JSON.stringify(tipTap)).toContain('Quantum Operators');
    expect(typstText).toContain('Quantum Operators');
  });
});
