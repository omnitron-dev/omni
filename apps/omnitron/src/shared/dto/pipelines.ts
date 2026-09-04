/**
 * Pipeline DTOs — wire shapes shared with the Omnitron Console.
 *
 * Declared away from the service implementation for the reason set out in
 * `./auth.ts`: a DTO that imports from an implementation drags decorators and
 * the server's dependency graph into the console's build.
 */

export interface PipelineDef {
  name: string;
  description?: string;
  steps: PipelineStep[];
  triggers?: PipelineTrigger[];
}

export interface PipelineStep {
  name: string;
  run: string;
  dependsOn?: string[];
  env?: Record<string, string>;
  timeout?: number;
  retries?: number;
  condition?: string;
}

export interface PipelineTrigger {
  type: 'cron' | 'webhook' | 'manual';
  config: Record<string, unknown>;
}

export interface Pipeline {
  id: string;
  name: string;
  description: string | null;
  steps: PipelineStep[];
  triggers: PipelineTrigger[];
  createdAt: string;
  updatedAt: string;
}

export interface PipelineRunStepResult {
  name: string;
  status: string;
  duration: number;
  output?: string;
  error?: string;
}

export interface PipelineRun {
  id: string;
  pipelineId: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  steps: PipelineRunStepResult[];
  startedAt: string;
  completedAt: string | null;
  triggeredBy: string;
  params: Record<string, unknown> | null;
}
