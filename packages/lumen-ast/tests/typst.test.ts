import { describe, it, expect } from 'vitest';
import { parseDocument, toTypst, projectDocumentAccess, createDocumentAccessPredicate } from '../src/index.js';
import { compileTypst } from '../src/typst/index.js';
import { inspectPdf } from './pdf-oracle.js';

describe('real Typst PDF output', () => {
  it('embeds Unicode fonts, mathematical layout and deterministic content on the requested paper', async () => {
    const ast = await parseDocument(String.raw`---
title: Спектральная теория
---
# Einführung — Γειά
Теорема сохраняет кириллицу. The fraction is $\frac{1}{2}$.

:::theorem{id="spectral" title="Теорема"}
An actual integral: $\int_0^1 x^2 \, dx$.
:::
`, 'paper.pdx');
    const bytes = await compileTypst(ast, { paperSize: 'us-letter', author: 'А. Колмогоров', lang: 'ru' });
    expect(bytes).toEqual(await compileTypst(ast, { paperSize: 'us-letter', author: 'А. Колмогоров', lang: 'ru' }));
    const pdf = await inspectPdf(bytes);
    expect(pdf.text).toContain('Спектральная теория');
    expect(pdf.text).toContain('Теорема сохраняет кириллицу');
    expect(pdf.text).toContain('Колмогоров');
    expect(pdf.text).toContain('Einführung');
    expect(pdf.text).toContain('Γειά');
    expect(pdf.text).not.toContain('\\frac');
    expect(pdf.pages[0]!.width).toBeCloseTo(612, 1);
    expect(pdf.pages[0]!.height).toBeCloseTo(792, 1);
    const numbers = pdf.pages.flatMap((page) => page.items).filter((item) => 'str' in item && (item.str === '1' || item.str === '2'));
    expect(numbers.length).toBeGreaterThanOrEqual(2);
    const heights = numbers.map((item) => 'transform' in item ? item.transform[5] : 0);
    expect(new Set(heights).size).toBeGreaterThan(1);
  });

  it('preserves the end of long paragraphs and multi-page theorem bodies', async () => {
    const paragraphs = Array.from({ length: 100 }, (_, i) => `PARAGRAPH${i} — ${'Content requiring real pagination. '.repeat(7)}`);
    const ast = await parseDocument(`# Pagination\n\n:::theorem{id="long" title="Long proof"}\n${paragraphs.join('\n\n')}\n\nFINAL_SENTINEL_998877\n:::`);
    const pdf = await inspectPdf(await compileTypst(ast));
    expect(pdf.pages.length).toBeGreaterThan(3);
    expect(pdf.text).toContain('PARAGRAPH0');
    expect(pdf.text).toContain('PARAGRAPH99');
    expect(pdf.text).toContain('FINAL_SENTINEL_998877');
  });

  it('typesets author text literally and rejects mathematical code injection and unsupported commands', async () => {
    const ast = await parseDocument('# Literal\n\nText #read("/etc/passwd") and \\#eval("1") and /* unchanged */.');
    const pdf = await inspectPdf(await compileTypst(ast, { title: '] #panic("injected") [' }));
    expect(pdf.text).toContain('#panic');
    expect(pdf.text).toContain('#read');
    expect(pdf.text).not.toContain('root:');
    for (const math of ['#read("/etc/passwd")', '\\unknown{a}', '\\text{#read("/etc/passwd")}']) {
      const hostile = await parseDocument(`$${math}$`);
      await expect(compileTypst(hostile)).rejects.toThrow();
    }
  });

  it('links to Unicode theorem labels and refuses missing glyphs explicitly', async () => {
    const ast = await parseDocument(':::theorem{id="spectral" title="Спектральная"}\nThe proof.\n:::\n\nSee @thm:spectral.');
    expect((await inspectPdf(await compileTypst(ast))).text).toContain('@thm:spectral');
    await expect(compileTypst(await parseDocument('日本語'))).rejects.toThrow('Missing PDF font glyphs');
  });

  it('keeps a fully redacted projection empty and never re-parses the raw source', async () => {
    const ast = await parseDocument('PUBLIC\n\n:::note{access="confidential"}\nPRIVATE_PAYLOAD\n:::');
    const projected = projectDocumentAccess(ast, createDocumentAccessPredicate());
    expect(projected.allowed).toBe(true);
    const pdf = await inspectPdf(await compileTypst(projected.ast));
    expect(pdf.text).not.toContain('PRIVATE_PAYLOAD');
    expect(toTypst({ ...ast, children: [], rawContent: 'PRIVATE_PAYLOAD' })).not.toContain('PRIVATE_PAYLOAD');
  });

  it('exposes compile failure, cancellation and timeout without a substitute PDF', async () => {
    const ast = await parseDocument('Valid document');
    await expect(compileTypst(ast, { paperSize: 'unknown-paper' })).rejects.toThrow('Typst compilation failed');
    await expect(compileTypst(ast, { timeoutMs: 1 })).rejects.toThrow('exceeded');
    const controller = new AbortController();
    const run = compileTypst(ast, { signal: controller.signal }); controller.abort(new Error('cancelled'));
    await expect(run).rejects.toThrow('cancelled');
    expect((await inspectPdf(await compileTypst(ast))).text).toContain('Valid document');
  });
});
