import { routeEdges, type CardinalDirection, type EdgeRequest, type Obstacle, type Point } from 'libavoided-js';

export interface GraphGeometry {
  cards: Obstacle[];
  links: Array<{ id: string; source: string; target: string }>;
}
export interface RoutedLink {
  points: Point[];
  label: Point;
}
export interface GraphRoutes {
  paths: Record<string, RoutedLink>;
  blocked: string[];
}

const vector = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] } as const;
const opposite = { left: 'right', right: 'left', up: 'down', down: 'up' } as const;
interface Port {
  side: CardinalDirection;
  order: number;
  id: string;
  point: Point;
}
function centre(card: Obstacle): Point {
  return { x: card.x + card.width / 2, y: card.y + card.height / 2 };
}
function crossesCard(a: Point, b: Point, card: Obstacle) {
  return a.x === b.x
    ? a.x > card.x &&
        a.x < card.x + card.width &&
        Math.max(a.y, b.y) > card.y &&
        Math.min(a.y, b.y) < card.y + card.height
    : a.y > card.y &&
        a.y < card.y + card.height &&
        Math.max(a.x, b.x) > card.x &&
        Math.min(a.x, b.x) < card.x + card.width;
}
function departure(port: Port): Point {
  const [dx, dy] = vector[port.side];
  return { x: port.point.x + dx * 16, y: port.point.y + dy * 16 };
}

/** Assign a distinct port per link, then route all links against the same obstacles and occupied lanes. */
export function routeTopology({ cards, links }: GraphGeometry): GraphRoutes {
  const paths: GraphRoutes['paths'] = Object.create(null);
  const blocked: string[] = [];
  const byId = new Map(cards.map((card) => [card.id, card]));
  const groups = new Map<Obstacle, Map<CardinalDirection, Port[]>>();
  const port = (card: Obstacle, side: CardinalDirection, peer: Point, id: string): Port => {
    const sides = groups.get(card) ?? new Map<CardinalDirection, Port[]>();
    groups.set(card, sides);
    const ports = sides.get(side) ?? [];
    sides.set(side, ports);
    const next = { side, order: side === 'left' || side === 'right' ? peer.y : peer.x, id, point: centre(card) };
    ports.push(next);
    return next;
  };
  const connections = [...links]
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((link) => {
      const a = byId.get(link.source),
        b = byId.get(link.target);
      if (!a || !b || a === b) {
        blocked.push(link.id);
        return [];
      }
      const start = centre(a),
        end = centre(b);
      const gapX = Math.max(b.x - a.x - a.width, a.x - b.x - b.width);
      const gapY = Math.max(b.y - a.y - a.height, a.y - b.y - b.height);
      // Between separate columns use their shared corridor, even across distant rows.
      const side = gapX >= 32 || gapX > gapY ? (end.x >= start.x ? 'right' : 'left') : end.y >= start.y ? 'down' : 'up';
      return [{ link, start: port(a, side, end, link.id), end: port(b, opposite[side], start, link.id) }];
    });
  for (const [card, sides] of groups)
    for (const [side, ports] of sides) {
      ports.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      ports.forEach((p, i) => {
        const vertical = side === 'left' || side === 'right';
        const offset = 10 + ((i + 1) / (ports.length + 1)) * ((vertical ? card.height : card.width) - 20);
        p.point = vertical
          ? { x: card.x + (side === 'right' ? card.width : 0), y: card.y + offset }
          : { x: card.x + offset, y: card.y + (side === 'down' ? card.height : 0) };
      });
    }
  const edges: EdgeRequest[] = connections.map(({ link, start, end }) => ({
    id: link.id,
    sourceId: link.source,
    targetId: link.target,
    sourcePoint: departure(start),
    targetPoint: departure(end),
    sourceDirection: start.side,
    targetDirection: end.side,
  }));
  const routed = new Map(
    routeEdges({ obstacles: cards, edges }, { obstacleMargin: 8, edgeSpacing: 10, crossingPenalty: 280 }).edges.map(
      (edge) => [edge.id, edge.sections[0]]
    )
  );
  for (const { link, start, end } of connections) {
    const section = routed.get(link.id);
    if (!section) {
      blocked.push(link.id);
      continue;
    }
    const points = [start.point, section.startPoint, ...section.bendPoints, section.endPoint, end.point];
    let longest = -1,
      label = start.point;
    const clear = points.slice(1).every((b, index) => {
      const a = points[index]!;
      if ((a.x !== b.x && a.y !== b.y) || cards.some((card) => crossesCard(a, b, card))) return false;
      const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (length > longest) {
        longest = length;
        label = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
      return true;
    });
    if (clear) paths[link.id] = { points, label };
    else blocked.push(link.id);
  }
  return { paths, blocked };
}
