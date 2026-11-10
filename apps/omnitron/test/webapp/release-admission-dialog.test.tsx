// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const rpc = vi.hoisted(() => ({ check: vi.fn(), list: vi.fn(), start: vi.fn(), progress: vi.fn() }));
vi.mock('src/netron/client', () => ({ invokeStackLifecycle: rpc.check, project: { getDeployProgress: rpc.progress } }));
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
