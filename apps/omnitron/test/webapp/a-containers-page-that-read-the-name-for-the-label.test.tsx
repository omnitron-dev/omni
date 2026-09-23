// @vitest-environment happy-dom

/**
 * A containers page that read a container's name for its labels.
 *
 * The page kept the selection's containers by name prefix — `daos-dev-` —
 * while every container says which deployment it belongs to in its
 * `omnitron.project` and `omnitron.stack` labels. A prefix is a guess that
 * holds only while no name happens to share it: `daos-` also begins every
 * container of a project called `daos-x`.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

import { useProjectStore } from '../../webapp/src/stores/project.store.js';

const container = (name: string, project?: string, stack?: string) => ({
  name,
  image: 'postgres:17-alpine',
  status: 'running',
  health: 'healthy',
  ...(project && { project, stack }),
});

vi.mock('src/netron/client', () => ({
  infra: {
    listContainers: vi.fn(async () => [
      container('daos-dev-postgres', 'daos', 'dev'),
      // Named for another deployment's prefix; labelled for this one.
      container('pg-restored-from-backup', 'daos', 'dev'),
      // Another project whose name begins with this one's.
      container('daos-x-dev-postgres', 'daos-x', 'dev'),
      container('daos-test-postgres', 'daos', 'test'),
      // The daemon's own, in every scope.
      container('omnitron-pg'),
    ]),
  },
  project: { listStacks: vi.fn(async () => []) },
}));

describe('a containers page that read the name for the label', () => {
  it("lists the selected stack's containers by their labels, and the daemon's own", async () => {
    useProjectStore.setState({ activeProject: 'daos', activeStack: 'dev', stacksByProject: {} });
    const { default: ContainersPage } = await import('../../webapp/src/pages/containers.js');
    render(
      <ThemeProvider theme={createTheme()}>
        <MemoryRouter>
          <ContainersPage />
        </MemoryRouter>
      </ThemeProvider>
    );

    expect(await screen.findByText('daos-dev-postgres')).toBeInTheDocument();
    expect(screen.getByText('pg-restored-from-backup')).toBeInTheDocument();
    expect(screen.getByText('omnitron-pg')).toBeInTheDocument();
    expect(screen.queryByText('daos-x-dev-postgres')).not.toBeInTheDocument();
    expect(screen.queryByText('daos-test-postgres')).not.toBeInTheDocument();
  });
});
