import { describe, it, expect } from 'vitest';
import { CorpusGraph } from '@omnitron-dev/lumen';
import { createCorpusBuilder } from '../harness/corpus-builder.js';

describe('Feature 18: Corpus Knowledge Graph', () => {
  it('TC-F18-01: adds and retrieves documents in CorpusGraph', () => {
    const graph = new CorpusGraph();
    graph.addDocument({
      id: 'doc-intro',
      path: 'docs/intro.pdx',
      title: 'Introduction',
      hash: 'sha256-abc',
      anchors: ['architecture'],
      mathObjects: [],
      backlinks: [],
    });

    expect(graph.size()).toBe(1);
    const doc = graph.getDocument('doc-intro');
    expect(doc).toBeDefined();
    expect(doc?.title).toBe('Introduction');
    expect(doc?.anchors).toContain('architecture');
  });

  it('TC-F18-02: computes backlinks based on dependency relations in CorpusGraph', () => {
    const graph = new CorpusGraph();
    graph.addDocument({
      id: 'doc-base',
      path: 'docs/base.pdx',
      title: 'Base',
      hash: 'sha256-1',
      anchors: [],
      mathObjects: [],
      backlinks: [],
    });

    graph.addDocument({
      id: 'doc-dependent',
      path: 'docs/dep.pdx',
      title: 'Dependent',
      hash: 'sha256-2',
      anchors: [],
      mathObjects: [],
      backlinks: [],
      relations: {
        dependsOn: ['doc-base'],
      },
    });

    const backlinks = graph.getBacklinks('doc-base');
    expect(backlinks).toContain('doc-dependent');
  });

  it('TC-F18-03: indexes math objects and anchors in programmatic CorpusBuilder', () => {
    const builder = createCorpusBuilder()
      .addDocument({
        id: 'doc-math',
        filePath: 'docs/math.pdx',
        title: 'Math Docs',
        content: '# Math Docs',
      })
      .addMathObject({
        id: 'thm-purity',
        envType: 'theorem',
        title: 'Purity Bound',
        docId: 'doc-math',
      });

    const graph = builder.build();
    const mathRef = graph.resolveMathRef('thm-purity');
    expect(mathRef).toBeDefined();
    expect(mathRef?.title).toBe('Purity Bound');
  });

  it('TC-F18-04: performs topological sort on document dependency DAG', () => {
    const builder = createCorpusBuilder()
      .addDocument({
        id: 'doc-c',
        filePath: 'c.pdx',
        content: 'C',
      })
      .addDocument({
        id: 'doc-b',
        filePath: 'b.pdx',
        content: 'B',
        frontmatter: { dependsOn: ['doc-c'] },
      })
      .addDocument({
        id: 'doc-a',
        filePath: 'a.pdx',
        content: 'A',
        frontmatter: { dependsOn: ['doc-b'] },
      });

    const graph = builder.build();
    const order = graph.getTopologicalOrder();
    expect(order).toEqual(['doc-c', 'doc-b', 'doc-a']);
  });

  it('TC-F18-05: detects outdated translations via SHA-256 hash comparison', () => {
    const builder = createCorpusBuilder()
      .addDocument({
        id: 'intro',
        filePath: 'en/intro.pdx',
        content: 'English content',
        sha256: 'sha-updated-v2',
      })
      .addTranslation('intro', 'ru', {
        id: 'intro',
        filePath: 'ru/intro.pdx',
        content: 'Russian content',
        sha256: 'sha-old-v1',
        frontmatter: { canonicalSha256: 'sha-old-v1' },
      });

    const graph = builder.build();
    const outdated = graph.getOutdatedTranslations();
    expect(outdated.length).toBe(1);
    expect(outdated[0].locale).toBe('ru');
    expect(outdated[0].canonicalId).toBe('intro');
  });
});
