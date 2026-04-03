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
import type {
  IProjectInfo,
  IStackInfo,
  StackRuntime,
  IProjectRequirements,
} from '../shared/dto/project.js';

@Service({ name: 'OmnitronProject' })
export class ProjectRpcService {
  constructor(private readonly projectService: ProjectService) {}

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

  @Public({ auth: { roles: VIEWER_ROLES } })
  async scanRequirements(data: { project: string }): Promise<IProjectRequirements> {
    return this.projectService.scanRequirements(data.project);
  }

  // ===========================================================================
  // Projects — Admin
  // ===========================================================================

  @Public({ auth: { roles: ADMIN_ROLES } })
  async addProject(data: { name: string; path: string }): Promise<IProjectInfo> {
    return this.projectService.addProject(data.name, data.path);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async updateProject(data: { name: string; path?: string }): Promise<IProjectInfo> {
    return this.projectService.updateProject(data.name, data.path ? { path: data.path } : {});
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async removeProject(data: { name: string }): Promise<{ success: boolean }> {
    this.projectService.removeProject(data.name);
    return { success: true };
  }

  // ===========================================================================
  // Stacks — Viewer
  // ===========================================================================

  @Public({ auth: { roles: VIEWER_ROLES } })
  async listStacks(data: { project: string }): Promise<IStackInfo[]> {
    return this.projectService.listStacks(data.project);
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getStack(data: { project: string; stack: string }): Promise<IStackInfo> {
    return this.projectService.getStack(data.project, data.stack);
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
  async startStack(data: { project: string; stack: string }): Promise<IStackInfo> {
    return this.projectService.startStack(data.project, data.stack);
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async stopStack(data: { project: string; stack: string }): Promise<IStackInfo> {
    return this.projectService.stopStack(data.project, data.stack);
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
