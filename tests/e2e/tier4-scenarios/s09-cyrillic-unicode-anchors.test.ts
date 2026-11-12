import { describe, it, expect } from 'vitest';
import { parseDocument, slugifyHeading, extractHeadingIdAndTitle, toHtmlSsr } from '@omnitron-dev/lumen-ast';
import { CorpusGraph } from '@omnitron-dev/lumen';
import { verifyUrlAndAnchorParity } from '@omnitron-dev/lumen-migrate';

describe('Tier 4: Scenario 09 — Cyrillic & Non-ASCII Anchor Integrity', () => {
  it('slugifies Cyrillic and Unicode headings without stripping non-ASCII characters or corrupting URLs', () => {
    const headingRu = 'Архитектура и Принципы Системы';
    const slugRu = slugifyHeading(headingRu);
    expect(slugRu).toBe('архитектура-и-принципы-системы');

    const customHeading = 'Спектральная Теория {#спектр-операторов}';
    const extracted = extractHeadingIdAndTitle(customHeading, 0);
    expect(extracted.id).toBe('спектр-операторов');
    expect(extracted.title).toBe('Спектральная Теория');
  });

  it('preserves Cyrillic in-page heading anchors in parsed document AST and SSR HTML', async () => {
    const docRu = `---
title: Документация Квантовой Теории
locale: ru
---

# Архитектура Системы

Общее описание архитектуры.

## Математический Аппарат {#математический-аппарат}

Формальные математические среды.
`;

    const ast = await parseDocument(docRu, 'docs/ru/arch.pdx');
    const html = toHtmlSsr(ast);

    expect(html).toContain('lumen-doc');
    expect(html).toContain('Архитектура Системы');
    expect(html).toContain('Математический Аппарат');
  });

  it('validates 100% parity across source and target routes with Unicode and Cyrillic anchors', () => {
    const sourceUrls = [
      '/ru/docs/arch',
      '/ru/docs/arch#архитектура-системы',
      '/ru/docs/arch#математический-аппарат',
      '/ru/docs/theorems#спектральная-теорема',
    ];

    const targetUrls = [
      '/ru/docs/arch',
      '/ru/docs/arch#архитектура-системы',
      '/ru/docs/arch#математический-аппарат',
      '/ru/docs/theorems#спектральная-теорема',
    ];

    const report = verifyUrlAndAnchorParity(sourceUrls, targetUrls);
    expect(report.passed).toBe(true);
    expect(report.anchors.total).toBe(3);
    expect(report.anchors.preserved).toBe(3);
    expect(report.anchors.missing).toHaveLength(0);
  });

  it('registers Unicode anchors in CorpusGraph and allows direct navigation resolution', () => {
    const graph = new CorpusGraph();
    graph.addDocument({
      id: 'doc-ru-theory',
      path: 'docs/ru/theory.pdx',
      title: 'Квантовая Теория',
      locale: 'ru',
      hash: 'sha-ru',
      anchors: ['архитектура-системы', 'математический-аппарат'],
      mathObjects: [],
      backlinks: [],
    });

    const doc = graph.getDocument('doc-ru-theory');
    expect(doc).toBeDefined();
    expect(doc?.anchors).toContain('архитектура-системы');
    expect(doc?.anchors).toContain('математический-аппарат');
  });
});
