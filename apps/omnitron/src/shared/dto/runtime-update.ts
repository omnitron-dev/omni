import type { ServiceScope } from '../../commands/service-units.js';
import type { DaemonStatusDto, ProcessInfoDto } from '../../config/types.js';
import type { IProjectInfo, IStackInfo, SelectedRelease } from './project.js';
import type { StackExecutionScope } from './stack-execution.js';

export type RuntimeUpdateSelection =
  | { kind: 'unreported' }
  | { kind: 'working-tree' }
  | ({ kind: 'release' } & SelectedRelease);

export interface RuntimeUpdateApplication {
  name: string;
  handleKey: string;
  status: IStackInfo['apps'][number]['status'];
  generation: string | null;
  pid: number | null;
  health: 'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'absent';
  release: SelectedRelease | null;
}

export interface RuntimeUpdateStack extends StackExecutionScope {
  runtimeScope: StackExecutionScope;
  path: string;
  enabled: boolean;
  status: IStackInfo['status'];
  infrastructureMode: 'preserve' | 'reconcile' | null;
  infrastructureReview: string | null;
  selection: RuntimeUpdateSelection;
  apps: RuntimeUpdateApplication[];
}

export interface ReviewedRuntimeUpdateStack extends RuntimeUpdateStack {
  savedSelection: RuntimeUpdateSelection;
  startReview: string;
}

export interface RuntimeUpdateExcludedStack extends StackExecutionScope {
  reason: 'remote' | 'disabled';
}

export interface LocalRuntimeInventory {
  targets: RuntimeUpdateStack[];
  excluded: RuntimeUpdateExcludedStack[];
}

export interface RuntimeUpdateOwner {
  ownerId: string;
  ownerPid: number;
  ownerLifetime: string;
}

export interface RuntimeUpdateIdentity extends RuntimeUpdateOwner {
  backend: string;
  owner: string;
  guardian: string;
  backendCommit: string;
  ownerCommit: string;
  scope: ServiceScope;
  guardianPid: number;
  backendPid: number;
  revision: number;
  retiredPids: number[];
}

export interface RuntimeUpdateReference {
  artifact: string;
  commit: string;
}

/** Verified local execution paths, resolved from the installed artifact identity. */
export interface VerifiedRuntimeReference extends RuntimeUpdateReference {
  directory: string;
  node: string;
  cli: string;
  nodeVersion: string;
  platform: string;
  arch: string;
}

export interface RuntimeUpdateInfrastructure {
  schemaScope: 'node' | 'all';
  coldStackAdmissionProtocol?: 1;
  digest: string;
  containers: Array<{ name: string; id: string }>;
  database: string | null;
}

export interface RuntimeUpdateWatch {
  name: string;
  directory: string;
}

export interface RuntimeUpdatePlan {
  protocol: 1;
  stackAdmissionProtocol?: 1;
  instance: string;
  target: RuntimeUpdateReference;
  before: RuntimeUpdateIdentity & { console: string | null; consoleCommit: string | null };
  stacks: ReviewedRuntimeUpdateStack[];
  excluded: RuntimeUpdateExcludedStack[];
  watches: RuntimeUpdateWatch[];
  infrastructure: RuntimeUpdateInfrastructure;
}

export interface PreparedRuntimeUpdate {
  protocol: 1;
  digest: string;
  plan: RuntimeUpdatePlan;
}

export type RuntimeUpdatePhase = 'stopping' | 'starting' | 'verifying' | 'accepted' | 'failed'
  | 'stopping-candidate' | 'restoring' | 'rolled-back' | 'recovery-required';

export interface RuntimeUpdateAcceptance {
  backend: string;
  owner: string;
  guardian: string;
  ownerId: string;
  console: { artifact: string | null; commit: string | null };
  stacks: Array<StackExecutionScope & {
    selection: RuntimeUpdateSelection;
    apps: Array<Pick<RuntimeUpdateApplication, 'handleKey' | 'generation' | 'health' | 'release'>>;
  }>;
  watches: RuntimeUpdateWatch[];
}

export interface RuntimeUpdateReceipt extends PreparedRuntimeUpdate {
  phase: RuntimeUpdatePhase;
  updatedAt: string;
  rollbackOwner?: RuntimeUpdateIdentity;
  restoreAttempted?: true;
  acceptance?: RuntimeUpdateAcceptance;
  error?: string;
  recoveryError?: string;
}

/** Local CLI projection. The daemon's HTTP API cannot authorize a host update. */
export interface RuntimeUpdateStatus {
  prepared: PreparedRuntimeUpdate | null;
  receipt: RuntimeUpdateReceipt | null;
  runtime: VerifiedRuntimeReference | null;
}

export interface RuntimeUpdateStatusObservation extends Pick<DaemonStatusDto, 'execution' | 'build' | 'pid'> {
  appsTotal: number;
  appsOnline: number;
  apps: ProcessInfoDto[];
}

export interface RuntimeUpdateProjectObservation {
  online: boolean;
  projects: IProjectInfo[];
}

export interface RuntimeUpdateStackObservation {
  project: string;
  path: string;
  stacks: IStackInfo[];
}
