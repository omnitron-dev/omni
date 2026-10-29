/**
 * Pipeline RPC Service
 *
 * Netron RPC endpoints for CI/CD pipeline management from webapp and CLI.
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
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
    await this.authorize('create');
    return this.pipelines.createPipeline(data);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async updatePipeline(data: { id: string; definition: PipelineDef }): Promise<Pipeline> {
    await this.authorize('update', data.id);
    return this.pipelines.updatePipeline(data.id, data.definition);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async getPipeline(data: { id: string }): Promise<Pipeline | null> {
    await this.authorize();
    return this.pipelines.getPipeline(data.id);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async listPipelines(): Promise<Pipeline[]> {
    await this.authorize();
    return this.pipelines.listPipelines();
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async deletePipeline(data: { id: string }): Promise<{ success: boolean }> {
    await this.authorize('delete', data.id);
    await this.pipelines.deletePipeline(data.id);
    return { success: true };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async executePipeline(data: {
    id: string;
    expectedRevision: string;
    params?: Record<string, unknown>;
  }): Promise<PipelineRun> {
    const actor = await this.authorize('run.requested', data.id);
    if (!/^[a-f0-9]{64}$/.test(data.expectedRevision ?? ''))
      throw new Error('Review the current definition before running it');
    return this.pipelines.executePipeline(data.id, data.params, actor, data.expectedRevision);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async cancelRun(data: { runId: string }): Promise<{ success: boolean }> {
    await this.authorize('cancel.requested', data.runId);
    await this.pipelines.cancelRun(data.runId);
    return { success: true };
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
