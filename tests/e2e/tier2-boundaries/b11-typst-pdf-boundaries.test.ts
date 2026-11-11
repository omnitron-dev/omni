import { describe, it, expect } from 'vitest';
import { parseDocument, compileTypst } from '@omnitron-dev/lumen-ast';

describe('Feature 11: Typst Academic PDF Compiler Boundaries', () => {
  it('TC-B11-01: handles custom or non-standard paper size options safely', async () => {
    const doc = `---
title: Custom Paper Document
---

Preprint on custom paper dimension.
`;

    const ast = await parseDocument(doc, 'docs/custom-paper.pdx');
    const buffer = await compileTypst(ast, { paperSize: 'b5' });

    expect(buffer).toBeDefined();
    expect(buffer.byteLength).toBeGreaterThan(0);
    const typstText = new TextDecoder().decode(buffer);
    expect(typstText).toContain('paper: "b5"');
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

    expect(buffer.byteLength).toBeGreaterThan(0);
    const typstText = new TextDecoder().decode(buffer);
    expect(typstText).toContain('E = mc^2');
  });

  it('TC-B11-03: compiles massive 100-page academic document with 200 theorem environments', async () => {
    const blocks: string[] = ['---\ntitle: Massive 100-Page Mathematical Treatise\n---\n'];
    const count = 200;
    for (let i = 0; i < count; i++) {
      blocks.push(
        `:::theorem{id="thm-${i}" title="Spectral Lemma ${i}"}\n` +
          `Let $\\mathcal{H}_{${i}}$ be a separable Hilbert space. Operator $T_{${i}}$ is trace-class.\n` +
          `:::`
      );
    }
    const massiveDoc = blocks.join('\n\n');

    const startTime = Date.now();
    const ast = await parseDocument(massiveDoc, 'docs/massive-treatise.pdx');
    const buffer = await compileTypst(ast, { title: 'Massive Treatise', paperSize: 'a4' });
    const elapsed = Date.now() - startTime;

    expect(buffer.byteLength).toBeGreaterThan(10_000);
    expect(elapsed).toBeLessThan(5_000);

    const typstText = new TextDecoder().decode(buffer);
    expect(typstText).toContain('Spectral Lemma 199');
  });

  it('TC-B11-04: compiles document with zero headings and zero theorems', async () => {
    const minimalDoc = 'Plain paragraph text without frontmatter or formal math environments.';

    const ast = await parseDocument(minimalDoc, 'docs/minimal.pdx');
    const buffer = await compileTypst(ast);

    expect(buffer.byteLength).toBeGreaterThan(0);
    const typstText = new TextDecoder().decode(buffer);
    expect(typstText).toContain('Plain paragraph text');
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

    expect(buffer.byteLength).toBeGreaterThan(0);
    const typstText = new TextDecoder().decode(buffer);
    expect(typstText).toContain('Quantum & Relativity');
  });
});
