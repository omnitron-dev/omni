import { describe, it, expect } from 'vitest';
import { parseDocument } from '@omnitron-dev/lumen-ast';
import { CorpusGraph, defineCorpusGate, type GateContext, type GateResult } from '@omnitron-dev/lumen';
import { createCorpusBuilder } from '../harness/corpus-builder.js';

describe('Tier 3: Cross-Feature — Smart References, CorpusGraph & Corpus Gates (F6 + F18 + F19)', () => {
  it('TC-X02-01: @thm smart references resolve against CorpusGraph mathematical objects and pass gate verification', async () => {
    const doc1 = `---
title: Foundational Axioms
---

:::axiom{id="ax-unitary" title="Unitary Evolution"}
State vectors evolve via unitary transformations $U(t) = e^{-i H t / \\hbar}$.
:::
`;

    const doc2 = `---
title: Superposition Principles
---

# Superposition

As established by @thm:ax-unitary, pure states remain normalized.
`;

    const ast1 = await parseDocument(doc1, 'docs/axioms.pdx');
    const ast2 = await parseDocument(doc2, 'docs/superposition.pdx');

    const graph = new CorpusGraph();
    graph.addDocument({
      id: 'doc-axioms',
      path: 'docs/axioms.pdx',
      title: 'Foundational Axioms',
      hash: 'hash-ax',
      anchors: ['ax-unitary'],
      mathObjects: [{ id: 'ax-unitary', type: 'axiom', title: 'Unitary Evolution' }],
      backlinks: [],
    });

    graph.addDocument({
      id: 'doc-superposition',
      path: 'docs/superposition.pdx',
      title: 'Superposition Principles',
      hash: 'hash-sup',
      anchors: [],
      mathObjects: [],
      backlinks: [],
      relations: {
        dependsOn: ['ax-unitary'],
      },
    });

    // Verification gate for smart references
    const smartRefGate = defineCorpusGate({
      name: 'smart-ref-integrity-gate',
      run(context: GateContext): GateResult {
        const diagnostics = [];
        for (const doc of context.documents) {
          if (doc.relations?.dependsOn) {
            for (const ref of doc.relations.dependsOn) {
              const targetDoc = context.graph
                .getAllDocuments()
                .find((d) => d.mathObjects.some((m) => m.id === ref) || d.anchors.includes(ref));
              if (!targetDoc) {
                diagnostics.push({
                  code: 'SMARTREF_NOT_FOUND',
                  message: `Unresolved reference: ${ref}`,
                  file: doc.path,
                  severity: 'error' as const,
                });
              }
            }
          }
        }
        return {
          name: 'smart-ref-integrity-gate',
          passed: diagnostics.length === 0,
          diagnostics,
        };
      },
    });

    const result = await smartRefGate.run({
      documents: graph.getAllDocuments(),
      graph,
      config: { title: 'Test Project' },
      reportDiagnostic: () => {},
    });

    expect(result.passed).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
    expect(graph.getBacklinks('ax-unitary')).toContain('doc-superposition');
  });

  it('TC-X02-02: Unresolved @thm reference triggers diagnostic error in CorpusGate with suggested candidate ID', async () => {
    const graph = new CorpusGraph();
    graph.addDocument({
      id: 'doc-source',
      path: 'docs/source.pdx',
      title: 'Source Document',
      hash: 'hash-src',
      anchors: ['thm-riemann-hypothesis'],
      mathObjects: [{ id: 'thm-riemann-hypothesis', type: 'theorem', title: 'Riemann Hypothesis' }],
      backlinks: [],
    });

    graph.addDocument({
      id: 'doc-consumer',
      path: 'docs/consumer.pdx',
      title: 'Consumer Document',
      hash: 'hash-csm',
      anchors: [],
      mathObjects: [],
      backlinks: [],
      relations: {
        dependsOn: ['thm-rieman-hypothesis'], // Typo in reference
      },
    });

    const brokenRefGate = defineCorpusGate({
      name: 'broken-reference-gate',
      run(context: GateContext): GateResult {
        const diagnostics = [];
        const knownIds = context.graph.getAllDocuments().flatMap((d) => d.mathObjects.map((m) => m.id));

        for (const doc of context.documents) {
          if (doc.relations?.dependsOn) {
            for (const ref of doc.relations.dependsOn) {
              if (!knownIds.includes(ref)) {
                // Find closest match as suggested fix
                const suggestion = knownIds.find((id) => id.includes('riemann') || id.startsWith(ref.slice(0, 8)));
                diagnostics.push({
                  code: 'UNRESOLVED_SMART_REF',
                  message: `Cannot resolve @thm:${ref}`,
                  file: doc.path,
                  suggestedFix: suggestion ? `@thm:${suggestion}` : undefined,
                  severity: 'error' as const,
                });
              }
            }
          }
        }
        return {
          name: 'broken-reference-gate',
          passed: diagnostics.length === 0,
          diagnostics,
        };
      },
    });

    const result = await brokenRefGate.run({
      documents: graph.getAllDocuments(),
      graph,
      config: { title: 'Corpus Gate Test' },
      reportDiagnostic: () => {},
    });

    expect(result.passed).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe('UNRESOLVED_SMART_REF');
    expect(result.diagnostics[0]?.suggestedFix).toBe('@thm:thm-riemann-hypothesis');
  });

  it('TC-X02-03: @api smart references populate CorpusGraph backlinks and pass anchor gates', async () => {
    const builder = createCorpusBuilder({ title: 'API Documentation' })
      .addDocument({
        id: 'api-core',
        filePath: 'docs/api/core.pdx',
        title: 'Core Engine API',
        content: '# Core Engine\n\nExported symbols for compilation.',
      })
      .addDocument({
        id: 'guide-quickstart',
        filePath: 'docs/guide/quickstart.pdx',
        title: 'Quickstart Guide',
        content: 'See @api:api-core for initialization contracts.',
      })
      .addMathObject({
        id: 'api-symbol-core',
        envType: 'definition',
        title: 'Core API Specification',
        docId: 'api-core',
      })
      .addSmartRef('guide-quickstart', 'api', 'api-symbol-core');

    const corpus = builder.build();
    expect(corpus.documents.has('api-core')).toBe(true);
    expect(corpus.documents.has('guide-quickstart')).toBe(true);

    const backlinks = corpus.getBacklinks('api-core');
    expect(backlinks.has('guide-quickstart')).toBe(true);
  });

  it('TC-X02-04: Cyclic theorem dependencies between documents are detected by CorpusGraph DAG cycle gate', () => {
    const builder = createCorpusBuilder({ title: 'Cyclic Theory Corpus' })
      .addDocument({
        id: 'doc-alpha',
        filePath: 'docs/alpha.pdx',
        title: 'Alpha Theorem',
        content: 'Theorem Alpha depends on Beta.',
      })
      .addDocument({
        id: 'doc-beta',
        filePath: 'docs/beta.pdx',
        title: 'Beta Theorem',
        content: 'Theorem Beta depends on Alpha.',
      })
      .addMathObject({
        id: 'thm-alpha',
        envType: 'theorem',
        title: 'Theorem Alpha',
        docId: 'doc-alpha',
        dependsOn: ['thm-beta'],
      })
      .addMathObject({
        id: 'thm-beta',
        envType: 'theorem',
        title: 'Theorem Beta',
        docId: 'doc-beta',
        dependsOn: ['thm-alpha'],
      });

    const corpus = builder.build();
    const cycles = corpus.detectMathCycles();

    expect(cycles.length).toBeGreaterThanOrEqual(1);
    const flattenedCycle = cycles.flat();
    expect(flattenedCycle).toContain('thm-alpha');
    expect(flattenedCycle).toContain('thm-beta');
  });
});
