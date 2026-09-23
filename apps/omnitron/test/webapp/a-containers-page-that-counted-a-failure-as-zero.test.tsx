// @vitest-environment happy-dom

/**
 * A containers page that counted a runtime it could not ask as zero.
 *
 * With Docker not answering, the page said «No containers found.
 * Infrastructure containers will appear here when Docker is running» and
 * «Total 0 · Running 0» — a picture of a machine with nothing on it. The
 * daemon now answers such a read with its failure, and the page says it,
 * with no count.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

vi.mock('src/netron/client', () => ({
  infra: {
    listContainers: vi.fn(async () => {
      throw new Error('Cannot connect to the Docker daemon at unix:///var/run/docker.sock');
    }),
  },
  project: { listStacks: vi.fn(async () => []) },
}));

describe('a containers page that counted a failure as zero', () => {
  it('says the runtime could not be asked, and counts nothing', async () => {
    const { default: ContainersPage } = await import('../../webapp/src/pages/containers.js');
    render(
      <ThemeProvider theme={createTheme()}>
        <MemoryRouter>
          <ContainersPage />
        </MemoryRouter>
      </ThemeProvider>
    );

    expect(
      (await screen.findAllByText(/Could not ask the container runtime: Cannot connect to the Docker daemon/)).length
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/No containers found/)).not.toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
