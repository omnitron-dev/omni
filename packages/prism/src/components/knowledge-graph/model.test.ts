import { describe, it, expect } from 'vitest';
import { validateKnowledgeGraph, projectKnowledgeGraph, incidenceGraph, type KnowledgeGraphData } from './model.js';
describe('Knowledge graph projection contract', () => {
  it('does not turn a joint justification into separate pairwise justifications', () => {
    const data: KnowledgeGraphData = {
      entities: ['a', 'b', 'c'].map((id) => ({ id, label: id, kind: 'claim' })),
      relations: [
        {
          id: 'r',
          label: 'joint support',
          kind: 'support',
          inputs: [
            { entity: 'a', role: 'premise' },
            { entity: 'b', role: 'assumption' },
            { entity: 'a', role: 'repeated argument' },
          ],
          outputs: [{ entity: 'c', role: 'conclusion' }],
        },
      ],
    };
    validateKnowledgeGraph(data);
    const p = projectKnowledgeGraph(data, undefined),
      g = incidenceGraph(p);
    expect(g.nodes).toHaveLength(4);
    expect(g.edges).toHaveLength(4);
    expect(new Set(g.edges.map((e) => e.id)).size).toBe(4);
    expect(g.edges.every((e) => e.source.includes('relation') || e.target.includes('relation'))).toBe(true);
    const limited = projectKnowledgeGraph(data, { type: 'entity', id: 'a' }, 3);
    expect(limited.entities.map((e) => e.id)).toEqual(['a']);
    expect(limited.relations).toEqual([]);
    expect(limited.omittedRelations).toBe(1);
  });
  it('requires explicit identities and complete references', () => {
    const a = { id: 'a', kind: 'source', label: 'A' };
    expect(() => validateKnowledgeGraph({ entities: [a, a], relations: [] })).toThrow();
    expect(() =>
      validateKnowledgeGraph({
        entities: [a],
        relations: [
          {
            id: 'r',
            kind: 'citation',
            label: 'R',
            inputs: [{ entity: 'a', role: 'source' }],
            outputs: [{ entity: 'absent', role: 'target' }],
          },
        ],
      })
    ).toThrow('dangling_port');
    expect(() => projectKnowledgeGraph({ entities: [], relations: [] }, undefined, 0)).toThrow();
  });
  it('preserves cycles, repeated ports and endpoint closure over generated graphs', () => {
    for (let n = 2; n < 120; n++) {
      const data: KnowledgeGraphData = {
        entities: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, kind: 'concept', label: `E${i}` })),
        relations: Array.from({ length: n }, (_, i) => ({
          id: `r${i}`,
          kind: 'relation',
          label: `R${i}`,
          inputs: [
            { entity: `e${i}`, role: 'input' },
            { entity: `e${(i + 1) % n}`, role: 'context' },
          ],
          outputs: [{ entity: `e${(i * 7) % n}`, role: 'output' }],
        })),
      };
      validateKnowledgeGraph(data);
      const p = projectKnowledgeGraph(data, { type: 'entity', id: 'e0' }, 9),
        g = incidenceGraph(p),
        ids = new Set(g.nodes.map((x) => x.id));
      expect(g.nodes.length).toBeLessThanOrEqual(9);
      expect(g.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
      for (const r of p.relations)
        expect(g.edges.filter((e) => e.relationId === r.id)).toHaveLength(r.inputs.length + r.outputs.length);
      expect(data.relations).toHaveLength(n);
    }
  });
});
