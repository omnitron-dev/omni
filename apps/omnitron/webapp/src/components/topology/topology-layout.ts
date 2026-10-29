import { Position, type Node, type Viewport } from '@xyflow/react';
import type { TopologyNodeData } from './topology-store';

export const TOPOLOGY_CARD_WIDTH = 280;
export const TOPOLOGY_CARD_HEIGHT = 152;
export const TOPOLOGY_GAP = 24;
export const TOPOLOGY_PADDING = 12;

export function topologyColumns(width: number): number {
  return Math.max(
    1,
    Math.min(4, Math.floor((width - TOPOLOGY_PADDING * 2 + TOPOLOGY_GAP) / (TOPOLOGY_CARD_WIDTH + TOPOLOGY_GAP)))
  );
}

const order = { server: 0, gateway: 1, app: 2, infra: 3 };

/** Compact deployment groups. A large deployment continues below the viewport at readable scale. */
export function arrangeTopologyNodes<T extends Node<TopologyNodeData>>(nodes: T[], columns: number): T[] {
  const groups = new Map<string | null, T[]>();
  for (const node of nodes) {
    const key = node.data.nodeType === 'server' ? (node.data.stacks[0] ?? null) : node.data.stack;
    const group = groups.get(key) ?? [];
    group.push(node);
    groups.set(key, group);
  }
  const result: T[] = [];
  let top = 0;
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => order[a.data.nodeType] - order[b.data.nodeType]);
    const placed = new Set<string>();
    const occupied: boolean[][] = [];
    const put = (node: T, column: number, row: number, sideRoute = false) => {
      placed.add(node.id);
      result.push({
        ...node,
        sourcePosition: columns === 1 && !sideRoute ? Position.Bottom : Position.Right,
        targetPosition: sideRoute ? Position.Right : columns === 1 ? Position.Top : Position.Left,
        position: {
          x: column * (TOPOLOGY_CARD_WIDTH + TOPOLOGY_GAP),
          y: top + row * (TOPOLOGY_CARD_HEIGHT + TOPOLOGY_GAP),
        },
      });
    };
    for (const node of sorted) {
      if (placed.has(node.id)) continue;
      // A declared service-to-app edge stays inside a reserved block. Other cards
      // cannot occupy its route, and a small screen stacks the same pair vertically.
      const appName = node.data.nodeType === 'app' ? node.data.name.split('/').at(-1) : null;
      const owned = appName
        ? sorted.filter(
            (service) => service.data.nodeType === 'infra' && service.data.app === appName && !placed.has(service.id)
          )
        : [];
      const width = owned.length && columns > 1 ? 2 : 1;
      const height = owned.length ? (columns > 1 ? owned.length : owned.length + 1) : 1;
      let row = 0;
      let column = 0;
      search: for (; ; row++) {
        for (column = 0; column <= columns - width; column++) {
          const fits = Array.from({ length: height }, (_, y) =>
            Array.from({ length: width }, (_, x) => !occupied[row + y]?.[column + x]).every(Boolean)
          ).every(Boolean);
          if (fits) break search;
        }
      }
      for (let y = 0; y < height; y++) {
        occupied[row + y] ??= [];
        for (let x = 0; x < width; x++) occupied[row + y]![column + x] = true;
      }
      // Multiple vertical relationships use the outside gutter instead of passing
      // through intervening cards. The edge's 8 px offset fits the canvas padding.
      const sideRoute = columns === 1 && owned.length > 1;
      owned.forEach((service, index) => put(service, column, row + index, sideRoute));
      put(
        node,
        column + width - 1,
        row + (owned.length ? (columns > 1 ? (height - 1) / 2 : owned.length) : 0),
        sideRoute
      );
    }
    top += occupied.length * (TOPOLOGY_CARD_HEIGHT + TOPOLOGY_GAP) + TOPOLOGY_GAP;
  }
  return result;
}

/** Fit a card's width, never shrink the whole deployment just to fit its height. */
export function readableTopologyViewport(
  nodes: Pick<Node, 'id' | 'position'>[],
  size: { width: number; height: number },
  focusId?: string | null
): Viewport {
  const zoom = Math.min(1, Math.max(0.1, (size.width - TOPOLOGY_PADDING * 2) / TOPOLOGY_CARD_WIDTH));
  const selected = nodes.find((node) => node.id === focusId);
  if (selected)
    return {
      x: size.width / 2 - (selected.position.x + TOPOLOGY_CARD_WIDTH / 2) * zoom,
      y: Math.max(TOPOLOGY_PADDING, (size.height - TOPOLOGY_CARD_HEIGHT * zoom) / 2) - selected.position.y * zoom,
      zoom,
    };
  const left = nodes.length ? Math.min(...nodes.map((node) => node.position.x)) : 0;
  const top = nodes.length ? Math.min(...nodes.map((node) => node.position.y)) : 0;
  const right = nodes.length
    ? Math.max(...nodes.map((node) => node.position.x + TOPOLOGY_CARD_WIDTH))
    : TOPOLOGY_CARD_WIDTH;
  return {
    x: Math.max(TOPOLOGY_PADDING, (size.width - (right - left) * zoom) / 2) - left * zoom,
    y: TOPOLOGY_PADDING - top * zoom,
    zoom,
  };
}

/** Keep the same part of a long graph in view when its columns reflow. */
export function nearestTopologyNode(
  nodes: Pick<Node, 'id' | 'position'>[],
  size: { width: number; height: number },
  viewport: Viewport
): string | null {
  const centreX = (size.width / 2 - viewport.x) / viewport.zoom;
  const centreY = (size.height / 2 - viewport.y) / viewport.zoom;
  let nearest: string | null = null;
  let distance = Infinity;
  for (const node of nodes) {
    const dx = node.position.x + TOPOLOGY_CARD_WIDTH / 2 - centreX;
    const dy = node.position.y + TOPOLOGY_CARD_HEIGHT / 2 - centreY;
    const candidate = dx * dx + dy * dy;
    if (candidate < distance) {
      nearest = node.id;
      distance = candidate;
    }
  }
  return nearest;
}
