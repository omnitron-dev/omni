import { describe, expect, it } from 'vitest';
import { routeTopology, type GraphGeometry } from '../../webapp/src/components/topology/route-geometry.js';

const card = (id: string, x: number, y: number) => ({ id, x, y, width: 280, height: 152 });
const link = (source: string, target: string) => ({ id: source + '->' + target, source, target });
describe('infrastructure map routing', () => {
  it('gives shared dependencies distinct ports and respects an intervening card after a manual move', () => {
    const graph: GraphGeometry = {
      cards: [
        card('api', 0, 0),
        card('worker', 0, 240),
        card('jobs', 0, 480),
        card('db', 780, 240),
        card('other', 370, 230),
      ],
      links: [link('api', 'db'), link('worker', 'db'), link('jobs', 'db')],
    };
    for (const offset of [0, 64]) {
      graph.cards[4]!.y += offset;
      const result = routeTopology(graph);
      expect(result.blocked).toEqual([]);
      const endpoints = new Set<string>();
      for (const edge of graph.links) {
        const points = result.paths[edge.id]!.points;
        endpoints.add(JSON.stringify(points.at(-1)));
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1]!,
            b = points[i]!,
            barrier = graph.cards[4]!;
          expect(a.x === b.x || a.y === b.y).toBe(true);
          const cuts =
            a.x === b.x
              ? a.x > barrier.x &&
                a.x < barrier.x + 280 &&
                Math.min(a.y, b.y) < barrier.y + 152 &&
                Math.max(a.y, b.y) > barrier.y
              : a.y > barrier.y &&
                a.y < barrier.y + 152 &&
                Math.min(a.x, b.x) < barrier.x + 280 &&
                Math.max(a.x, b.x) > barrier.x;
          expect(cuts).toBe(false);
        }
      }
      expect(endpoints.size).toBe(3);
      expect(routeTopology({ ...graph, links: [...graph.links].reverse() })).toEqual(result);
    }
  });
  it('reserves visible tracks for every overlapping span in a narrow single column', () => {
    const cards = Array.from({ length: 9 }, (_, i) => card(String(i), 0, i * 200));
    const links = cards.slice(0, 6).flatMap((c, i) =>
      cards
        .slice(6)
        .filter((_, j) => (i + j) % 3 !== 1)
        .map((provider) => link(c.id, provider.id))
    );
    const result = routeTopology({ cards, links });
    expect(result.blocked).toEqual([]);
    expect(Object.keys(result.paths)).toHaveLength(12);
    expect(new Set(Object.values(result.paths).map((route) => route.points[1]!.x)).size).toBe(12);
  });
  it('routes every shared dependency through a two-column deployment without overlaying vertical spans', () => {
    const apps = Array.from({ length: 6 }, (_, i) => card('app' + i, 0, i * 200));
    const services = Array.from({ length: 3 }, (_, i) => card('provider' + i, 464, i * 200));
    const links = apps.flatMap((app, i) =>
      services.filter((_, j) => (i + j) % 3 !== 1).map((service) => link(app.id, service.id))
    );
    const result = routeTopology({ cards: [...apps, ...services], links });
    expect(result.blocked).toEqual([]);
    const runs = Object.values(result.paths).map((path) => [path.points[1]!, path.points[2]!] as const);
    for (const [index, [a, b]] of runs.entries())
      for (const [c, d] of runs.slice(index + 1)) {
        if (Math.min(a.y, b.y) < Math.max(c.y, d.y) && Math.min(c.y, d.y) < Math.max(a.y, b.y))
          expect(Math.abs(a.x - c.x)).toBeGreaterThanOrEqual(8);
      }
  });
  it('reports an impossible connection instead of drawing through an overlapping node', () => {
    const graph = { cards: [card('a', 0, 0), card('b', 4, 4)], links: [link('a', 'b')] };
    expect(routeTopology(graph).blocked).toContain('a->b');
  });
  it('separates host ownership and app-to-app links from shared provider routes across deployments', () => {
    for (const columns of [1, 2]) {
      const cards: GraphGeometry['cards'] = [],
        links: GraphGeometry['links'] = [];
      for (let group = 0; group < 2; group++) {
        const x = columns === 2 ? group * 960 : 0,
          y = columns === 1 ? group * 1700 : 0;
        const host = card('host' + group, x, y);
        const apps = Array.from({ length: 6 }, (_, i) => card(group + '/app' + i, x, y + (i + 1) * 210));
        const stores = Array.from({ length: 4 }, (_, i) => card(group + '/store' + i, x + 530, y + (i + 1) * 210));
        cards.push(host, ...apps, ...stores);
        for (const app of apps) {
          links.push(link(host.id, app.id), ...stores.slice(0, 2).map((store) => link(app.id, store.id)));
          if (app !== apps[0]) links.push(link(app.id, apps[0]!.id));
        }
        for (const store of stores) links.push(link(host.id, store.id));
      }
      cards[0]!.x += 64;
      const routed = routeTopology({ cards, links });
      expect(routed.blocked).toEqual([]);
      expect(Object.keys(routed.paths)).toHaveLength(links.length);
    }
  });
});
