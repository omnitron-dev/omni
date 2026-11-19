// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { IProjectInfo } from '../../src/shared/dto/project.js';
import { ProjectSwitcher } from '../../webapp/src/components/project-switcher.js';
import ProjectsPage from '../../webapp/src/pages/projects.js';

const access = vi.hoisted(() => ({ allowed: true }));
const rpc = vi.hoisted(() => ({ reviewProjectCreation: vi.fn(), createProject: vi.fn() }));
vi.mock('src/netron/client', () => ({ project: rpc, daemonClient: {} }));
const state = vi.hoisted(() => ({
  projects: [] as IProjectInfo[],
  activeProject: null as string | null,
  loading: false,
  error: null,
  fetchProjects: vi.fn(async () => undefined),
  clearError: vi.fn(),
  addProject: vi.fn(),
  updateProject: vi.fn(),
  removeProject: vi.fn(),
  workspaceRoutes: {},
}));
vi.mock('src/auth/access', () => ({
  useAccess: () => ({ can: () => access.allowed }),
  Can: ({ children }: { children: React.ReactNode }) => (access.allowed ? children : null),
}));
vi.mock('src/stores/project.store', () => ({
  useProjectStore: (selector: (value: typeof state) => unknown) => selector(state),
  workspaceBookmark: (_routes: unknown, project: string | null) => project ? '/projects/' + project : '/',
}));
vi.mock('src/hooks/use-polled-resource', () => ({ usePollingEffect: () => {} }));
vi.mock('@omnitron-dev/prism/components/snackbar', () => ({
  useSnackbar: () => ({ success: vi.fn(), error: vi.fn() }),
}));
beforeEach(() => {
  access.allowed = true;
  state.projects = [];
  state.activeProject = null;
  vi.clearAllMocks();
});
afterEach(cleanup);

function mount(path = '/') {
  return render(
    <ThemeProvider theme={createTheme()}>
      <MemoryRouter initialEntries={[path]}>
        <ProjectSwitcher />
        <Routes>
          <Route path="/projects/:project" element={<main />} />
          <Route path="/" element={<main />} />
          <Route path="/projects" element={<ProjectsPage />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
}
describe('workspace menu commands', () => {
  it('focuses the selected workspace and navigates directly between project menu items', async () => {
    state.projects = ['alpha', 'beta'].map((name) => ({
      name,
      displayName: name,
      path: `/projects/${name}`,
      registeredAt: '2026-01-01',
      enabledStacks: [],
      runningStacks: 0,
      totalStacks: 1,
    }));
    mount('/projects/beta');
    fireEvent.click(screen.getByRole('button', { name: 'Switch workspace: beta' }));
    const current = screen.getByRole('menuitem', { name: 'beta 0/1 stacks' });
    await waitFor(() => expect(document.activeElement).toBe(current));
    fireEvent.keyDown(current, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'alpha 1 stacks' }));
  });
  it('reviews the starter through the workspace menu and registers the exact reviewed project', async () => {
    const needs = { automation: false, persistence: 'none', service: 'node' };
    rpc.reviewProjectCreation.mockResolvedValue({ name: 'sample', path: '/workspace/sample', effects: [],
      manifest: { needs, commands: { start: 'node omnitron-worker.js' }, dependencies: {} },
      digest: 'a'.repeat(64), files: [{ path: 'omnitron.config.ts', content: 'configuration' }] });
    rpc.createProject.mockResolvedValue({ name: 'sample' });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Switch workspace: Omnitron' }));
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'End' });
    const add = screen.getByRole('menuitem', { name: 'Create project' });
    await waitFor(() => expect(document.activeElement).toBe(add));
    fireEvent.click(add);
    expect(await screen.findByRole('dialog', { name: 'Create project' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'sample' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review starter' }));
    await screen.findByText('/workspace/sample');
    expect(rpc.reviewProjectCreation).toHaveBeenCalledWith({ name: 'sample', needs });
    expect(rpc.createProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(state.fetchProjects).toHaveBeenCalled());
    expect(rpc.createProject).toHaveBeenCalledWith({ name: 'sample', needs, digest: 'a'.repeat(64) });
    expect(state.addProject).not.toHaveBeenCalled();
  });
  it('keeps existing directory registration separate from starter creation', () => {
    mount('/projects');
    fireEvent.click(screen.getByRole('button', { name: 'Add existing project' }));
    expect(screen.getByRole('dialog', { name: 'Add existing project' })).toBeTruthy();
    expect(screen.getByLabelText('Project Path')).toBeTruthy();
    expect(screen.getByText('omnitron init --existing --check')).toBeTruthy();
    expect(rpc.reviewProjectCreation).not.toHaveBeenCalled();
  });
  it('lets an administrator review suggested needs before any project is created', async () => {
    mount('/projects?create=1&name=notes&automation=1&persistence=sqlite&service=none');
    expect((screen.getByLabelText('Run automation with Xec') as HTMLInputElement).checked).toBe(true);
    expect(rpc.reviewProjectCreation).not.toHaveBeenCalled();
    rpc.reviewProjectCreation.mockRejectedValueOnce(Error('Review unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Review starter' }));
    await screen.findByText('Review unavailable');
    expect(rpc.reviewProjectCreation).toHaveBeenCalledWith({ name: 'notes', needs: { automation: true, persistence: 'sqlite', service: 'none' } });
    expect(rpc.createProject).not.toHaveBeenCalled();
  });
  it('does not offer or open a registration form without permission', () => {
    access.allowed = false;
    mount('/projects?create=1');
    fireEvent.click(screen.getByRole('button', { name: 'Switch workspace: Omnitron' }));
    expect(screen.queryByRole('menuitem', { name: 'Create project' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Create project' })).toBeNull();
  });
  it('does not query or reveal a retained project name without inventory access', () => {
    access.allowed = false;
    state.activeProject = 'private-workspace';
    state.projects = [{ name: state.activeProject, displayName: 'Private workspace' } as IProjectInfo];
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Switch workspace: Omnitron' }));
    expect(screen.queryByText('Private workspace')).toBeNull();
    expect(state.fetchProjects).not.toHaveBeenCalled();
  });
});
