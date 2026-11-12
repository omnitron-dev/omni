import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { parseDocument } from '@omnitron-dev/lumen-ast';
import { compileTypst } from '@omnitron-dev/lumen-ast/typst';
import { inspectPdf } from '../../../packages/lumen-ast/tests/pdf-oracle.js';

const executeNode = promisify(execFile);

describe('Feature 11: Typst Academic PDF Compiler', () => {
  it('TC-F11-01: typesets document AST into readable PDF pages', async () => {
    const doc = `---
title: Minimal Typst Document
---

# Introduction

This is an academic preprint.
`;

    const ast = await parseDocument(doc, 'docs/preprint.pdx');
    const buffer = await compileTypst(ast);

    const pdf = await inspectPdf(buffer);
    expect(pdf.pages).toHaveLength(1);
    expect(pdf.text).toContain('Minimal Typst Document');
    expect(pdf.text).toContain('This is an academic preprint.');
  });

  it('TC-F11-02: typesets formal math environment titles and bodies', async () => {
    const doc = `---
title: Formal Mathematical Typst
---

:::theorem{id="thm-spectral" title="Spectral Decomposition"}
Self-adjoint operators decompose on Hilbert spaces.
:::
`;

    const ast = await parseDocument(doc, 'docs/math-typst.pdx');
    const buffer = await compileTypst(ast);
    const { text } = await inspectPdf(buffer);

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

    const pdf = await inspectPdf(buffer);
    expect(pdf.text).toContain('Configured Academic Paper');
    expect(pdf.text).toContain('LuxQuant Research');
    expect(pdf.pages[0]!.width).toBeCloseTo(612, 1);
    expect(pdf.pages[0]!.height).toBeCloseTo(792, 1);
  });

  it('TC-F11-04: preserves the reading order and vertical placement of headings', async () => {
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
    const pdf = await inspectPdf(buffer);
    expect(pdf.text).toContain('Hierarchical Paper');
    expect(pdf.text).toContain('Abstract');
    expect(pdf.text).toContain('Methodology');
    const headings = pdf.pages[0]!.items.filter(item => 'str' in item && ['Abstract', 'Methodology'].includes(item.str));
    expect(headings).toHaveLength(2);
    const heights = headings.map(item => 'transform' in item ? item.transform[5] : Number.NaN);
    expect(heights[0]).toBeGreaterThan(heights[1]!);
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
    expect((await inspectPdf(buffer1)).text).toContain('Fixed text content for determinism test.');
  });

  it('TC-F11-06: loads the built Node export and packaged fonts without source aliases', async () => {
    const { stdout } = await executeNode(process.execPath, ['--input-type=module', '-e', `
      import * as ast from '@omnitron-dev/lumen-ast';
      import { compileTypst } from '@omnitron-dev/lumen-ast/typst';
      if ('compileTypst' in ast) throw new Error('Node compiler leaked into the isomorphic entry');
      const document = await ast.parseDocument('# Packaged compiler\\n\\nКириллица. Fraction: $\\\\frac{1}{2}$.');
      const pdf = await compileTypst(document);
      console.log(JSON.stringify({ entry: import.meta.resolve('@omnitron-dev/lumen-ast/typst'), pdf: Buffer.from(pdf).toString('base64') }));
    `], { cwd: resolve(import.meta.dirname, '../../../packages/lumen-ast'), timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    const result = JSON.parse(stdout) as { entry: string; pdf: string };
    expect(result.entry).toMatch(/\/dist\/typst\/index\.js$/);
    const pdf = await inspectPdf(Uint8Array.from(Buffer.from(result.pdf, 'base64')));
    expect(pdf.text).toContain('Packaged compiler');
    expect(pdf.text).toContain('Кириллица');
    expect(pdf.text).not.toContain('\\frac');
    const fraction = pdf.pages[0]!.items.filter(item => 'str' in item && (item.str === '1' || item.str === '2'));
    expect(fraction).toHaveLength(2);
    const heights = fraction.map(item => 'transform' in item ? item.transform[5] : Number.NaN);
    expect(heights[0]).toBeGreaterThan(heights[1]!);
  });
});
