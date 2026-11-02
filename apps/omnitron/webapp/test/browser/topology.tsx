import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import type { Node } from '@xyflow/react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import TopologyPage from '../../src/pages/topology';
import { useTopologyStore, type AppNodeData, type InfraNodeData } from '../../src/components/topology/topology-store';

const position = { x: 0, y: 0 };
const placement = { stack: 'test', deploymentKey: 'example/test' };
const dependencies = {
  api: ['postgres', 'redis'],
  worker: ['redis', 'nats'],
  mail: ['postgres', 'nats'],
  scheduler: ['postgres', 'redis'],
  events: ['redis', 'nats'],
  files: ['postgres', 'nats'],
};
const apps: Node<AppNodeData>[] = Object.keys(dependencies).map((name) => ({
  id: name,
  type: 'appNode',
  position,
  data: {
    ...placement,
    nodeType: 'app',
    label: name,
    name,
    status: 'online',
    remote: false,
    port: null,
    pid: null,
    cpu: 0,
    memory: 0,
    uptime: 0,
    restarts: 0,
    instances: 1,
  },
}));
const services: Node<InfraNodeData>[] = ['postgres', 'redis', 'nats'].map((service) => ({
  id: service,
  type: 'infraNode',
  position,
  data: { ...placement, nodeType: 'infra', label: service, service, port: null, health: 'healthy', status: 'running' },
}));
const edges = Object.entries(dependencies).flatMap(([app, targets]) =>
  targets.map((service) => ({
    id: `${app}->${service}`,
    source: app,
    target: service,
    data: { evidence: 'configuration', via: ['bootstrap'] },
  }))
);

// Only inventory is supplied by the fixture. The real component owns layout, the worker, input and storage.
useTopologyStore.setState({
  nodes: [...apps, ...services],
  edges,
  apps: apps.map((app) => app.data),
  loading: false,
  fetchAll: async () => {},
  setScope: () => {},
});

createRoot(document.getElementById('root')!).render(
  <ThemeProvider theme={createTheme({ palette: { mode: 'dark' } })}>
    <CssBaseline />
    <MemoryRouter initialEntries={['/topology']}>
      <TopologyPage />
    </MemoryRouter>
  </ThemeProvider>
);
