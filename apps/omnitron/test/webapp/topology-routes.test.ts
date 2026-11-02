import { describe, expect, it } from 'vitest';
import { routeTopology, type GraphGeometry } from '../../webapp/src/components/topology/route-geometry.js';

const card = (id: string,x: number,y: number) => ({ id,x,y,width:280,height:152 });
const link = (source: string,target: string) => ({ id:source+'->'+target,source,target });
describe('infrastructure map routing', () => {
  it('gives shared dependencies distinct ports and respects an intervening card after a manual move', () => {
    const graph: GraphGeometry = { cards:[card('api',0,0),card('worker',0,240),card('jobs',0,480),card('db',780,240),card('other',370,230)],
      links:[link('api','db'),link('worker','db'),link('jobs','db')] };
    for (const offset of [0,64]) {
      graph.cards[4]!.y += offset;
      const result = routeTopology(graph);
      expect(result.blocked).toEqual([]);
      const endpoints = new Set<string>();
      for (const edge of graph.links) {
        const points = result.paths[edge.id]!.points;
        endpoints.add(JSON.stringify(points.at(-1)));
        for (let i=1;i<points.length;i++) {
          const a=points[i-1]!,b=points[i]!,barrier=graph.cards[4]!;
          expect(a.x === b.x || a.y === b.y).toBe(true);
          const cuts = a.x === b.x
            ? a.x>barrier.x && a.x<barrier.x+280 && Math.min(a.y,b.y)<barrier.y+152 && Math.max(a.y,b.y)>barrier.y
            : a.y>barrier.y && a.y<barrier.y+152 && Math.min(a.x,b.x)<barrier.x+280 && Math.max(a.x,b.x)>barrier.x;
          expect(cuts).toBe(false);
        }
      }
      expect(endpoints.size).toBe(3);
      expect(routeTopology({ ...graph, links:[...graph.links].reverse() })).toEqual(result);
    }
  });
  it('reports an impossible connection instead of drawing through an overlapping node', () => {
    const graph={cards:[card('a',0,0),card('b',4,4)],links:[link('a','b')]};
    expect(routeTopology(graph).blocked).toContain('a->b');
  });
});
