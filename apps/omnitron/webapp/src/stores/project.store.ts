/** Access-keyed project and stack inventories, workspace bookmarks and daemon operations. */

import { isLostRpcAcknowledgement } from '@omnitron-dev/omnitron/dto/services';
import { readStackStart } from '@omnitron-dev/omnitron/release-reading';
import { create } from 'zustand';
import { isRpcTimeout } from '../utils/rpc-error';
export { isRpcTimeout } from '../utils/rpc-error';
import { useShallow } from 'zustand/shallow';
import { invokeStackLifecycle, project as projectRpc } from '../netron/client';
import { readStoredJson, removeStored, writeStoredJson } from '../utils/storage';
import { stacksInScope } from '../utils/stack-inventory';
import { useWorkspace, workspaceHref, workspaceLocation } from '../routes/workspace';
import type {
  DeploymentRecoveryInput,
  IProjectInfo,
  IStackInfo,
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
  /** In-flight operations keyed by "project/stack" */
  pendingOps: Record<string, PendingOp>;
  /** Saved route per workspace (key = project name or '__omnitron__') */
  workspaceRoutes: Record<string, string>;
  loading: boolean;
  error: string | null;

  fetchProjects: (afterChange?: boolean) => Promise<void>;
  setInventoryReaders: (projects: string | null, stacks: string | null, account?: string | null) => void;
  fetchStacks: (project: string) => Promise<IStackInfo[] | null>;
  saveCurrentRoute: (path: string, owner: string) => void;
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
  startStack: (project: string, stack: string, opts?: { release?: string; allowDirty?: boolean; workingTree?: boolean; deploymentReview?: string; recovery?: DeploymentRecoveryInput }) => Promise<StackActionResult>;
  resumeInstalledStack: (project: string, stack: string) => Promise<void>;
  stopStack: (project: string, stack: string, review: string, keepInfrastructure?: boolean) => Promise<void>;
  createStack: (project: string, data: { name: string; type: 'local' | 'remote' | 'cluster'; apps: string[] | 'all'; nodeIds?: string[] }) => Promise<IStackInfo>;
  deleteStack: (project: string, stack: string) => Promise<void>;
  /** Clear error message */
  clearError: () => void;
}

// =============================================================================
// Persistence
// =============================================================================

const STORAGE_KEY_ROUTES = 'omnitron_workspace_routes';
const accessChanged = 'Console access changed before the operation completed.';

function routesForAccount(account: string): Record<string, string> {
  const routes = readStoredJson<Record<string, string> | null>(`${STORAGE_KEY_ROUTES}:${account}`, null);
  return routes && typeof routes === 'object' && !Array.isArray(routes) ? routes : {};
}

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
  let account: string | null = null;
  let projectAccessGeneration = 0;
  let projectGeneration = 0;
  let inventoryGeneration = 0;

  const notice = (key: string, message?: string) => set(state => {
    const next = { ...state.stackNotices };
    if (message) next[key] = message;
    else delete next[key];
    return { stackNotices: next };
  });

  const refreshAfterStackChange = async (project: string, generation: number) => {
    if (generation !== inventoryGeneration) return;
    // A poll already in flight can have sampled the stack before this change.
    await stackRequests.get(project);
    if (generation === inventoryGeneration) await get().fetchStacks(project);
  };

  const runStackOperation = async (project: string, stack: string, op: PendingOp,
    execute: () => Promise<StackActionResult>, missingAcknowledgement: string): Promise<StackActionResult> => {
    const key = `${project}/${stack}`;
    if (get().pendingOps[key]) return { state: 'busy', message: `An operation is already pending for ${key}.` };
    const generation = inventoryGeneration;
    set(state => {
      const stackNotices = { ...state.stackNotices };
      delete stackNotices[key];
      return {
        stackNotices, pendingOps: { ...state.pendingOps, [key]: op },
        stacksByProject: op === 'resuming' ? state.stacksByProject : patchStackStatus(state.stacksByProject, project, stack, op),
      };
    });
    let result: StackActionResult;
    try {
      result = await execute();
    } catch (error) {
      result = isRpcTimeout(error) || isLostRpcAcknowledgement(error)
        ? { state: 'unconfirmed', message: missingAcknowledgement }
        : { state: 'failed', message: error instanceof Error ? error.message : String(error) };
    }
    if (generation === inventoryGeneration) {
      if (result.state !== 'confirmed') notice(key, result.message);
      try {
        await refreshAfterStackChange(project, generation);
      } finally {
        if (generation === inventoryGeneration) set(state => {
          const pendingOps = { ...state.pendingOps };
          delete pendingOps[key];
          return { pendingOps };
        });
      }
    }
    return generation === inventoryGeneration ? result : { state: 'unconfirmed', message: accessChanged };
  };

  const changeProject = async (execute: () => Promise<unknown>) => {
    const generation = projectAccessGeneration;
    set({ loading: Boolean(projectReader), error: null });
    try {
      await execute();
      if (generation === projectAccessGeneration) await get().fetchProjects(true);
    } catch (error) {
      if (generation === projectAccessGeneration) {
        set({ error: error instanceof Error ? error.message : String(error), loading: false });
        throw error;
      }
    }
    if (generation !== projectAccessGeneration) throw new Error(accessChanged);
  };

  const changeStack = async <T>(project: string, execute: () => Promise<T>, noticeKey?: string): Promise<T> => {
    const generation = inventoryGeneration;
    if (noticeKey) notice(noticeKey);
    try {
      const result = await execute();
      await refreshAfterStackChange(project, generation);
      if (generation === inventoryGeneration) return result;
    } catch (error) {
      if (generation === inventoryGeneration) {
        if (noticeKey) notice(noticeKey, error instanceof Error ? error.message : String(error));
        throw error;
      }
    }
    throw new Error(accessChanged);
  };

  return {
  projects: [],
  hasProjectSnapshot: false,
  stacksByProject: {},
  stackReadErrors: {},
  stackNotices: {},
  clearStackNotice: key => notice(key),
  pendingOps: {},
  workspaceRoutes: {},
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

  setInventoryReaders: (projects, stacks, nextAccount = projects ?? stacks) => {
    const accountChanged = account !== nextAccount;
    const changeProjects = accountChanged || projectReader !== projects;
    const changeStacks = accountChanged || stackReader !== stacks;
    if (!changeProjects && !changeStacks) return;
    account = nextAccount;
    if (changeProjects) {
      projectReader = projects;
      projectGeneration++;
      projectAccessGeneration++;
      projectRequest = null;
    }
    if (changeStacks) {
      stackReader = stacks;
      inventoryGeneration++;
      stackRequests.clear();
    }
    if (accountChanged) removeStored(STORAGE_KEY_ROUTES);
    set({
      ...(changeProjects && { projects: [], hasProjectSnapshot: false, loading: false, error: null }),
      ...(changeStacks && { stacksByProject: {}, stackReadErrors: {}, stackNotices: {}, pendingOps: {} }),
      ...(accountChanged && { workspaceRoutes: account ? routesForAccount(account) : {} }),
    });
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

  saveCurrentRoute: (path, owner) => {
    if (account !== owner) return;
    const { project } = workspaceLocation({ pathname: path.split(/[?#]/)[0]! });
    const key = project ?? '__omnitron__';
    if (get().workspaceRoutes[key] === path) return;
    const routes = { ...get().workspaceRoutes, [key]: path };
    writeStoredJson(`${STORAGE_KEY_ROUTES}:${account}`, routes);
    set({ workspaceRoutes: routes });
  },

  addProject: (name, path) => changeProject(() => projectRpc.addProject({ name, path })),
  updateProject: (name, data) => changeProject(() => projectRpc.updateProject({ name, ...data })),
  removeProject: name => changeProject(() => projectRpc.removeProject({ name })),

  startStack: (project, stack, opts) => runStackOperation(project, stack, 'starting', async () => {
    if (opts?.recovery && !opts.deploymentReview) throw Error('A qualified recovery release requires a deployment review');
    if (opts?.deploymentReview !== undefined && (!opts.release || opts.allowDirty || opts.workingTree))
      throw Error('A deployment review requires its exact release');
    const reply = opts?.deploymentReview !== undefined
      ? await invokeStackLifecycle('deployReviewedRelease', { project, stack, release: opts.release!, review: opts.deploymentReview, ...(opts.recovery && { recovery: opts.recovery }) })
      : await invokeStackLifecycle('startStack', { project, stack,
      ...(opts?.release && { release: opts.release }), ...(opts?.workingTree && { workingTree: true }),
      ...(opts?.allowDirty && { allowDirty: true }),
    });
    const { outcome, issues, online, total } = readStackStart(reply);
    return outcome === 'confirmed' ? { state: outcome }
      : { state: outcome, message: `${project}/${stack}: ${online}/${total} apps online. ${issues.join('; ')}.` };
  }, `No start acknowledgement for ${project}/${stack}. Inspect the stack and deployment history before retrying.`),

  resumeInstalledStack: async (project, stack) => {
    await runStackOperation(project, stack, 'resuming', async () => {
      const result = await invokeStackLifecycle('resumeInstalledStack', { project, stack });
      if (result.outcome === 'running') return { state: 'confirmed' };
      const issues = result.nodes.filter(node => node.outcome !== 'running')
        .map(node => [node.node, node.outcome, node.reason].filter(Boolean).join(' · '));
      return { state: 'unconfirmed', message: [`Resume ${result.outcome}`, ...issues, result.operationId].join(' · ') };
    }, 'Resume acknowledgement unavailable. Check the stack and each recipient before another recovery.');
  },

  stopStack: async (project, stack, review, keepInfrastructure = false) => {
    await runStackOperation(project, stack, 'stopping', async () => {
      const result = await invokeStackLifecycle('stopStack', { project, stack, review, ...(keepInfrastructure && { keepInfrastructure: true }) });
      if (result.status !== 'stopped' || result.stopOperation?.phase !== 'stopped') throw new Error('Daemon did not confirm the complete stack stop');
      if (keepInfrastructure && result.stopOperation.keepInfrastructure !== true)
        throw new Error('Daemon did not confirm infrastructure preservation. Inspect the stop operation before retrying.');
      return { state: 'confirmed' };
    }, 'Stop acknowledgement has not arrived. Check the stack operation before retrying; applications may still be running.');
  },

  createStack: (project, data) => changeStack(project, () => projectRpc.createStack({ project, ...data })),
  deleteStack: async (project, stack) => {
    await changeStack(project, () => projectRpc.deleteStack({ project, stack }), `${project}/${stack}`);
  },

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
  status: IStackInfo['status'],
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
