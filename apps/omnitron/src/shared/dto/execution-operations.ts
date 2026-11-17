import type { ExecutionResource, ExecutionResourceObservation } from '@xec-sh/core';

/** Logical resources serialize conflicting work, without a global project lock. */
export interface OperationResource {
  kind: string;
  project?: string;
  stack?: string;
  name: string;
}

export type OperationState = 'prepared' | 'running' | 'cancelling' | 'unknown' |
  'succeeded' | 'failed' | 'cancelled';

export interface OperationIntent {
  /** A caller can read/reconcile this attempt again; it cannot execute it twice. */
  id: string;
  kind: string;
  resources: readonly OperationResource[];
  /** SHA-256 of the exact inputs. Commands, credentials and data are not stored. */
  inputDigest: string;
}

export interface OperationArtifact {
  id: string;
  sizeBytes: number;
  sha256?: string;
}

/** An explicit administrative decision, never evidence of execution completion. */
export interface UnknownBackupReview {
  decision: 'allow-new-backup';
  reviewedRevision: number;
  actor: string;
  reason: string;
  at: string;
}

export interface OperationReceipt extends OperationIntent {
  protocol: 1;
  revision: number;
  state: OperationState;
  createdAt: string;
  updatedAt: string;
  execution?: ExecutionResource;
  observation?: ExecutionResourceObservation;
  artifact?: OperationArtifact;
  /** Stable diagnostic code; never a raw command or an unredacted error. */
  code?: string;
  /** The outcome stays unknown. Restores remain fenced until reconciliation. */
  review?: UnknownBackupReview;
}
