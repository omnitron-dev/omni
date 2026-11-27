import type { PhysicalRestoreEvidence, PhysicalRestoreVolume, PhysicalRestoreNode } from './physical-restore.js';
import type { PreparedRemoteReleaseSource, ReleaseMigrationHistory } from './project.js';
import type { StackExecutionScope } from './stack-execution.js';
import type { TargetRuntime } from '../../release/target-runtime.js';

export interface InspectFirstWrite extends StackExecutionScope {
  release: string;
  verifyRunId?: string;
}

/** A fresh read of the two approved release sources and their selected process owner. */
export interface FirstWriteInspection extends StackExecutionScope {
  protocol: 1;
  ok: false;
  writeAdmission: 'withheld';
  selectionDigest: string;
  /** Original target-journal input. The reopened source receipt may use a subsequently approved registration. */
  selectedPrepared: string;
  incumbent: PreparedRemoteReleaseSource;
  candidate: PreparedRemoteReleaseSource;
  migrationHistory: ReleaseMigrationHistory;
  owner: StackExecutionScope & {
    nodeId: string; definition: string; revision: number; phase: 'running' | 'stopped';
    apps: Array<{ name: string; generation: string; artifactSha256: string }>;
    containers: Array<{ name: string; id: string }>;
    stop?: { id: string; nodeOperationId: string; observedAt: string };
  };
  physical: { state: 'unverified'; reason: string } | { state: 'verified-closed-copy'; evidence: PhysicalRestoreEvidence };
  missing: Array<{ authority: string; reason: string }>;
}

/** Native volume hashing can take up to a day. Only explicit physical reads receive this budget. */
export const FIRST_WRITE_PHYSICAL_TIMEOUT_MS = 86_700_000;

export interface PrepareRehearsalRequest extends InspectFirstWrite {
  verifyRunId: string;
  operationId: string;
  review?: string;
}
export interface RehearsalCopyPlan extends StackExecutionScope {
  protocol: 1;
  operationId: string;
  release: string;
  manifestSha256: string;
  prepared: string;
  selectionDigest: string;
  sourceRevision: number;
  ownerDigest: string;
  verifyRunId: string;
  proofDigest: string;
  seed: string;
  sourceStop: string;
  receiver: PhysicalRestoreNode;
  logicalBytes: number;
  volumes: PhysicalRestoreVolume[];
  digest: string;
}
export interface RehearsalCopyReceipt {
  operationId: string;
  review: string;
  /** Physical roots beneath the receiver's private rehearsal directory. */
  copies: Array<{ tag: string; device: string; inode: string; generation: string }>;
}
export type PrepareRehearsalResult = { state: 'awaiting-confirmation'; plan: RehearsalCopyPlan }
  | { state: 'prepared'; plan: RehearsalCopyPlan; receipt: RehearsalCopyReceipt };

export interface RehearseMigrationsRequest extends StackExecutionScope {
  release: string;
  app: string;
  /** One private working pair is consumed by at most one migration trial. */
  operationId: string;
  review?: string;
}

export interface MigrationRehearsalPlan {
  protocol: 1;
  copy: RehearsalCopyPlan;
  receipt: RehearsalCopyReceipt;
  app: string;
  producerApp: string;
  producerManifest: string;
  database: string;
  archiveSha256: string;
  archiveBytes: number;
  closureSha256: string;
  nodeOptions: string;
  program: { path: string; sha256: string; sourceSha256: string };
  target: TargetRuntime;
  /** Names from the complete admitted registry and the exact additions since the incumbent. */
  names: string[];
  added: string[];
  digest: string;
}
export interface RehearsalMigrationRow { name: string; checksum: string }
export interface RehearsalHistoryRow extends RehearsalMigrationRow { executedAt: string }
export interface MigrationRehearsalReceipt {
  operationId: string;
  review: string;
  registry: RehearsalMigrationRow[];
  before: RehearsalHistoryRow[];
  after: RehearsalHistoryRow[];
  generations: { postgres: string; minio: string };
}
export type MigrationRehearsalResult = { writeAdmission: 'withheld'; plan: MigrationRehearsalPlan } & (
  { state: 'awaiting-confirmation' } |
  { state: 'verified'; receipt: MigrationRehearsalReceipt } |
  { state: 'unconfirmed' | 'refused'; reason: string }
);
