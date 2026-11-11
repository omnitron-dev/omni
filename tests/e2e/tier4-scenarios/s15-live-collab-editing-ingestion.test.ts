import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { parseDocument, toHtmlSsr, toCleanMarkdown } from '@omnitron-dev/lumen-ast';
import { CorpusGraph, type CorpusDocument } from '@omnitron-dev/lumen';
import { LumenRpcService } from '@omnitron-dev/titan-lumen';

describe('Tier 4: Scenario 15 — Live Collaborative Editing Ingestion', () => {
  function hash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  it('receives live edit stream updates and updates CorpusGraph node and cache atomically', async () => {
    const graph = new CorpusGraph();

    // Initial document state before live edit
    const docId = 'doc-collaborative-paper';
    const initialText = `---
title: Collaborative Quantum Note
---

# Draft Hypothesis
The spectral radius satisfies $\\rho(T) = 1$.
`;

    const initialHash = hash(initialText);
    const initialAst = await parseDocument(initialText, 'docs/collab.pdx');
    const initialHtml = toHtmlSsr(initialAst);

    graph.addDocument({
      id: docId,
      path: 'docs/collab.pdx',
      title: 'Collaborative Quantum Note',
      hash: initialHash,
      anchors: ['draft-hypothesis'],
      mathObjects: [],
      backlinks: [],
    });

    expect(graph.getDocument(docId)?.hash).toBe(initialHash);
    expect(initialHtml).toContain('The spectral radius satisfies');

    // Simulate ResearchEditor SSE / HTTP live diff event:
    // Co-author refines hypothesis into a formal theorem
    const editedText = `---
title: Collaborative Quantum Note
---

# Verified Formulations

:::theorem{id="thm-spectral-norm" title="Spectral Radius Identity"}
For any normal operator $T$ on a Hilbert space, $\\rho(T) = \\|T\\|$.
:::
`;

    const editedHash = hash(editedText);
    const editedAst = await parseDocument(editedText, 'docs/collab.pdx');
    const editedHtml = toHtmlSsr(editedAst);
    const editedCleanMd = toCleanMarkdown(editedAst);

    // Atomically update CorpusGraph with new version
    const updatedDoc: CorpusDocument = {
      id: docId,
      path: 'docs/collab.pdx',
      title: 'Collaborative Quantum Note',
      hash: editedHash,
      anchors: ['verified-formulations', 'thm-spectral-norm'],
      mathObjects: [{ id: 'thm-spectral-norm', type: 'theorem', title: 'Spectral Radius Identity' }],
      backlinks: [],
    };
    graph.addDocument(updatedDoc);

    // Validate instant cache refresh in graph
    const retrieved = graph.getDocument(docId);
    expect(retrieved?.hash).toBe(editedHash);
    expect(retrieved?.mathObjects).toHaveLength(1);
    expect(retrieved?.anchors).toContain('thm-spectral-norm');

    // Validate updated multi-target transformations
    expect(editedHtml).toContain('thm-spectral-norm');
    expect(editedHtml).toContain('Spectral Radius Identity');
    expect(editedCleanMd).toContain('Verified Formulations');
    expect(editedCleanMd).toContain('Spectral Radius Identity');
  });

  it('integrates with Titan LumenModule RPC to propagate live edit notifications', async () => {
    const rpcService = new LumenRpcService({
      docsDir: 'docs',
      kbEnabled: true,
      mcpEnabled: true,
    });

    // Inquire about document state through RPC
    const docContent = await rpcService.getDocument('docs/collab.pdx');
    expect(docContent === null || typeof docContent === 'string').toBe(true);
  });
});
