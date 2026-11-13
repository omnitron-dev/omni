// @vitest-environment happy-dom

/**
 * A containers page that hid a stack.
 *
 * The page lists this machine's Docker, filtered by the selected stack's
 * name prefix. A remote stack's containers run on its node: with «sample /
 * test» selected the table held omnitron's own two, as though test had none,
 * and with all stacks selected test's containers were simply absent — while
 * its stack page showed its PostgreSQL, Redis and MinIO running on the node.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import type { IStackInfo } from '../../src/shared/dto/services.js';

import { useProjectStore } from '../../webapp/src/stores/project.store.js';
import { infra } from 'src/netron/client';

vi.mock('src/auth/access', () => ({ useAccess: () => ({ can: () => true }), Can: ({ children }: { children: import('react').ReactNode }) => children }));

vi.mock('src/netron/client', () => ({
  infra: {
    listContainers: vi.fn(async () => [
      { name: 'omnitron-pg', image: 'postgres:17-alpine', status: 'running', health: 'healthy', ports: {} },
      { name: 'sample-dev-postgres', image: 'postgis', status: 'running', health: 'healthy', ports: {} },
    ]),
  },
  project: { listProjects: vi.fn(async () => []), listStacks: vi.fn(async () => []) },
}));

const stack = (name: string, type: 'local' | 'remote'): IStackInfo => ({ name, type, config: { type },
  status: 'stopped', nodes: [], apps: [], infrastructure: { ready: true, services: {} },
  portRange: null, startedAt: null, uptime: 0, attachedAt: null });

beforeEach(() => {
  useProjectStore.setState({
    activeProject: 'sample',
    activeStack: 'test',
    stacksByProject: { sample: [stack('dev', 'local'), { ...stack('test', 'remote'), infrastructure: {
      ready: true, services: { postgres: { status: 'running', containerName: 'test-postgres', port: 5432 } },
    } }] },
  });
});

describe('a containers page that hid a stack', () => {
  it('reads the remote stack inventory without querying the local Docker engine', async () => {
    const { default: ContainersPage } = await import('../../webapp/src/pages/containers.js');
    render(
      <ThemeProvider theme={createTheme()}>
        <MemoryRouter>
          <ContainersPage />
        </MemoryRouter>
      </ThemeProvider>,
    );

    expect(await screen.findByText(/test-postgres · 5432/)).toBeInTheDocument();
    expect(screen.queryByText('Local total')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop container test-postgres' })).not.toBeInTheDocument();
    expect(infra.listContainers).not.toHaveBeenCalled();
  });
});
