// @vitest-environment happy-dom

/**
 * Telling "nothing there" from "could not look".
 *
 * Several console surfaces answered a failed RPC with the empty value for
 * whatever they display: an empty node list, an empty log panel. Those are
 * not error states — they are valid answers, and an operator acts on them.
 * "No nodes" on the page whose job is to show the fleet reads as a fleet
 * that is gone; "no recent logs" reads as an app that has been quiet.
 *
 * Both surfaces poll, so a single failed call used to erase what someone was
 * reading and replace it with a confident, wrong statement.
 */

import type { ReactNode } from 'react';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { SnackbarProvider } from '@omnitron-dev/prism';
import '@testing-library/jest-dom/vitest';

// The page reads the MUI theme and the snackbar context; neither is optional
// in a renderer, and both come from `PrismProvider` in the real app.
const theme = createTheme();
const render = (ui: ReactNode) =>
  rtlRender(
    <ThemeProvider theme={theme}>
      <SnackbarProvider>{ui}</SnackbarProvider>
    </ThemeProvider>
  );

const listNodes = vi.fn();
const listSshKeys = vi.fn(async () => []);
const getUptimeBar = vi.fn(async () => []);

vi.mock('src/netron/client', () => ({
  nodes: {
    listNodes: (...a: unknown[]) => listNodes(...a),
    listSshKeys: (...a: unknown[]) => listSshKeys(...a),
    getUptimeBar: (...a: unknown[]) => getUptimeBar(...a),
    checkSsh: vi.fn(),
    addNode: vi.fn(),
    updateNode: vi.fn(),
    removeNode: vi.fn(),
  },
  logs: { streamLogs: vi.fn() },
  daemon: {},
  alerts: {},
}));

const node = (name: string) => ({
  id: `id-${name}`,
  name,
  host: '10.0.0.1',
  port: 9700,
  status: 'online',
  isLocal: false,
  role: 'worker',
  // Required on `INode`, and the service always fills it — the card reads
  // `node.tags.length` without a guard, which is fine because of that.
  tags: [],
  sshUser: 'root',
  createdAt: new Date().toISOString(),
});

beforeEach(() => {
  listNodes.mockReset();
  listSshKeys.mockClear();
  getUptimeBar.mockClear();
});

describe('nodes page', () => {
  it('keeps the last good list when a refresh fails, and says so', async () => {
    const { default: NodesPage } = await import('../../webapp/src/pages/nodes.js');

    listNodes.mockResolvedValueOnce([node('alpha')]).mockRejectedValue(new Error('daemon unreachable'));

    render(<NodesPage />);

    await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument());

    // The polling interval is long; drive the second, failing fetch through
    // the Refresh button, which takes the same path.
    screen.getByRole('button', { name: /refresh/i }).click();

    await waitFor(() => expect(screen.getByText(/could not refresh the node list/i)).toBeInTheDocument());
    // The card is still there. Blanking it would have said "no nodes".
    expect(screen.getByText('alpha')).toBeInTheDocument();
  });

  it('distinguishes an empty fleet from an unreadable one', async () => {
    const { default: NodesPage } = await import('../../webapp/src/pages/nodes.js');

    listNodes.mockResolvedValue([]);
    render(<NodesPage />);

    await waitFor(() => expect(screen.getByText('No nodes registered')).toBeInTheDocument());
    expect(screen.queryByText(/could not refresh/i)).not.toBeInTheDocument();
  });

  it('says nothing about the fleet when the very first call fails', async () => {
    const { default: NodesPage } = await import('../../webapp/src/pages/nodes.js');

    listNodes.mockRejectedValue(new Error('daemon unreachable'));
    render(<NodesPage />);

    await waitFor(() => expect(screen.getByText(/could not refresh the node list/i)).toBeInTheDocument());
    // Not "No nodes registered" — that is a claim the console cannot make.
    expect(screen.getByText('No nodes to show')).toBeInTheDocument();
    expect(screen.queryByText('No nodes registered')).not.toBeInTheDocument();
  });
});
