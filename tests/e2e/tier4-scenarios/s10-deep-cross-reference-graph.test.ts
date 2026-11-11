import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BacklinksSection, HoverReferenceCard } from '@omnitron-dev/lumen-ui';
import { CorpusGraph, defineCorpusGate, type GateContext } from '@omnitron-dev/lumen';
import { createCorpusBuilder } from '../harness/corpus-builder.js';

describe('Tier 4: Scenario 10 — Deep Cross-Reference Graph Traversal', () => {
  it('traverses multi-hop dependency chain: Axiom -> Lemma -> Theorem -> Corollary', () => {
    const builder = createCorpusBuilder({ title: 'Spectral Rigidity Theory' })
      .addDocument({
        id: 'doc-axioms',
        filePath: 'docs/axioms.pdx',
        title: 'Foundational Axioms',
        content: 'Axiomatic base.',
      })
      .addDocument({
        id: 'doc-lemmas',
        filePath: 'docs/lemmas.pdx',
        title: 'Operator Lemmas',
        content: 'Lemma derivations.',
      })
      .addDocument({
        id: 'doc-theorems',
        filePath: 'docs/theorems.pdx',
        title: 'Core Theorems',
        content: 'Main theorems.',
      })
      .addDocument({
        id: 'doc-corollaries',
        filePath: 'docs/corollaries.pdx',
        title: 'Derived Corollaries',
        content: 'Corollaries.',
      })
      .addMathObject({
        id: 'ax-spectral',
        envType: 'axiom',
        title: 'Spectral Axiom',
        docId: 'doc-axioms',
      })
      .addMathObject({
        id: 'lem-decomp',
        envType: 'lemma',
        title: 'Decomposition Lemma',
        docId: 'doc-lemmas',
        dependsOn: ['ax-spectral'],
      })
      .addMathObject({
        id: 'thm-rigidity',
        envType: 'theorem',
        title: 'Rigidity Theorem',
        docId: 'doc-theorems',
        dependsOn: ['lem-decomp'],
      })
      .addMathObject({
        id: 'cor-invariance',
        envType: 'corollary',
        title: 'Unitary Invariance',
        docId: 'doc-corollaries',
        dependsOn: ['thm-rigidity'],
      })
      .addCrossLink('doc-lemmas', 'doc-axioms')
      .addCrossLink('doc-theorems', 'doc-lemmas')
      .addCrossLink('doc-corollaries', 'doc-theorems');

    const corpus = builder.build();

    // Verify multi-document topological order
    const topo = corpus.getTopologicalOrder();
    expect(topo.indexOf('doc-axioms')).toBeLessThan(topo.indexOf('doc-lemmas'));
    expect(topo.indexOf('doc-lemmas')).toBeLessThan(topo.indexOf('doc-theorems'));
    expect(topo.indexOf('doc-theorems')).toBeLessThan(topo.indexOf('doc-corollaries'));

    // Verify backlinks chain
    const axiomBacklinks = corpus.getBacklinks('doc-axioms');
    expect(axiomBacklinks.has('doc-lemmas')).toBe(true);

    const lemmaBacklinks = corpus.getBacklinks('doc-lemmas');
    expect(lemmaBacklinks.has('doc-theorems')).toBe(true);

    const theoremBacklinks = corpus.getBacklinks('doc-theorems');
    expect(theoremBacklinks.has('doc-corollaries')).toBe(true);

    // Verify cycle detection reports zero cycles for valid DAG
    const cycles = corpus.detectMathCycles();
    expect(cycles).toHaveLength(0);
  });

  it('renders interactive backlinks section and hover reference cards in document footer', () => {
    const backlinks = ['doc-lemmas', 'doc-theorems', 'doc-applications'];

    const backlinksHtml = renderToStaticMarkup(React.createElement(BacklinksSection, { backlinks }));

    expect(backlinksHtml).toContain('class="lumen-backlinks"');
    expect(backlinksHtml).toContain('Backlinks');
    expect(backlinksHtml).toContain('doc-lemmas');
    expect(backlinksHtml).toContain('doc-theorems');
    expect(backlinksHtml).toContain('doc-applications');

    const hoverHtml = renderToStaticMarkup(
      React.createElement(HoverReferenceCard, {
        id: 'thm-rigidity',
        targetTitle: 'Rigidity Theorem',
      })
    );

    expect(hoverHtml).toContain('class="lumen-hover-reference-card"');
    expect(hoverHtml).toContain('data-reference-id="thm-rigidity"');
    expect(hoverHtml).toContain('Rigidity Theorem');
  });
});
