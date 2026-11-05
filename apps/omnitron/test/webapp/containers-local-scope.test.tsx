// @vitest-environment happy-dom
import { type ReactNode, StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import '@testing-library/jest-dom/vitest';
import type { ContainerState, IStackInfo } from '../../src/shared/dto/services.js';

const rpc = vi.hoisted(() => ({ list: vi.fn(), stacks: vi.fn(), start: vi.fn(), stop: vi.fn(), readStacks: true }));
vi.mock('src/netron/client', () => ({
  infra: { listContainers: rpc.list, startContainer: rpc.start, stopContainer: rpc.stop },
  project: { listStacks: rpc.stacks },
}));
vi.mock('src/auth/access', () => ({
  useAccess: () => ({ can: (permission: string) => permission !== 'OmnitronProject.listStacks' || rpc.readStacks }),
  Can: ({ children }: { children: ReactNode }) => children,
}));
import ContainersPage from '../../webapp/src/pages/containers.js';
import { useProjectStore } from '../../webapp/src/stores/project.store.js';

const remote: IStackInfo = { name: 'test', type: 'remote', status: 'running', config: { type: 'remote' }, nodes: [], apps: [],
  infrastructure: { ready: true, services: {} }, portRange: null, startedAt: null, uptime: 0, attachedAt: null };
const containers: ContainerState[] = [
  { name: 'project-db', image: 'postgres', status: 'exited', health: 'none', project: 'sample', stack: 'dev' },
  { name: 'controller-db', image: 'postgres', status: 'running', lifecycleRestriction: 'Owned by the control plane.' },
  { name: 'unassigned-db', image: 'postgres', status: 'running' },
];
const view = () => <StrictMode><ThemeProvider theme={createTheme()}><MemoryRouter><ContainersPage /></MemoryRouter></ThemeProvider></StrictMode>;
beforeEach(() => {
  vi.clearAllMocks(); rpc.readStacks = true;
  rpc.list.mockResolvedValue(containers); rpc.stacks.mockResolvedValue([remote]); rpc.start.mockResolvedValue(undefined);
  useProjectStore.getState().setInventoryReaders(null, null);
  useProjectStore.getState().setInventoryReaders('reader', 'reader');
  useProjectStore.setState({ activeProject: 'sample', activeStack: null, stacksByProject: {}, stackReadErrors: {}, projects: [] });
});
afterEach(() => { cleanup(); useProjectStore.getState().setInventoryReaders(null, null); });

it('loads unknown stack locations on direct entry and shares the existing reader with the status bar', async () => {
  let finish!: (value: IStackInfo[]) => void;
  rpc.stacks.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(view());
  expect(await screen.findByText('project-db')).toBeInTheDocument();
  expect(screen.getByText('Local node')).toBeInTheDocument();
  expect(screen.getByText('Local total')).toBeInTheDocument();
  expect(screen.getByText(/Loading stack locations/)).toBeInTheDocument();
  expect(screen.getByText('Control plane')).toBeInTheDocument();
  expect(screen.getByText('Unassigned')).toBeInTheDocument();
  const sameRequest = useProjectStore.getState().fetchStacks('sample');
  expect(rpc.stacks).toHaveBeenCalledTimes(1);
  await act(async () => { finish([remote]); await sameRequest; });
  expect(screen.getByRole('link', { name: 'test' })).toHaveAttribute('href', '/stacks/test');
  expect(screen.queryByText(/Loading stack locations/)).not.toBeInTheDocument();
  const row = within(screen.getByText('project-db').closest('tr')!);
  expect(row.getByText('Not reported')).toBeInTheDocument();
});

it('reports a location read failure and retries through the same store', async () => {
  rpc.stacks.mockRejectedValueOnce(Error('inventory unavailable'));
  render(view());
  expect(await screen.findByText(/Stack locations unavailable: inventory unavailable/)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'test' })).not.toBeInTheDocument();
  rpc.stacks.mockResolvedValue([remote]);
  fireEvent.click(screen.getByRole('button', { name: 'Retry stack locations' }));
  expect(await screen.findByRole('link', { name: 'test' })).toBeInTheDocument();
  expect(rpc.stacks).toHaveBeenCalledTimes(2);
});

it('does not read stack inventory without permission', async () => {
  rpc.readStacks = false;
  useProjectStore.getState().setInventoryReaders('reader', null);
  render(view());
  expect(await screen.findByText('project-db')).toBeInTheDocument();
  expect(screen.getByText(/Stack locations are unavailable with your current permissions/)).toBeInTheDocument();
  expect(rpc.stacks).not.toHaveBeenCalled();
});

it('shows pending container work, prevents duplicate start and recovers from refusal', async () => {
  let fail!: (error: Error) => void;
  rpc.start.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  render(view());
  const start = await screen.findByRole('button', { name: 'Start container project-db' });
  act(() => { fireEvent.click(start); fireEvent.click(start); });
  expect(rpc.start).toHaveBeenCalledTimes(1);
  expect(start).toBeDisabled();
  expect(screen.getByText('Starting…')).toHaveAttribute('role', 'status');
  expect(screen.getByRole('button', { name: 'Remove container project-db' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Logs for project-db' })).toBeDisabled();
  await act(async () => { fail(Error('fixture refused')); });
  expect(await screen.findByText(/Starting project-db failed: fixture refused/)).toBeInTheDocument();
  expect(start).toBeEnabled();
  expect(screen.queryByText('Starting…')).not.toBeInTheDocument();
  fireEvent.click(start);
  await waitFor(() => expect(rpc.start).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(start).toBeEnabled());
});

it('separates native health from failed setup and shows its actionable reason', async () => {
  rpc.list.mockResolvedValue([{ ...containers[0], status: 'running', health: 'healthy', provisioning: 'failed', error: 'Required bucket policy denied' }]);
  render(view());
  const row = within((await screen.findByText('project-db')).closest('tr')!);
  expect(row.getByText('healthy')).toBeInTheDocument();
  expect(row.getByText('failed')).toBeInTheDocument();
  expect(row.getByText('Required bucket policy denied')).toBeInTheDocument();
  expect(screen.getByText('Not ready')).toBeInTheDocument();
});
