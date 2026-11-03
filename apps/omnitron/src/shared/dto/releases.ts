/** Release execution contracts without the build runner or service graph. */
import type { GateOutcome, ReleaseArtifactReference, ReleaseSource } from '../../release/manifest.js';

/** Recorded build provenance. Neither a launch receipt nor a continuous file-integrity check. */
export type ArtifactSourceReading = { readonly app: string } & (
  | {
      readonly state: 'recorded';
      readonly releaseId: string;
      readonly producerApp: string;
      readonly project: ReleaseSource;
      readonly framework: ReleaseSource;
      readonly via: readonly ReleaseArtifactReference[];
      readonly target?: import('../../release/target-runtime.js').TargetRuntime;
      readonly packageDirectory?: string;
    }
  | { readonly state: 'invalid'; readonly reason: string }
);

export interface BuildPhase {
  readonly phase: string;
  readonly percent: number;
  readonly at: string;
  /** Known once the commits are resolved. */
  readonly releaseId?: string;
  /** Filled the moment the gates answer, so the console can show them running. */
  readonly gates?: readonly GateOutcome[];
}

/** What the caller asked for, as it is shown back to them. */
export interface BuildRequest {
  readonly project: string;
  readonly projectCommit?: string | undefined;
  readonly omniCommit?: string | undefined;
  /** Explicit source override; omission uses the committed project configuration or package metadata. */
  readonly frameworkSource?: import('../framework-source.js').FrameworkSource | undefined;
  readonly forStack?: string | undefined;
  readonly skipGates?: boolean | undefined;
  readonly keepSource?: boolean | undefined;
  /** Names only — a value here would be in every console's memory. */
  readonly envKeys?: readonly string[] | undefined;
}

export interface BuildRecord {
  readonly buildId: string;
  readonly request: BuildRequest;
  /** Known once the two commits are resolved, a few seconds in. */
  releaseId: string | null;
  state: 'running' | 'done' | 'failed' | 'stopped';
  phase: string;
  percent: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  gates: GateOutcome[];
  error: string | null;
  /** Who asked, as the request proved it. */
  readonly requestedBy: string | null;
  /** Every phase line, in order — the console's live log. */
  readonly history: BuildPhase[];
}
