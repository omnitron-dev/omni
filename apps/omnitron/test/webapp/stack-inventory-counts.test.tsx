// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IStackInfo } from '../../src/shared/dto/project.js';
const rpc = vi.hoisted(() => ({ stacks: vi.fn() }));
vi.mock('src/auth/access', () => ({ useAccess: () => ({ can: () => true, snapshot: { userId: 'reader' } }) }));
vi.mock('src/netron/client', () => ({
  daemon: { status: async () => ({ apps: [], uptime: 1 }) }, project: { listStacks: (data: unknown) => rpc.stacks(data) },
  nodes: { listNodes: async () => [] }, alerts: { getSummary: async () => ({ firing: 0 }) },
}));
const initialize = () => () => undefined;
vi.mock('src/stores/realtime.store', () => ({ useRealtimeStore: (select: (state: unknown) => unknown) => select({ connected: true, lastEvent: null, initialize }) }));
import { StackSelector } from '../../webapp/src/components/stack-selector.js';
import { StatusBar } from '../../webapp/src/components/status-bar.js';
import { useProjectStore } from '../../webapp/src/stores/project.store.js';
const stack = (name: string, running: boolean): IStackInfo => ({ name, type: name === 'dev' ? 'local' : 'remote', status: running ? 'running' : 'stopped',
  apps: Array.from({ length: 6 }, (_, n) => ({ name: `app${n}`, status: running ? 'online' : 'stopped' })), config: {}, nodes: [], infrastructure: { ready: false, services: {} },
} as IStackInfo);
beforeEach(() => {
  rpc.stacks.mockReset();
  useProjectStore.getState().setInventoryReaders('reader', 'reader');
  useProjectStore.setState({ activeProject: 'sample', activeStack: null, stacksByProject: {}, projects: [] });
});
afterEach(cleanup);
describe('one observed inventory across the console', () => {
  it('includes stopped stacks and their applications in the same snapshot', async () => {
    rpc.stacks.mockResolvedValue([stack('dev', false), stack('test', true)]);
    render(<StatusBar />);
    await waitFor(() => expect(screen.getByLabelText(/applications 6\/12,/)).toBeTruthy());
    expect(screen.getByText('(1/2 stacks)')).toBeTruthy(); expect(rpc.stacks).toHaveBeenCalledTimes(1);
    act(() => useProjectStore.getState().selectStack('dev'));
    await waitFor(() => expect(screen.getByLabelText(/applications 0\/6,/)).toBeTruthy());
    expect(screen.getByText('(0/1 stacks)')).toBeTruthy();
  });
  it('updates the footer when another page refreshes the shared inventory', async () => {
    rpc.stacks.mockResolvedValue([stack('dev', false), stack('test', true)]);
    render(<StatusBar />);
    await waitFor(() => expect(screen.getByLabelText(/applications 6\/12,/)).toBeTruthy());
    rpc.stacks.mockResolvedValue([stack('dev', false), stack('test', false)]);
    await act(async () => { await useProjectStore.getState().fetchStacks('sample'); });
    expect(screen.getByLabelText(/applications 0\/12,/)).toBeTruthy();
    expect(screen.getByText('(0/2 stacks)')).toBeTruthy();
  });
  it('rejects a late previous workspace answer', async () => {
    let finish!: (value: IStackInfo[]) => void;
    rpc.stacks.mockImplementation(({ project }) => project === 'sample' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve([stack('dev', false), stack('test', false)]));
    render(<StatusBar />);
    act(() => useProjectStore.getState().selectProject('next'));
    await waitFor(() => expect(screen.getByLabelText(/applications 0\/12,/)).toBeTruthy());
    await act(async () => { finish([stack('dev', true), stack('test', true)]); });
    expect(screen.getByText('(0/2 stacks)')).toBeTruthy(); expect(screen.queryByLabelText(/applications 12\/12,/)).toBeNull();
  });
  it('coalesces concurrent inventory requests', async () => {
    let finish!: (value: IStackInfo[]) => void;
    rpc.stacks.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = useProjectStore.getState().fetchStacks('sample'); const second = useProjectStore.getState().fetchStacks('sample');
    expect(rpc.stacks).toHaveBeenCalledTimes(1);
    finish([stack('dev', false), stack('test', true)]);
    expect(await first).toEqual(await second);
  });
});


it('exposes a keyboard-operable bounded filter and returns from one stack to all stacks', async () => {
  rpc.stacks.mockResolvedValue([stack('dev', false), stack('test', true)]);
  render(<><StackSelector /><StatusBar /></>);
  await waitFor(() => expect(screen.getByLabelText(/applications 6\/12,/)).toBeTruthy());
  const filter = screen.getByRole('combobox', { name: 'Stack filter' });
  expect(filter.textContent).toBe('All stacks');
  fireEvent.keyDown(filter, { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: /test.*running/ }));
  await waitFor(() => expect(screen.getByLabelText(/applications 6\/6,/)).toBeTruthy());
  expect(filter.textContent).toBe('Stack: test');
  expect(screen.getByText('(1/1 stacks)')).toBeTruthy();
  expect(localStorage.getItem('omnitron_active_stack')).toBe('test');
  fireEvent.keyDown(filter, { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: 'All stacks' }));
  await waitFor(() => expect(screen.getByLabelText(/applications 6\/12,/)).toBeTruthy());
  expect(screen.getByText('(1/2 stacks)')).toBeTruthy();
  expect(localStorage.getItem('omnitron_active_stack')).toBeNull();
});


it('removes the filter tooltip before a pointer can select All stacks', async () => {
  rpc.stacks.mockResolvedValue([stack('dev', false), stack('test', true)]);
  render(<><StackSelector /><StatusBar /></>);
  await waitFor(() => expect(screen.getByLabelText(/applications 6\/12,/)).toBeTruthy());
  act(() => useProjectStore.getState().selectStack('test'));
  const filter = screen.getByRole('combobox', { name: 'Stack filter' });
  fireEvent.mouseOver(filter);
  await screen.findByRole('tooltip');
  fireEvent.mouseDown(filter, { button: 0 });
  await screen.findByRole('listbox');
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  fireEvent.click(screen.getByRole('option', { name: 'All stacks' }));
  await waitFor(() => expect(screen.getByLabelText(/applications 6\/12,/)).toBeTruthy());
  expect(filter.textContent).toBe('All stacks');
  expect(useProjectStore.getState().activeStack).toBeNull();
});
