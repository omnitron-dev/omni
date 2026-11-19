import { describe, expect, it } from 'vitest';
import {
  diskSpaceFlow,
  evaluateFlow,
  FlowRegistry,
  validateFlow,
  type FlowDefinition,
  type FlowEvent,
  type FlowState,
} from '../../src/shared/dto/flows.js';

const event = (freeBytes: number): FlowEvent => ({
  id: String(freeBytes),
  source: 'disk',
  type: 'host.disk.sample',
  data: { freeBytes, totalBytes: 500 },
});
describe('Versioned flow graph shared by Console, Studio and the controller', () => {
  it('fires on entering low space, suppresses repeated alarms, rearms at the upper boundary, and models every effect without performing it', () => {
    const graph = diskSpaceFlow('/sample', 100, 150);
    let state: FlowState = {};
    const outcomes = [100, 99, 70, 100, 149, 150, 151, 98].map((n) => {
      const result = evaluateFlow(graph, event(n), state);
      state = JSON.parse(JSON.stringify(result.state));
      return result.effects.map((effect) => effect.nodeId);
    });
    expect(outcomes).toEqual([[], ['low'], [], [], [], ['restored'], [], ['low']]);
  });
  it('rejects invalid or unreachable nodes, mismatched event sources, ambiguity and invalid samples', () => {
    const graph = diskSpaceFlow('/sample', 100, 105);
    expect(() => validateFlow({ ...graph, edges: [...graph.edges, graph.edges[0]] })).toThrow('unoccupied');
    expect(() => validateFlow({ ...graph, edges: graph.edges.slice(1) })).toThrow('path');
    expect(() => evaluateFlow(graph, { ...event(1), type: 'manual' })).toThrow('match');
    expect(() => evaluateFlow(graph, event(-1))).toThrow('disk observation');
    expect(() => validateFlow(diskSpaceFlow('/x', 100, 50))).toThrow('Recovery');
    expect(() =>
      validateFlow({ ...graph, nodes: [...graph.nodes, { id: 'arbitrary', type: 'missing@1', config: {} }] })
    ).toThrow('Unknown');
  });
  it('exposes the same versioned extension and field projection in the editor catalog and in evaluation', () => {
    const registry = new FlowRegistry();
    registry.register({
      type: 'example.round@1',
      label: 'Round',
      group: 'transform',
      fields: [],
      ports: ['rounded'],
      evaluate(_config, data) {
        return { deliveries: [{ port: 'rounded', data: { count: Math.round(Number(data['count'])) } }] };
      },
    });
    const graph: FlowDefinition = {
      version: 1,
      name: 'Observed count',
      nodes: [
        { id: 'input', type: 'input.event@1', config: { eventType: 'sensor' } },
        { id: 'select', type: 'data.select@1', config: { fields: ['count'] } },
        { id: 'round', type: 'example.round@1', config: {} },
        { id: 'report', type: 'output.notify@1', config: { title: 'Count' } },
      ],
      edges: [
        { from: 'input', port: 'event', to: 'select' },
        { from: 'select', port: 'data', to: 'round' },
        { from: 'round', port: 'rounded', to: 'report' },
      ],
    };
    expect(registry.catalog().find((x) => x.type === 'example.round@1')).toMatchObject({ ports: ['rounded'] });
    expect(
      evaluateFlow(
        graph,
        { id: 'e1', source: 'input', type: 'sensor', data: { count: 2.7, private: 'omit' } },
        {},
        registry
      ).effects[0]?.data
    ).toEqual({ count: 3 });
    expect(() => validateFlow(graph)).toThrow('Unknown');
  });
});
