// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const rpc = vi.hoisted(() => ({ check: vi.fn(), list: vi.fn(), start: vi.fn(), progress: vi.fn(), refresh: vi.fn(), can: vi.fn() }));
vi.mock('src/auth/access', () => ({ useAccess: () => ({ can: rpc.can }) }));
vi.mock('src/netron/client', () => ({ invokeStackLifecycle: rpc.check, daemonClient: { invoke: rpc.refresh }, project: { getDeployProgress: rpc.progress } }));
vi.mock('src/netron/release-wire', () => ({ releaseApi: { list: rpc.list } }));
vi.mock('src/stores/project.store', () => {
  const state = {
    stacksByProject: { sample: [{ name: 'test', type: 'remote', status: 'running' }] },
    stackReadErrors: {}, startStack: rpc.start, fetchStacks: vi.fn(),
  };
  return { useProjectStore: (select: (value: typeof state) => unknown) => select(state) };
});
const { DeployReleaseDialog } = await import('../../webapp/src/components/deploy-release-dialog');
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('accepts an external release ID, fetches on request and requires a separate deployment action', async () => {
  rpc.list.mockResolvedValue({ releases: [] });
  rpc.progress.mockResolvedValue([]);
  rpc.check.mockResolvedValueOnce({ ok: false, state: 'missing', because: 'Release is absent from this controller' });
  let confirm!: (reply: { ok: boolean; because: string }) => void;
  rpc.check.mockReturnValueOnce(new Promise(resolve => { confirm = resolve; }));
  render(<MemoryRouter><DeployReleaseDialog open onClose={vi.fn()} project="sample" stack="test" release={null} /></MemoryRouter>);
  fireEvent.change(screen.getByRole('combobox', { name: 'Release ID' }), { target: { value: 'sample-123' } });
  const fetch = await screen.findByRole('button', { name: 'Fetch and verify' });
  expect(rpc.check).toHaveBeenCalledWith('checkRelease', { project: 'sample', stack: 'test', release: 'sample-123' });
  fireEvent.click(fetch);
  expect(screen.getByRole('status').textContent).toContain('Preparing');
  expect(rpc.check).toHaveBeenLastCalledWith('checkRelease', { project: 'sample', stack: 'test', release: 'sample-123', prepare: true });
  confirm({ ok: true, because: 'Ready for test' });
  const deploy = await screen.findByRole('button', { name: 'Deploy' });
  expect(deploy.hasAttribute('disabled')).toBe(false);
  expect(rpc.start).not.toHaveBeenCalled();
  rpc.start.mockResolvedValue({ state: 'failed', message: 'Node unreachable' });
  fireEvent.click(deploy);
  await waitFor(() => expect(rpc.start).toHaveBeenCalledWith('sample', 'test', { release: 'sample-123' }));
  expect(await screen.findByText('Node unreachable')).toBeTruthy();
});

const requiresDeclarations = {
  ok: false, state: 'requires-stop', declarations: 'refresh-required', because: 'The target is running',
  declarationReason: 'Verified declarations are missing for app api.',
};
const renderRelease = (project = 'sample') => <MemoryRouter><DeployReleaseDialog open onClose={vi.fn()} project={project} stack="test" release={null} /></MemoryRouter>;

it('lets an authorized operator refresh the exact release before reviewing the running target', async () => {
  rpc.can.mockImplementation(permission => permission === 'OmnitronProject.refreshTopologyMetadata');
  rpc.list.mockResolvedValue({ releases: [] });
  rpc.check.mockResolvedValueOnce(requiresDeclarations).mockResolvedValueOnce({ ok: false, state: 'requires-stop', because: 'Ready after reviewed stop' });
  rpc.refresh.mockResolvedValue({ refreshed: 1, failures: [] });
  render(renderRelease());
  fireEvent.change(screen.getByRole('combobox', { name: 'Release ID' }), { target: { value: 'sample-123' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Update declarations…' }));
  expect(rpc.refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Update declarations' }));
  expect(await screen.findByText('Ready after reviewed stop')).toBeTruthy();
  expect(rpc.refresh).toHaveBeenCalledWith('daemon', 'OmnitronProject', 'refreshTopologyMetadata',
    [{ project: 'sample', stack: 'test', release: 'sample-123' }], { timeout: 120_000 });
  expect(rpc.check.mock.calls).toEqual(Array(2).fill(['checkRelease', { project: 'sample', stack: 'test', release: 'sample-123' }]));
  expect(screen.queryByRole('button', { name: 'Update declarations…' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Inspect stack' }).hasAttribute('disabled')).toBe(false);
  expect(rpc.start).not.toHaveBeenCalled();
});

it('explains the exact grant needed and keeps a running stack inspectable for an ordinary operator', async () => {
  rpc.can.mockReturnValue(false);
  rpc.list.mockResolvedValue({ releases: [] });
  rpc.check.mockResolvedValue(requiresDeclarations);
  render(renderRelease());
  fireEvent.change(screen.getByRole('combobox', { name: 'Release ID' }), { target: { value: 'sample-123' } });
  expect(await screen.findByText(/An administrator must update/)).toBeTruthy();
  expect(screen.getByText(requiresDeclarations.declarationReason)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Update declarations…' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Inspect stack' }).hasAttribute('disabled')).toBe(false);
  expect(rpc.start).not.toHaveBeenCalled();
  expect(rpc.refresh).not.toHaveBeenCalled();
});

it('discards a release declaration reply after the workspace changes', async () => {
  rpc.can.mockReturnValue(true);
  rpc.list.mockResolvedValue({ releases: [] });
  rpc.check.mockResolvedValueOnce(requiresDeclarations).mockResolvedValue({ ok: true, because: 'Ready for second project' });
  let finish!: (result: { refreshed: number; failures: [] }) => void;
  rpc.refresh.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const { rerender } = render(renderRelease());
  fireEvent.change(screen.getByRole('combobox', { name: 'Release ID' }), { target: { value: 'sample-123' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Update declarations…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Update declarations' }));
  rerender(renderRelease('second'));
  fireEvent.change(screen.getByRole('combobox', { name: 'Release ID' }), { target: { value: 'second-123' } });
  expect(await screen.findByText('Ready for second project')).toBeTruthy();
  finish({ refreshed: 1, failures: [] });
  await waitFor(() => expect(screen.queryByText('The target is running')).toBeNull());
  expect(rpc.check.mock.calls.filter(([, input]) => input.project === 'sample')).toHaveLength(1);
  expect(rpc.start).not.toHaveBeenCalled();
});
