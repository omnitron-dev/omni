// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { INodeWithStatus, KernelRollout } from '../../src/shared/dto/services.js';
import { FleetRollout } from '../../webapp/src/components/fleet-rollout.js';

const rpc = vi.hoisted(() => ({
  getKernelRollout: vi.fn(), listKernelBuilds: vi.fn(), planKernelRollout: vi.fn(), startKernelRollout: vi.fn(),
  reconcileKernelRollout: vi.fn(), getUpgradeProgress: vi.fn(),
}));
const daemonStatus = vi.hoisted(() => vi.fn());
const access = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock('src/netron/client', () => ({ nodes: rpc, daemon: { status: daemonStatus } }));
vi.mock('src/auth/access', () => ({
  useAccess: () => ({ can: (permission: string) => access.granted.has(permission), snapshot: { userId: 'reader' } }),
  Can: () => null,
}));

const commit = 'a'.repeat(40);
const report: KernelRollout = {
  id: 'plan-1', commit, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:03Z', state: 'planned', reason: null,
  targets: [{ nodeId: 'id-1', name: 'west', state: 'ready', previous: '2'.repeat(64), candidate: '3'.repeat(64), ownerId: 'owner-1', ownerPid: 33, reason: null }],
};
function Location() { return <output>{useLocation().search}</output>; }
function mount(url = '/nodes', nodes: INodeWithStatus[] = []) {
  return render(<MemoryRouter initialEntries={[url]}><FleetRollout nodes={nodes} /><Location /></MemoryRouter>);
}
const grant = (...methods: string[]) => methods.forEach(method => access.granted.add('OmnitronNodes.' + method));
beforeEach(() => { vi.resetAllMocks(); access.granted.clear(); rpc.getUpgradeProgress.mockResolvedValue([]); });
afterEach(cleanup);

it('renders no inventory or actions and performs no poll without read access', () => {
  mount();
  expect(rpc.getKernelRollout).not.toHaveBeenCalled();
  expect(rpc.getUpgradeProgress).not.toHaveBeenCalled();
  expect(screen.queryByRole('button')).toBeNull();
});

it('restores a specific receipt read-only and shows the reason, owner and rollback target', async () => {
  grant('getKernelRollout', 'getUpgradeProgress');
  rpc.getKernelRollout.mockResolvedValue({ ...report, state: 'failed', targets: [
    { ...report.targets[0], state: 'rolled-back', reason: 'Previous backend resumed.' },
  ] });
  mount('/nodes?rollout=plan-1');
  await screen.findByText('Previous backend resumed.');
  expect(rpc.getKernelRollout).toHaveBeenCalledWith({ id: 'plan-1' });
  expect(screen.getByText('owner-1')).toBeTruthy();
  expect(screen.getByText('2'.repeat(64))).toBeTruthy();
  expect(screen.queryByRole('button', { name: /prepare|plan update|apply|reconcile/i })).toBeNull();
  expect(rpc.getUpgradeProgress).not.toHaveBeenCalled();
});

it('prepares without dispatch and applies exactly the reviewed ID after the controller reads it back', async () => {
  grant('getKernelRollout', 'planKernelRollout', 'startKernelRollout');
  let state: KernelRollout['state'] = 'planned';
  rpc.getKernelRollout.mockImplementation(async ({ id }) => id ? { ...report, id, state } : null);
  rpc.planKernelRollout.mockImplementation(async ({ requestId }) => ({ ...report, id: requestId }));
  rpc.startKernelRollout.mockImplementation(async () => { state = 'running'; return { ...report, state }; });
  mount('/nodes?scope=all');
  fireEvent.click(await screen.findByRole('button', { name: /Plan update/ }));
  expect(screen.getByRole('button', { name: 'Prepare plan' }).hasAttribute('disabled')).toBe(true);
  fireEvent.change(screen.getByRole('combobox', { name: /Target commit/ }), { target: { value: commit } });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare plan' }));
  const apply = await screen.findByRole('button', { name: 'Apply reviewed plan' });
  const id = rpc.planKernelRollout.mock.calls[0]![0].requestId as string;
  expect(screen.getByText('?scope=all&rollout=' + id)).toBeTruthy();
  expect(rpc.planKernelRollout).toHaveBeenCalledWith({ commit, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  expect(rpc.getKernelRollout).toHaveBeenCalledWith({ id });
  expect(rpc.startKernelRollout).not.toHaveBeenCalled();
  fireEvent.click(apply);
  await screen.findByText('running');
  expect(rpc.startKernelRollout.mock.calls).toEqual([[{ id }]]);
});

it('holds an uncertain operation for reconciliation without re-dispatch', async () => {
  grant('getKernelRollout', 'startKernelRollout', 'reconcileKernelRollout');
  rpc.getKernelRollout.mockResolvedValue({ ...report, state: 'uncertain', reason: 'Acknowledgement lost' });
  rpc.reconcileKernelRollout.mockResolvedValue(report);
  mount('/nodes?rollout=plan-1');
  fireEvent.click(await screen.findByRole('button', { name: 'Reconcile node status' }));
  await waitFor(() => expect(rpc.reconcileKernelRollout).toHaveBeenCalledWith({ id: report.id }));
  expect(rpc.startKernelRollout).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Apply reviewed plan' })).toBeNull();
});

it('does not navigate to a previous reader’s late plan after access is revoked', async () => {
  grant('getKernelRollout', 'planKernelRollout');
  rpc.getKernelRollout.mockResolvedValue(null);
  let finish!: (plan: KernelRollout) => void;
  rpc.planKernelRollout.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const view = mount();
  fireEvent.click(await screen.findByRole('button', { name: /Plan update/ }));
  fireEvent.change(screen.getByRole('combobox', { name: /Target commit/ }), { target: { value: commit } });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare plan' }));
  access.granted.clear();
  view.rerender(<MemoryRouter initialEntries={['/nodes']}><FleetRollout nodes={[]} /><Location /></MemoryRouter>);
  finish(report);
  await Promise.resolve();
  expect(screen.getByRole('status').textContent).toBe('');
  expect(rpc.startKernelRollout).not.toHaveBeenCalled();
});

it('sends the exact selected order and excludes the local controller from remote targets', async () => {
  grant('getKernelRollout', 'planKernelRollout');
  rpc.getKernelRollout.mockResolvedValue(null);
  rpc.planKernelRollout.mockImplementation(async ({ requestId }) => ({ ...report, id: requestId }));
  const nodes: INodeWithStatus[] = ['local', 'east', 'west'].map(name => ({
    id: name, name, host: name + '.example', sshPort: 22, sshUser: 'ops', sshAuthMethod: 'key', runtime: 'node',
    daemonPort: 9999, tags: [], isLocal: name === 'local', createdAt: '', updatedAt: '', status: null,
  }));
  mount('/nodes', nodes);
  fireEvent.click(await screen.findByRole('button', { name: /Plan update/ }));
  fireEvent.change(screen.getByRole('combobox', { name: /Target commit/ }), { target: { value: commit } });
  const picker = screen.getByRole('combobox', { name: 'Target nodes' });
  fireEvent.keyDown(picker, { key: 'ArrowDown' });
  expect(screen.queryByRole('option', { name: /local/ })).toBeNull();
  fireEvent.click(await screen.findByRole('option', { name: /west/ }));
  fireEvent.keyDown(picker, { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: /east/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Prepare plan' }));
  await waitFor(() => expect(rpc.planKernelRollout).toHaveBeenCalledWith({ commit, nodeIds: ['west', 'east'], requestId: expect.any(String) }));
  expect(rpc.startKernelRollout).not.toHaveBeenCalled();
});

it('reads the receipt after a start timeout and does not re-send the operation', async () => {
  grant('getKernelRollout', 'startKernelRollout');
  rpc.getKernelRollout.mockResolvedValueOnce(report).mockResolvedValue({ ...report, state: 'running' });
  rpc.startKernelRollout.mockRejectedValue(new Error('Connection lost'));
  mount('/nodes?rollout=plan-1');
  fireEvent.click(await screen.findByRole('button', { name: 'Apply reviewed plan' }));
  await screen.findByText('running');
  expect(screen.getByText(/Connection lost/)).toBeTruthy();
  expect(rpc.startKernelRollout).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Apply reviewed plan' })).toBeNull();
});

it('fences a mismatched read and a blocked receipt even for an administrator', async () => {
  grant('getKernelRollout', 'startKernelRollout');
  rpc.getKernelRollout.mockResolvedValue({ ...report, state: 'blocked', reason: 'Owner restart requires a maintenance window.' });
  const view = mount('/nodes?rollout=other');
  await screen.findByText(/Controller returned another rollout/);
  expect(screen.queryByRole('button', { name: /Apply|Review/ })).toBeNull();
  view.unmount();
  mount('/nodes?rollout=plan-1');
  await screen.findByText('Owner restart requires a maintenance window.');
  expect(screen.queryByRole('button', { name: /Apply|Review/ })).toBeNull();
});

it('uses the attested controller commit on demand and reuses the request ID only for unchanged preflight inputs', async () => {
  grant('getKernelRollout', 'planKernelRollout');
  access.granted.add('OmnitronDaemon.status');
  daemonStatus.mockResolvedValue({ build: { dirty: false, commit } });
  rpc.getKernelRollout.mockResolvedValue(null);
  rpc.planKernelRollout.mockRejectedValue(new Error('Lost acknowledgement'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /Plan update/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Use controller commit/ }));
  const submit = screen.getByRole('button', { name: 'Prepare plan' });
  fireEvent.click(submit);
  await screen.findByText('Lost acknowledgement');
  const first = rpc.planKernelRollout.mock.calls[0]![0];
  expect(first).toEqual({ commit, requestId: expect.any(String) });
  fireEvent.click(submit);
  await waitFor(() => expect(rpc.planKernelRollout).toHaveBeenCalledTimes(2));
  expect(rpc.planKernelRollout.mock.calls[1]![0]).toEqual(first);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Stage from controller catalog' }));
  fireEvent.click(submit);
  await waitFor(() => expect(rpc.planKernelRollout).toHaveBeenCalledTimes(3));
  const staged = rpc.planKernelRollout.mock.calls[2]![0];
  expect(staged).toEqual({ commit, requestId: expect.any(String), stage: true });
  expect(staged.requestId).not.toBe(first.requestId);
  fireEvent.click(await screen.findByRole('button', { name: 'Check last request' }));
  await waitFor(() => expect(rpc.getKernelRollout).toHaveBeenCalledWith({ id: staged.requestId }));
  expect(rpc.startKernelRollout).not.toHaveBeenCalled();
});

it('shows asynchronous preflight progress and holds application until the reviewed plan is ready', async () => {
  grant('getKernelRollout', 'planKernelRollout', 'startKernelRollout');
  const planning = { ...report, state: 'planning', targets: [{ ...report.targets[0], state: 'pending' }] };
  let finish!: (value: KernelRollout) => void;
  rpc.getKernelRollout.mockResolvedValueOnce(planning).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  mount('/nodes?rollout=plan-1');
  await screen.findByText('0/1 nodes checked');
  expect(screen.getByRole('button', { name: /Plan update/ }).hasAttribute('disabled')).toBe(true);
  expect(screen.queryByRole('button', { name: 'Apply reviewed plan' })).toBeNull();
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  await act(async () => { finish(report); });
  await screen.findByRole('button', { name: 'Apply reviewed plan' });
  expect(rpc.startKernelRollout).not.toHaveBeenCalled();
});

it('reads the catalog only for an authorized open dialog and offers one option per commit with every platform', async () => {
  grant('getKernelRollout', 'planKernelRollout', 'listKernelBuilds');
  rpc.getKernelRollout.mockResolvedValue(null);
  rpc.listKernelBuilds.mockResolvedValue(['x64', 'arm64'].map(arch => ({ commit, platform: 'linux', arch, nodeVersion: '24.13.0' })));
  mount();
  expect(rpc.listKernelBuilds).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: /Plan update/ }));
  const input = screen.getByRole('combobox', { name: /Target commit/ });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  const option = await screen.findByRole('option', { name: /linux\/x64.*linux\/arm64/ });
  expect(screen.getAllByRole('option')).toHaveLength(1);
  fireEvent.click(option);
  expect((input as HTMLInputElement).value).toBe(commit);
  expect(rpc.planKernelRollout).not.toHaveBeenCalled();
  expect(daemonStatus).not.toHaveBeenCalled();
});
