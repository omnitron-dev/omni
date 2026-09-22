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
  StackRuntime,
  IProjectRequirements,
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

  @Public({ auth: { roles: ADMIN_ROLES } })
  async addProject(data: { name: string; path: string }): Promise<IProjectInfo> {
    const project = await this.projectService.addProject(data.name, data.path);
    await this.audit?.record({
      action: 'project.add',
      resourceType: 'project',
      resourceId: data.name,
      details: { path: data.path },
    });
    return project;
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async updateProject(data: { name: string; path?: string }): Promise<IProjectInfo> {
    return this.projectService.updateProject(data.name, data.path ? { path: data.path } : {});
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
    // nodes are asked here, where the call can be awaited.
    return Promise.all(
      this.projectService
        .listStacks(data.project)
        .map((info) => this.projectService.withRemoteAppStatuses(data.project, info)),
    );
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getStack(data: { project: string; stack: string }): Promise<IStackInfo> {
    return this.projectService.withRemoteAppStatuses(
      data.project,
      this.projectService.getStack(data.project, data.stack),
    );
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getStackStatus(data: { project: string; stack: string }): Promise<StackRuntime> {
    return this.projectService.getStackStatus(data.project, data.stack);
  }

  /**
   * Get all configured apps for a project with their current status.
   * Returns apps even when not running (status: 'stopped').
   */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getProjectApps(data: { project: string }): Promise<import('../shared/dto/project.js').IStackAppStatus[]> {
    const stacks = await this.projectService.listStacks(data.project);
    // Flatten all apps from all stacks, deduplicate by name
    const seen = new Set<string>();
    const apps: import('../shared/dto/project.js').IStackAppStatus[] = [];
    for (const stack of stacks) {
      for (const app of stack.apps) {
        if (!seen.has(app.name)) {
          seen.add(app.name);
          apps.push(app);
        }
      }
    }
    return apps;
  }

  // ===========================================================================
  // Stacks — Operator
  // ===========================================================================

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async startStack(data: { project: string; stack: string; allowDirty?: boolean; release?: string }): Promise<IStackInfo> {
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
      }),
    );
    return info;
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async stopStack(data: { project: string; stack: string }): Promise<IStackInfo> {
    const info = await this.projectService.stopStack(data.project, data.stack);
    await this.audit?.record({
      action: 'stack.stop',
      resourceType: 'stack',
      resourceId: `${data.project}/${data.stack}`,
      details: { type: info.type },
    });
    return info;
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
    await this.projectService.deleteStack(data.project, data.stack);
    return { success: true };
  }
}
