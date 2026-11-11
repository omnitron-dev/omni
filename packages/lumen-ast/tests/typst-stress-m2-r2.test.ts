import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { parseDocument, compileTypst, toTypst } from '../src/index.js';

describe('Milestone 2 Iteration 2: Empirical Typst Stress Testing', () => {
  it('handles multiple headings at all markdown levels (h1 through h6)', async () => {
    const doc = `---
title: Multi-Level Heading Document
---

# Level 1 Heading
Paragraph under level 1.

## Level 2 Heading
Paragraph under level 2.

### Level 3 Heading
Paragraph under level 3.

#### Level 4 Heading
Paragraph under level 4.

##### Level 5 Heading
Paragraph under level 5.

###### Level 6 Heading
Paragraph under level 6.
`;

    const ast = await parseDocument(doc, 'docs/headings.pdx');
    const typst = toTypst(ast);
    const buffer = await compileTypst(ast);

    expect(buffer).toBeInstanceOf(Uint8Array);
    expect(buffer.byteLength).toBeGreaterThan(0);

    const decoded = new TextDecoder().decode(buffer);
    expect(decoded).toContain('= Level 1 Heading');
    expect(decoded).toContain('== Level 2 Heading');
    expect(decoded).toContain('=== Level 3 Heading');

    // Check how level 4-6 headings are handled
    // In Typst, level 4 would ideally be ==== Level 4 Heading
    console.log('Heading 4-6 Typst serialization:\n', typst.slice(typst.indexOf('### Level 3 Heading')));
  });

  it('handles non-ASCII, Cyrillic, Greek, CJK, and Arabic titles and section names', async () => {
    const doc = `---
id: cyrillic-spectral
title: "Спектральная Теория и Квантовая Механика"
---

# Глава 1: Пространства Гильберта и Операторы

## Раздел 1.1: Самосопряженные операторы $\\mathcal{A}$

### Подраздел 1.1.1: Спектральная мера $E(\\lambda)$

:::theorem{id="thm-spectral-ru" title="Спектральная Теорема для Неограниченных Операторов"}
Пусть $T$ — плотно определенный самосопряженный оператор в гильбертовом пространстве $\\mathcal{H}$.
Тогда существует единственная спектральная мера $E$ на $\\mathbb{R}$, такая что:
$$T = \\int_{\\mathbb{R}} \\lambda \\, dE(\\lambda)$$
:::

# 2. 日本語の章: 作用素環の基礎

## 節 2.1: フォン・ノイマン環

# 3. الفصل الثالث: نظرية المؤثرات

## 3.1 المؤثرات الترافقية
`;

    const ast = await parseDocument(doc, 'docs/multilingual.pdx');
    const buffer = await compileTypst(ast, {
      title: 'Спектральная Теория (Typst Test)',
      author: 'Академик А. Н. Колмогоров & Dr. 佐藤 幹夫',
    });

    expect(buffer).toBeInstanceOf(Uint8Array);
    expect(buffer.byteLength).toBeGreaterThan(0);

    const decoded = new TextDecoder().decode(buffer);
    expect(decoded).toContain('Спектральная Теория (Typst Test)');
    expect(decoded).toContain('Академик А. Н. Колмогоров');
    expect(decoded).toContain('Глава 1: Пространства Гильберта и Операторы');
    expect(decoded).toContain('Раздел 1.1: Самосопряженные операторы');
    expect(decoded).toContain('Спектральная мера');
    expect(decoded).toContain('Спектральная Теорема для Неограниченных Операторов');
    expect(decoded).toContain('日本語の章: 作用素環の基礎');
    expect(decoded).toContain('フォン・ノイマン環');
    expect(decoded).toContain('الفصل الثالث: نظرية المؤثرات');
    expect(decoded).toContain('المؤثرات الترافقية');
  });

  it('guarantees deterministic byte equality across 100 consecutive compileTypst runs', async () => {
    const doc = `---
id: det-stress
title: "Deterministic Compilation Stress Test"
---

# Heading A

Content for determinism testing.

:::definition{id="def-hilbert" title="Hilbert Space"}
A complete inner product space.
:::

## Heading B

More math $x^2 + y^2 = z^2$.
`;

    const ast = await parseDocument(doc, 'docs/det-stress.pdx');
    const iterations = 100;
    const hashes = new Set<string>();
    let baselineLength = 0;

    for (let i = 0; i < iterations; i++) {
      const buffer = await compileTypst(ast, {
        paperSize: 'a4',
        author: 'Verification Runner',
      });

      if (i === 0) {
        baselineLength = buffer.byteLength;
      } else {
        expect(buffer.byteLength).toBe(baselineLength);
      }

      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      hashes.add(hash);
    }

    // Exactly 1 unique hash across all 100 runs
    expect(hashes.size).toBe(1);
  });

  it('handles large document with 100 alternating headings and math environments', async () => {
    const blocks: string[] = ['---\ntitle: Scalability 100 Headings\n---\n'];
    for (let i = 1; i <= 50; i++) {
      blocks.push(`# Chapter ${i}: Theory of Structures ${i}`);
      blocks.push(`## Section ${i}.1: Rigorous Formulations`);
      blocks.push(`### Subsection ${i}.1.1: Boundary Analysis`);
      blocks.push(`:::theorem{id="thm-gen-${i}" title="General Theorem ${i}"}\nContent for theorem ${i}.\n:::`);
    }

    const doc = blocks.join('\n\n');
    const ast = await parseDocument(doc, 'docs/scale-headings.pdx');
    const start = Date.now();
    const buffer = await compileTypst(ast);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(2000);
    expect(buffer.byteLength).toBeGreaterThan(10000);

    const decoded = new TextDecoder().decode(buffer);
    expect(decoded).toContain('= Chapter 1: Theory of Structures 1');
    expect(decoded).toContain('== Section 1.1: Rigorous Formulations');
    expect(decoded).toContain('=== Subsection 1.1.1: Boundary Analysis');
    expect(decoded).toContain('General Theorem 50');
  });

  it('handles headings with special characters, quotes, inline code, and backslashes', async () => {
    const doc = `---
title: "Special Headings Document"
---

# Heading with \`inline_code()\` and "double quotes"
Paragraph.

## Heading with 'single quotes' & ampersand & symbols < > $ %
Paragraph.

### Heading with backslash \\ and math $x = \\alpha + \\beta$
Paragraph.
`;

    const ast = await parseDocument(doc, 'docs/special-headings.pdx');
    const buffer = await compileTypst(ast);
    const decoded = new TextDecoder().decode(buffer);

    expect(decoded).toContain('= Heading with `inline_code()` and "double quotes"');
    expect(decoded).toContain("== Heading with 'single quotes' & ampersand & symbols < > $ %");
    expect(decoded).toContain('=== Heading with backslash \\ and math $x = \\alpha + \\beta$');
  });
});
