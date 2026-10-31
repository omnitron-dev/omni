import { publicStack } from '../project/public-stack.js';
import type { TopologyScope, TopologySpec } from '../shared/dto/topology.js';
import { publicStackName, type ConfigurationImport } from '../project/configuration-catalog.js';
/**
 * ProjectRpcService — OmnitronProject Netron RPC endpoints
 *
 * Exposes project and stack management over Netron RPC
 * with role-based access control.
 *
 * RBAC:
 * - Viewer: listProjects, getProject, listStacks, getStack, scanRequirements, getStackStatus
 * - Operator: startStack, stopStack
 * - Admin: addProject, removeProject
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { VIEWER_ROLES, OPERATOR_ROLES, ADMIN_ROLES } from '../shared/roles.js';
import type { ProjectService } from './project.service.js';
import type { DeployProgressRecord } from './remote-deployer.service.js';
import type {
  IProjectInfo,
  IStackInfo,
  IProjectAppStatus,
  StackRuntime,
  IProjectRequirements,
  IStackAccount,
  IStackAccountLookup,
  IStackAccountRemoved,
  IStackAccountCensus,
  IStackLeftoversCensus,
  IStackMaintenance,
} from '../shared/dto/project.js';

@Service({ name: 'OmnitronProject' })
export class ProjectRpcService {
  constructor(
    private readonly projectService: ProjectService,
    /**
     * The audit trail, when this daemon has one.
     *
     * Optional so a daemon without the omnitron database still serves these
     * methods — a stack start that cannot be recorded is still a stack
     * start, and refusing it would make the audit trail an availability
     * dependency of the control plane.
     */
    private readonly audit?: import('./audit.service.js').AuditService | undefined,
  ) {}

  // ===========================================================================
  // Projects — Viewer
  // ===========================================================================

  @Public({ auth: { roles: VIEWER_ROLES } })
  async listProjects(): Promise<IProjectInfo[]> {
    return this.projectService.listProjects();
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getProject(data: { name: string }): Promise<IProjectInfo> {
    return this.projectService.getProject(data.name);
  }

  /**
   * Live per-app deployment progress, newest first.
   *
   * Viewer, because it says what the daemon is doing and nothing about how
   * to reach anything — the same tier as `getStackStatus`.
   */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getDeployProgress(): Promise<DeployProgressRecord[]> {
    return this.projectService.getDeployProgress();
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async scanRequirements(data: { project: string }): Promise<IProjectRequirements> {
    return this.projectService.scanRequirements(data.project);
  }

  // ===========================================================================
  // Projects — Admin
  // ===========================================================================

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getTopologyInventory() {
    return this.projectService.getTopologyInventory();
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getTopologyWorkspace(data: TopologyScope) {
    const scope = await this.projectService.resolveProjectStack(data);
    const workspace = await this.projectService.getTopologyWorkspace(scope);
    return { ...workspace, ...data,
      plans: workspace.plans.map(plan => ({ ...plan, ...data })),
      observed: { ...workspace.observed, name: data.stack, runtimeScope: scope },
      dependencies: workspace.dependencies.map(edge => ({ ...edge, ...data })),
      coverage: workspace.coverage?.map(item => ({ ...item, ...data })),
    };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async saveTopologyDraft(data: TopologyScope & { baseRevision: string; expectedDraft: number | null; spec: TopologySpec }) {
    return this.projectService.saveTopologyDraft(await this.projectService.resolveProjectStack(data));
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async planTopology(data: TopologyScope & { draftRevision: number }) {
    const plan = await this.projectService.planTopology(await this.projectService.resolveProjectStack(data));
    return { ...plan, project: data.project, stack: data.stack };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async applyTopologyPlan(data: TopologyScope & { plan: string }) {
    const plan = await this.projectService.applyTopologyPlan(await this.projectService.resolveProjectStack(data));
    return { ...plan, project: data.project, stack: data.stack };
  }

  /** Explicit administrative imports; all configurations share one bounded read window. */
  @Public({ auth: { roles: ADMIN_ROLES } })
  async refreshTopologyMetadata(data: { project: string; stack?: string }): Promise<import('../shared/dto/project.js').TopologyMetadataRefresh> {
    const result: import('../shared/dto/project.js').TopologyMetadataRefresh = { refreshed: 0, failures: [] };
    const { TOPOLOGY_REFRESH_TIMEOUT_MS } = await import('../project/bootstrap-metadata.js');
    const deadline = Date.now() + TOPOLOGY_REFRESH_TIMEOUT_MS;
    const selected = data.stack ? await this.projectService.resolveProjectStack({ project: data.project, stack: data.stack }) : null;
    for (const record of this.projectService.projectConfigurations(data.project)) {
      if (selected && selected.project !== record.name) continue;
      const refresh = await this.projectService.refreshTopologyMetadata({ project: record.name, ...(selected ? { stack: selected.stack } : {}) }, deadline);
      result.refreshed += refresh.refreshed;
      result.failures.push(...refresh.failures.map(failure => ({ ...failure, project: data.project })));
    }
    return result;
  }

  /** Sanitized configuration graph; reading it never imports bootstrap code. */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getTopology(data: { project?: string; stack?: string }): Promise<import('../shared/dto/project.js').ProjectTopology> {
    const result: import('../shared/dto/project.js').ProjectTopology = {
      version: 1, generatedAt: new Date().toISOString(), dependencies: [], warnings: [], scopes: [], coverage: [],
    };
    const projects = data.project ? [data.project] : this.projectService.listProjects().map(project => project.name);
    for (const project of projects) {
      const selected = data.stack ? await this.projectService.resolveProjectStack({ project, stack: data.stack }) : null;
      for (const record of this.projectService.projectConfigurations(project)) {
        if (selected && selected.project !== record.name) continue;
        const graph = await this.projectService.getTopology({ project: record.name, ...(selected ? { stack: selected.stack } : {}) });
        const stackName = (stack: string) => record.name === project ? stack : publicStackName(record, stack);
        for (const stack of this.projectService.listStacks(record.name))
          result.scopes!.push({ project, stack: stackName(stack.name), runtimeProject: record.name, runtimeStack: stack.name });
        result.dependencies.push(...graph.dependencies.map(edge => ({ ...edge, project, stack: stackName(edge.stack) })));
        result.coverage!.push(...(graph.coverage ?? []).map(item => ({ ...item, project, stack: stackName(item.stack) })));
        result.warnings.push(...graph.warnings.map(warning => ({ ...warning, project, ...(warning.stack ? { stack: stackName(warning.stack) } : {}) })));
      }
    }
    return result;
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async importConfiguration(data: ConfigurationImport): Promise<IProjectInfo> {
    return this.projectService.importProjectConfiguration(data);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async detachConfiguration(data: { project: string; name: string; expectedRevision: string }): Promise<{ success: true }> {
    await this.projectService.detachProjectConfiguration(data);
    return { success: true };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async addProject(data: { name: string; path: string }): Promise<IProjectInfo> {
    const project = await this.projectService.addProject(data.name, data.path);
    await this.audit?.record({
      action: 'project.add',
      resourceType: 'project',
      resourceId: data.name,
      // Said, because a re-read changes what the next restart runs.
      details: { path: data.path, ...(project.reread ? { reread: true, redefined: project.reread.redefined } : {}) },
    });
    return project;
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async updateProject(data: { name: string; path?: string }): Promise<IProjectInfo> {
    return this.projectService.updateProject(data.name, data.path ? { path: data.path } : {});
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async refreshInfrastructureOwnership(data: { project: string; stack: string }): Promise<{ released: string[]; adopted: string[] }> {
    data = await this.projectService.resolveProjectStack(data);
    const result = await this.projectService.refreshInfrastructureOwnership(data.project, data.stack);
    await this.audit?.record({ action: 'project.infrastructure.ownership', resourceType: 'project', resourceId: data.project, details: { stack: data.stack, ...result } });
    return result;
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async removeProject(data: { name: string }): Promise<{ success: boolean }> {
    this.projectService.removeProject(data.name);
    await this.audit?.record({
      action: 'project.remove',
      resourceType: 'project',
      resourceId: data.name,
    });
    return { success: true };
  }

  // ===========================================================================
  // Stacks — Viewer
  // ===========================================================================

  @Public({ auth: { roles: VIEWER_ROLES } })
  async listStacks(data: { project: string }): Promise<IStackInfo[]> {
    // A remote stack's apps run on its nodes, and `listStacks` reads this
    // daemon's own handles — so every one of them came back `stopped`. The
    // nodes are asked here, where the call can be awaited. And the config is
    // loaded if the daemon has not got to it yet: `listStacks` answers [] for
    // a project not loaded, which read as «this project has no stacks».
    const result: IStackInfo[] = [];
    for (const source of this.projectService.projectConfigurations(data.project)) {
      await this.projectService.ensureConfig(source.name);
      for (const info of this.projectService.listStacks(source.name)) {
        const observed = await this.projectService.withRemoteAppStatuses(source.name, info);
        result.push(this.projectService.publicStackInfo(data.project, source, observed));
      }
    }
    if (new Set(result.map(stack => stack.name)).size !== result.length) throw new Error('Conflicting stack names in project configurations');
    return result;
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getStack(data: { project: string; stack: string }): Promise<IStackInfo> {
    // Loaded on demand in the first seconds after a daemon start rather than
    // refused (`ensureConfig`).
    const logicalName = data.stack;
    data = await this.projectService.resolveProjectStack(data);
    await this.projectService.ensureConfig(data.project);
    const info = publicStack(await this.projectService.withRemoteAppStatuses(
      data.project,
      this.projectService.getStack(data.project, data.stack),
    ));
    return { ...info, name: logicalName, runtimeScope: { project: data.project, stack: data.stack } };
  }

  /**
   * What each node of a stack would find and do on its host — read, never
   * changed. Admin: it answers about a machine's units, paths and addresses.
   */
  @Public({ auth: { roles: ADMIN_ROLES } })
  async inspectStackHost(
    data: { project: string; stack: string } & Omit<
      import('../infrastructure/host-inspection.js').HostInspectionRequest,
      'services' | 'overrides'
    >,
  ): Promise<Array<{ node: string; inspection?: import('../infrastructure/host-inspection.js').HostInspection; error?: string }>> {
    return this.projectService.inspectStackHost(await this.projectService.resolveProjectStack(data));
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getStackStatus(data: { project: string; stack: string }): Promise<StackRuntime> {
    const scope = await this.projectService.resolveProjectStack(data);
    await this.projectService.ensureConfig(scope.project);
    return { ...await this.projectService.getStackStatus(scope.project, scope.stack), name: data.stack };
  }

  /**
   * Every deployment of every app of a project, each with its stack — apps
   * that are not running included (`stopped`).
   *
   * This flattened the stacks and kept the FIRST app of each name. A project
   * whose local `dev` and remote `test` stacks both run the same six apps
   * answered with dev's six: the console's /apps listed six rows for twelve
   * deployments, and never one on the node. It also read the stacks without
   * asking the nodes, so had test's apps survived they would have read
   * `stopped`. It is `listStacks` now — the nodes asked — with nothing
   * dropped.
   */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getProjectApps(data: { project: string }): Promise<IProjectAppStatus[]> {
    const stacks = await this.listStacks(data);
    return stacks.flatMap((stack) => stack.apps.map((app) => ({ ...app, stack: stack.name, stackType: stack.type })));
  }

  // ===========================================================================
  // Stacks — Operator
  // ===========================================================================

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async startStack(data: { project: string; stack: string; allowDirty?: boolean; release?: string; reinstall?: boolean }): Promise<IStackInfo> {
    const logicalName = data.stack;
    data = await this.projectService.resolveProjectStack(data);
    // The report an operator acts on, and a script exits on: `only 0/6 apps
    // came online` about six that were running.
    //
    // The `stack.start` audit row is written by `ProjectService`, not here:
    // this is one of three callers, and the other two — the boot resume and
    // the reconciler — never reached this method. Recording at this layer
    // meant the trail held the deployments a human typed and none of the
    // ones the daemon decided on. All it needs from us is which we are.
    const info = await this.projectService.withRemoteAppStatuses(
      data.project,
      await this.projectService.startStack(data.project, data.stack, {
        source: 'operator',
        ...(data.allowDirty === true ? { allowDirty: true } : {}),
        ...(typeof data.release === 'string' && data.release ? { release: data.release } : {}),
        ...(data.reinstall === true ? { reinstall: true } : {}),
      }),
    );
    return { ...publicStack(info), name: logicalName, runtimeScope: { project: data.project, stack: data.stack } };
  }

  /**
   * Would this stack take this release? The deploy's own verdict, in advance.
   *
   * Operator rather than viewer: it reads the release's every artifact off
   * the disk to check them, and it is the question an operator asks before
   * pressing Deploy.
   */
  @Public({ auth: { roles: OPERATOR_ROLES } })
  async checkRelease(data: { project: string; stack: string; release: string }): Promise<{ ok: boolean; because: string }> {
    data = await this.projectService.resolveProjectStack(data);
    return this.projectService.checkRelease(data.project, data.stack, data.release);
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async stopStack(data: { project: string; stack: string }): Promise<IStackInfo> {
    const logicalName = data.stack;
    data = await this.projectService.resolveProjectStack(data);
    const info = await this.projectService.stopStack(data.project, data.stack);
    await this.audit?.record({
      action: 'stack.stop',
      resourceType: 'stack',
      resourceId: `${data.project}/${data.stack}`,
      details: { type: info.type },
    });
    return { ...publicStack(info), name: logicalName, runtimeScope: { project: data.project, stack: data.stack } };
  }

  // ===========================================================================
  // Stacks — Admin
  // ===========================================================================

  @Public({ auth: { roles: ADMIN_ROLES } })
  async createStack(data: {
    project: string;
    name: string;
    type: 'local' | 'remote' | 'cluster';
    apps: string[] | 'all';
    nodeIds?: string[];
  }): Promise<IStackInfo> {
    return this.projectService.createStack(data.project, data);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async deleteStack(data: { project: string; stack: string }): Promise<{ success: boolean }> {
    data = await this.projectService.resolveProjectStack(data);
    await this.projectService.deleteStack(data.project, data.stack);
    return { success: true };
  }

  /**
   * A named account with a platform role on a remote stack; its password goes
   * to the vault and never into the answer. Admin: it can hand out a stand's
   * highest role. Recorded both ways — who was made, where, by which commit's
   * tool, and where the password is kept; a refusal with its words.
   */
  @Public({ auth: { roles: ADMIN_ROLES } })
  async createStackAccount(data: {
    project: string;
    stack: string;
    username: string;
    role?: string;
    displayName?: string;
    vaultKey?: string;
  }): Promise<IStackAccount> {
    data = await this.projectService.resolveProjectStack(data);
    const row = { action: 'stack.account.create', resourceType: 'stack', resourceId: `${data.project}/${data.stack}` };
    try {
      const made = await this.projectService.createOperatorAccount(data.project, data.stack, {
        username: data.username,
        role: data.role,
        displayName: data.displayName,
        vaultKey: data.vaultKey,
      });
      await this.audit?.record({
        ...row,
        // `vault`, not `vaultKey`: the value is a key's NAME, and the row's
        // scrub would take anything called a key for the secret itself.
        details: { username: made.username, role: made.role, id: made.id, node: made.node, vault: made.vaultKey, commit: made.commit },
        outcome: 'ok',
      });
      return made;
    } catch (err) {
      await this.audit?.record({
        ...row,
        details: { username: data.username, ...(data.role !== undefined ? { role: data.role } : {}) },
        outcome: 'failed',
        error: err,
      });
      throw err;
    }
  }

  /**
   * The stand's accounts counted — no value in the answer. Admin: it runs the
   * project's code on the node.
   */
  @Public({ auth: { roles: ADMIN_ROLES } })
  async censusStackAccounts(data: { project: string; stack: string }): Promise<IStackAccountCensus> {
    data = await this.projectService.resolveProjectStack(data);
    return this.projectService.censusOperatorAccounts(data.project, data.stack);
  }

  /**
   * What the probes left on a remote stack's stand — the project tool's
   * census, a rehearsal of the removal rolled back, or the removal itself,
   * which never accepts a loss of somebody who stays. Admin: it runs the
   * project's code on the node.
   */
  @Public({ auth: { roles: ADMIN_ROLES } })
  async probeLeftovers(data: {
    project: string;
    stack: string;
    mode: 'census' | 'rehearse' | 'apply';
    also?: string[];
  }): Promise<IStackLeftoversCensus> {
    data = await this.projectService.resolveProjectStack(data);
    return this.projectService.probeLeftovers(data.project, data.stack, { mode: data.mode, also: data.also });
  }

  /**
   * The stack's maintenance lock: the gateway's answer, or held/released by
   * hand. Admin: it holds the whole platform.
   */
  @Public({ auth: { roles: ADMIN_ROLES } })
  async stackMaintenance(data: {
    project: string;
    stack: string;
    action: 'status' | 'on' | 'off';
    minutes?: number;
  }): Promise<IStackMaintenance> {
    data = await this.projectService.resolveProjectStack(data);
    return this.projectService.stackMaintenance(data.project, data.stack, { action: data.action, minutes: data.minutes });
  }

  /**
   * What a remote stack's stand holds under a name — never a secret. Admin:
   * it runs the project's code on the node.
   */
  @Public({ auth: { roles: ADMIN_ROLES } })
  async showStackAccount(data: { project: string; stack: string; username: string }): Promise<IStackAccountLookup> {
    data = await this.projectService.resolveProjectStack(data);
    return this.projectService.showOperatorAccount(data.project, data.stack, data.username);
  }

  /**
   * Take an account away from a remote stack's stand — by name AND id — with
   * the password the vault keeps for it. Recorded both ways.
   */
  @Public({ auth: { roles: ADMIN_ROLES } })
  async removeStackAccount(data: {
    project: string;
    stack: string;
    username: string;
    id: string;
    vaultKey?: string;
  }): Promise<IStackAccountRemoved> {
    data = await this.projectService.resolveProjectStack(data);
    const row = { action: 'stack.account.remove', resourceType: 'stack', resourceId: `${data.project}/${data.stack}` };
    try {
      const removed = await this.projectService.removeOperatorAccount(data.project, data.stack, {
        username: data.username,
        id: data.id,
        vaultKey: data.vaultKey,
      });
      await this.audit?.record({
        ...row,
        details: {
          username: removed.username,
          id: removed.id,
          node: removed.node,
          commit: removed.commit,
          vault: removed.vaultKeyRemoved,
        },
        outcome: 'ok',
      });
      return removed;
    } catch (err) {
      await this.audit?.record({ ...row, details: { username: data.username, id: data.id }, outcome: 'failed', error: err });
      throw err;
    }
  }
}
