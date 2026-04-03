/**
 * Pipeline RPC Service
 *
 * Netron RPC endpoints for CI/CD pipeline management from webapp and CLI.
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { VIEWER_ROLES, OPERATOR_ROLES } from '../shared/roles.js';
import type {
  PipelineService,
  Pipeline,
  PipelineDef,
  PipelineRun,
} from './pipeline.service.js';

@Service({ name: 'OmnitronPipelines' })
export class PipelineRpcService {
  constructor(private readonly pipelines: PipelineService) {}

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async createPipeline(data: PipelineDef): Promise<Pipeline> {
    return this.pipelines.createPipeline(data);
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getPipeline(data: { id: string }): Promise<Pipeline | null> {
    return this.pipelines.getPipeline(data.id);
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async listPipelines(): Promise<Pipeline[]> {
    return this.pipelines.listPipelines();
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async deletePipeline(data: { id: string }): Promise<{ success: boolean }> {
    await this.pipelines.deletePipeline(data.id);
    return { success: true };
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async executePipeline(data: { id: string; params?: Record<string, unknown> }): Promise<PipelineRun> {
    return this.pipelines.executePipeline(data.id, data.params);
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async cancelRun(data: { runId: string }): Promise<{ success: boolean }> {
    await this.pipelines.cancelRun(data.runId);
    return { success: true };
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getRunStatus(data: { runId: string }): Promise<PipelineRun | null> {
    return this.pipelines.getRunStatus(data.runId);
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async listRuns(data?: { pipelineId?: string; limit?: number }): Promise<PipelineRun[]> {
    return this.pipelines.listRuns(data?.pipelineId, data?.limit);
  }
}
