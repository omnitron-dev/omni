// @vitest-environment happy-dom

/**
 * A containers page that read a container's name for its labels.
 *
 * The page kept the selection's containers by name prefix — `sample-dev-` —
 * while every container says which deployment it belongs to in its
 * `omnitron.project` and `omnitron.stack` labels. A prefix is a guess that
 * holds only while no name happens to share it: `sample-` also begins every
 * container of a project called `sample-x`.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

import { useProjectStore } from '../../webapp/src/stores/project.store.js';
import { stackFixture } from '../helpers/stack-fixture.js';

vi.mock('src/auth/access', () => ({
  useAccess: () => ({ can: () => true }), Can: ({ children }: { children: import('react').ReactNode }) => children,
}));

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
      container('sample-dev-postgres', 'sample', 'dev'),
      // Named for another deployment's prefix; labelled for this one.
      container('pg-restored-from-backup', 'sample', 'dev'),
      // Another project whose name begins with this one's.
      container('sample-x-dev-postgres', 'sample-x', 'dev'),
      container('sample-test-postgres', 'sample', 'test'),
      // The controller workspace owns this container.
      { ...container('omnitron-pg'), lifecycleRestriction: 'The control plane owns this container.' },
    ]),
  },
  project: { listStacks: vi.fn(async () => []) },
}));

describe('a containers page that read the name for the label', () => {
  it("lists only the selected stack's containers by their labels", async () => {
    useProjectStore.setState({ activeProject: 'sample', activeStack: 'dev', stacksByProject: { sample: [stackFixture('dev')] } });
    const { default: ContainersPage } = await import('../../webapp/src/pages/containers.js');
    render(
      <ThemeProvider theme={createTheme()}>
        <MemoryRouter>
          <ContainersPage />
        </MemoryRouter>
      </ThemeProvider>
    );

    expect(await screen.findByText('sample-dev-postgres')).toBeInTheDocument();
    expect(screen.getByText('pg-restored-from-backup')).toBeInTheDocument();
    expect(screen.queryByText('omnitron-pg')).not.toBeInTheDocument();
    expect(screen.queryByText('sample-x-dev-postgres')).not.toBeInTheDocument();
    expect(screen.queryByText('sample-test-postgres')).not.toBeInTheDocument();
  });
});
