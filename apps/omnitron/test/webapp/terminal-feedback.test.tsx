// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import TerminalPage from '../../webapp/src/pages/terminal.js';
import type { TerminalSession, TerminalRead } from '../../src/shared/dto/terminal.js';
const api = vi.hoisted(() => ({
  listNodes: vi.fn(),
  capabilities: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  read: vi.fn(),
  resize: vi.fn(),
}));
vi.mock('src/netron/client', () => ({ nodes: api, terminal: api }));
vi.mock('src/auth/store', () => ({
  useAuthStore: (select: (s: unknown) => unknown) => select({ user: { id: 'operator', role: 'admin' } }),
}));
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options = {};
    parser = { registerOscHandler() {} };
    loadAddon() {}
    attachCustomKeyEventHandler() {}
    open() {}
    dispose() {}
    focus() {}
    onData() {
      return { dispose() {} };
    }
    onBinary() {
      return { dispose() {} };
    }
    onResize() {
      return { dispose() {} };
    }
    write(_bytes: unknown, done: () => void) {
      done();
    }
    writeln() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (e: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const session = (id = 'one'): TerminalSession => ({
  id,
  nodeId: 'remote',
  nodeName: 'Remote',
  host: 'example.test',
  username: 'ops',
  fingerprint: 'SHA256:test',
  createdAt: new Date().toISOString(),
  state: 'open',
  cols: 100,
  rows: 28,
});
function mount() {
  return render(
    <ThemeProvider theme={createTheme()}>
      <MemoryRouter>
        <TerminalPage />
      </MemoryRouter>
    </ThemeProvider>
  );
}
async function open() {
  const button = await screen.findByRole('button', { name: 'New SSH tab' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}
beforeEach(() => {
  vi.resetAllMocks();
  api.listNodes.mockResolvedValue([
    { id: 'remote', name: 'Remote', host: 'example.test', sshUser: 'ops', isLocal: false },
  ]);
  api.capabilities.mockResolvedValue({
    enabled: true,
    maxSessionsPerOwner: 8,
    idleTimeoutMs: 60000,
    disconnectTimeoutMs: 30000,
  });
  api.open.mockResolvedValue(session());
  api.close.mockResolvedValue(undefined);
  api.resize.mockResolvedValue(undefined);
  api.read.mockImplementation(() => new Promise(() => {}));
});
afterEach(cleanup);
it('opens a pending tab immediately, blocks duplicate opens, and reports a failed connection with retry', async () => {
  const request = deferred<TerminalSession>();
  api.open.mockReturnValueOnce(request.promise);
  mount();
  await open();
  expect(screen.getByRole('tab', { name: /Remote · connecting/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('Connecting to Remote')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'New SSH tab' }));
  expect(api.open).toHaveBeenCalledOnce();
  await act(async () => request.reject(new Error('Host key is not trusted')));
  expect(screen.getByRole('alert')).toHaveTextContent('Host key is not trusted');
  fireEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
  await screen.findByRole('tab', { name: 'Remote 1' });
  expect(screen.queryByText('Connecting to Remote')).not.toBeInTheDocument();
});
it('does not steal selection when a connection finishes in another tab', async () => {
  mount();
  await open();
  await screen.findByRole('tab', { name: 'Remote 1' });
  const second = deferred<TerminalSession>();
  api.open.mockReturnValueOnce(second.promise);
  await open();
  fireEvent.click(screen.getByRole('tab', { name: 'Remote 1' }));
  await act(async () => second.resolve(session('two')));
  expect(screen.getByRole('tab', { name: 'Remote 1' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Remote 2' })).toHaveAttribute('aria-selected', 'false');
});
it('removes an expired tab without asking to close an already ended session', async () => {
  api.read.mockResolvedValueOnce({
    session: { ...session(), state: 'closed', reason: 'idle_timeout' },
    data: '',
    cursor: 0,
    hasMore: false,
    droppedBytes: 0,
  });
  mount();
  await open();
  await screen.findByRole('tab', { name: /Remote 1 · closed/ });
  expect(screen.getByText(/Session ended: idle timeout/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Terminal input unavailable' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Close Remote 1' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  expect(api.close).not.toHaveBeenCalled();
});
it('retains the tab and shows a closure failure inside the confirmation dialog', async () => {
  mount();
  await open();
  await screen.findByRole('tab', { name: 'Remote 1' });
  fireEvent.click(screen.getByRole('button', { name: 'Close Remote 1' }));
  expect(api.close).not.toHaveBeenCalled();
  const request = deferred<void>();
  api.close.mockReturnValueOnce(request.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Close session' }));
  expect(within(screen.getByRole('dialog')).getByText('Closing SSH session')).toBeInTheDocument();
  await act(async () => request.reject(new Error('Daemon unavailable')));
  expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Closure not confirmed');
  fireEvent.click(screen.getByRole('button', { name: 'Close session' }));
  await waitFor(() => expect(screen.queryByRole('tab', { name: 'Remote 1' })).not.toBeInTheDocument());
});
it('resolves a pending confirmation locally if the shell exits meanwhile', async () => {
  const read = deferred<TerminalRead>();
  api.read.mockReturnValueOnce(read.promise);
  mount();
  await open();
  await screen.findByRole('tab', { name: 'Remote 1' });
  fireEvent.click(screen.getByRole('button', { name: 'Close Remote 1' }));
  await act(async () =>
    read.resolve({
      session: { ...session(), state: 'closed', reason: 'idle_timeout' },
      data: '',
      cursor: 0,
      hasMore: false,
      droppedBytes: 0,
    })
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(api.close).not.toHaveBeenCalled();
});
it('offers a retry when workspace discovery fails', async () => {
  api.listNodes.mockRejectedValueOnce(new Error('Node registry unavailable'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Retry loading SSH workspace' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'New SSH tab' })).toBeEnabled());
  expect(screen.queryByText('Node registry unavailable')).not.toBeInTheDocument();
});
it('closes only its own late connection after the workspace unmounts', async () => {
  const request = deferred<TerminalSession>();
  api.open.mockReturnValueOnce(request.promise);
  const view = mount();
  await open();
  view.unmount();
  await act(async () => request.resolve(session('late')));
  expect(api.close).toHaveBeenCalledExactlyOnceWith({ id: 'late' });
});
it('does not claim a failed read closed the server session until closure is acknowledged', async () => {
  api.read.mockRejectedValueOnce(new Error('RPC disconnected'));
  const closing = deferred<void>();
  api.close.mockReturnValueOnce(closing.promise);
  mount();
  await open();
  await screen.findByText('State unknown');
  expect(screen.queryByRole('tab', { name: /closed/ })).not.toBeInTheDocument();
  await act(async () => closing.resolve());
  await screen.findByRole('tab', { name: /Remote 1 · closed/ });
});

it('distinguishes an unconfirmed open from a rejected connection', async () => {
  api.open.mockRejectedValueOnce(Object.assign(new Error('Request timeout after 30000ms'), { code: 'TIMEOUT' }));
  mount();
  await open();
  await screen.findByRole('tab', { name: /Remote · unconfirmed/ });
  expect(screen.getByRole('alert')).toHaveTextContent('An unattached shell may still exist');
  expect(api.open).toHaveBeenCalledOnce();
});
