/**
 * Project Store — Zustand state for project/stack management
 *
 * Manages:
 * - Project list + active project selection (lightweight UI context)
 * - Stack list per project + active stack filter
 * - Daemon operations (add/remove project, start/stop stack)
 *
 * Project/stack switching is a LIGHTWEIGHT operation — just changes
 * the webapp's filter context. The daemon keeps running everything.
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';
import { project as projectRpc } from '../netron/client';
import type {
  IProjectInfo,
  IStackInfo,
  StackRuntime,
  StackStatus,
} from '@omnitron-dev/omnitron/dto/services';

// =============================================================================
// Types
// =============================================================================

/** Tracks in-flight start/stop operations per stack */
type PendingOp = 'starting' | 'stopping';

interface ProjectState {
  projects: IProjectInfo[];
  stacksByProject: Record<string, IStackInfo[]>;
  stackRuntimes: Record<string, StackRuntime>;
  /** In-flight operations keyed by "project/stack" */
  pendingOps: Record<string, PendingOp>;
  activeProject: string | null;
  activeStack: string | null;
  /** Saved route per workspace (key = project name or '__omnitron__') */
  workspaceRoutes: Record<string, string>;
  loading: boolean;
  error: string | null;

  fetchProjects: () => Promise<void>;
  fetchStacks: (project: string) => Promise<void>;
  fetchStackStatus: (project: string, stack: string) => Promise<StackRuntime | null>;
  /** Select a project workspace. Saves current route for old workspace, returns saved route for new. */
  selectProject: (name: string, currentPath?: string) => string;
  /** Deselect project (switch to Omnitron). Saves current route, returns saved route. */
  deselectProject: (currentPath?: string) => string;
  /** Save the current route for the active workspace (call on navigation) */
  saveCurrentRoute: (path: string) => void;
  selectStack: (name: string | null) => void;
  addProject: (name: string, path: string) => Promise<void>;
  removeProject: (name: string) => Promise<void>;
  startStack: (project: string, stack: string) => Promise<void>;
  stopStack: (project: string, stack: string) => Promise<void>;
  createStack: (project: string, data: { name: string; type: 'local' | 'remote' | 'cluster'; apps: string[] | 'all'; nodeIds?: string[] }) => Promise<IStackInfo>;
  deleteStack: (project: string, stack: string) => Promise<void>;
  /** Check if a stack has a pending operation */
  getStackPendingOp: (project: string, stack: string) => PendingOp | null;
  /** Clear error message */
  clearError: () => void;
}

// =============================================================================
// Persistence
// =============================================================================

const STORAGE_KEY_PROJECT = 'omnitron_active_project';
const STORAGE_KEY_STACK = 'omnitron_active_stack';
const STORAGE_KEY_ROUTES = 'omnitron_workspace_routes';
const OMNITRON_WORKSPACE_KEY = '__omnitron__';

function persistWorkspace(project: string | null, stack: string | null): void {
  if (project) {
    localStorage.setItem(STORAGE_KEY_PROJECT, project);
  } else {
    localStorage.removeItem(STORAGE_KEY_PROJECT);
  }
  if (stack) {
    localStorage.setItem(STORAGE_KEY_STACK, stack);
  } else {
    localStorage.removeItem(STORAGE_KEY_STACK);
  }
}

function loadPersistedWorkspace(): { project: string | null; stack: string | null; routes: Record<string, string> } {
  let routes: Record<string, string> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ROUTES);
    if (raw) routes = JSON.parse(raw);
  } catch { /* ignore */ }
  return {
    project: localStorage.getItem(STORAGE_KEY_PROJECT),
    stack: localStorage.getItem(STORAGE_KEY_STACK),
    routes,
  };
}

function persistRoutes(routes: Record<string, string>): void {
  localStorage.setItem(STORAGE_KEY_ROUTES, JSON.stringify(routes));
}

// =============================================================================
// Store
// =============================================================================

export const useProjectStore = create<ProjectState>((set, get) => {
  const persisted = loadPersistedWorkspace();

  return {
  projects: [],
  stacksByProject: {},
  stackRuntimes: {},
  pendingOps: {},
  activeProject: persisted.project,
  activeStack: persisted.stack,
  workspaceRoutes: persisted.routes,
  loading: false,
  error: null,

  fetchProjects: async () => {
    try {
      set({ loading: true, error: null });
      const projects = await projectRpc.listProjects();
      set({ projects, loading: false });

      // Restore persisted project — validate it still exists
      const current = get().activeProject;
      if (current) {
        const exists = projects.some((p) => p.name === current);
        if (exists) {
          get().fetchStacks(current);
        } else {
          // Project no longer exists — clear persisted state
          set({ activeProject: null, activeStack: null });
          persistWorkspace(null, null);
        }
      } else if (projects.length === 1) {
        // Auto-select the only project — no user action needed
        const only = projects[0]!.name;
        set({ activeProject: only });
        persistWorkspace(only, null);
        get().fetchStacks(only);
      }
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  fetchStacks: async (projectName: string) => {
    try {
      const stacks = await projectRpc.listStacks({ project: projectName });
      set((state) => ({
        stacksByProject: { ...state.stacksByProject, [projectName]: stacks },
      }));

      // Auto-select stack if exactly one exists and none is selected
      if (stacks.length === 1 && !get().activeStack) {
        const stackName = stacks[0]!.name;
        set({ activeStack: stackName });
        persistWorkspace(projectName, stackName);
      }
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  fetchStackStatus: async (projectName: string, stackName: string) => {
    try {
      const runtime = await projectRpc.getStackStatus({ project: projectName, stack: stackName });
      set((state) => ({
        stackRuntimes: { ...state.stackRuntimes, [`${projectName}/${stackName}`]: runtime },
      }));
      return runtime;
    } catch (err) {
      set({ error: (err as Error).message });
      return null;
    }
  },

  selectProject: (name: string, currentPath?: string): string => {
    const state = get();
    const routes = { ...state.workspaceRoutes };

    // Save current route for the workspace we're leaving
    if (currentPath) {
      const leavingKey = state.activeProject ?? OMNITRON_WORKSPACE_KEY;
      routes[leavingKey] = currentPath;
    }

    // Get saved route for the workspace we're entering (default: dashboard)
    const savedRoute = routes[name] ?? '/';

    set({ activeProject: name, activeStack: null, workspaceRoutes: routes });
    persistWorkspace(name, null);
    persistRoutes(routes);
    get().fetchStacks(name);

    return savedRoute;
  },

  deselectProject: (currentPath?: string): string => {
    const state = get();
    const routes = { ...state.workspaceRoutes };

    // Save current route for the project we're leaving
    if (currentPath && state.activeProject) {
      routes[state.activeProject] = currentPath;
    }

    // Get saved route for Omnitron workspace (default: dashboard)
    const savedRoute = routes[OMNITRON_WORKSPACE_KEY] ?? '/';

    set({ activeProject: null, activeStack: null, workspaceRoutes: routes });
    persistWorkspace(null, null);
    persistRoutes(routes);

    return savedRoute;
  },

  saveCurrentRoute: (path: string) => {
    const state = get();
    const key = state.activeProject ?? OMNITRON_WORKSPACE_KEY;
    const routes = { ...state.workspaceRoutes, [key]: path };
    set({ workspaceRoutes: routes });
    persistRoutes(routes);
  },

  selectStack: (name: string | null) => {
    set({ activeStack: name });
    persistWorkspace(get().activeProject, name);
  },

  addProject: async (name: string, path: string) => {
    try {
      set({ loading: true, error: null });
      await projectRpc.addProject({ name, path });
      await get().fetchProjects();
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
      throw err;
    }
  },

  removeProject: async (name: string) => {
    try {
      set({ loading: true, error: null });
      await projectRpc.removeProject({ name });
      if (get().activeProject === name) {
        set({ activeProject: null, activeStack: null });
        persistWorkspace(null, null);
      }
      await get().fetchProjects();
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
      throw err;
    }
  },

  startStack: async (projectName: string, stackName: string) => {
    const opKey = `${projectName}/${stackName}`;
    // Guard against double-click
    if (get().pendingOps[opKey]) return;

    // Optimistic: mark as starting immediately
    set((s) => ({
      error: null,
      pendingOps: { ...s.pendingOps, [opKey]: 'starting' as PendingOp },
      stacksByProject: patchStackStatus(s.stacksByProject, projectName, stackName, 'starting'),
    }));

    try {
      await projectRpc.startStack({ project: projectName, stack: stackName });
    } catch (err) {
      const msg = (err as Error).message;
      // Timeout is expected for long-running start — real status arrives via polling
      if (!isTimeoutError(msg)) {
        set({ error: msg });
      }
    } finally {
      set((s) => {
        const next = { ...s.pendingOps };
        delete next[opKey];
        return { pendingOps: next };
      });
      // Always refresh to get real status
      await get().fetchStacks(projectName);
    }
  },

  stopStack: async (projectName: string, stackName: string) => {
    const opKey = `${projectName}/${stackName}`;
    if (get().pendingOps[opKey]) return;

    set((s) => ({
      error: null,
      pendingOps: { ...s.pendingOps, [opKey]: 'stopping' as PendingOp },
      stacksByProject: patchStackStatus(s.stacksByProject, projectName, stackName, 'stopping'),
    }));

    try {
      await projectRpc.stopStack({ project: projectName, stack: stackName });
    } catch (err) {
      const msg = (err as Error).message;
      if (!isTimeoutError(msg)) {
        set({ error: msg });
      }
    } finally {
      set((s) => {
        const next = { ...s.pendingOps };
        delete next[opKey];
        return { pendingOps: next };
      });
      await get().fetchStacks(projectName);
    }
  },

  createStack: async (projectName: string, data: { name: string; type: 'local' | 'remote' | 'cluster'; apps: string[] | 'all'; nodeIds?: string[] }) => {
    try {
      set({ error: null });
      const result = await projectRpc.createStack({ project: projectName, ...data });
      await get().fetchStacks(projectName);
      return result;
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },
  deleteStack: async (projectName: string, stackName: string) => {
    try {
      set({ error: null });
      await projectRpc.deleteStack({ project: projectName, stack: stackName });
      await get().fetchStacks(projectName);
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  getStackPendingOp: (projectName: string, stackName: string) => {
    return get().pendingOps[`${projectName}/${stackName}`] ?? null;
  },

  clearError: () => set({ error: null }),
  };
});

// =============================================================================
// Helpers
// =============================================================================

/** Check if error is a network/RPC timeout */
function isTimeoutError(msg: string): boolean {
  return /timeout|timed?\s*out|ETIMEDOUT|ECONNABORTED/i.test(msg);
}

/** Optimistically patch a single stack's status in the store */
function patchStackStatus(
  byProject: Record<string, IStackInfo[]>,
  project: string,
  stack: string,
  status: StackStatus,
): Record<string, IStackInfo[]> {
  const stacks = byProject[project];
  if (!stacks) return byProject;
  return {
    ...byProject,
    [project]: stacks.map((s) =>
      s.name === stack ? { ...s, status } : s,
    ),
  };
}

// =============================================================================
// Selectors — use useShallow to prevent infinite re-render loops
// =============================================================================

/** Primitive selectors — Object.is comparison works fine */
export const useActiveProject = () => useProjectStore((s) => s.activeProject);
export const useActiveStack = () => useProjectStore((s) => s.activeStack);

/**
 * Returns stacks for the active project.
 * Uses useShallow for shallow array comparison — prevents infinite loop
 * when stacksByProject object is replaced but array contents are the same.
 */
export function useActiveProjectStacks(): IStackInfo[] {
  return useProjectStore(
    useShallow((s) => (s.activeProject ? s.stacksByProject[s.activeProject] : undefined) ?? EMPTY_STACKS)
  );
}

export function useProjectInfo(name: string) {
  return useProjectStore((s) => s.projects.find((p) => p.name === name));
}

const EMPTY_STACKS: IStackInfo[] = [];
