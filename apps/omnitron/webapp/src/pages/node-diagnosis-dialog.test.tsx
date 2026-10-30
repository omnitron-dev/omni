// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { INodeWithStatus } from '@omnitron-dev/omnitron/dto/services';
import { NodeDiagnosisDialog, NodeRelay, NodeSyncStatus } from './nodes';

const rpc = vi.hoisted(() => Object.fromEntries([
  'getCheckHistory', 'getNodeIndicators', 'getNodeSyncStatus', 'getNodeRelayStats', 'getNodeHealthSummaries',
  'getMeshStatus', 'getNodeDaemonStatus', 'getUpgradeProgress', 'getNodeDaemonHealth', 'triggerNodeCheck',
].map(name => [name, vi.fn()])));
vi.mock('src/netron/client', () => ({ nodes: rpc }));
vi.mock('src/auth/access', () => ({ Can: ({ children }: { children: React.ReactNode }) => children, useAccess: () => ({}) }));
vi.mock('@omnitron-dev/prism/components/snackbar', () => ({ useSnackbar: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }) }));

const node = (id: string) => ({ id, name: id, host: '127.0.0.1', daemonPort: 9700, isLocal: true }) as INodeWithStatus;
const indicators = (nodeId: string, message: string) => ({ nodeId, reachable: true, status: 'healthy', indicators: { memory: { status: 'healthy', message } } });
const view = (id: string) => <MemoryRouter><NodeDiagnosisDialog open node={node(id)} onClose={() => {}} /></MemoryRouter>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  Object.values(rpc).forEach(fn => fn.mockReset());
  for (const name of ['getCheckHistory', 'getNodeHealthSummaries', 'getUpgradeProgress', 'getMeshStatus']) rpc[name]!.mockResolvedValue([]);
  for (const name of ['getNodeSyncStatus', 'getNodeRelayStats']) rpc[name]!.mockImplementation(async ({ nodeId }: { nodeId: string }) => ({ nodeId, reachable: false, error: 'not measured' }));
  rpc['getNodeDaemonStatus']!.mockImplementation(async ({ nodeId }: { nodeId: string }) => ({ nodeId, reachable: true, answer: { apps: [], totalCpu: 0, totalMemory: 0 } }));
  rpc['getNodeDaemonHealth']!.mockImplementation(async ({ nodeId }: { nodeId: string }) => ({ nodeId, reachable: true, answer: { apps: {}, overall: 'healthy' } }));
  rpc['triggerNodeCheck']!.mockResolvedValue([]);
});
afterEach(cleanup);

it('clears another node’s readings immediately while the selected node is still loading', async () => {
  const pending = deferred<ReturnType<typeof indicators>>();
  rpc['getNodeIndicators']!.mockResolvedValueOnce(indicators('local', 'local-only measurement')).mockReturnValueOnce(pending.promise);
  const rendered = render(view('local'));
  await screen.findByText('local-only measurement');
  rendered.rerender(view('remote'));
  expect(screen.queryByText('local-only measurement')).toBeNull();
  expect(screen.getByRole('progressbar', { name: 'Loading node diagnostics' })).toBeTruthy();
  await act(async () => { pending.resolve(indicators('remote', 'remote-only measurement')); });
  await screen.findByText('remote-only measurement');
  expect(screen.queryByText('local-only measurement')).toBeNull();
});

it('does not overwrite a newer manual check with an older in-flight response', async () => {
  const older = deferred<ReturnType<typeof indicators>>();
  rpc['getNodeIndicators']!.mockReturnValueOnce(older.promise).mockResolvedValueOnce(indicators('local', 'latest measurement'));
  render(view('local'));
  await waitFor(() => expect(rpc['getNodeIndicators']).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
  await screen.findByText('latest measurement');
  await act(async () => { older.resolve(indicators('local', 'obsolete measurement')); });
  expect(screen.getByText('latest measurement')).toBeTruthy();
  expect(screen.queryByText('obsolete measurement')).toBeNull();
});

it('explains the separate master relay without treating access failures as unsupported features', () => {
  const rendered = render(<NodeRelay data={{ nodeId: 'remote', reachable: false, relay: null, error: "Service 'OmnitronTelemetry' not found" }} />);
  expect(screen.getByText('not exposed')).toBeTruthy();
  expect(screen.getByText(/Slave daemons replicate logs and metrics/)).toBeTruthy();
  rendered.rerender(<NodeRelay data={{ nodeId: 'remote', reachable: false, relay: null, error: 'Missing required role' }} />);
  expect(screen.getByText('Missing required role')).toBeTruthy();
  expect(screen.getByText('unavailable')).toBeTruthy();
  expect(screen.queryByText(/Slave daemons replicate logs and metrics/)).toBeNull();
});

it('uses delivery acknowledgements instead of the unused push-connection flag', () => {
  const data = { nodeId: 'remote', reachable: true, error: null, sync: { connected: false, pendingItems: 30, bufferSize: 4096, lastSyncAt: Date.now(), lastError: null, failedAttempts: 0 } };
  const rendered = render(<NodeSyncStatus data={data} />);
  expect(screen.getByText('keeping up')).toBeTruthy();
  rendered.rerender(<NodeSyncStatus data={{ ...data, sync: { ...data.sync, lastSyncAt: Date.now() - 120000 } }} />);
  expect(screen.getByText('behind')).toBeTruthy();
  rendered.rerender(<NodeSyncStatus data={{ nodeId: 'remote', reachable: false, error: 'Heartbeat timeout', sync: null }} />);
  expect(screen.getByText('unavailable')).toBeTruthy();
  expect(screen.getByText('Heartbeat timeout')).toBeTruthy();
  expect(screen.queryByText('behind')).toBeNull();
});
