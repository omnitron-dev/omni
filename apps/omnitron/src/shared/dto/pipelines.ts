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

/** A review binds a durable command to one definition and parameter set. */
export interface PipelineRunReview {
  protocol: 1;
  digest: string;
  definitionRevision: string;
  /** Derived from sealed release targets, never supplied as an authority claim. */
  projects: string[];
  parameterNames: string[];
}

export interface PreparePipelineRun {
  /** Caller-generated UUID. Retain it before sending; reuse it after a lost reply. */
  runId: string;
  id: string;
  expectedRevision: string;
  params?: Record<string, unknown>;
}

export interface StartPipelineRun {
  runId: string;
  expectedDigest: string;
  /** Re-supply parameters; their plaintext is never persisted in the admission. */
  params?: Record<string, unknown>;
}

export interface PipelineRecoveryReview {
  digest: string;
  completed: string[];
  pending: string[];
  blocked: string[];
}

/** An immutable release and a separately reviewed infrastructure-preserving start. */
export interface PipelineDeploymentTarget {
  project: string;
  stack: string;
  releaseId: string;
  manifestSha256: string;
  review: string;
}

export interface PipelineDeploymentEvidence {
  target: PipelineDeploymentTarget;
  scope: { project: string; stack: string; registeredAt: string };
  expected: Array<{ node: string; app: string; releaseId: string; manifestSha256: string; artifactSha256: string }>;
  state: 'prepared' | 'unconfirmed' | 'confirmed';
  /** Convergence evidence, not proof that this request caused a launch. */
  observation?: { basis: 'observed-target'; observedAt: string; confirmed: boolean;
    apps: Array<{ node: string; app: string; launchId: string | null; matches: boolean }> };
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
} | {
  kind: 'deploy';
  target: PipelineDeploymentTarget;
  run?: never;
  args?: never;
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
  kind?: 'shell' | 'xec' | 'release' | 'deploy';
  executions?: PipelineReleaseExecution[];
  deployment?: PipelineDeploymentEvidence;
}

export interface PipelineRun {
  id: string;
  pipelineId: string;
  status: 'awaiting-review' | 'pending' | 'running' | 'cancelling' | 'success' | 'failed' | 'cancelled' | 'interrupted';
  steps: PipelineRunStepResult[];
  startedAt: string;
  completedAt: string | null;
  triggeredBy: string;
  params: Record<string, unknown> | null;
  review?: PipelineRunReview;
  /** Human/server principal that atomically claimed the reviewed request. */
  startedBy?: string;
  recovery?: PipelineRecoveryReview;
}

/** History rows exclude potentially large step output; retrieve details only for the selected run. */
export type PipelineRunSummary = Omit<PipelineRun, 'steps' | 'params'>;
