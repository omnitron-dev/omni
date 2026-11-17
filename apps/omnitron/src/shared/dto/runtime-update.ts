import type { ServiceScope } from '../../commands/service-units.js';
import type { DaemonStatusDto, ProcessInfoDto } from '../../config/types.js';
import type { IProjectInfo, IStackInfo, SelectedRelease } from './project.js';
import type { StackExecutionScope } from './stack-execution.js';
import type { OperationReceipt } from './execution-operations.js';
import type { RuntimeRestartConfiguration } from '../../project/runtime-restart.js';
import type { DarwinReconciliationScope } from '../../daemon/darwin-owner-evidence.js';

/** Read-only next-start intent. It is not a recovery or shutdown certificate. */
export interface RuntimeRestartReview {
  configuration: RuntimeRestartConfiguration;
  backups: OperationReceipt[];
}

export interface RuntimeRestartPrepareRequest {
  planDigest: string;
  stacks: StackExecutionScope[];
  configurationSha256: string;
  backups: OperationReceipt[];
}

export interface RuntimeRestartReleaseRequest {
  planDigest: string;
}

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

/** An empty candidate owner can outlive a backend which never became ready.
 * Absence is explicit: no invented backend PID or serving build is recorded. */
export interface NativeEmptyRuntimeIdentity extends Omit<RuntimeUpdateIdentity, 'backendPid' | 'backendCommit'> {
  observation: 'native-empty-owner';
  backendPid: null;
  backendCommit: null;
  guardianLifetime: string;
  native: DarwinReconciliationScope;
}

export type RuntimeUpdateRetiringIdentity = RuntimeUpdateIdentity | NativeEmptyRuntimeIdentity;

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
  runtimeRestartProtocol?: 1;
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
  /** Private effective definitions; never contains environment values in the public plan. */
  configuration?: { sha256: string; basis: 'retained-next-start' };
  /** Only these reviewed, locally owned attempts may be cancelled before shutdown. */
  backupOperations: OperationReceipt[];
  instance: string;
  target: RuntimeUpdateReference;
  before: RuntimeUpdateIdentity & { console: string | null; consoleCommit: string | null };
  stacks: ReviewedRuntimeUpdateStack[];
  excluded: RuntimeUpdateExcludedStack[];
  watches: RuntimeUpdateWatch[];
  infrastructure: RuntimeUpdateInfrastructure;
}

/** Both the cold starter and its independent observer use the artifact selected by the review. */
export function reviewedRuntimeConsole(plan: RuntimeUpdatePlan, direction: 'target' | 'previous'): RuntimeUpdateReference | null {
  const { console: artifact, consoleCommit: commit } = plan.before;
  if (artifact === null && commit === null) return null;
  if (typeof artifact !== 'string' || !/^[a-f0-9]{64}$/.test(artifact) ||
      typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit) ||
      !/^[a-f0-9]{64}$/.test(plan.target.artifact) || !/^[a-f0-9]{40}$/.test(plan.target.commit))
    throw Error('Invalid reviewed Console artifact or build');
  return direction === 'target' ? plan.target : { artifact, commit };
}

export interface PreparedRuntimeUpdate {
  protocol: 1;
  digest: string;
  plan: RuntimeUpdatePlan;
}

export type RuntimeUpdatePhase = 'draining' | 'aborted' | 'stopping' | 'starting' | 'verifying' | 'accepted' | 'failed'
  | 'stopping-candidate' | 'restoring' | 'rolled-back' | 'recovery-required';

export const RUNTIME_UPDATE_TERMINAL_PHASES = ['accepted', 'rolled-back', 'aborted'] as const satisfies readonly RuntimeUpdatePhase[];

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
  rollbackOwner?: RuntimeUpdateRetiringIdentity;
  restoreAttempted?: true;
  /** Existing guardian transaction, retained before its first effect. */
  restoreGuardian?: { file: string; intentSha256: string };
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
