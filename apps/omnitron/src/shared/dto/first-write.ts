import type { PhysicalRestoreEvidence } from './physical-restore.js';
import type { PreparedRemoteReleaseSource, ReleaseMigrationHistory } from './project.js';
import type { StackExecutionScope } from './stack-execution.js';

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
