/** Access-keyed project and stack inventories, workspace bookmarks and daemon operations. */

import { isLostRpcAcknowledgement } from '@omnitron-dev/omnitron/dto/services';
import { readStackStart } from '@omnitron-dev/omnitron/release-reading';
import { create } from 'zustand';
import { isRpcTimeout } from '../utils/rpc-error';
export { isRpcTimeout } from '../utils/rpc-error';
import { useShallow } from 'zustand/shallow';
import { invokeStackLifecycle, project as projectRpc } from '../netron/client';
import { readStoredJson, writeStoredJson } from '../utils/storage';
import { stacksInScope } from '../utils/stack-inventory';
import { useWorkspace, workspaceHref, workspaceLocation } from '../routes/workspace';
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
export type PendingOp = 'starting' | 'stopping' | 'resuming';

export type StackActionResult = { state: 'confirmed' } | { state: 'partial' | 'unconfirmed' | 'failed' | 'busy'; message: string };

interface ProjectState {
  projects: IProjectInfo[];
  hasProjectSnapshot: boolean;
  stacksByProject: Record<string, IStackInfo[]>;
  stackReadErrors: Record<string, string | null>;
  stackNotices: Record<string, string>;
  clearStackNotice(key: string): void;
  stackRuntimes: Record<string, StackRuntime>;
  /** In-flight operations keyed by "project/stack" */
  pendingOps: Record<string, PendingOp>;
  /** Saved route per workspace (key = project name or '__omnitron__') */
  workspaceRoutes: Record<string, string>;
  loading: boolean;
  error: string | null;

  fetchProjects: (afterChange?: boolean) => Promise<void>;
  setInventoryReaders: (projects: string | null, stacks: string | null) => void;
  fetchStacks: (project: string) => Promise<IStackInfo[] | null>;
  fetchStackStatus: (project: string, stack: string) => Promise<StackRuntime | null>;
  saveCurrentRoute: (path: string) => void;
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
  startStack: (project: string, stack: string, opts?: { release?: string; allowDirty?: boolean; workingTree?: boolean }) => Promise<StackActionResult>;
  resumeInstalledStack: (project: string, stack: string) => Promise<void>;
  stopStack: (project: string, stack: string, review: string, keepInfrastructure?: boolean) => Promise<void>;
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

const STORAGE_KEY_ROUTES = 'omnitron_workspace_routes';

export function workspaceBookmark(routes: Record<string, string>, project: string | null): string {
  const saved = routes[project ?? '__omnitron__'];
  if (typeof saved === 'string' && saved.startsWith('/') && !saved.startsWith('//') && !saved.includes('\\')) {
    const pathname = saved.split(/[?#]/)[0]!;
    if (workspaceLocation({ pathname }).project === project) return saved;
  }
  return workspaceHref({ project, stack: null });
}

// =============================================================================
// Store
// =============================================================================

export const useProjectStore = create<ProjectState>((set, get) => {

  const stackRequests = new Map<string, Promise<IStackInfo[] | null>>();
  let projectRequest: Promise<void> | null = null;
  let stackReader: string | null = null;
  let projectReader: string | null = null;
  let projectGeneration = 0;
  let inventoryGeneration = 0;

  const notice = (key: string, message?: string) => set(state => {
    const next = { ...state.stackNotices };
    if (message) next[key] = message;
    else delete next[key];
    return { stackNotices: next };
  });

  const finishOperation = async (key: string, project: string) => {
    try {
      // A poll already in flight may have sampled the stack before the command finished.
      await stackRequests.get(project);
      await get().fetchStacks(project);
    } finally {
      set(state => {
        const pendingOps = { ...state.pendingOps };
        delete pendingOps[key];
        return { pendingOps };
      });
    }
  };

  return {
  projects: [],
  hasProjectSnapshot: false,
  stacksByProject: {},
  stackReadErrors: {},
  stackNotices: {},
  clearStackNotice: key => notice(key),
  stackRuntimes: {},
  pendingOps: {},
  workspaceRoutes: readStoredJson<Record<string, string>>(STORAGE_KEY_ROUTES, {}),
  loading: false,
  error: null,

  fetchProjects: async (afterChange = false) => {
    if (!projectReader) return;
    if (projectRequest && !afterChange) {
      await projectRequest;
      return;
    }
    const generation = ++projectGeneration;
    set({ loading: true, error: null });
    const request = projectRpc.listProjects().then(projects => {
      if (generation === projectGeneration) set({ projects, hasProjectSnapshot: true, loading: false });
    }).catch((err: Error) => {
      if (generation === projectGeneration) set({ error: err.message, loading: false });
    });
    projectRequest = request;
    try { await request; } finally {
      if (projectRequest === request) projectRequest = null;
    }
  },

  setInventoryReaders: (projects, stacks) => {
    if (projectReader !== projects) {
      projectReader = projects;
      projectGeneration++;
      projectRequest = null;
      set({ projects: [], hasProjectSnapshot: false, loading: false, error: null });
    }
    if (stackReader === stacks) return;
    stackReader = stacks;
    inventoryGeneration++;
    stackRequests.clear();
    set({ stacksByProject: {}, stackReadErrors: {} });
  },

  fetchStacks: async (projectName: string) => {
    if (!stackReader) return null;
    const generation = inventoryGeneration;
    const pending = stackRequests.get(projectName);
    if (pending) return pending;
    const request = (async () => {
    try {
      const stacks = await projectRpc.listStacks({ project: projectName });
      if (generation !== inventoryGeneration) return null;
      set((state) => ({
        stacksByProject: { ...state.stacksByProject, [projectName]: stacks },
        stackReadErrors: { ...state.stackReadErrors, [projectName]: null },
      }));

      return stacks;
    } catch (err) {
      if (generation === inventoryGeneration) {
        set(state => ({ stackReadErrors: { ...state.stackReadErrors, [projectName]: (err as Error).message } }));
      }
      return null;
    }
    })();
    stackRequests.set(projectName, request);
    try { return await request; } finally {
      if (stackRequests.get(projectName) === request) stackRequests.delete(projectName);
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

  saveCurrentRoute: (path) => {
    const { project } = workspaceLocation({ pathname: path.split(/[?#]/)[0]! });
    const key = project ?? '__omnitron__';
    if (get().workspaceRoutes[key] === path) return;
    const routes = { ...get().workspaceRoutes, [key]: path };
    set({ workspaceRoutes: routes });
    writeStoredJson(STORAGE_KEY_ROUTES, routes);
  },

  addProject: async (name: string, path: string) => {
    try {
      set({ loading: true, error: null });
      await projectRpc.addProject({ name, path });
      await get().fetchProjects(true);
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
      throw err;
    }
  },

  updateProject: async (name: string, data: { path?: string }) => {
    try {
      set({ loading: true, error: null });
      await projectRpc.updateProject({ name, ...data });
      await get().fetchProjects(true);
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
      throw err;
    }
  },

  removeProject: async (name: string) => {
    try {
      set({ loading: true, error: null });
      await projectRpc.removeProject({ name });
      await get().fetchProjects(true);
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
      throw err;
    }
  },

  startStack: async (projectName: string, stackName: string, opts?: { release?: string; allowDirty?: boolean; workingTree?: boolean }) => {
    const opKey = `${projectName}/${stackName}`;
    if (get().pendingOps[opKey]) return { state: 'busy', message: `An operation is already pending for ${opKey}.` };

    // Optimistic: mark as starting immediately
    notice(opKey);
    set((s) => ({
      pendingOps: { ...s.pendingOps, [opKey]: 'starting' as PendingOp },
      stacksByProject: patchStackStatus(s.stacksByProject, projectName, stackName, 'starting'),
    }));

    try {
      const stack = await invokeStackLifecycle('startStack', {
        project: projectName,
        stack: stackName,
        ...(opts?.release ? { release: opts.release } : {}),
        ...(opts?.workingTree ? { workingTree: true } : {}),
        ...(opts?.allowDirty ? { allowDirty: true } : {}),
      });
      const { outcome, issues, online, total } = readStackStart(stack);
      if (outcome === 'confirmed') return { state: outcome };
      const message = `${opKey}: ${online}/${total} apps online. ${issues.join('; ')}.`;
      notice(opKey, message);
      return { state: outcome, message };
    } catch (err) {
      const unconfirmed = isRpcTimeout(err) || isLostRpcAcknowledgement(err);
      const message = unconfirmed
        ? `No start acknowledgement for ${opKey}. Inspect the stack and deployment history before retrying.`
        : err instanceof Error ? err.message : String(err);
      notice(opKey, message);
      return { state: unconfirmed ? 'unconfirmed' : 'failed', message };
    } finally {
      await finishOperation(opKey, projectName);
    }
  },

  resumeInstalledStack: async (project, stack) => {
    const key = `${project}/${stack}`;
    if (get().pendingOps[key]) return;
    notice(key);
    set(state => ({ pendingOps: { ...state.pendingOps, [key]: 'resuming' } }));
    try {
      const result = await invokeStackLifecycle('resumeInstalledStack', { project, stack });
      if (result.outcome !== 'running') {
        const issues = result.nodes.filter(node => node.outcome !== 'running')
          .map(node => [node.node, node.outcome, node.reason].filter(Boolean).join(' · '));
        notice(key, [`Resume ${result.outcome}`, ...issues, result.operationId].join(' · '));
      }
    } catch (error) {
      notice(key, isRpcTimeout(error) || isLostRpcAcknowledgement(error)
        ? 'Resume acknowledgement unavailable. Check the stack and each recipient before another recovery.'
        : error instanceof Error ? error.message : String(error));
    } finally {
      await finishOperation(key, project);
    }
  },

  stopStack: async (projectName: string, stackName: string, review: string, keepInfrastructure = false) => {
    const opKey = `${projectName}/${stackName}`;
    if (get().pendingOps[opKey]) return;

    notice(opKey);
    set((s) => ({
      pendingOps: { ...s.pendingOps, [opKey]: 'stopping' as PendingOp },
      stacksByProject: patchStackStatus(s.stacksByProject, projectName, stackName, 'stopping'),
    }));

    try {
      const result = await invokeStackLifecycle('stopStack', { project: projectName, stack: stackName, review,
        ...(keepInfrastructure && { keepInfrastructure: true }) });
      if (result.status !== 'stopped' || result.stopOperation?.phase !== 'stopped') throw new Error('Daemon did not confirm the complete stack stop');
      if (keepInfrastructure && result.stopOperation.keepInfrastructure !== true)
        throw new Error('Daemon did not confirm infrastructure preservation. Inspect the stop operation before retrying.');
    } catch (err) {
      notice(opKey, isRpcTimeout(err) || isLostRpcAcknowledgement(err)
        ? 'Stop acknowledgement has not arrived. Check the stack operation before retrying; applications may still be running.'
        : (err as Error).message);
    } finally {
      await finishOperation(opKey, projectName);
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

export function useActiveProjectStacks(): IStackInfo[] {
  const { project } = useWorkspace();
  return useProjectStore(s => (project && s.stacksByProject[project]) || EMPTY_STACKS);
}

export function useProjectInfo(name: string) {
  return useProjectStore((s) => s.projects.find((p) => p.name === name));
}

export function useScopedStacks(): IStackInfo[] {
  const { project, stack } = useWorkspace();
  return useProjectStore(useShallow(s => stacksInScope(
    (project && s.stacksByProject[project]) || EMPTY_STACKS, stack,
  )));
}

const EMPTY_STACKS: IStackInfo[] = [];
