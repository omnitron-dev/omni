// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { INodeWithStatus } from '@omnitron-dev/omnitron/dto/services';
import { NodeDiagnosisDialog } from './nodes';

const rpc = vi.hoisted(() => Object.fromEntries([
  'getCheckHistory', 'getNodeIndicators', 'getNodeSyncStatus', 'getNodeRelayStats', 'getNodeHealthSummaries',
  'getNodeDaemonStatus', 'getUpgradeProgress', 'getNodeDaemonHealth', 'triggerNodeCheck',
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
  for (const name of ['getCheckHistory', 'getNodeHealthSummaries', 'getUpgradeProgress']) rpc[name]!.mockResolvedValue([]);
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
