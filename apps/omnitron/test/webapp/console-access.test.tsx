// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import '@testing-library/jest-dom/vitest';
import { ConsoleAccessProvider, AccessBoundary, Can, useAccess } from '../../webapp/src/auth/access.js';
import { useAuthStore } from '../../webapp/src/auth/store.js';
import AccessPage from '../../webapp/src/pages/access.js';
import type { ConsoleAccess } from '../../src/shared/dto/access.js';

const { describeAccess, listUsers } = vi.hoisted(() => ({ describeAccess: vi.fn(), listUsers: vi.fn() }));
vi.mock('src/netron/client', () => ({
  access: { describe: describeAccess, listUsers },
  getSessionId: () => 'session-1',
  setStorageToken: vi.fn(),
  clearSession: vi.fn(),
  authRpc: vi.fn(),
}));
vi.mock('../../webapp/src/auth/session-manager', () => ({ sessionManager: { stop: vi.fn(), start: vi.fn() } }));

const snapshot = (allowed: boolean, userId = 'u1'): ConsoleAccess => ({
  userId,
  role: allowed ? 'admin' : 'viewer',
  roles: [],
  capabilities: [{ service: 'OmnitronTerminal', method: 'open', roles: ['admin'], allowed, conditional: false }],
});
function Surface() {
  const { refresh } = useAccess();
  return (
    <>
      <button onClick={() => void refresh()}>Check access</button>
      <Can permission="OmnitronTerminal.open">
        <button>Open SSH</button>
      </Can>
      <AccessBoundary permission="OmnitronTerminal.open">
        <p>Protected terminal</p>
      </AccessBoundary>
    </>
  );
}
function mount(page = <Surface />) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <ConsoleAccessProvider>{page}</ConsoleAccessProvider>
    </ThemeProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  useAuthStore.setState({
    user: { id: 'u1', username: 'test', displayName: 'Test', role: 'admin' },
    sessionId: 'session-1',
    initialized: true,
  });
});

describe('console RPC-derived access', () => {
  it('holds content until grants arrive and removes it on revocation', async () => {
    let resolve!: (value: ConsoleAccess) => void;
    describeAccess.mockReturnValueOnce(
      new Promise<ConsoleAccess>((r) => {
        resolve = r;
      })
    );
    mount();
    expect(screen.queryByText('Protected terminal')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open SSH' })).not.toBeInTheDocument();
    await act(async () => resolve(snapshot(true)));
    expect(await screen.findByText('Protected terminal')).toBeInTheDocument();
    describeAccess.mockResolvedValue(snapshot(false));
    fireEvent.click(screen.getByRole('button', { name: 'Check access' }));
    await waitFor(() => expect(screen.queryByText('Protected terminal')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Open SSH' })).not.toBeInTheDocument();
    expect(useAuthStore.getState().user?.role).toBe('viewer');
  });

  it('clears grants after a failed check and restores them after a successful retry', async () => {
    describeAccess.mockResolvedValue(snapshot(true));
    mount();
    await screen.findByText('Protected terminal');
    describeAccess.mockRejectedValue(new Error('Session revoked'));
    fireEvent.click(screen.getByRole('button', { name: 'Check access' }));
    await screen.findByText(/Could not verify your access/);
    expect(screen.queryByText('Protected terminal')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open SSH' })).not.toBeInTheDocument();
    describeAccess.mockResolvedValue(snapshot(true));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Protected terminal');
  });

  it('never reuses another account’s snapshot', async () => {
    describeAccess.mockResolvedValue(snapshot(true));
    mount();
    await screen.findByText('Protected terminal');
    act(() => useAuthStore.setState({ user: { id: 'u2', username: 'reader', displayName: 'Reader', role: 'viewer' } }));
    expect(screen.queryByText('Protected terminal')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open SSH' })).not.toBeInTheDocument();
  });

  it('shows a viewer’s permissions without requesting the administrator directory', async () => {
    describeAccess.mockResolvedValue(snapshot(false));
    mount(<AccessPage />);
    await screen.findByText('viewer');
    expect(listUsers).not.toHaveBeenCalled();
    expect(screen.queryByText('Console accounts')).not.toBeInTheDocument();
  });
});

it('does not show the previous account page when pagination races an outstanding refresh', async () => {
  describeAccess.mockResolvedValue({
    ...snapshot(true),
    capabilities: [
      { service: 'OmnitronAccess', method: 'listUsers', roles: ['admin'], allowed: true, conditional: false },
    ],
  });
  const account = (id: string) => ({
    id,
    username: `${id}@example.test`,
    displayName: null,
    role: 'viewer',
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  });
  const first = { users: [account('first')], next: 'second-cursor' };
  let resolve!: (value: typeof first) => void;
  listUsers
    .mockResolvedValueOnce(first)
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    )
    .mockResolvedValue({ users: [account('second')], next: null });
  mount(<AccessPage />);
  await screen.findByText('first@example.test');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }));
  await waitFor(() => expect(listUsers).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(screen.queryByText('first@example.test')).not.toBeInTheDocument();
  await act(async () => resolve(first));
  await screen.findByText('second@example.test');
  expect(listUsers).toHaveBeenLastCalledWith({ after: 'second-cursor' });
});
