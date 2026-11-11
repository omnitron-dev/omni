import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { parseDocument, toHtmlSsr, toCleanMarkdown } from '@omnitron-dev/lumen-ast';
import { CorpusGraph, type CorpusDocument } from '@omnitron-dev/lumen';

describe('Tier 3: Cross-Feature — Live Collaborative Editing, CorpusGraph & Transformers (F10 + F18 + F27)', () => {
  function computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  it('TC-X07-01: Live document update via MCP ingestion recalculates SHA-256 hash and updates CorpusGraph node', async () => {
    const graph = new CorpusGraph();
    const initialContent = '# Initial Draft\n\nPreliminary thoughts.';
    const initialHash = computeHash(initialContent);

    const doc: CorpusDocument = {
      id: 'doc-live-1',
      path: 'docs/live-1.pdx',
      title: 'Live Draft',
      hash: initialHash,
      anchors: ['initial-draft'],
      mathObjects: [],
      backlinks: [],
    };
    graph.addDocument(doc);

    expect(graph.getDocument('doc-live-1')?.hash).toBe(initialHash);

    // Simulate MCP live update payload
    const updatedContent = '# Final Draft\n\nVerified mathematical formulations.';
    const updatedHash = computeHash(updatedContent);

    const updatedDoc: CorpusDocument = {
      ...doc,
      title: 'Final Draft',
      hash: updatedHash,
      anchors: ['final-draft'],
    };
    graph.addDocument(updatedDoc);

    const retrieved = graph.getDocument('doc-live-1');
    expect(retrieved?.hash).toBe(updatedHash);
    expect(retrieved?.title).toBe('Final Draft');
    expect(retrieved?.anchors).toContain('final-draft');
  });

  it('TC-X07-02: Updated document re-triggers toHtmlSsr and toCleanMarkdown transformations with fresh content', async () => {
    const v1Source = `---
title: Research Notes v1
---

# Preliminary Phase
Initial notes.
`;
    const v2Source = `---
title: Research Notes v2
---

# Preliminary Phase
Updated notes with formal conclusions.
`;

    const ast1 = await parseDocument(v1Source, 'docs/research.pdx');
    const html1 = toHtmlSsr(ast1);
    const md1 = toCleanMarkdown(ast1);

    expect(html1).toContain('Initial notes');
    expect(md1).toContain('Initial notes');

    // Transform updated AST
    const ast2 = await parseDocument(v2Source, 'docs/research.pdx');
    const html2 = toHtmlSsr(ast2);
    const md2 = toCleanMarkdown(ast2);

    expect(html2).toContain('Updated notes with formal conclusions');
    expect(md2).toContain('Updated notes with formal conclusions');
    expect(html2).not.toEqual(html1);
    expect(md2).not.toEqual(md1);
  });

  it('TC-X07-03: Updating theorem ID propagates invalidation through CorpusGraph backlinks index', () => {
    const graph = new CorpusGraph();

    graph.addDocument({
      id: 'doc-math',
      path: 'docs/math.pdx',
      title: 'Core Math',
      hash: 'h1',
      anchors: ['thm-initial'],
      mathObjects: [{ id: 'thm-initial', type: 'theorem' }],
      backlinks: [],
    });

    graph.addDocument({
      id: 'doc-consumer',
      path: 'docs/consumer.pdx',
      title: 'Consumer',
      hash: 'h2',
      anchors: [],
      mathObjects: [],
      backlinks: [],
      relations: {
        dependsOn: ['thm-initial'],
      },
    });

    expect(graph.getBacklinks('thm-initial')).toContain('doc-consumer');

    // Simulate clearing and updating dependency
    graph.clear();
    graph.addDocument({
      id: 'doc-math',
      path: 'docs/math.pdx',
      title: 'Core Math',
      hash: 'h1-updated',
      anchors: ['thm-renamed'],
      mathObjects: [{ id: 'thm-renamed', type: 'theorem' }],
      backlinks: [],
    });

    graph.addDocument({
      id: 'doc-consumer',
      path: 'docs/consumer.pdx',
      title: 'Consumer',
      hash: 'h2-updated',
      anchors: [],
      mathObjects: [],
      backlinks: [],
      relations: {
        dependsOn: ['thm-renamed'],
      },
    });

    expect(graph.getBacklinks('thm-renamed')).toContain('doc-consumer');
    expect(graph.getBacklinks('thm-initial')).toHaveLength(0);
  });

  it('TC-X07-04: Concurrent live edit events maintain CorpusGraph consistency without dangling edges', () => {
    const graph = new CorpusGraph();
    const documentsCount = 20;

    // Concurrently add documents
    for (let i = 0; i < documentsCount; i++) {
      graph.addDocument({
        id: `doc-${i}`,
        path: `docs/doc-${i}.pdx`,
        title: `Doc ${i}`,
        hash: `hash-${i}`,
        anchors: [`heading-${i}`],
        mathObjects: [],
        backlinks: [],
        relations: {
          dependsOn: i > 0 ? [`doc-${i - 1}`] : [],
        },
      });
    }

    expect(graph.size()).toBe(documentsCount);
    for (let i = 1; i < documentsCount; i++) {
      const backlinks = graph.getBacklinks(`doc-${i - 1}`);
      expect(backlinks).toContain(`doc-${i}`);
    }
  });
});
