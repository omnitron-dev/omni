import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { parseDocument, toHtmlSsr, toCleanMarkdown } from '@omnitron-dev/lumen-ast';
import { CorpusGraph, type CorpusDocument } from '@omnitron-dev/lumen';
import type { LiveEditEvent } from '@omnitron-dev/titan-lumen';
import { asUser, createLumenFixture } from '../../../packages/titan-lumen/tests/netron-fixture.js';

describe('Tier 4: Scenario 15 — Live Collaborative Editing Ingestion', () => {
  function hash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  it('replaces a corpus graph document and renders the updated AST', async () => {
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

    // The graph owns document replacement; durable edit ingestion is qualified separately.
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

  it('emits the verified author and accepted revision after an admitted RPC edit', async () => {
    const service = createLumenFixture();
    const events: LiveEditEvent[] = [];
    service.getLiveEditService().on('live-edit', event => events.push(event));
    const client = await asUser(service, 'admin');
    const result = await client.saveLiveEdit({
      docId: 'collab.pdx', patch: '# Accepted draft', baseRevision: 1, author: 'forged',
    });
    expect(result).toMatchObject({ success: true, revision: 2 });
    expect(events).toMatchObject([{ docId: 'collab.pdx', revision: 2, author: 'verified-admin' }]);
    expect(await client.getDocument('collab.pdx')).toContain('# Accepted draft');
    const conflict = await client.saveLiveEdit({ docId: 'collab.pdx', patch: 'stale', baseRevision: 1 });
    expect(conflict.conflict).toBe(true);
    expect(events).toHaveLength(1);
  });
});
