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

import { readStackStart } from '@omnitron-dev/omnitron/release-reading';
import { create } from 'zustand';
import { isRpcTimeout } from '../utils/rpc-error';
export { isRpcTimeout } from '../utils/rpc-error';
import { useShallow } from 'zustand/shallow';
import { project as projectRpc } from '../netron/client';
import { readStored, writeStored, removeStored, readStoredJson, writeStoredJson } from '../utils/storage';
import { stackCounts } from '../utils/stack-inventory';
import { restoredProjectScope } from '../utils/project-scope';
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

export type StackActionResult = { state: 'confirmed' } | { state: 'partial' | 'unconfirmed' | 'failed' | 'busy'; message: string };

interface ProjectState {
  projects: IProjectInfo[];
  stacksByProject: Record<string, IStackInfo[]>;
  stackReadErrors: Record<string, string | null>;
  stackNotices: Record<string, string>;
  clearStackNotice(key: string): void;
  stackRuntimes: Record<string, StackRuntime>;
  /** In-flight operations keyed by "project/stack" */
  pendingOps: Record<string, PendingOp>;
  activeProject: string | null;
  activeStack: string | null;
  /** Saved route per workspace (key = project name or '__omnitron__') */
  workspaceRoutes: Record<string, string>;
  loading: boolean;
  error: string | null;

  fetchProjects: (currentPath?: string) => Promise<string | void>;
  fetchStacks: (project: string) => Promise<IStackInfo[] | null>;
  fetchStackStatus: (project: string, stack: string) => Promise<StackRuntime | null>;
  /** Select a project workspace. Saves current route for old workspace, returns saved route for new. */
  selectProject: (name: string, currentPath?: string) => string;
  /** Deselect project (switch to Omnitron). Saves current route, returns saved route. */
  deselectProject: (currentPath?: string) => string;
  /** Save the current route for the active workspace (call on navigation) */
  saveCurrentRoute: (path: string) => void;
  selectStack: (name: string | null) => void;
  addProject: (name: string, path: string) => Promise<void>;
  updateProject: (name: string, data: { path?: string }) => Promise<void>;
  removeProject: (name: string) => Promise<void>;
  /**
   * Start a stack, optionally FROM A RELEASE.
   *
   * Without `release` the daemon deploys what is on its disk, which is what
   * a development stand is for. A stack whose config says
   * `release: { mode: 'required' }` refuses that outright and names the two
   * commands instead — see `admitRelease`.
   */
  startStack: (project: string, stack: string, opts?: { release?: string; allowDirty?: boolean }) => Promise<StackActionResult>;
  stopStack: (project: string, stack: string, review: string) => Promise<void>;
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
  if (project) writeStored(STORAGE_KEY_PROJECT, project);
  else removeStored(STORAGE_KEY_PROJECT);

  if (stack) writeStored(STORAGE_KEY_STACK, stack);
  else removeStored(STORAGE_KEY_STACK);
}

/**
 * Runs while the store is being constructed, i.e. at import.
 *
 * The routes read was already guarded; the two plain `getItem` calls beside
 * it were not, and in a browser that blocks site data even reading throws.
 * A throw here happens before any component mounts and above every error
 * boundary, so the console renders nothing at all.
 */
function loadPersistedWorkspace(): { project: string | null; stack: string | null; routes: Record<string, string> } {
  const project = readStored(STORAGE_KEY_PROJECT);
  return {
    project,
    stack: project ? readStored(STORAGE_KEY_STACK) : null,
    routes: readStoredJson<Record<string, string>>(STORAGE_KEY_ROUTES, {}),
  };
}

function persistRoutes(routes: Record<string, string>): void {
  writeStoredJson(STORAGE_KEY_ROUTES, routes);
}

// =============================================================================
// Store
// =============================================================================

export const useProjectStore = create<ProjectState>((set, get) => {
  const persisted = loadPersistedWorkspace();
  const stackRequests = new Map<string, Promise<IStackInfo[] | null>>();

  const notice = (key: string, message?: string) => set(state => {
    const next = { ...state.stackNotices };
    if (message) next[key] = message;
    else delete next[key];
    return { stackNotices: next };
  });

  return {
  projects: [],
  stacksByProject: {},
  stackReadErrors: {},
  stackNotices: {},
  clearStackNotice: key => notice(key),
  stackRuntimes: {},
  pendingOps: {},
  activeProject: persisted.project,
  activeStack: persisted.stack,
  workspaceRoutes: persisted.routes,
  loading: false,
  error: null,

  fetchProjects: async (currentPath?: string) => {
    try {
      set({ loading: true, error: null });
      const projects = await projectRpc.listProjects();
      set(state => ({ projects: projects.map(project => state.stacksByProject[project.name]
        ? { ...project, ...stackCounts(state.stacksByProject[project.name]!) } : project), loading: false }));

      // Restore persisted project — validate it still exists
      const current = get().activeProject;
      if (current) {
        const restored = restoredProjectScope(projects, current, get().activeStack);
        if (restored) {
          const previousStack = get().activeStack;
          if (restored.project !== current) {
            const rewriteRoute = (route: string) => previousStack && restored.stack && route === `/stacks/${previousStack}`
              ? `/stacks/${restored.stack}` : route;
            const routes = { ...get().workspaceRoutes };
            if (routes[current] && !routes[restored.project]) routes[restored.project] = rewriteRoute(routes[current]!);
            set({ activeProject: restored.project, activeStack: restored.stack, workspaceRoutes: routes });
            persistWorkspace(restored.project, restored.stack);
            persistRoutes(routes);
            void get().fetchStacks(restored.project);
            if (currentPath && rewriteRoute(currentPath) !== currentPath) return rewriteRoute(currentPath);
          } else void get().fetchStacks(current);
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
    return undefined;
  },

  fetchStacks: async (projectName: string) => {
    const pending = stackRequests.get(projectName);
    if (pending) return pending;
    const request = (async () => {
    try {
      const stacks = await projectRpc.listStacks({ project: projectName });
      set((state) => ({
        stacksByProject: { ...state.stacksByProject, [projectName]: stacks },
        stackReadErrors: { ...state.stackReadErrors, [projectName]: null },
        projects: state.projects.map(project => project.name === projectName ? { ...project, ...stackCounts(stacks) } : project),
      }));

      // A successful inventory may invalidate a removed/renamed filter. It
      // never narrows an explicit All stacks choice, even for one stack, and
      // an answer for a previous workspace cannot change the current scope.
      if (get().activeProject === projectName && get().activeStack
        && !stacks.some(stack => stack.name === get().activeStack)) {
        set({ activeStack: null });
        persistWorkspace(projectName, null);
      }
      return stacks;
    } catch (err) {
      set(state => ({ stackReadErrors: { ...state.stackReadErrors, [projectName]: (err as Error).message } }));
      return null;
    }
    })();
    stackRequests.set(projectName, request);
    try { return await request; } finally { stackRequests.delete(projectName); }
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
    const { activeProject, stacksByProject } = get();
    // Only inventory-backed choices can narrow the workspace. A failed read
    // does not clear an existing choice; clearing to All is always available.
    if (name && (!activeProject || !stacksByProject[activeProject]?.some(stack => stack.name === name))) return;
    set({ activeStack: name });
    persistWorkspace(activeProject, name);
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

  updateProject: async (name: string, data: { path?: string }) => {
    try {
      set({ loading: true, error: null });
      const updated = await projectRpc.updateProject({ name, ...data });
      // Registry may rename the project (basename of new path)
      if (updated.name !== name && get().activeProject === name) {
        set({ activeProject: updated.name, activeStack: null });
        persistWorkspace(updated.name, null);
      }
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

  startStack: async (projectName: string, stackName: string, opts?: { release?: string; allowDirty?: boolean }) => {
    const opKey = `${projectName}/${stackName}`;
    if (get().pendingOps[opKey]) return { state: 'busy', message: `An operation is already pending for ${opKey}.` };

    // Optimistic: mark as starting immediately
    notice(opKey);
    set((s) => ({
      pendingOps: { ...s.pendingOps, [opKey]: 'starting' as PendingOp },
      stacksByProject: patchStackStatus(s.stacksByProject, projectName, stackName, 'starting'),
    }));

    try {
      const stack = await projectRpc.startStack({
        project: projectName,
        stack: stackName,
        ...(opts?.release ? { release: opts.release } : {}),
        ...(opts?.allowDirty ? { allowDirty: true } : {}),
      });
      const { confirmed, issues, online, total } = readStackStart(stack);
      if (confirmed) return { state: 'confirmed' };
      const message = `${opKey}: ${online}/${total} apps online. ${issues.join('; ')}.`;
      notice(opKey, message);
      return { state: 'partial', message };
    } catch (err) {
      const timeout = isRpcTimeout(err);
      const message = timeout
        ? `No start acknowledgement for ${opKey}. Inspect the stack and deployment history before retrying.`
        : err instanceof Error ? err.message : String(err);
      notice(opKey, message);
      return { state: timeout ? 'unconfirmed' : 'failed', message };
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

  stopStack: async (projectName: string, stackName: string, review: string) => {
    const opKey = `${projectName}/${stackName}`;
    if (get().pendingOps[opKey]) return;

    notice(opKey);
    set((s) => ({
      pendingOps: { ...s.pendingOps, [opKey]: 'stopping' as PendingOp },
      stacksByProject: patchStackStatus(s.stacksByProject, projectName, stackName, 'stopping'),
    }));

    try {
      const result = await projectRpc.stopStack({ project: projectName, stack: stackName, review });
      if (result.status !== 'stopped' || result.stopOperation?.phase !== 'stopped') throw new Error('Daemon did not confirm the complete stack stop');
    } catch (err) {
      notice(opKey, isRpcTimeout(err)
        ? 'Stop acknowledgement has not arrived. Check the stack operation before retrying; applications may still be running.'
        : (err as Error).message);
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
      notice(`${projectName}/${stackName}`);
      await projectRpc.deleteStack({ project: projectName, stack: stackName });
      await get().fetchStacks(projectName);
    } catch (err) {
      notice(`${projectName}/${stackName}`, (err as Error).message);
      throw err;
    }
  },

  getStackPendingOp: (projectName: string, stackName: string) => get().pendingOps[`${projectName}/${stackName}`] ?? null,

  clearError: () => set({ error: null }),
  };
});

// =============================================================================
// Helpers
// =============================================================================

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
