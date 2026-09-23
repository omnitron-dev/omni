// @vitest-environment happy-dom

/**
 * A containers page that hid a stack.
 *
 * The page lists this machine's Docker, filtered by the selected stack's
 * name prefix. A remote stack's containers run on its node: with «daos /
 * test» selected the table held omnitron's own two, as though test had none,
 * and with all stacks selected test's containers were simply absent — while
 * its stack page showed its PostgreSQL, Redis and MinIO running on the node.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

import { useProjectStore } from '../../webapp/src/stores/project.store.js';

vi.mock('src/netron/client', () => ({
  infra: {
    listContainers: vi.fn(async () => [
      { name: 'omnitron-pg', image: 'postgres:17-alpine', status: 'running', health: 'healthy', ports: [] },
      { name: 'daos-dev-postgres', image: 'postgis', status: 'running', health: 'healthy', ports: [] },
    ]),
  },
  project: { listProjects: vi.fn(async () => []), listStacks: vi.fn(async () => []) },
}));

const stack = (name: string, type: 'local' | 'remote') => ({ name, type }) as never;

beforeEach(() => {
  useProjectStore.setState({
    activeProject: 'daos',
    activeStack: 'test',
    stacksByProject: { daos: [stack('dev', 'local'), stack('test', 'remote')] },
  });
});

describe('a containers page that hid a stack', () => {
  it('says the list is this machine’s, and where the remote stack’s containers are', async () => {
    const { default: ContainersPage } = await import('../../webapp/src/pages/containers.js');
    render(
      <ThemeProvider theme={createTheme()}>
        <MemoryRouter>
          <ContainersPage />
        </MemoryRouter>
      </ThemeProvider>,
    );

    expect(await screen.findByText(/These are this machine/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'test' })).toHaveAttribute('href', '/stacks/test');
  });
});
