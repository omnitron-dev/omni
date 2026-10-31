// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { TopologyEditor } from '../../webapp/src/components/topology/topology-editor.js';
const api = vi.hoisted(() => ({
  getTopologyWorkspace: vi.fn(),
  saveTopologyDraft: vi.fn(),
  planTopology: vi.fn(),
  applyTopologyPlan: vi.fn(),
  can: vi.fn(),
}));
vi.mock('src/netron/client', () => ({ project: api }));
vi.mock('src/auth/access', () => ({ useAccess: () => ({ can: api.can }) }));
const spec = {
  version: 1,
  type: 'cluster',
  apps: ['api'],
  nodes: [{ host: 'a', port: 9700, role: 'app', apps: ['api'] }],
};
const workspace = () => ({
  project: 'sample',
  stack: 'prod',
  revision: 'base',
  configured: spec,
  desired: spec,
  draft: null,
  plans: [],
  applications: [{ name: 'api', runtime: 'process', dependsOn: [] }],
  services: [],
  availableNodes: [],
  dependencies: [],
  warnings: [],
  observed: { placements: [] },
});
const plan = () => ({
  project: 'sample',
  stack: 'prod',
  id: 'reviewed-plan',
  baseRevision: 'base',
  draftRevision: 1,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 600000).toISOString(),
  spec,
  changes: [],
  issues: [],
  effect: 'configuration',
  status: 'planned',
});
const renderEditor = (onClose = vi.fn()) =>
  render(
    <ThemeProvider theme={createTheme()}>
      <MemoryRouter>
        <TopologyEditor projectName="sample" stackName="prod" onClose={onClose} onApplied={vi.fn()} />
      </MemoryRouter>
    </ThemeProvider>
  );
beforeEach(() => {
  vi.clearAllMocks();
  api.can.mockReturnValue(true);
  api.getTopologyWorkspace.mockResolvedValue(workspace());
  api.saveTopologyDraft.mockResolvedValue({
    revision: 1,
    baseRevision: 'base',
    spec,
    updatedAt: new Date().toISOString(),
  });
  api.planTopology.mockResolvedValue(plan());
  api.applyTopologyPlan.mockResolvedValue({ ...plan(), status: 'applied' });
});
afterEach(cleanup);
describe('topology editor', () => {
  it('rebases local edits explicitly after a conflict and reviews against the new draft revision', async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove a:9700 from desired topology' }));
    api.saveTopologyDraft.mockRejectedValueOnce(new Error('Draft changed in another session'));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText('Draft changed in another session');
    api.getTopologyWorkspace.mockResolvedValueOnce({ ...workspace(), revision: 'new-base', draft: { revision: 7, baseRevision: 'new-base', spec } });
    fireEvent.click(screen.getByRole('button', { name: 'Rebase edits' }));
    await screen.findByText('Latest base loaded. Your edits are preserved locally; review and save them before planning.');
    expect(api.applyTopologyPlan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Review plan' }));
    await waitFor(() => expect(api.saveTopologyDraft).toHaveBeenLastCalledWith({ project: 'sample', stack: 'prod', baseRevision: 'new-base', expectedDraft: 7, spec: { ...spec, nodes: [] } }));
  });
  it('saves a draft, reviews a server plan, and applies only its explicit ID', async () => {
    renderEditor();
    const review = await screen.findByRole('button', { name: 'Review plan' });
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(review);
    const apply = await screen.findByRole('button', { name: 'Accept target' });
    expect(api.saveTopologyDraft).toHaveBeenCalledWith({
      project: 'sample',
      stack: 'prod',
      baseRevision: 'base',
      expectedDraft: null,
      spec,
    });
    expect(api.applyTopologyPlan).not.toHaveBeenCalled();
    fireEvent.click(apply);
    await waitFor(() =>
      expect(api.applyTopologyPlan).toHaveBeenCalledWith({ project: 'sample', stack: 'prod', plan: 'reviewed-plan' })
    );
    await screen.findByText('Target accepted. Deployment and restart configuration are unchanged.');
  });
  it('keeps viewer controls read-only, including keyboard saving', async () => {
    api.can.mockReturnValue(false);
    renderEditor();
    await screen.findByLabelText('Stack applications');
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Review plan' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 's', ctrlKey: true });
    expect(api.saveTopologyDraft).not.toHaveBeenCalled();
  });
  it('protects unsaved edits on close and supports keyboard saving', async () => {
    const close = vi.fn();
    renderEditor(close);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove a:9700 from desired topology' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close topology editor' }));
    await screen.findByText('Discard unsaved changes?');
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Discard unsaved changes?')).toBeNull());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 's', ctrlKey: true });
    await waitFor(() =>
      expect(api.saveTopologyDraft).toHaveBeenCalledWith(expect.objectContaining({ spec: { ...spec, nodes: [] } }))
    );
  });
  it('blocks application of an invalid plan', async () => {
    api.planTopology.mockResolvedValue({
      ...plan(),
      issues: [{ severity: 'error', code: 'invalid-placement', message: 'Application is unassigned' }],
    });
    renderEditor();
    const review = await screen.findByRole('button', { name: 'Review plan' });
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(review);
    const apply = await screen.findByRole('button', { name: 'Accept target' });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    expect(api.applyTopologyPlan).not.toHaveBeenCalled();
  });
});
