/**
 * Pipeline DTOs — wire shapes shared with the Omnitron Console.
 *
 * Declared away from the service implementation for the reason set out in
 * `./auth.ts`: a DTO that imports from an implementation drags decorators and
 * the server's dependency graph into the console's build.
 */
import type { ArtifactIdentity } from '../../runtime/identity.js';
import type { TargetRuntime } from '../../release/target-runtime.js';

export interface PipelineDef {
  name: string;
  description?: string;
  steps: PipelineStep[];
  triggers?: PipelineTrigger[];
}

interface PipelineStepOptions {
  name: string;
  cwd?: string;
  /** Registered node ID. Omission or local executes locally. */
  nodeId?: string;
  dependsOn?: string[];
  env?: Record<string, string>;
  timeout?: number;
  retries?: number;
  condition?: string;
}

/** Logical producer identity is independent of the owner's installation directory. */
export interface PipelineReleaseTarget {
  project: string;
  stack: string;
  app: string;
  artifact: ArtifactIdentity;
  /** Physical compiled JavaScript member of the verified application closure. */
  entry: string;
}

export type PipelineStep = PipelineStepOptions & ({
  /** Shell command or a TypeScript script with $, $target and params. */
  kind?: 'shell' | 'xec';
  run: string;
  target?: never;
  args?: never;
} | {
  kind: 'release';
  target: PipelineReleaseTarget;
  args?: string[];
  run?: never;
});

/** Per-attempt observations, never part of the registered semantic definition. */
export interface PipelineReleaseExecution {
  attempt: number;
  artifact: ArtifactIdentity;
  consumer: { releaseId: string; manifestSha256: string; app: string };
  installationRoot: string;
  treeSha256: string;
  entry: string;
  executable: string;
  cwd: string;
  /** Fingerprint only: environment values can contain credentials. */
  environmentSha256: string;
  target: TargetRuntime;
  owner: { id: string; pid: number; epoch: number; lifetime: string; frameworkCommit: string };
  pid?: number;
  state: 'prepared' | 'started' | 'completed' | 'unconfirmed';
}

export interface PipelineTrigger {
  type: 'cron' | 'webhook' | 'manual';
  config: Record<string, unknown>;
}

export interface Pipeline {
  id: string;
  /** Content revision required when admitting the reviewed definition. */
  revision: string;
  /** Older daemons silently ignore update preconditions. Require this before sending an update. */
  conditionalUpdates?: true;
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
  kind?: 'shell' | 'xec' | 'release';
  executions?: PipelineReleaseExecution[];
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
