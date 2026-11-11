import { describe, it, expect } from 'vitest';
import { CorpusGraph } from '@omnitron-dev/lumen';
import { createCorpusBuilder } from '../harness/corpus-builder.js';

describe('Feature 18: Corpus Knowledge Graph Boundaries', () => {
  it('TC-B18-01: handles cyclic document dependencies during topological ordering safely', () => {
    const builder = createCorpusBuilder()
      .addDocument({
        id: 'doc-alpha',
        filePath: 'alpha.pdx',
        content: 'Alpha',
        frontmatter: { dependsOn: ['doc-beta'] },
      })
      .addDocument({
        id: 'doc-beta',
        filePath: 'beta.pdx',
        content: 'Beta',
        frontmatter: { dependsOn: ['doc-gamma'] },
      })
      .addDocument({
        id: 'doc-gamma',
        filePath: 'gamma.pdx',
        content: 'Gamma',
        frontmatter: { dependsOn: ['doc-alpha'] },
      });

    const graph = builder.build();
    const order = graph.getTopologicalOrder();

    // Must return an array without entering an infinite loop
    expect(Array.isArray(order)).toBe(true);
    expect(order.length).toBeLessThanOrEqual(3);
  });

  it('TC-B18-02: overwrites duplicate document IDs safely and maintains graph size integrity', () => {
    const graph = new CorpusGraph();

    graph.addDocument({
      id: 'doc-duplicate',
      path: 'docs/initial.pdx',
      title: 'Initial Title',
      hash: 'sha256-v1',
      anchors: ['init'],
      mathObjects: [],
      backlinks: [],
    });
    expect(graph.size()).toBe(1);

    // Overwrite with identical ID
    graph.addDocument({
      id: 'doc-duplicate',
      path: 'docs/updated.pdx',
      title: 'Updated Title',
      hash: 'sha256-v2',
      anchors: ['updated'],
      mathObjects: [],
      backlinks: [],
    });

    expect(graph.size()).toBe(1);
    const doc = graph.getDocument('doc-duplicate');
    expect(doc?.title).toBe('Updated Title');
    expect(doc?.anchors).toEqual(['updated']);
  });

  it('TC-B18-03: returns empty backlinks set for non-existent or unreferenced document IDs', () => {
    const graph = new CorpusGraph();
    graph.addDocument({
      id: 'doc-standalone',
      path: 'docs/standalone.pdx',
      title: 'Standalone',
      hash: 'sha256-hash',
      anchors: [],
      mathObjects: [],
      backlinks: [],
    });

    const backlinksGhost = graph.getBacklinks('non-existent-doc-id');
    expect(backlinksGhost).toEqual([]);

    const backlinksStandalone = graph.getBacklinks('doc-standalone');
    expect(backlinksStandalone).toEqual([]);
  });

  it('TC-B18-04: resolves missing anchors and cross-links returning unresolved status cleanly', () => {
    const builder = createCorpusBuilder().addDocument({
      id: 'doc-target',
      filePath: 'target.pdx',
      content: '# Heading 1\nSome text.',
    });

    const graph = builder.build();
    const anchorResult = graph.resolveAnchor('nonexistent-target.pdx#phantom-anchor');
    expect(anchorResult.resolved).toBe(false);

    const linkResult = graph.resolveLink('doc-target', 'nonexistent.pdx');
    expect(linkResult.resolved).toBe(false);
  });

  it('TC-B18-05: correctly identifies outdated translations on canonical SHA-256 hash mismatch', () => {
    const builder = createCorpusBuilder()
      .addDocument({
        id: 'overview',
        filePath: 'en/overview.pdx',
        content: 'English text v2',
        sha256: 'sha-new-hash',
      })
      .addTranslation('overview', 'ru', {
        id: 'overview',
        filePath: 'ru/overview.pdx',
        content: 'Russian text v1',
        sha256: 'sha-old-hash',
        frontmatter: { canonicalSha256: 'sha-stale-hash' },
      });

    const graph = builder.build();
    const outdatedList = graph.getOutdatedTranslations();

    expect(outdatedList).toHaveLength(1);
    expect(outdatedList[0].canonicalId).toBe('overview');
    expect(outdatedList[0].locale).toBe('ru');
  });
});
