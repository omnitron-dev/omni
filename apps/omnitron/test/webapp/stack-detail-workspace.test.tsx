// @vitest-environment happy-dom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { IStackInfo } from '../../src/shared/dto/project';
import type { RpcPermission } from '../../webapp/src/auth/access';
import { stackAppFixture, stackFixture } from '../helpers/stack-fixture';
import { useProjectStore } from '../../webapp/src/stores/project.store';
import StackDetailPage from '../../webapp/src/pages/stacks/detail';

const rpc = vi.hoisted(() => ({
  grants: new Set<string>(), invoke: vi.fn(), history: vi.fn(), fetch: vi.fn(), start: vi.fn(), stop: vi.fn(), remove: vi.fn(),
}));
vi.mock('src/netron/client', () => ({ daemonClient: { invoke: rpc.invoke }, project: {} }));
vi.mock('src/netron/release-wire', () => ({ releaseApi: { deployments: rpc.history } }));
vi.mock('src/auth/access', () => ({
  useAccess: () => ({ can: (permission: RpcPermission) => rpc.grants.has(permission) }),
  Can: ({ permission, children }: { permission: RpcPermission; children: ReactNode }) => rpc.grants.has(permission) ? children : null,
}));

const at = '2026-11-17T14:00:00Z';
const historicalStop: NonNullable<IStackInfo['stopOperation']> = {
  phase: 'stopped', id: 'stop-local', startedAt: at, completedAt: at, intentCommitted: true,
  keepInfrastructure: true, supersededAt: '2026-11-17T14:02:00Z', nodes: [],
};
function openStack(stack: IStackInfo, grants: RpcPermission[] = [], readError?: string) {
  grants.forEach(grant => rpc.grants.add(grant));
  rpc.fetch.mockResolvedValue([stack]);
  useProjectStore.setState({
    activeProject: 'sample', activeStack: null, stacksByProject: { sample: [stack] }, stackReadErrors: readError ? { sample: readError } : {},
    stackNotices: {}, pendingOps: {}, fetchStacks: rpc.fetch, startStack: rpc.start, stopStack: rpc.stop, deleteStack: rpc.remove,
  });
  return render(<MemoryRouter initialEntries={['/stacks/dev']}><Routes>
    <Route path="/stacks/:name" element={<StackDetailPage />} />
  </Routes></MemoryRouter>);
}
const select = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));
beforeEach(() => {
  rpc.grants.clear();
  rpc.history.mockResolvedValue({ known: true, deployments: [] });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('shows the two health observations, links the local process by handle, and reads retained history on demand', async () => {
  const app = stackAppFixture('payments', { handleKey: 'retained/local/payments', status: 'online', health: 'degraded', pid: 86, restarts: 2 });
  const stack = stackFixture('dev', {
    status: 'running', apps: [app], infrastructureMode: 'preserve', runtimeScope: { project: 'retained', stack: 'local' },
    health: { status: 'degraded', observedAt: at, apps: [{ name: 'payments', node: 'local', status: 'degraded',
      checks: [{ name: 'database', status: 'warn', message: 'Connection pool exhausted' }] }] },
    infrastructure: { ready: true, services: { database: { status: 'running', health: 'healthy', containerName: 'sample-dev-database', port: 5432 } } },
    stopOperation: historicalStop,
  });
  rpc.history.mockResolvedValue({ known: true, deployments: [
    { project: 'retained', stack: 'local', release: 'previous-release', at, source: 'operator' },
    { project: 'other', stack: 'dev', release: 'unrelated', at },
  ] });
  openStack(stack, ['OmnitronDaemon.getApp', 'OmnitronRelease.deployments', 'OmnitronAudit.available']);
  const summary = within(screen.getByRole('region', { name: 'Runtime summary' }));
  expect(summary.getByText('1/1 online')).toBeVisible();
  expect(summary.getByText('Health warning')).toBeVisible();
  expect(summary.getByText('Ready')).toBeVisible();
  expect(summary.getByText('1 observed service')).toBeVisible();
  expect(screen.getByRole('link', { name: 'payments' })).toHaveAttribute('href', '/apps/retained%2Flocal%2Fpayments');
  expect(screen.getByRole('region', { name: 'Stack infrastructure' })).toHaveTextContent('sample-dev-database');
  expect(rpc.history).not.toHaveBeenCalled();
  expect(screen.queryByText(/stop-local/)).not.toBeInTheDocument();
  select('Releases & history');
  expect(summary.getByText(/Connection pool exhausted/)).toBeVisible();
  expect(await screen.findByText('previous-release')).toBeVisible();
  expect(screen.queryByRole('link', { name: 'previous-release' })).not.toBeInTheDocument();
  expect(screen.queryByText('unrelated')).not.toBeInTheDocument();
  const receipt = screen.getByText(/Stop confirmed · superseded/).closest('details');
  expect(receipt).toHaveTextContent('Operation stop-local');
  expect(receipt).toHaveTextContent('Requested infrastructure preservation');
  expect(receipt).not.toHaveTextContent('0/0 nodes');
  expect(rpc.history).toHaveBeenCalledTimes(1);
  expect(rpc.fetch).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: /Inspect installed files/ })).not.toBeInTheDocument();
  select('Configuration');
  expect(screen.getByText('Preserve existing infrastructure')).toBeVisible();
  expect(screen.queryByRole('button', { name: /Review stop|Deploy release|Delete stack/ })).not.toBeInTheDocument();
});

it('keeps active failures visible on every tab and preserves an earlier recovery with a different stop ID', () => {
  openStack(stackFixture('dev', { status: 'error', notUp: ['payments could not bind port 9040'],
    stopOperation: { id: 'new-stop', startedAt: at, phase: 'failed', intentCommitted: true, error: 'Node receipt missing', nodes: [] },
    resumeOperation: { project: 'sample', stack: 'dev', stopOperationId: 'older-stop', operationId: 'older-resume', outcome: 'unconfirmed',
      nodes: [{ node: 'worker', outcome: 'unconfirmed', reason: 'Lost connection' }] },
  }), [], 'Controller disconnected');
  for (const tab of ['Runtime', 'Configuration', 'Releases & history']) {
    select(tab);
    expect(screen.getByText('Node receipt missing')).toBeVisible();
    expect(screen.getByText('payments could not bind port 9040')).toBeVisible();
    expect(screen.getByText(/Showing the last stack inventory/)).toBeVisible();
  }
  const receipts = within(screen.getByRole('region', { name: 'Operation receipts' }));
  expect(receipts.getByText(/Operation older-resume · Stop older-stop/)).toBeInTheDocument();
  expect(receipts.queryByText(/Inspect each node before requesting/)).not.toBeInTheDocument();
  expect(screen.getByText(/Deployment history is unavailable with your permissions/)).toBeVisible();
  expect(rpc.history).not.toHaveBeenCalled();
});

it('distinguishes an unobserved remote node from a healthy service and refuses a local application link', () => {
  openStack(stackFixture('dev', { type: 'cluster', status: 'unknown', config: { type: 'cluster' },
    apps: [stackAppFixture('payments', { status: 'unknown' })], infrastructure: { ready: true, services: {} },
    placements: [
      { nodeKey: 'one:9700', host: 'one', port: 9700, label: null, observedAt: at, appsObserved: true, apps: [], infrastructureObserved: true,
        infrastructure: { ready: true, services: { nats: { status: 'running', containerName: 'nats', port: 4222 } } }, errors: [] },
      { nodeKey: 'two:9700', host: 'two', port: 9700, label: null, observedAt: null, appsObserved: false, apps: [],
        infrastructureObserved: false, infrastructure: null, errors: ['Worker inventory unavailable'] },
    ],
  }), ['OmnitronDaemon.getApp']);
  const summary = within(screen.getByRole('region', { name: 'Runtime summary' }));
  expect(summary.getByText('Inventory incomplete')).toBeVisible();
  expect(summary.getByText('1 process state unknown')).toBeVisible();
  expect(summary.getByText(/1 observed service · 1\/2 node inventories/)).toBeVisible();
  expect(summary.queryByText('Ready')).not.toBeInTheDocument();
  expect(screen.getByText('Worker inventory unavailable')).toBeVisible();
  expect(screen.queryByRole('link', { name: 'payments' })).not.toBeInTheDocument();
});

it('separates prerequisite inspection from mutation, then starts exactly the selected stack', async () => {
  const stack = stackFixture('dev', { status: 'stopped' });
  openStack(stack, ['OmnitronProject.diagnoseStack', 'OmnitronProject.startStack', 'OmnitronProject.deleteStack']);
  rpc.invoke.mockResolvedValue({ status: 'ready', checkedAt: at, durationMs: 6, checks: [], deferred: [] });
  expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Check start prerequisites' }));
  expect(await screen.findByText('Prerequisites verified')).toBeVisible();
  expect(rpc.invoke).toHaveBeenCalledWith('daemon', 'OmnitronProject', 'diagnoseStack', [{ project: 'sample', stack: 'dev' }], { timeout: 120000 });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  select('Configuration & actions');
  expect(rpc.start).not.toHaveBeenCalled();
  expect(rpc.stop).not.toHaveBeenCalled();
  const actions = within(screen.getByRole('group', { name: 'Stack actions' }));
  fireEvent.click(actions.getByRole('button', { name: 'Delete stack…' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  expect(rpc.remove).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(actions.getByRole('button', { name: 'Start' }));
  expect(rpc.start).toHaveBeenCalledExactlyOnceWith('sample', 'dev');
});
