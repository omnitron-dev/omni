/**
 * Pipeline RPC Service
 *
 * Netron RPC endpoints for CI/CD pipeline management from webapp and CLI.
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import type { InspectPhysicalRestore } from '../shared/dto/physical-restore.js';
import { validateRunId } from './pipeline-admission.js';
import type { PipelineWorkspace, PreparePipelineRun, StartPipelineRun } from '../shared/dto/pipelines.js';
import { ADMIN_ROLES } from '../shared/roles.js';
import { daemonPrincipal } from './daemon-principal.js';
import type { AuthService } from './auth.service.js';
import type { AuditService } from './audit.service.js';
import type { PipelineService, Pipeline, PipelineDef, PipelineRun, PipelineRunSummary } from './pipeline.service.js';

import type { IOmnitronPipelinesService } from '../shared/dto/services.js';

@Service({ name: 'OmnitronPipelines' })
export class PipelineRpcService implements IOmnitronPipelinesService {
  constructor(
    private readonly pipelines: PipelineService,
    private readonly auth: Pick<AuthService, 'validateSession'>,
    private readonly audit: Pick<AuditService, 'record'>
  ) {}

  private async authorize(action?: string, resourceId?: string) {
    const principal = await daemonPrincipal(this.auth, 'admin');
    if (action) await this.audit.record({ action: `pipeline.${action}`, resourceType: 'pipeline', resourceId }, true);
    return principal.context.userId;
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async createPipeline(data: PipelineDef): Promise<Pipeline> {
    await this.authorize('create.requested');
    return this.pipelines.createPipeline(data);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async updatePipeline(data: { id: string; definition: PipelineDef; expectedRevision: string }): Promise<Pipeline> {
    await this.authorize('update.requested', data.id);
    if (!/^[a-f0-9]{64}$/.test(data.expectedRevision ?? ''))
      throw new Error('Review the current definition before updating it');
    return this.pipelines.updatePipeline(data.id, data.definition, data.expectedRevision);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async getPipeline(data: { id: string; workspace?: PipelineWorkspace }): Promise<Pipeline | null> {
    await this.authorize();
    return this.pipelines.getPipeline(data.id, data.workspace);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async listPipelines(): Promise<Pipeline[]> {
    await this.authorize();
    return this.pipelines.listPipelines();
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async listWorkspace(data: PipelineWorkspace & { limit?: number; activityOnly?: boolean }) {
    await this.authorize();
    return this.pipelines.listWorkspace(data);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async deletePipeline(data: { id: string }): Promise<{ success: boolean }> {
    await this.authorize('delete.requested', data.id);
    await this.pipelines.deletePipeline(data.id);
    return { success: true };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async prepareRun(data: PreparePipelineRun): Promise<PipelineRun> {
    const actor = await this.authorize('prepare.requested', data.runId);
    return this.pipelines.prepareRun(data, actor);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async startRun(data: StartPipelineRun): Promise<PipelineRun> {
    const actor = await this.authorize('start.requested', data.runId);
    return this.pipelines.startRun(data, actor);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async resumeRun(data: StartPipelineRun): Promise<PipelineRun> {
    const actor = await this.authorize('resume.requested', data.runId);
    return this.pipelines.resumeRun(data, actor);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async reconcileRun(data: { runId: string }): Promise<PipelineRun> {
    await this.authorize('reconcile.requested', data.runId);
    validateRunId(data.runId);
    return this.pipelines.reconcileRun(data.runId);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async executePipeline(data: PreparePipelineRun): Promise<PipelineRun> {
    const actor = await this.authorize('run.requested', data.runId);
    if (!/^[a-f0-9]{64}$/.test(data.expectedRevision ?? ''))
      throw new Error('Review the current definition before running it');
    validateRunId(data.runId);
    return this.pipelines.executePipeline(data.id, data.params, actor, data.expectedRevision, data.runId);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async cancelRun(data: { runId: string }): Promise<{ success: boolean }> {
    await this.authorize('cancel.requested', data.runId);
    await this.pipelines.cancelRun(data.runId);
    return { success: true };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async inspectPhysicalRestore(data: InspectPhysicalRestore) {
    await this.authorize('physical-restore.inspect', data.verifyRunId);
    return this.pipelines.inspectPhysicalRestore(data);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async getRunStatus(data: { runId: string }): Promise<PipelineRun | null> {
    await this.authorize();
    return this.pipelines.getRunStatus(data.runId);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async listRuns(data?: { pipelineId?: string; limit?: number }): Promise<PipelineRunSummary[]> {
    await this.authorize();
    return this.pipelines.listRuns(data?.pipelineId, data?.limit);
  }
}
