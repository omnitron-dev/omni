import { describe, expect, it } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import type { TopologyNodeData } from '../../webapp/src/components/topology/topology-store.js';
import { connectDependencies } from '../../webapp/src/components/topology/dependency-graph.js';
import { arrangeDependencyTopology, TOPOLOGY_CARD_WIDTH, TOPOLOGY_CARD_HEIGHT } from '../../webapp/src/components/topology/topology-layout.js';
const app = (name: string) => ({ id: `app-dev-sample/dev/${name}`, type: 'appNode', position: { x: 0, y: 0 }, data: { nodeType: 'app', name: `sample/dev/${name}`, stack: 'dev', label: name } }) as Node<TopologyNodeData>;
const service = { id: 'infra-dev-redis', type: 'infraNode', position: { x: 0, y: 0 }, data: { nodeType: 'infra', service: 'redis', stack: 'dev', label: 'redis', port: 6379, health: 'healthy', status: 'running' } } as Node<TopologyNodeData>;
const dependency = { project: 'sample', stack: 'dev', app: 'api', service: 'redis', host: 'localhost', port: 6379, via: 'REDIS_URL', evidence: 'configuration' as const };
describe('configured dependency graph', () => {
  it('connects shared services and aggregates evidence without duplicating nodes or claiming traffic', () => {
    const nodes = [app('api'), app('worker'), structuredClone(service)], edges: Edge[] = [];
    connectDependencies(nodes, edges, [dependency, { ...dependency, via: 'DISCOVERY_REDIS_URL' }, { ...dependency, app: 'worker' }], { project: 'sample', stack: 'dev' });
    expect(nodes).toHaveLength(3); expect(edges).toHaveLength(2);
    expect(edges.every(edge => edge.target === service.id && !edge.animated)).toBe(true);
    expect(edges[0]!.data!.via).toEqual(['REDIS_URL', 'DISCOVERY_REDIS_URL']);
  });
  it('never borrows local container health for an external endpoint or another deployment', () => {
    const nodes = [app('api'), structuredClone(service)], edges: Edge[] = [];
    connectDependencies(nodes, edges, [{ ...dependency, host: 'outside.example' }, { ...dependency, stack: 'prod' }], { project: 'sample', stack: null });
    expect(nodes).toHaveLength(3); expect(edges).toHaveLength(1);
    expect(edges[0]!.target).not.toBe(service.id);
    expect(nodes[2]!.data).toMatchObject({ status: 'configured', health: 'unknown' });
  });
  it.each([1, 2, 4])('keeps consumer/provider cards distinct at %i columns', columns => {
    const nodes = [app('api'), app('worker'), structuredClone(service)];
    const arranged = arrangeDependencyTopology(nodes, columns);
    for (const a of arranged) for (const b of arranged) if (a !== b) {
      expect(Math.abs(a.position.x - b.position.x) >= TOPOLOGY_CARD_WIDTH || Math.abs(a.position.y - b.position.y) >= TOPOLOGY_CARD_HEIGHT).toBe(true);
    }
    expect(nodes.every(node => node.position.y === 0 && node.position.x === 0)).toBe(true);
  });
});
