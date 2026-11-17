// @vitest-environment happy-dom

import type { ReactNode } from 'react';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { SnackbarProvider } from '@omnitron-dev/prism';
import '@testing-library/jest-dom/vitest';
import { ConsoleAccessProvider } from '../../webapp/src/auth/access.js';
import { useAuthStore } from '../../webapp/src/auth/store.js';

const list = vi.fn();
const getSnapshot = vi.fn();

vi.mock('src/netron/client', () => ({
  access: { describe: vi.fn(async () => ({ userId: 'reader', role: 'viewer', roles: [], capabilities: [
    { service: 'OmnitronDaemon', method: 'list', allowed: true },
    { service: 'OmnitronDaemon', method: 'getApp', allowed: true },
    { service: 'OmnitronMetrics', method: 'getSnapshot', allowed: true },
  ] })) },
  daemon: { list: (...a: unknown[]) => list(...a), status: vi.fn(async () => ({ apps: [] })) },
  metrics: { getSnapshot: (...a: unknown[]) => getSnapshot(...a) },
  logs: {},
  alerts: { getSummary: vi.fn(async () => ({})) },
  nodes: { listNodes: vi.fn(async () => []) },
  project: { listProjects: vi.fn(async () => []), listStacks: vi.fn(async () => []) },
}));

const theme = createTheme();
const render = (ui: ReactNode) =>
  rtlRender(
    <ThemeProvider theme={theme}>
      <SnackbarProvider>
        <MemoryRouter><ConsoleAccessProvider>{ui}</ConsoleAccessProvider></MemoryRouter>
      </SnackbarProvider>
    </ThemeProvider>
  );

const app = (name: string) => ({
  name, pid: 1, status: 'online', cpu: 1, memory: 100, uptime: 1, restarts: 0, port: null,
});

beforeEach(() => {
  useAuthStore.setState({ user: { id: 'reader', username: 'reader', displayName: 'Reader', role: 'viewer' } });
  list.mockReset();
  getSnapshot.mockReset();
});

describe('dashboard with a half-failed refresh', () => {
  it('says the figures are stale rather than clearing the error', async () => {
    list.mockResolvedValueOnce([app('main')]).mockRejectedValue(new Error('daemon unreachable'));
    getSnapshot.mockResolvedValue({ apps: {} });

    const { default: Dashboard } = await import('../../webapp/src/pages/dashboard.js');
    render(<Dashboard />);

    await waitFor(() => expect(screen.getByRole('link', { name: 'main' })).toBeInTheDocument());

    // The second poll fails on the app list only.
    await waitFor(() => expect(screen.getByText(/last available application inventory.*daemon unreachable/i)).toBeInTheDocument(), {
      timeout: 8000,
    });
    // And the last good data is still shown — blanking it would be the
    // other half of this defect.
    expect(screen.getByRole('link', { name: 'main' })).toBeInTheDocument();
  }, 15_000);

  it('names metrics when metrics is the half that failed', async () => {
    list.mockResolvedValue([app('main')]);
    getSnapshot.mockResolvedValueOnce({ apps: {} }).mockRejectedValue(new Error('collector down'));

    const { default: Dashboard } = await import('../../webapp/src/pages/dashboard.js');
    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText(/resource sampling is unavailable.*collector down/i)).toBeInTheDocument(), {
      timeout: 8000,
    });
  }, 15_000);

  it('shows no error while both halves answer', async () => {
    list.mockResolvedValue([app('main')]);
    getSnapshot.mockResolvedValue({ apps: {} });

    const { default: Dashboard } = await import('../../webapp/src/pages/dashboard.js');
    render(<Dashboard />);

    await waitFor(() => expect(screen.getByRole('link', { name: 'main' })).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('uses the same current readings in the summary and application cards', async () => {
    list.mockResolvedValue([app('main')]);
    getSnapshot.mockResolvedValue({ apps: { main: { cpu: 4, memory: 1024 } } });
    const { default: Dashboard } = await import('../../webapp/src/pages/dashboard.js');
    render(<Dashboard />);
    await screen.findByRole('link', { name: 'main' });
    await waitFor(() => expect(screen.getAllByText('4.0%')).toHaveLength(2));
    expect(screen.getAllByText('1 KiB')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Show resource distribution' }));
    const ranking = screen.getByRole('list', { name: 'Resident memory by application' });
    expect(within(ranking).getByRole('listitem')).toHaveTextContent('main1 KiB');
  });

});
