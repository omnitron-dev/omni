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
  /** shell commands or a TypeScript script with $, $target and params. */
  kind?: 'shell' | 'xec';
  run: string;
  cwd?: string;
  /** Registered node ID. Omission or local executes locally. */
  nodeId?: string;
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
  /** Content revision required when admitting the reviewed definition. */
  revision: string;
  name: string;
  description: string | null;
  steps: PipelineStep[];
  triggers: PipelineTrigger[];
  createdAt: string;
  updatedAt: string;
}

export interface PipelineRunStepResult {
  name: string;
  /** Digest of the exact admitted step definition, including its target. */
  sourceHash?: string;
  status: string;
  duration: number;
  output?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  attempts?: number;
  exitCode?: number;
  stderr?: string;
  outputTruncated?: boolean;
  nodeId?: string;
  kind?: 'shell' | 'xec';
}

export interface PipelineRun {
  id: string;
  pipelineId: string;
  status: 'pending' | 'running' | 'cancelling' | 'success' | 'failed' | 'cancelled' | 'interrupted';
  steps: PipelineRunStepResult[];
  startedAt: string;
  completedAt: string | null;
  triggeredBy: string;
  params: Record<string, unknown> | null;
}

/** History rows exclude potentially large step output; retrieve details only for the selected run. */
export type PipelineRunSummary = Omit<PipelineRun, 'steps' | 'params'>;
