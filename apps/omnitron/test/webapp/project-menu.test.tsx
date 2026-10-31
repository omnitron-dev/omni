// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { IProjectInfo } from '../../src/shared/dto/project.js';
import { ProjectSwitcher } from '../../webapp/src/components/project-switcher.js';
import ProjectsPage from '../../webapp/src/pages/projects.js';

const access = vi.hoisted(() => ({ allowed: true }));
const state = vi.hoisted(() => ({
  projects: [] as IProjectInfo[],
  activeProject: null as string | null,
  loading: false,
  error: null,
  fetchProjects: vi.fn(),
  clearError: vi.fn(),
  addProject: vi.fn(),
  updateProject: vi.fn(),
  removeProject: vi.fn(),
  selectProject: vi.fn(),
  deselectProject: vi.fn(),
}));
vi.mock('src/auth/access', () => ({
  useAccess: () => ({ can: () => access.allowed }),
  Can: ({ children }: { children: React.ReactNode }) => (access.allowed ? children : null),
}));
vi.mock('src/stores/project.store', () => ({
  useProjectStore: (selector: (value: typeof state) => unknown) => selector(state),
  useActiveProject: () => state.activeProject,
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
    state.activeProject = 'beta';
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Switch workspace: beta' }));
    const current = screen.getByRole('menuitem', { name: 'beta idle' });
    await waitFor(() => expect(document.activeElement).toBe(current));
    fireEvent.keyDown(current, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'alpha idle' }));
  });
  it('opens the authorized Add Project form through keyboard menu navigation', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Switch workspace: Omnitron' }));
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'End' });
    const add = screen.getByRole('menuitem', { name: 'Add project' });
    await waitFor(() => expect(document.activeElement).toBe(add));
    fireEvent.click(add);
    expect(await screen.findByRole('dialog', { name: 'Add Project' })).toBeTruthy();
    expect(state.addProject).not.toHaveBeenCalled();
  });
  it('does not offer or open a registration form without permission', () => {
    access.allowed = false;
    mount('/projects?create=1');
    fireEvent.click(screen.getByRole('button', { name: 'Switch workspace: Omnitron' }));
    expect(screen.queryByRole('menuitem', { name: 'Add project' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Add Project' })).toBeNull();
  });
});
