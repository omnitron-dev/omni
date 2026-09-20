// @vitest-environment happy-dom

/**
 * A stop that failed, on a surface with error handling that never runs.
 *
 * `stopApp` does not throw. The daemon answers `{ success: false, error }`
 * deliberately — its own comment says so: "we surface stopChild errors
 * explicitly without throwing — Netron clients see a structured payload they
 * can render". Three console call sites wrapped it in a `try/catch` and
 * discarded the result, so the `catch` sat on a path nothing takes.
 *
 * The handling existed, read as correct, and could not fire. An operator
 * clicked Stop, saw no error, and the app kept running.
 */

import type { ReactNode } from 'react';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { SnackbarProvider } from '@omnitron-dev/prism';
import '@testing-library/jest-dom/vitest';

const stopApp = vi.fn();
const list = vi.fn(async () => [
  { name: 'main', pid: 4242, status: 'online', cpu: 1, memory: 100, uptime: 1000, restarts: 0, port: 3001 },
]);

vi.mock('src/netron/client', () => ({
  daemon: {
    list: (...a: unknown[]) => list(...a),
    stopApp: (...a: unknown[]) => stopApp(...a),
    startApp: vi.fn(async () => ({})),
    restartApp: vi.fn(async () => ({})),
  },
  logs: {},
  alerts: {},
  project: { listProjects: vi.fn(async () => []), listStacks: vi.fn(async () => []) },
}));

const theme = createTheme();
// The page links to app detail, so it needs a router as well as a theme —
// both come from the app shell in the real console.
const render = (ui: ReactNode) =>
  rtlRender(
    <ThemeProvider theme={theme}>
      <SnackbarProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </SnackbarProvider>
    </ThemeProvider>
  );

/**
 * Stop the page's polling loop without touching the page.
 *
 * `usePolledResource` listens for `visibilitychange` and stops while the
 * document is hidden — the one lever this console already has for "do not
 * fetch now", used here so an assertion about a click is about the click.
 */
function hideDocument(): void {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  stopApp.mockReset();
  list.mockClear();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('stopping an app that will not stop', () => {
  it('says so instead of reporting success', async () => {
    // The daemon's own shape for a failed stop.
    stopApp.mockResolvedValue({ success: false, error: 'child ignored SIGTERM' });

    const { default: AppsPage } = await import('../../webapp/src/pages/apps/index.js');
    const user = userEvent.setup();
    render(<AppsPage />);

    await waitFor(() => expect(screen.getByText('main')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /stop/i }));

    expect(await screen.findByText(/child ignored SIGTERM/i)).toBeInTheDocument();
  });

  it('does not refresh the list on a failed stop', async () => {
    // Refreshing would redraw the app as still running with no explanation —
    // the state an operator reads as "the click did nothing".
    stopApp.mockResolvedValue({ success: false, error: 'child ignored SIGTERM' });

    const { default: AppsPage } = await import('../../webapp/src/pages/apps/index.js');
    const user = userEvent.setup();
    render(<AppsPage />);

    await waitFor(() => expect(screen.getByText('main')).toBeInTheDocument());

    // The page also polls, and the poll calls the same `list`. Counting calls
    // across the click therefore measured "did anything fetch", not "did the
    // stop handler fetch" — and the page re-arms its timer when the realtime
    // connection state settles, which fetches immediately. That is why this
    // assertion failed intermittently against a handler that is correct.
    //
    // `usePolledResource` stops entirely while the document is hidden, so
    // hiding it leaves the click as the only thing that can call `list`.
    hideDocument();
    const before = list.mock.calls.length;

    await user.click(screen.getByRole('button', { name: /stop/i }));
    await screen.findByText(/child ignored SIGTERM/i);

    expect(list.mock.calls.length).toBe(before);
  });

  it('does refresh when the stop worked, measured the same way', async () => {
    // The control for the assertion above: with the poll stopped, a
    // successful stop still fetches exactly once. Without this, "the counter
    // did not move" could equally mean the instrument was broken.
    stopApp.mockResolvedValue({ success: true });

    const { default: AppsPage } = await import('../../webapp/src/pages/apps/index.js');
    const user = userEvent.setup();
    render(<AppsPage />);

    await waitFor(() => expect(screen.getByText('main')).toBeInTheDocument());
    hideDocument();
    const before = list.mock.calls.length;

    await user.click(screen.getByRole('button', { name: /stop/i }));
    await waitFor(() => expect(list.mock.calls.length).toBe(before + 1));
  });

  it('refreshes when the stop worked', async () => {
    stopApp.mockResolvedValue({ success: true });

    const { default: AppsPage } = await import('../../webapp/src/pages/apps/index.js');
    const user = userEvent.setup();
    render(<AppsPage />);

    await waitFor(() => expect(screen.getByText('main')).toBeInTheDocument());
    const before = list.mock.calls.length;
    await user.click(screen.getByRole('button', { name: /stop/i }));

    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(before));
  });
});
