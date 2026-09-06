// @vitest-environment happy-dom

/**
 * The dashboard when half of it fails.
 *
 * `Promise.allSettled` never rejects, so the `try/catch` around it cannot
 * see a failed half — and the code cleared the error unconditionally
 * afterwards. A failed `daemon.list()` therefore left the last apps on
 * screen with nothing to say they were stale, and an explicit statement
 * that everything was fine.
 *
 * This is the panel an operator looks at first, so "these numbers are old"
 * has to be on it rather than inferred from them not changing.
 */

import type { ReactNode } from 'react';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { SnackbarProvider } from '@omnitron-dev/prism';
import '@testing-library/jest-dom/vitest';

const list = vi.fn();
const getSnapshot = vi.fn();

vi.mock('src/netron/client', () => ({
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
        <MemoryRouter>{ui}</MemoryRouter>
      </SnackbarProvider>
    </ThemeProvider>
  );

const app = (name: string) => ({
  name, pid: 1, status: 'online', cpu: 1, memory: 100, uptime: 1, restarts: 0, port: null,
});

beforeEach(() => {
  list.mockReset();
  getSnapshot.mockReset();
});

describe('dashboard with a half-failed refresh', () => {
  it('says the figures are stale rather than clearing the error', async () => {
    list.mockResolvedValueOnce([app('main')]).mockRejectedValue(new Error('daemon unreachable'));
    getSnapshot.mockResolvedValue({ apps: {} });

    const { default: Dashboard } = await import('../../webapp/src/pages/dashboard.js');
    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText('main')).toBeInTheDocument());

    // The second poll fails on the app list only.
    await waitFor(() => expect(screen.getByText(/could not refresh the app list/i)).toBeInTheDocument(), {
      timeout: 8000,
    });
    // And the last good data is still shown — blanking it would be the
    // other half of this defect.
    expect(screen.getByText('main')).toBeInTheDocument();
  }, 15_000);

  it('names metrics when metrics is the half that failed', async () => {
    list.mockResolvedValue([app('main')]);
    getSnapshot.mockResolvedValueOnce({ apps: {} }).mockRejectedValue(new Error('collector down'));

    const { default: Dashboard } = await import('../../webapp/src/pages/dashboard.js');
    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText(/could not refresh metrics/i)).toBeInTheDocument(), {
      timeout: 8000,
    });
  }, 15_000);

  it('shows no error while both halves answer', async () => {
    list.mockResolvedValue([app('main')]);
    getSnapshot.mockResolvedValue({ apps: {} });

    const { default: Dashboard } = await import('../../webapp/src/pages/dashboard.js');
    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText('main')).toBeInTheDocument());
    expect(screen.queryByText(/could not refresh/i)).not.toBeInTheDocument();
  });
});
