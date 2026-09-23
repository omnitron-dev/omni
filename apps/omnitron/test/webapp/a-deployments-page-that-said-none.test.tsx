// @vitest-environment happy-dom

/**
 * A deployments page that said none were made.
 *
 * Its history is the `deployments` table: apps deployed one at a time, with
 * the Deploy button or `omnitron deploy`. Stacks started from releases are
 * recorded in the audit trail. On the master, 2026-09-23, the table held 0
 * rows beside stacks deployed from releases all day, and the page said «No
 * deployments yet». It now says what it records and where the rest is.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

vi.mock('src/netron/client', () => ({
  deploy: { getHistory: vi.fn(async () => []), listDeployableApps: vi.fn(async () => []), deployApp: vi.fn() },
  project: { getDeployProgress: vi.fn(async () => []) },
}));

describe('a deployments page that said none were made', () => {
  it('says what it records, and points at where a release deployment is', async () => {
    const { default: DeploymentsPage } = await import('../../webapp/src/pages/deployments.js');
    render(
      <ThemeProvider theme={createTheme()}>
        <MemoryRouter>
          <DeploymentsPage />
        </MemoryRouter>
      </ThemeProvider>,
    );

    expect(await screen.findByText(/Apps deployed one at a time/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Releases' })).toHaveAttribute('href', '/releases');
    expect(screen.queryByText('No deployments yet')).not.toBeInTheDocument();
  });
});
