/**
 * Project & Stack DTOs — Wire types for RPC communication
 *
 * These DTOs define the contract between webapp/CLI clients
 * and the daemon's ProjectService.
 */

import type { DaemonRole, IStackConfig, AppStatus } from '../../config/types.js';

export interface ConfigurationImport {
  project: string;
  name: string;
  path: string;
  /** Existing namespace for migration; new imports receive a stable generated namespace. */
  registration?: string;
  /** Source stack name -> public stack name within the owning project. */
  stacks: Record<string, string>;
  expectedRevision: string;
}

export interface ProjectConfigurationInfo {
  name: string;
  path: string;
  runtimeProject: string;
  stacks: Record<string, string>;
}

export interface RuntimeStackScope {
  project: string;
  stack: string;
}

// =============================================================================
// Project DTOs
// =============================================================================

export const projectStarterOptions = {
  persistence: { none: 'No persistence', sqlite: 'SQLite file', postgresql: 'PostgreSQL database', mysql: 'MySQL database' },
  service: { none: 'None · standalone commands', node: 'Node worker', titan: 'Titan application' },
} as const;

export interface ProjectStarterNeeds {
  automation: boolean;
  persistence: keyof typeof projectStarterOptions.persistence;
  service: keyof typeof projectStarterOptions.service;
}

export const defaultProjectStarterNeeds: Readonly<ProjectStarterNeeds> = Object.freeze({
  automation: false, persistence: 'none', service: 'node',
});

export function isProjectStarterNeeds(value: unknown): value is ProjectStarterNeeds {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  const { automation, persistence, service } = fields;
  return Object.keys(fields).length === 3 && ['automation', 'persistence', 'service'].every(key => Object.hasOwn(fields, key)) &&
    typeof automation === 'boolean' && typeof persistence === 'string' && Object.hasOwn(projectStarterOptions.persistence,persistence) &&
    typeof service === 'string' && Object.hasOwn(projectStarterOptions.service,service) && (automation || persistence !== 'none' || service !== 'none');
}

export interface ProjectStarterManifest {
  version: 1;
  name: string;
  needs: ProjectStarterNeeds;
  dependencies: Record<string, string>;
  commands: Record<string, string>;
  stack: string | null;
  app: string | null;
}

export interface ProjectCreationReview {
  name: string;
  path: string;
  manifest: ProjectStarterManifest;
  effects: string[];
  files: Array<{ path: string; content: string }>;
  digest: string;
}

export interface IProjectInfo {
  /** Registry name (directory-based, e.g. 'omni') */
  name: string;
  /** Display name from omnitron.config.ts `project` field (e.g. 'myproj') */
  displayName: string;
  /** Absolute path to monorepo root */
  path: string;
  /** When the project was registered */
  registeredAt: string;
  /** Stacks that are enabled (running or auto-start) */
  enabledStacks: string[];
  /** Number of running stacks */
  runningStacks: number;
  /** Total number of configured stacks */
  totalStacks: number;
  /** Configuration sources belong to this project; runtime namespaces are retained for history and recovery. */
  configurations?: ProjectConfigurationInfo[];
  catalogRevision?: string;
  /**
   * Set only on the answer to an add of a project already registered at that
   * path: its config was read again, and this many running apps took the new
   * definition for their next start.
   */
  reread?: { redefined: number };
}

// =============================================================================
// Stack DTOs
// =============================================================================

/**
 * An account `createStackAccount` made on a stand. Its password is not here:
 * it is in the daemon's vault under `vaultKey`, and nowhere else.
 */
export interface IStackAccount {
  username: string;
  /** The role the stand reports it holds — read back, not the one asked for. */
  role: string;
  id: string;
  /** `host:port` of the node it was made on. */
  node: string;
  vaultKey: string;
  /** The project commit whose tool made it. */
  commit: string;
}

/** An account as a stand holds it — no secret in it. */
export interface IStackAccountShown {
  username: string;
  id: string;
  role: string;
  status: string | null;
  createdAt: string | null;
  /** `null`: nobody has signed in with it. */
  lastActiveAt: string | null;
}

/** What `showStackAccount` found: the account, or `null` when the stand holds none by that name. */
export interface IStackAccountLookup {
  node: string;
  commit: string;
  account: IStackAccountShown | null;
}

/** What `censusStackAccounts` counted on a stand — no value in it. */
export interface IStackAccountCensus {
  node: string;
  commit: string;
  census: import('../../project/operator-account.js').StandCensus;
}

/** What `probeLeftovers` found on a stand: the project tool's report in the mode asked for, and its words. */
export interface IStackLeftoversCensus {
  node: string;
  commit: string;
  mode: import('../../project/operator-account.js').LeftoversMode;
  report: Readonly<Record<string, unknown>>;
  lines: readonly string[];
}

/** An account `removeStackAccount` took away. */
export interface IStackAccountRemoved {
  username: string;
  id: string;
  node: string;
  commit: string;
  /** The vault key of its password, removed with it — `null` when the vault kept none. */
  vaultKeyRemoved: string | null;
}

export type StackStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'degraded' | 'error' | 'unknown';

export interface ExistingInfrastructureReview {
  protocol: 1;
  mode: 'preserve';
  scope?: { project: string; stack: string };
  digest: string | null;
  checks: import('./stack-diagnosis.js').StackDiagnosisCheck[];
  containers: Array<{ name: string; id: string; fingerprint: string }>;
  retainedIngress?: { name: string; id: string; generation: string; fingerprint: string };
}

export interface PlacementProvisionIntent {
  placementDigest: string;
  stopOperationId: string;
}

/** The existing node infrastructure transport, with an explicit effect authority. */
export interface StackInfrastructureInput {
  placement?: PlacementProvisionIntent | undefined;
  config: import('../../infrastructure/types.js').InfrastructureConfig;
  services?: Record<string, import('../../infrastructure/types.js').IServiceRequirement> | undefined;
  project?: string | undefined;
  stack?: string | undefined;
  overrides?: Record<string, import('../../infrastructure/types.js').IServiceOverride> | undefined;
  configFiles?: import('../../infrastructure/config-payload.js').ConfigPayload | undefined;
  staticRoots?: Record<string, string> | undefined;
  staticLinkRoots?: Record<string, string> | undefined;
  /** Expected content of the existing static link. Preservation never uploads or repoints it. */
  staticDigests?: Record<string, string> | undefined;
  infrastructure?: 'reconcile' | 'preserve' | undefined;
  review?: string | undefined;
}

/** Refusals that can safely cross the node registration boundary without exposing application output. */
export const stackStartRefusals = {
  'infrastructure-review-required': 'Preserved infrastructure requires a successful stack start review; inspect --dry-run --infrastructure preserve',
  'infrastructure-review-changed': 'Stack launch or native infrastructure changed since review; no startup effects were admitted',
  'declarations-refresh-required': 'The recipient requires a topology declaration refresh before it can review the start',
  'receiver-admission-unknown': 'The selected node could not confirm the start policy of its registered application allocation',
} as const;

export interface StackStartOptions {
  allowDirty?: boolean;
  release?: string;
  workingTree?: boolean;
  reinstall?: boolean;
  /** Preserve admits only existing verified infrastructure; reconcile authorizes its normal deployment lifecycle. */
  infrastructure?: 'reconcile' | 'preserve';
  /** Required when selecting preserve. Binds the complete read-only review, including native IDs. */
  review?: string;
}
export interface StackStartReview {
  protocol: 1;
  project: string;
  stack: string;
  infrastructure: 'preserve';
  selection?: { release?: string; workingTree?: true; preparedSource?: string; nodeId?: string };
  checkedAt: string;
  digest: string | null;
  targets: Array<{ node: string; infrastructure?: ExistingInfrastructureReview; applicationOnly?: true; reason?: string; refreshDeclarations?: { release?: string } }>;
  deferred: string[];
}

export interface StackStopReview {
  project: string;
  stack: string;
  /** Explicit acknowledgement: applications stop while infrastructure keeps running. */
  keepInfrastructure?: true;
  checkedAt: string;
  /** Present only when every target was inspected. Changes invalidate this review. */
  digest: string | null;
  targets: Array<{
    node: string;
    runtime?: RuntimeStackScope & { revision?: number; phase?: import('./stack-execution.js').StackExecutionPlan['phase'] };
    definitionSha256?: string;
    applications?: string[];
    containers?: string[];
    reason?: string;
  }>;
}
export interface InstalledStackResumeResult {
  project: string;
  stack: string;
  operationId: string;
  stopOperationId: string;
  outcome: 'running' | 'partial' | 'unconfirmed';
  nodes: Array<{
    node: string;
    outcome: 'running' | 'failed' | 'unconfirmed' | 'skipped';
    apps?: string[];
    reason?: string;
    observedAt?: string;
  }>;
}

export interface StackStopProgress {
  /** Identifies the reviewed release replacement that requested this stop. */
  deploymentReview?: string;
  /** Binds this local stop to its registration, PostgreSQL databases and retained native container identities. */
  retainedDatabaseSha256?: string;
  backupWindow?: { id: string; target: string; expiresAt: string };
  keepInfrastructure?: true;
  intentCommitted?: boolean;
  supersededAt?: string;
  id: string;
  phase: 'preparing' | 'stopping' | 'stopped' | 'failed';
  startedAt: string;
  completedAt?: string;
  error?: string;
  nodes: Array<{ node: string; nodeId?: string; outcome: 'checking' | 'prepared' | 'stopping' | 'stopped' | 'unknown'; operationId?: string; observedAt?: string; reason?: string;
    definition?: string; execution?: { project: string; stack: string; revision: number };
    authority?: { clusterId: string; nodeId: string; epoch: string } }>;
}

/** Fresh operator evidence about a host-local prepared payload, not gateway publication. */
export interface PreparedArtifactVolume {
  binding: string;
  service: string;
  app: string;
  directory: string;
  /** Physical source returned by the verified installer on this execution node. */
  source: string;
  target: string;
  readonly: true;
  releaseId: string;
  manifestSha256: string;
  artifactSha256: string;
}

export interface PlacementRequest extends RuntimeStackScope {
  fromNodeId: string;
  destination: { release: string; prepared: string } | { registered: true };
  previousDeclarationCommit?: string;
}
export interface PlacementReceipt extends RuntimeStackScope {
  digest: string; generation: number; fromNodeId: string; toNodeId: string; stopId: string; release: string | null;
  registrationChange?: { previous: string; current: string; previousDeclarationCommit: string; currentDeclarationCommit?: string };
  /** Previous source used for the two-way migration comparison. Older selections omit it. */
  migrationBaseline?: { release: string; manifestSha256: string } | { registeredCommit: string };
}

/** Read-only evidence available before stopping a remote allocation. Only a post-stop review can authorize selection. */
export interface PlacementPreflight extends RuntimeStackScope {
  fromNodeId: string;
  toNodeId: string;
  release: string | null;
  registration: string;
  registrationChange?: NonNullable<PlacementReceipt['registrationChange']>;
  sshFingerprint: string;
  source: { definition: string; project: string; stack: string; revision: number };
}

/** Controller-local, administrator-selected input for a single remote replacement. */
export interface RemoteReleaseSourceInput {
  sourceRoot: string;
  storeRoot: string;
  manifestSha256: string;
  declarationsSha256: string;
  nodeId: string;
}
export interface PreparedRemoteReleaseSource {
  protocol: 1;
  project: string;
  stack: string;
  release: string;
  manifestSha256: string;
  declarationsSha256: string;
  commit: string;
  nodeId: string;
  sshFingerprint: string;
  digest: string;
}

export interface ReleaseAdmission {
  /** File history and producer provenance measured from both immutable release sources. */
  migrationHistory?: ReleaseMigrationHistory;
  /** A whole-stack replacement on its selected recipient. Confirmation requires administrator access. */
  deployment?: RemoteReleaseDeployment;
  deploymentPhase?: RemoteDeploymentPhase;
  /** Installed candidate declarations needed for a preservation review. This is independent of the stop fence. */
  declarations?: 'refresh-required';
  declarationReason?: string;
  /** Only a successful prepare inspection supplies paths. Requires-stop may retain this
   * evidence so an operator can publish immutable assets before quiescing applications.
   * It does not select a release, update a gateway, or authorize any filesystem mutation. */
  preparedArtifactVolumes?: PreparedArtifactVolume[];
  ok: boolean;
  because: string;
  state?: 'missing' | 'unprepared' | 'requires-stop' | 'replacement-unavailable';
}

export interface ReleaseMigrationHistory {
  kind: 'existing-history-changed' | 'added-migrations' | 'provenance-unavailable';
  total: number;
  /** First 20 affected entries. The total counts all distinct differences in the refused direction. */
  entries: string[];
}

export type RemoteDeploymentPhase = 'stopping' | 'stopped' | 'selecting' | 'selected' | 'starting';

/** The native qualification run for a return release that can process post-migration writes. */
export interface DeploymentRecoveryInput {
  release: string;
  runId: string;
  probeCommit: string;
}

export function isDeploymentRecoveryInput(value: unknown): value is DeploymentRecoveryInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  return Object.keys(input).length === 3 && ['release', 'runId', 'probeCommit'].every(key => Object.hasOwn(input, key)) &&
    typeof input['release'] === 'string' && input['release'].trim().length > 0 && typeof input['runId'] === 'string' && input['runId'].trim().length > 0 &&
    typeof input['probeCommit'] === 'string' && /^[a-f0-9]{40}$/.test(input['probeCommit']);
}

export interface PlanRecoveryQualificationRequest extends RuntimeStackScope {
  release: string;
  recoveryRelease: string;
  probeCommit: string;
  qaNodeId: string;
}

export interface CheckReleaseRequest extends RuntimeStackScope {
  release: string;
  prepare?: boolean;
  recovery?: DeploymentRecoveryInput;
}

export interface ReviewedReleaseRequest extends RuntimeStackScope {
  release: string;
  review: string;
  recovery?: DeploymentRecoveryInput;
}

export interface RemoteReleaseDeployment extends RuntimeStackScope {
  digest: string;
  nodeId: string;
  release: string;
  prepared: string;
  rollback: { release: string; prepared: string };
  postWriteRecovery?: {
    incumbent: { release: string; prepared: string };
    runId: string;
    proofDigest: string;
    probeCommit: string;
  };
  stop: { digest: string; applications: string[]; containers: string[] };
  previousDeclarationCommit?: string;
  recoveryOf?: string;
}

export function recoveryFromDeployment(review: RemoteReleaseDeployment): DeploymentRecoveryInput | undefined {
  const proof = review.postWriteRecovery;
  return proof && { release: review.rollback.release, runId: proof.runId, probeCommit: proof.probeCommit };
}

export interface SelectedRelease {
  id: string;
  manifestSha256: string;
}

/** Application health is an observation, separate from process lifecycle and start prerequisites. */
export interface StackHealthObservation {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'not-running';
  observedAt: string | null;
  apps: Array<{
    name: string;
    node: string;
    status: StackHealthObservation['status'];
    checks: Array<{ name: string; status: string; message?: string }>;
  }>;
}

export interface IStackInfo {
  /** Durable authority for subsequent starts, including automatic resumes. */
  infrastructureMode?: 'reconcile' | 'preserve';
  /** Stored preserve authority; a null review cannot authorize an automatic boot. */
  infrastructureReview?: string | null;
  health?: StackHealthObservation;
  /** Desired release for the next local launch. Runtime evidence is reported separately. */
  selectedRelease?: SelectedRelease;
  /** Last explicit recovery of the applications retained by their process owners. */
  resumeOperation?: InstalledStackResumeResult | undefined;
  /** Last durable stop operation; failures and unreachable peers remain visible. */
  stopOperation?: StackStopProgress | undefined;
  /** Execution/history identity, which can predate this stack's public project/name. */
  runtimeScope?: RuntimeStackScope;
  /** Stack name (e.g., 'dev', 'test', 'prod') */
  name: string;
  /** Stack deployment type */
  type: 'local' | 'remote' | 'cluster';
  /** Current runtime status */
  status: StackStatus;
  /** Stack configuration */
  config: IStackConfig;
  /** Nodes participating in this stack (remote/cluster) */
  nodes: IStackNodeStatus[];
  /** Apps running in this stack */
  apps: IStackAppStatus[];
  /** Infrastructure services provisioned for this stack */
  infrastructure: IStackInfraStatus;
  /** Node-qualified observations. Missing peers are retained as unknown placements. */
  placements?: IStackPlacement[];
  /** Port range allocated to this stack */
  portRange: { start: number; end: number } | null;
  /**
   * When this stack's applications started, as the machine that runs them
   * says: this daemon for a local stack; for a remote or cluster stack, the
   * nodes — the start of the longest-running app they report online. `null`
   * when that is not known (no node answered, or none runs an app of it):
   * a start time is never made up from this master's memory.
   */
  startedAt: string | null;
  /** Milliseconds since `startedAt` (0 when that is `null`) */
  uptime: number;
  /**
   * When THIS master took charge of a remote or cluster stack: deployed it,
   * or attached to it after its own restart. Not when the stack started —
   * see `startedAt`. `null` for a local stack, and for one this master has
   * neither deployed nor attached.
   */
  attachedAt: string | null;
  /**
   * Unavailable resources and observed causes. Local observations include app
   * launch failures, blocked dependencies and stack-owned infrastructure.
   * Remote start replies include skipped nodes and unavailable infrastructure.
   */
  notUp?: string[];
}

export interface IStackNodeStatus {
  /** Node host */
  host: string;
  /** Node port */
  port: number;
  /** Node role */
  role: string;
  /** Node label */
  label: string | null;
  /** Daemon role on this node */
  daemonRole: DaemonRole;
  /** Whether the node's daemon is reachable */
  connected: boolean;
  /** Last heartbeat timestamp */
  lastSeen: number | null;
  /** Sync status (for slave nodes) */
  syncStatus: ISyncStatus | null;
}

/**
 * Sync status for a slave daemon.
 * Tracks local buffer state and last successful sync to master.
 */
export interface ReplicationEvidence {
  /** Scope of the durable evidence. No guarantee is inferred before this epoch. */
  epoch: string;
  since: string;
  firstTrackedId: string;
  producedThrough: string;
  /** Includes discards and evictions; this is not proof of delivery. */
  releasedThrough: string;
  /** Contiguous, durable master receipts starting at firstTrackedId. */
  committedThrough: string;
  committedRows: number;
  discardedRows: number;
  unverifiedRows: number;
  evictedRows: number;
  lastCommittedAt: number | null;
  lastLossAt: number | null;
  /** Later verification/restoration, distinct from the original delivery acknowledgement. */
  reconciliation?: {
    verifiedRows: number;
    restoredRows: number;
    lastReconciledAt: string | null;
    scope: 'source' | 'master';
  };
}

/** A bounded audit of retained sources; never implies coverage before firstAt. */
export interface HistoryCoverage {
  sourceId: string;
  category: 'metrics' | 'logs';
  status: 'partial' | 'verified';
  expectedRows: number;
  processedRows: number;
  presentRows: number;
  restoredRows: number;
  /** Missing from the live table after configured retention; source archive remains. */
  expiredRows: number;
  firstAt: string;
  lastAt: string;
  verifiedAt: string | null;
  precision: 'original' | 'millisecond';
  gaps: Array<{
    reason: string;
    from: string | null;
    to: string | null;
    rows: number | null;
    /** A separate committed source proof; the original audit is retained. */
    resolution?: { sourceId: string; explanation: string; verifiedAt: string };
  }>;
}

export interface ISyncStatus {
  /** Legacy reverse-channel indicator. Pull connectivity is observed by the controller. */
  connected: boolean;
  /** Last successful sync timestamp. Advanced by `ackDrained` — the pull path. */
  lastSyncAt: number | null;
  /** Number of buffered items pending sync. Counted from `sync_buffer`. */
  pendingItems: number;
  /** Age of the oldest pending row, measured on the node (no clock skew). Absent on older nodes. */
  oldestPendingAgeMs?: number | null;
  /** Age of the last actual acknowledgement, measured on the node. */
  lastSyncAgeMs?: number | null;
  /** Actual rows acknowledged per second over the last 60 seconds, including idle time. */
  deliveryRatePerSecond?: number;
  /** Pending payload bytes (UTF-8), measured on new nodes; older nodes estimate it. */
  bufferSize: number;
  bufferSizeAccuracy?: 'measured';
  /** All retained payload bytes, including released records awaiting cleanup. */
  retainedBufferSize?: number;
  /** Durable receipts and explicit gaps; absent on peers without evidence tracking. */
  evidence?: ReplicationEvidence;
  /** A failed reconciliation-history read must not disappear behind healthy transport. */
  reconciliationError?: string;
  /** Earlier source coverage is independent of the current receipt frontier. */
  history?: HistoryCoverage[];
  /** Legacy reverse-channel error. The master exposes pull failures through mesh diagnostics. */
  lastError: string | null;
  /** Legacy reverse-channel retry count. */
  failedAttempts: number;
}

export interface IStackAppStatus {
  /** Observed health of all physical replicas, independent of process status. */
  health?: StackHealthObservation['status'];
  release?: import('../../config/types.js').RuntimeReleaseEvidence;
  /** Owner's launch generation for a single observed replica; absent on older owners. */
  generation?: string;
  /** App name */
  name: string;
  /** Namespaced handle key: project/stack/app */
  handleKey: string;
  /** Current status */
  status: AppStatus | 'degraded' | 'unknown';
  /** Main PID, or null when stopped or no single process represents the application. */
  pid: number | null;
  /** Number of instances */
  instances: number;
  /** Uptime in ms */
  uptime: number;
  /** Restarts since the app was first started — a crash loop shows up here. */
  restarts: number;
  /** CPU percentage, 0 when not running or not yet sampled. */
  cpu: number;
  /** Resident memory in bytes, 0 when not running or not yet sampled. */
  memory: number;
  /** HTTP port the app listens on, null when it has no HTTP transport. */
  port: number | null;
}

/**
 * One deployment of an app, as `getProjectApps` lists them: an app that two
 * stacks run appears twice, once with each stack.
 */
export interface IProjectAppStatus extends IStackAppStatus {
  /** The stack this deployment belongs to. */
  stack: string;
  /** Where that stack runs — only a `local` stack's apps are this daemon's own. */
  stackType: IStackInfo['type'];
}

export interface IStackInfraStatus {
  /** Whether infrastructure is provisioned and healthy */
  ready: boolean;
  preservationIssues?: import('../../infrastructure/types.js').InfrastructureState['preservationIssues'];
  /** Individual service statuses */
  services: Record<
    string,
    {
      status: 'running' | 'stopped' | 'error';
      /** Docker lifecycle, separate from the service verdict and setup. */
      nativeStatus?: import('../../infrastructure/types.js').ContainerStatus;
      containerName: string;
      port: number | null;
      service?: string;
      nodeKey?: string;
      containerId?: string;
      image?: string;
      health?: 'healthy' | 'unhealthy' | 'starting' | 'none';
      provisioning?: 'pending' | 'ready' | 'failed';
      error?: string;
      ports?: Record<string, number>;
      app?: string;
    }
  >;
}

/** One node's observations, distinct from the desired placement in config.nodes. */
export interface IStackPlacement {
  nodeKey: string;
  host: string;
  port: number;
  label: string | null;
  observedAt: string | null;
  appsObserved: boolean;
  infrastructureObserved: boolean;
  apps: Array<{
    name: string;
    expected: boolean;
    /** Null means absent on an answering node, unknown on a non-answering node. */
    process: import('../../config/types.js').ProcessInfoDto | null;
  }>;
  infrastructure: IStackInfraStatus | null;
  /** Safe source-level reasons, with no credentials or launch environment. */
  errors: string[];
}

// =============================================================================
// Stack Runtime (detailed runtime state for a stack)
// =============================================================================

export interface StackRuntime {
  health?: StackHealthObservation;
  /** Stack name */
  name: string;
  /** Stack type */
  type: 'local' | 'remote' | 'cluster';
  /** Current status */
  status: StackStatus;
  /** Current unavailable applications and bounded evidence from the last start, as in IStackInfo. */
  notUp?: string[];
  /** Total apps */
  totalApps: number;
  /** Online apps */
  onlineApps: number;
  /** Total nodes (1 for local) */
  totalNodes: number;
  /** Connected nodes */
  connectedNodes: number;
  /** Aggregate CPU across all apps in this stack */
  totalCpu: number;
  /** Aggregate memory across all apps in this stack */
  totalMemory: number;
  /** Sync status summary (for remote/cluster stacks) */
  syncSummary: {
    /** Total slave nodes */
    totalSlaves: number;
    /** Slaves currently syncing successfully */
    syncedSlaves: number;
    /** Total pending items across all slaves */
    totalPending: number;
  } | null;
}

// =============================================================================
// Project Requirements (from static analysis)
// =============================================================================

export interface IProjectRequirements {
  /** Per-app infrastructure requirements */
  apps: Record<
    string,
    {
      postgres: boolean;
      redis: boolean;
      s3: boolean;
      discovery: boolean;
      notifications: boolean;
      custom: string[];
    }
  >;
  /** Aggregated: does any app need postgres? */
  needsPostgres: boolean;
  /** Aggregated: does any app need redis? */
  needsRedis: boolean;
  /** Aggregated: does any app need S3? */
  needsS3: boolean;
}

/** A stack's maintenance lock, as its gateway answers `/_/maintenance`. */
export interface IStackMaintenance {
  where: string;
  active: boolean;
  reason: string | null;
  message: string | null;
  endsAt: number | null;
  retryAfter: number | null;
  notice: { startsAt: number; startsIn: number; reason: string; message: string | null } | null;
}

/** Configured dependencies, never a claim that a live socket is connected. */
export interface ProjectDependency {
  project: string;
  stack: string;
  app: string;
  targetApp?: string;
  service?: string;
  host?: string;
  port?: number;
  /** Configuration key establishing this relationship, without its value. */
  via: string;
  evidence: 'configuration' | 'declaration';
}
export interface ProjectTopology {
  version: 1;
  generatedAt: string;
  dependencies: ProjectDependency[];
  /** Snapshot provenance. Captured declarations do not assert live traffic or connection health. */
  coverage?: Array<{ project: string; stack: string; app: string;
    source: 'entry' | 'launch' | 'snapshot' | 'memory' | 'missing'; capturedAt?: string }>;
  /** Canonical ownership of unchanged runtime/history namespaces. */
  scopes?: Array<{ project: string; stack: string; runtimeProject: string; runtimeStack: string }>;
  /** Missing definitions/configuration are explicit; a partial graph is not a complete census. */
  warnings: Array<{ project: string; stack?: string; app?: string; reason: string }>;
}

export interface TopologyMetadataRefresh {
  refreshed: number;
  failures: Array<{ project: string; app: string; reason: string }>;
}
/** Resolved credentials stay inside the controller. No infrastructure effects
 * or application start are authorized by a migration review. */
export interface StackMigrationReview {
  protocol: 1;
  project: string;
  stack: string;
  app?: string;
  digest: string | null;
  stopped: boolean;
  reason?: string;
  targets: Array<{ app: string; service: string; database: string; mode: 'script' | 'config'; program: string; sourceSha256: string }>;
}
export interface StackMigrationRequest {
  project: string;
  stack: string;
  app?: string;
  review: string;
  operationId: string;
}
