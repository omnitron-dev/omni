import { describe, it, expect } from 'vitest';
import { parseDocument, toHtmlSsr, LumenMacroRegistry } from '@omnitron-dev/lumen-ast';
import { CorpusGraph, defineCorpusGate, type GateContext, type GateResult } from '@omnitron-dev/lumen';
import { FixtureLoader } from '../harness/fixture-loader.js';

describe('Tier 4: Scenario 02 — Multilingual Academic Corpus Build', () => {
  const fixtureLoader = new FixtureLoader();

  it('builds bilingual corpus with shared KaTeX macros and preserves mathematical consistency across locales', async () => {
    await fixtureLoader.withFixture('docusaurus-multilingual', async (fixture) => {
      const macros = new LumenMacroRegistry({
        '\\norm': '\\|#1\\|',
        '\\hilbert': '\\mathcal{H}',
        '\\ket': '|#1\\rangle',
      });

      const enDoc = `---
title: Quantum Spectral Foundations
locale: en
---

# Spectral Theory

:::theorem{id="thm-hilbert-spectral" title="Spectral Theorem in Hilbert Space"}
Let $T$ be a bounded self-adjoint operator on $\\hilbert$. Then there exists a unique spectral measure.
:::
`;

      const ruDoc = `---
title: Спектральные основы квантовой теории
locale: ru
---

# Спектральная теория

:::theorem{id="thm-hilbert-spectral" title="Спектральная теорема в гильбертовом пространстве"}
Пусть $T$ — ограниченный самосопряжённый оператор в $\\hilbert$. Тогда существует единственная спектральная мера.
:::
`;

      const astEn = await parseDocument(enDoc, 'docs/spectral.en.pdx');
      const astRu = await parseDocument(ruDoc, 'docs/spectral.ru.pdx');

      const htmlEn = toHtmlSsr(astEn, { macros });
      const htmlRu = toHtmlSsr(astRu, { macros });

      expect(htmlEn).toContain('thm-hilbert-spectral');
      expect(htmlEn).toContain('Spectral Theorem in Hilbert Space');
      expect(htmlRu).toContain('thm-hilbert-spectral');
      expect(htmlRu).toContain('Спектральная теорема');

      // 2. Build CorpusGraph with locale metadata
      const graph = new CorpusGraph();
      graph.addDocument({
        id: 'doc-spectral-en',
        path: 'docs/spectral.en.pdx',
        title: 'Quantum Spectral Foundations',
        locale: 'en',
        hash: 'hash-en-1',
        anchors: ['spectral-theory', 'thm-hilbert-spectral'],
        mathObjects: [{ id: 'thm-hilbert-spectral', type: 'theorem' }],
        backlinks: [],
      });

      graph.addDocument({
        id: 'doc-spectral-ru',
        path: 'docs/spectral.ru.pdx',
        title: 'Спектральные основы квантовой теории',
        locale: 'ru',
        hash: 'hash-ru-1',
        anchors: ['спектральная-теория', 'thm-hilbert-spectral'],
        mathObjects: [{ id: 'thm-hilbert-spectral', type: 'theorem' }],
        backlinks: [],
      });

      expect(graph.size()).toBe(2);
      expect(graph.getDocument('doc-spectral-ru')?.locale).toBe('ru');

      // 3. Multilingual Parity Gate
      const multilingualGate = defineCorpusGate({
        name: 'multilingual-math-parity-gate',
        run(context: GateContext): GateResult {
          const diagnostics = [];
          const enDocs = context.documents.filter((d) => d.locale === 'en');
          const ruDocs = context.documents.filter((d) => d.locale === 'ru');

          const enMathIds = new Set(enDocs.flatMap((d) => d.mathObjects.map((m) => m.id)));
          const ruMathIds = new Set(ruDocs.flatMap((d) => d.mathObjects.map((m) => m.id)));

          for (const id of enMathIds) {
            if (!ruMathIds.has(id)) {
              diagnostics.push({
                code: 'MISSING_I18N_MATH_OBJECT',
                message: `Theorem ${id} defined in English corpus is missing in Russian translation`,
                severity: 'warning' as const,
              });
            }
          }

          return {
            name: 'multilingual-math-parity-gate',
            passed: diagnostics.length === 0,
            diagnostics,
          };
        },
      });

      const gateResult = await multilingualGate.run({
        documents: graph.getAllDocuments(),
        graph,
        config: { title: 'Multilingual Project' } as any,
        reportDiagnostic: () => {},
      });

      expect(gateResult.passed).toBe(true);
      expect(gateResult.diagnostics).toHaveLength(0);
    });
  });
});
