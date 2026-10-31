// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { ReactFlow, type Edge, type Node } from '@xyflow/react';
import { AppNode } from '../../webapp/src/components/topology/app-node.js';
import { InfraNode } from '../../webapp/src/components/topology/infra-node.js';
import { connectDependencies } from '../../webapp/src/components/topology/dependency-graph.js';
import type { TopologyNodeData } from '../../webapp/src/components/topology/topology-store.js';

vi.mock('src/netron/client', () => ({ daemon: {}, infra: {}, project: {} }));
afterEach(cleanup);

describe('rendered topology connections', () => {
  it('provides both ends of configured dependencies and service ownership links', async () => {
    const nodes: Node<TopologyNodeData>[] = [
      {
        id: 'app-dev-example/dev/api',
        type: 'appNode',
        position: { x: 0, y: 0 },
        data: {
          nodeType: 'app',
          name: 'example/dev/api',
          label: 'api',
          stack: 'dev',
          remote: false,
          port: null,
          status: 'online',
          pid: 123,
          cpu: 0,
          memory: 0,
          uptime: 1,
          restarts: 0,
          instances: 1,
        },
      },
      {
        id: 'infra-dev-redis',
        type: 'infraNode',
        position: { x: 304, y: 0 },
        data: {
          nodeType: 'infra',
          service: 'redis',
          label: 'redis',
          stack: 'dev',
          port: 6379,
          health: 'healthy',
          status: 'running',
        },
      },
    ];
    const edges: Edge[] = [{ id: 'ownership', source: nodes[1]!.id, target: nodes[0]!.id }];
    connectDependencies(
      nodes,
      edges,
      [
        {
          project: 'example',
          stack: 'dev',
          app: 'api',
          service: 'redis',
          host: 'localhost',
          port: 6379,
          via: 'REDIS_URL',
          evidence: 'configuration',
        },
      ],
      { project: 'example', stack: 'dev' }
    );
    const { container } = render(
      <ThemeProvider theme={createTheme()}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={{ appNode: AppNode, infraNode: InfraNode }} />
      </ThemeProvider>
    );
    await waitFor(() => {
      for (const edge of edges) {
        const source = container.querySelector(`[data-id="${edge.source}"]`);
        const target = container.querySelector(`[data-id="${edge.target}"]`);
        expect(source?.querySelector('.react-flow__handle.source'), `${edge.id}: source`).toBeTruthy();
        expect(target?.querySelector('.react-flow__handle.target'), `${edge.id}: target`).toBeTruthy();
      }
    });
  });
});
