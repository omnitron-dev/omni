// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const mocks = vi.hoisted(() => ({ stacks: vi.fn(), deployments: vi.fn() }));
vi.mock('src/netron/release-wire', () => ({ releaseApi: { deployments: mocks.deployments } }));
vi.mock('src/stores/project.store', () => ({ useProjectStore: { getState: () => ({ fetchStacks: mocks.stacks }) } }));
const { ReleaseDeploymentState } = await import('../../webapp/src/components/release-deployment-state');
const { CommitPair } = await import('../../webapp/src/components/release-bits');
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('shows current placement and stopped apps without turning deployment history into a running release', async () => {
  mocks.stacks.mockResolvedValue([
    { name: 'dev', type: 'local', status: 'stopped', apps: [{ status: 'stopped' }], nodes: [] },
    { name: 'test', type: 'remote', status: 'running', apps: [{ status: 'online' }], nodes: [{ host: 'test.example', port: 9700, label: 'Test node', connected: true }] },
  ]);
  mocks.deployments.mockResolvedValue({ known: true, deployments: [{ project: 'sample', stack: 'test', release: 'sample-old', at: '2026-09-30T00:00:00Z', source: 'operator' }] });
  render(<MemoryRouter><ReleaseDeploymentState project="sample" /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('Test node · test.example:9700 · reachable')).toBeTruthy());
  expect(screen.getByText('No applications running')).toBeTruthy();
  expect(screen.getByText('Current release not reported')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'sample-old' }).getAttribute('href')).toBe('/releases/sample-old');
  expect(screen.getAllByText('Last recorded deployment')).toHaveLength(2);
});

it('does not display a failed inventory request as an empty project', async () => {
  mocks.stacks.mockResolvedValue(null);
  mocks.deployments.mockResolvedValue({ known: true, deployments: [] });
  render(<MemoryRouter><ReleaseDeploymentState project="sample" /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText(/Stack inventory could not be read/)).toBeTruthy());
  expect(screen.queryByText('No stacks configured for this project.')).toBeNull();
});

it('labels the source control warning explicitly as Git', () => {
  render(<CommitPair project="sample" projectCommit="aabbccdd" omniCommit="11223344" onRemote={{ project: false, omni: true }} />);
  expect(screen.getByText('Git: no remote branch')).toBeTruthy();
  expect(screen.queryByText('local only')).toBeNull();
});
