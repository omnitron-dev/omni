import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import type { AppNodeData, TopologyNodeData } from '../../webapp/src/components/topology/topology-store';
import {
  arrangeTopologyNodes,
  nearestTopologyNode,
  readableTopologyViewport,
  topologyColumns,
  TOPOLOGY_CARD_WIDTH,
  TOPOLOGY_CARD_HEIGHT,
  TOPOLOGY_GAP,
} from '../../webapp/src/components/topology/topology-layout';

const app = (id: string, stack = 'dev'): Node<AppNodeData> => ({
  id,
  position: { x: 0, y: 0 },
  data: {
    nodeType: 'app',
    label: id,
    name: id,
    stack,
    remote: false,
    port: null,
    status: 'online',
    pid: 1,
    cpu: 0,
    memory: 1024,
    uptime: 1,
    restarts: 0,
    instances: 1,
  },
});

describe('readable topology framing', () => {
  it.each([304, 736, 1128, 1648])(
    'keeps %i px canvases within width at full text size, even with 50 nodes',
    (width) => {
      const nodes = arrangeTopologyNodes(
        Array.from({ length: 50 }, (_, i) => app(`app-${i}`)),
        topologyColumns(width)
      );
      const viewport = readableTopologyViewport(nodes, { width, height: 600 });
      expect(viewport.zoom).toBe(1);
      for (const node of nodes) {
        expect(viewport.x + node.position.x).toBeGreaterThanOrEqual(0);
        expect(viewport.x + node.position.x + TOPOLOGY_CARD_WIDTH).toBeLessThanOrEqual(width);
      }
      expect(nodes.at(-1)!.position.y).toBeGreaterThan(600);
      expect(nodes[0]!.position.y + viewport.y).toBe(12);
    }
  );

  it('keeps deployment groups separate and cards non-overlapping after reflow', () => {
    const original = [
      ...Array.from({ length: 7 }, (_, i) => app(`dev-${i}`)),
      ...Array.from({ length: 4 }, (_, i) => app(`prod-${i}`, 'prod')),
    ];
    for (const columns of [1, 2, 3, 4]) {
      const nodes = arrangeTopologyNodes(original, columns);
      expect(new Set(nodes.map((node) => node.id)).size).toBe(original.length);
      const devBottom = Math.max(
        ...nodes.filter((node) => node.data.stack === 'dev').map((node) => node.position.y + TOPOLOGY_CARD_HEIGHT)
      );
      const prodTop = Math.min(...nodes.filter((node) => node.data.stack === 'prod').map((node) => node.position.y));
      expect(prodTop - devBottom).toBeGreaterThanOrEqual(TOPOLOGY_GAP);
      for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]!.position;
          const b = nodes[j]!.position;
          expect(Math.abs(a.x - b.x) >= TOPOLOGY_CARD_WIDTH || Math.abs(a.y - b.y) >= TOPOLOGY_CARD_HEIGHT).toBe(true);
        }
    }
    expect(original.every((node) => node.position.x === 0 && node.position.y === 0)).toBe(true);
  });

  it('centres the chosen node at readable scale, even far below the first screen', () => {
    const nodes = arrangeTopologyNodes(
      Array.from({ length: 30 }, (_, i) => app(`app-${i}`)),
      2
    );
    const selected = nodes.at(-1)!;
    const viewport = readableTopologyViewport(nodes, { width: 728, height: 640 }, selected.id);
    expect(viewport.zoom).toBe(1);
    expect(viewport.x + selected.position.x + TOPOLOGY_CARD_WIDTH / 2).toBe(364);
    expect(viewport.y + selected.position.y + TOPOLOGY_CARD_HEIGHT / 2).toBe(320);
  });

  it('keeps owned services alongside their app and stacks the relationship on a phone', () => {
    const nodes: Node<TopologyNodeData>[] = [
      app('main'),
      app('worker'),
      ...['db', 'cache'].map((id) => ({
        id,
        position: { x: 0, y: 0 },
        data: {
          nodeType: 'infra' as const,
          label: id,
          service: id,
          stack: 'dev',
          app: 'main',
          port: null,
          health: 'healthy' as const,
          status: 'running',
        },
      })),
    ];
    const desktop = arrangeTopologyNodes(nodes, 3);
    const main = desktop.find((node) => node.id === 'main')!;
    const db = desktop.find((node) => node.id === 'db')!;
    const cache = desktop.find((node) => node.id === 'cache')!;
    const worker = desktop.find((node) => node.id === 'worker')!;
    expect(db.position.x).toBe(cache.position.x);
    expect(main.position.x - db.position.x).toBe(TOPOLOGY_CARD_WIDTH + TOPOLOGY_GAP);
    expect(main.position.y).toBe((db.position.y + cache.position.y) / 2);
    expect(worker.position.x).toBeGreaterThan(main.position.x);
    const phone = arrangeTopologyNodes(nodes, 1);
    expect(phone.map((node) => node.id)).toEqual(['db', 'cache', 'main', 'worker']);
    expect(phone.every((node) => node.position.x === 0)).toBe(true);
    expect(
      phone
        .filter((node) => node.id !== 'worker')
        .every((node) => node.sourcePosition === 'right' && node.targetPosition === 'right')
    ).toBe(true);
    expect(phone.find((node) => node.id === 'worker')!.sourcePosition).toBe('bottom');
    expect(new Set(phone.map((node) => node.id)).size).toBe(nodes.length);
  });

  it('adapts to an exceptionally narrow canvas without shrinking for a short landscape window', () => {
    const nodes = [app('main')];
    const narrow = readableTopologyViewport(nodes, { width: 240, height: 90 });
    expect(narrow.x).toBe(12);
    expect(narrow.zoom * TOPOLOGY_CARD_WIDTH + narrow.x).toBeLessThanOrEqual(240);
    expect(readableTopologyViewport(nodes, { width: 540, height: 90 }).zoom).toBe(1);
  });

  it('preserves the visible node when a deeply scrolled phone layout reflows onto a desktop', () => {
    const data = Array.from({ length: 50 }, (_, i) => app(`app-${i}`));
    const phone = arrangeTopologyNodes(data, 1);
    const target = phone[37]!;
    const viewport = readableTopologyViewport(phone, { width: 304, height: 600 }, target.id);
    const anchor = nearestTopologyNode(phone, { width: 304, height: 600 }, viewport);
    expect(anchor).toBe(target.id);
    const desktop = arrangeTopologyNodes(data, 3);
    const reframed = readableTopologyViewport(desktop, { width: 1128, height: 640 }, anchor);
    const visible = desktop.find((node) => node.id === anchor)!;
    expect(visible.position.y + reframed.y).toBeGreaterThanOrEqual(0);
    expect(visible.position.y + reframed.y + TOPOLOGY_CARD_HEIGHT).toBeLessThanOrEqual(640);
    expect(reframed.zoom).toBe(1);
  });
});
