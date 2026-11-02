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
  const singleColumn =
    cards.length > 0 &&
    Math.max(...cards.map((card) => card.x)) < Math.min(...cards.map((card) => card.x + card.width));
  const connections = [...links]
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((link, index) => {
      const a = byId.get(link.source),
        b = byId.get(link.target);
      if (!a || !b || a === b) {
        blocked.push(link.id);
        return [];
      }
      const start = centre(a),
        end = centre(b);
      if (singleColumn) {
        const side = index % 2 ? 'left' : 'right';
        return [{ link, start: port(a, side, end, link.id), end: port(b, side, start, link.id) }];
      }
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
  // In a single column, keep long vertical runs outside the cards. Spans that
  // overlap need exclusive tracks. Disjoint spans may reuse the same track.
  const tracks = { left: [] as Array<Array<[number, number]>>, right: [] as Array<Array<[number, number]>> };
  const left = Math.min(...cards.map((card) => card.x)),
    right = Math.max(...cards.map((card) => card.x + card.width));
  const usedChannels: Array<{ x: number; from: number; to: number }> = [];
  function throughGutter(a: Port, b: Port): Point[] | undefined {
    if ((a.side !== 'right' && a.side !== 'left') || b.side !== opposite[a.side]) return undefined;
    const leftStub = Math.min(a.point.x, b.point.x) + 16;
    const rightStub = Math.max(a.point.x, b.point.x) - 16;
    if (leftStub > rightStub) return undefined;
    const from = Math.min(a.point.y, b.point.y),
      to = Math.max(a.point.y, b.point.y);
    const candidates: number[] = [];
    for (let x = leftStub; x <= rightStub; x += 10) candidates.push(x);
    const middle = (leftStub + rightStub) / 2;
    candidates.sort((x, y) => Math.abs(x - middle) - Math.abs(y - middle));
    for (const x of candidates) {
      if (usedChannels.some((lane) => Math.abs(lane.x - x) < 8 && from <= lane.to + 4 && to >= lane.from - 4)) continue;
      const path = [a.point, { x, y: a.point.y }, { x, y: b.point.y }, b.point];
      if (path.slice(1).some((point, i) => cards.some((card) => crossesCard(path[i]!, point, card)))) continue;
      usedChannels.push({ x, from, to });
      return path;
    }
    return undefined;
  }
  const direct = new Map<string, Point[]>();
  const fallback: EdgeRequest[] = [];
  for (const { link, start, end } of connections) {
    if (singleColumn) {
      const side = start.side === 'left' ? 'left' : 'right';
      const lo = Math.min(start.point.y, end.point.y),
        hi = Math.max(start.point.y, end.point.y);
      const occupied = tracks[side];
      let lane = occupied.findIndex((spans) => spans.every(([from, to]) => hi < from - 8 || lo > to + 8));
      if (lane < 0) {
        lane = occupied.length;
        occupied.push([]);
      }
      occupied[lane]!.push([lo, hi]);
      const x = side === 'left' ? left - 16 - lane * 10 : right + 16 + lane * 10;
      direct.set(link.id, [start.point, { x, y: start.point.y }, { x, y: end.point.y }, end.point]);
    } else {
      const channel = throughGutter(start, end);
      if (channel) direct.set(link.id, channel);
      else
        fallback.push({
          id: link.id,
          sourceId: link.source,
          targetId: link.target,
          sourcePoint: departure(start),
          targetPoint: departure(end),
          sourceDirection: start.side,
          targetDirection: end.side,
        });
    }
  }
  const detours = new Map(
    (fallback.length
      ? routeEdges({ obstacles: cards, edges: fallback }, { obstacleMargin: 8, edgeSpacing: 10, crossingPenalty: 280 })
          .edges
      : []
    ).map((edge) => [edge.id, edge.sections[0]])
  );
  for (const { link, start, end } of connections) {
    const section = detours.get(link.id);
    const points =
      direct.get(link.id) ??
      (section && [start.point, section.startPoint, ...section.bendPoints, section.endPoint, end.point]);
    if (!points) {
      blocked.push(link.id);
      continue;
    }
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
