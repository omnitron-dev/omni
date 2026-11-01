/** Explicit, read-only disk observation. This never attests what a process loaded. */
export interface InstalledArtifactObservation {
  app: string;
  pid: number | null;
  startedAt: number | null;
  observedAt: string;
  state: 'observed' | 'unavailable' | 'changed-during-inspection';
  entrySha256: string | null;
  frameworkCommit: string | null;
  archives: Array<{ sha256: string; bytes: number; entrySha256: string | null }>;
  reasons: string[];
}

export interface InstalledReleaseCandidate {
  releaseId: string;
  manifestSha256: string;
  state: 'modified' | 'entry-matches' | 'incomplete';
  reasons: string[];
}

export interface InstalledReleaseInspection {
  project: string;
  stack: string;
  observedAt: string;
  /** Complete catalog scan; false means candidates are not an exhaustive answer. */
  catalogComplete: boolean;
  catalogReasons: string[];
  apps: Array<InstalledArtifactObservation & { node: string; candidates: InstalledReleaseCandidate[] }>;
  nodes: Array<{ node: string; error: string }>;
  limitations: string[];
}
