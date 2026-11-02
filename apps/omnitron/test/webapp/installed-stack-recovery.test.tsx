// @vitest-environment happy-dom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LONG_REQUEST_TIMEOUT } from '../../src/shared/dto/services.js';
import type { IStackInfo } from '../../src/shared/dto/project.js';
import { StackRecoveryAction, StackResumeNotice } from '../../webapp/src/components/stack-recovery.js';
import { useProjectStore } from '../../webapp/src/stores/project.store.js';

const rpc = vi.hoisted(() => ({ granted: true, resumeInstalledStack: vi.fn(), listStacks: vi.fn() }));
vi.mock('../../webapp/src/netron/client', () => ({ project: rpc, invokeStackLifecycle: (_method: string, input: unknown) => rpc.resumeInstalledStack(input) }));
vi.mock('src/auth/access', () => ({ Can: ({ children }: { children: ReactNode }) => rpc.granted ? children : null }));

const stop: NonNullable<IStackInfo['stopOperation']> = { phase: 'stopped', intentCommitted: true, id: 'stop-1', startedAt: '',
  nodes: [{ node: 'worker', outcome: 'stopped', operationId: 'node-stop', observedAt: '2026-11-02T00:00:00.000Z', authority: { clusterId: 'west', nodeId: 'worker', epoch: '3' } }] };
const result: NonNullable<IStackInfo['resumeOperation']> = {
  project: 'sample', stack: 'stage', operationId: 'recovery', stopOperationId: 'stop-1', outcome: 'unconfirmed',
  nodes: [{ node: 'worker', outcome: 'unconfirmed', reason: 'Connection lost' }],
};
const stack = { name: 'stage', stopOperation: stop, apps: [] } as unknown as IStackInfo;
afterEach(() => { cleanup(); vi.clearAllMocks(); rpc.granted = true; });

it('offers only a permitted recovery after a fully confirmed, fenced stop', () => {
  const onResume = vi.fn();
  const action = (s: IStackInfo) => <StackRecoveryAction stack={s} onResume={onResume} onReviewStop={vi.fn()} />;
  const page = render(action({ ...stack, stopOperation: { ...stop, nodes: [{ node: 'old', outcome: 'stopped' }] } }));
  expect(screen.queryByRole('button')).toBeNull();
  page.rerender(action({ ...stack, stopOperation: { ...stop, nodes: stop.nodes.map(node => ({ ...node, operationId: undefined })) } }));
  expect(screen.queryByRole('button', { name: 'Resume installed apps' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Review new stop…' })).toBeTruthy();
  rpc.granted = false; page.rerender(action(stack)); expect(screen.queryByRole('button')).toBeNull();
  rpc.granted = true; page.rerender(action(stack));
  fireEvent.click(screen.getByRole('button', { name: 'Resume installed apps' }));
  expect(onResume).toHaveBeenCalledOnce();
  page.rerender(action({ ...stack, stopOperation: { ...stop, supersededAt: 'now' } }));
  expect(screen.queryByRole('button')).toBeNull();
});

it('shows durable per-node receipts and requests a new stop before another dispatch', () => {
  const subject = { ...stack, resumeOperation: result };
  const review = vi.fn();
  render(<><StackRecoveryAction stack={subject} onResume={vi.fn()} onReviewStop={review} /><StackResumeNotice stack={subject} /></>);
  expect(screen.getByText(/worker · unconfirmed · Connection lost/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Resume installed apps' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Review new stop…' }));
  expect(review).toHaveBeenCalledOnce();
});

it('holds the scoped pending action until a fresh inventory follows any pre-dispatch poll', async () => {
  let finish!: (value: unknown) => void;
  rpc.listStacks.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce([{ ...stack, resumeOperation: result }]);
  rpc.resumeInstalledStack.mockResolvedValue(result);
  const store = useProjectStore;
  store.getState().setInventoryReaders('reader', 'reader');
  const stale = store.getState().fetchStacks('sample');
  const command = store.getState().resumeInstalledStack('sample', 'stage');
  await store.getState().resumeInstalledStack('sample', 'stage');
  expect(rpc.resumeInstalledStack).toHaveBeenCalledTimes(1);
  expect(store.getState().pendingOps['sample/stage']).toBe('resuming');
  finish([stack]); await stale; await command;
  expect(rpc.listStacks).toHaveBeenCalledTimes(2);
  expect(store.getState().stacksByProject['sample']?.[0]?.resumeOperation).toEqual(result);
  expect(store.getState().pendingOps['sample/stage']).toBeUndefined();
  expect(store.getState().stackNotices['sample/stage']).toContain('Connection lost');
});

it('reports a missing receipt after losing the connection and submits only once', async () => {
  rpc.resumeInstalledStack.mockRejectedValueOnce(Object.assign(new Error('upstream lost'), { code: 'NETWORK_ERROR' }));
  rpc.listStacks.mockResolvedValueOnce([stack]);
  await useProjectStore.getState().resumeInstalledStack('sample', 'stage');
  expect(useProjectStore.getState().stackNotices['sample/stage']).toContain('acknowledgement unavailable');
  expect(rpc.resumeInstalledStack).toHaveBeenCalledOnce();
});

it('sends the CLI lifecycle budget through the browser transport to the daemon', async () => {
  const { invokeStackLifecycle } = await vi.importActual<typeof import('../../webapp/src/netron/client.js')>('../../webapp/src/netron/client.js');
  const fetch = vi.fn(async (_url: string, request: RequestInit) => {
    const message = JSON.parse(String(request.body));
    expect(message.hints.timeout).toBe(LONG_REQUEST_TIMEOUT);
    return Response.json({ id: message.id, success: true, data: result });
  });
  vi.stubGlobal('fetch', fetch);
  try {
    await expect(invokeStackLifecycle('resumeInstalledStack', { project: 'sample', stack: 'stage' })).resolves.toEqual(result);
    expect(fetch).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});
