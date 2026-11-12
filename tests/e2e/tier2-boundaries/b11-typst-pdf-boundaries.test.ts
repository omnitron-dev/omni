import { describe, it, expect } from 'vitest';
import { parseDocument } from '@omnitron-dev/lumen-ast';
import { compileTypst } from '@omnitron-dev/lumen-ast/typst';
import { inspectPdf } from '../../../packages/lumen-ast/tests/pdf-oracle.js';

describe('Feature 11: Typst Academic PDF Compiler Boundaries', () => {
  it('TC-B11-01: handles custom or non-standard paper size options safely', async () => {
    const doc = `---
title: Custom Paper Document
---

Preprint on custom paper dimension.
`;

    const ast = await parseDocument(doc, 'docs/custom-paper.pdx');
    const buffer = await compileTypst(ast, { paperSize: 'iso-b5' });

    const pdf = await inspectPdf(buffer);
    expect(pdf.text).toContain('Custom Paper Document');
    expect(pdf.pages[0]!.width).toBeCloseTo(498.9, 1);
    expect(pdf.pages[0]!.height).toBeCloseTo(708.66, 1);
    await expect(compileTypst(ast, { paperSize: 'unknown-paper' })).rejects.toThrow('Typst compilation failed');
  });

  it('TC-B11-02: compiles document with unclosed math equation delimiters without crashing', async () => {
    const doc = `---
title: Unclosed Math Typst
---

Equation with unclosed formula delimiter:
$E = mc^2 + \\int_0^1 f(x)dx
Follow-up paragraph.
`;

    const ast = await parseDocument(doc, 'docs/unclosed-math.pdx');
    const buffer = await compileTypst(ast);

    const pdf = await inspectPdf(buffer);
    expect(pdf.text).toContain('E = mc^2');
    expect(pdf.text).toContain('Follow-up paragraph.');
  });

  it('TC-B11-03: paginates 200 theorem environments without dropping the first or last one', async () => {
    const blocks: string[] = ['---\ntitle: Mathematical Treatise\n---\n'];
    const count = 200;
    for (let i = 0; i < count; i++) {
      blocks.push(
        `:::theorem{id="thm-${i}" title="Spectral Lemma ${i}"}\n` +
          `Lemma ${i} starts here. Let $\\mathcal{H}_{${i}}$ be a separable Hilbert space. Operator $T_{${i}}$ is trace-class. Lemma conclusion ${i}.\n` +
          `:::`
      );
    }
    const massiveDoc = blocks.join('\n\n');

    const ast = await parseDocument(massiveDoc, 'docs/massive-treatise.pdx');
    const buffer = await compileTypst(ast, { title: 'Massive Treatise', paperSize: 'a4' });
    const pdf = await inspectPdf(buffer);
    expect(pdf.pages.length).toBeGreaterThan(5);
    expect(pdf.pages[0]!.text).toContain('Spectral Lemma 0');
    expect(pdf.pages.at(-1)!.text).toContain('Lemma conclusion 199.');
    expect(pdf.text.match(/Spectral Lemma \d+/g)).toEqual(Array.from({ length: count }, (_, i) => `Spectral Lemma ${i}`));
    for (const page of pdf.pages) {
      expect(page.width).toBeCloseTo(595.28, 1);
      expect(page.height).toBeCloseTo(841.89, 1);
      for (const title of page.text.matchAll(/Spectral Lemma (\d+)/g))
        expect(page.text, `Theorem ${title[1]} must stay with its first body line`).toContain(`Lemma ${title[1]} starts here.`);
    }
  });

  it('TC-B11-04: compiles document with zero headings and zero theorems', async () => {
    const minimalDoc = 'Plain paragraph text without frontmatter or formal math environments.';

    const ast = await parseDocument(minimalDoc, 'docs/minimal.pdx');
    const buffer = await compileTypst(ast);

    const pdf = await inspectPdf(buffer);
    expect(pdf.text).toContain(minimalDoc);
  });

  it('TC-B11-05: handles author and document metadata with special typographic characters', async () => {
    const doc = `---
title: "Special Characters: & < > \\" ' $"
---

Body content.
`;

    const ast = await parseDocument(doc, 'docs/author.pdx');
    const buffer = await compileTypst(ast, {
      title: 'Quantum & Relativity: A "Unified" View',
      author: "O'Connor & Müller <research@example.com>",
    });

    const pdf = await inspectPdf(buffer);
    expect(pdf.text).toContain('Quantum & Relativity');
    expect(pdf.text).toContain('Müller');
    expect(pdf.text).toContain('research@example.com');
    expect(pdf.text).toContain('Body content.');
  });
});
