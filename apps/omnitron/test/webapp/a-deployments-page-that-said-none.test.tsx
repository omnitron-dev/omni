// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
const mocks = vi.hoisted(() => ({ history: vi.fn(), starts: vi.fn(), progress: vi.fn(), deploy: vi.fn(),
  state: { activeProject: 'sample', activeStack: null as string | null,
    projects: [{ name: 'sample', configurations: [{ runtimeProject: 'sample-extra', stacks: { prodA: 'prod' } }] }] },
}));
vi.mock('src/netron/client', () => ({ deploy: { getHistory: mocks.history, deployApp: mocks.deploy }, project: { getDeployProgress: mocks.progress } }));
vi.mock('src/netron/release-wire', () => ({ releaseApi: { deployments: mocks.starts } }));
vi.mock('src/stores/project.store', () => ({ useProjectStore: (select: (state: typeof mocks.state) => unknown) => select(mocks.state) }));
const { default: DeploymentsPage } = await import('../../webapp/src/pages/deployments');
const draw = () => render(<ThemeProvider theme={createTheme()}><MemoryRouter><DeploymentsPage /></MemoryRouter></ThemeProvider>);
const start = (project: string, stack: string, release: string) => ({ project, stack, release, releaseUnnamed: false, at: '2026-10-01T00:00:00Z', source: 'operator', actorId: 'operator', projectCommit: null, omniCommit: null });
beforeEach(() => { vi.resetAllMocks(); mocks.state.activeProject = 'sample'; mocks.state.activeStack = null;
  mocks.history.mockResolvedValue([]); mocks.starts.mockResolvedValue({ known: true, deployments: [] }); mocks.progress.mockResolvedValue([]);
});
afterEach(cleanup);

describe('deployment operations workspace', () => {
  it('points to the actual release workflow and makes history coverage explicit', async () => {
    draw();
    expect(await screen.findByText('No stack start recorded for this workspace')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Deploy a release' })).toHaveAttribute('href', '/releases');
    expect(screen.getByRole('link', { name: 'Audit' })).toHaveAttribute('href', '/audit');
    expect(screen.getByText(/Latest recorded start per stack/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deploy' })).not.toBeInTheDocument();
    expect(mocks.deploy).not.toHaveBeenCalled();
  });
  it('scopes stack and app history through the project configuration aliases', async () => {
    mocks.starts.mockResolvedValue({ known: true, deployments: [start('sample-extra', 'prodA', 'sample-release'), start('foreign', 'prod', 'foreign-release')] });
    mocks.history.mockResolvedValue([
      { id: '1', app: 'sample-extra/prodA/api', version: 'old-label', strategy: 'rolling', status: 'success', startedAt: '2026-01-01', completedAt: null, deployedBy: null },
      { id: '2', app: 'foreign/prod/api', version: 'foreign-label', strategy: 'rolling', status: 'success', startedAt: '2026-01-01', completedAt: null, deployedBy: null },
    ]);
    draw();
    expect(await screen.findByRole('link', { name: 'sample-release' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'prod' })).toHaveAttribute('href', '/stacks/prod');
    expect(screen.queryByText('foreign-release')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Legacy app operations/ }));
    expect(await screen.findByText('old-label')).toBeInTheDocument();
    expect(screen.queryByText('foreign-label')).not.toBeInTheDocument();
    expect(screen.getByText('Requested label')).toBeInTheDocument();
    expect(screen.getByText(/do not prove an artifact was installed/)).toBeInTheDocument();
  });
  it('keeps unscoped progress accessible without claiming it belongs to this project', async () => {
    mocks.progress.mockResolvedValue([{ node: 'node.example:9700', app: 'api', status: 'installing', progress: 50, message: 'Unscoped transfer', at: new Date().toISOString() }]);
    draw();
    const toggle = await screen.findByRole('button', { name: /Show unscoped observations/ });
    expect(screen.getByText(/Project and operation identities are not recorded/)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(await screen.findByText('Unscoped transfer')).toBeVisible();
  });
  it('shows progress read failure separately from readable stack history', async () => {
    mocks.progress.mockRejectedValue(new Error('peer unavailable'));
    mocks.starts.mockResolvedValue({ known: true, deployments: [start('sample', 'prod', 'sample-release')] });
    draw();
    expect(await screen.findByText(/Transfer observations unavailable: peer unavailable/)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'sample-release' })).toBeInTheDocument();
    expect(screen.queryByText('No transfer observations retained by this controller.')).not.toBeInTheDocument();
  });
  it('does not turn unavailable audit history into a claim of no deployments', async () => {
    mocks.starts.mockResolvedValue({ known: false, why: 'Audit unavailable' });
    draw();
    expect(await screen.findByText(/Audit unavailable/)).toBeInTheDocument();
    expect(screen.queryByText('No stack start recorded for this workspace')).not.toBeInTheDocument();
  });
  it('retains the last known stack record when the next audit read is unavailable', async () => {
    mocks.starts.mockResolvedValueOnce({ known: true, deployments: [start('sample', 'prod', 'sample-release')] })
      .mockResolvedValue({ known: false, why: 'Audit unavailable' });
    draw();
    expect(await screen.findByRole('link', { name: 'sample-release' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh deployments' }));
    expect(await screen.findByText(/Audit unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'sample-release' })).toBeInTheDocument();
  });
  it('retains a transfer report without animating it as live after polling fails', async () => {
    mocks.progress.mockResolvedValueOnce([{ node: 'node.example:9700', app: 'api', status: 'installing', progress: 50, message: 'Last transfer report', at: new Date().toISOString() }])
      .mockRejectedValue(new Error('peer unavailable'));
    draw();
    fireEvent.click(await screen.findByRole('button', { name: /Show unscoped observations/ }));
    expect(screen.getByText('Last transfer report')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh deployments' }));
    expect(await screen.findByText(/Transfer observations unavailable: peer unavailable/)).toBeInTheDocument();
    expect(screen.getByText('Last transfer report')).toBeVisible();
    expect(screen.getByText(/completion is unknown/)).toBeVisible();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(screen.queryByText('1 in flight')).not.toBeInTheDocument();
  });
});
