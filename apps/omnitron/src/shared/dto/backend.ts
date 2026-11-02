import type { BuildStamp } from '../build-stamp.js';

export interface BackendRuntimeStatus {
  mode: 'coupled' | 'resident';
  handoffSupported: boolean;
  reason?: string;
  owner?: { id: string; pid: number; startedAt: string };
  /** The build loaded by the process running applications. Older owners omit it. */
  ownerBuild?: BuildStamp | null;
  /** Absent on older backends; an empty map means the owner advertised none. */
  ownerCapabilities?: Readonly<Record<string, number>>;
  epoch?: number;
  phase?: string;
  observedAgeMs?: number;
  connection?: {
    status: 'connected' | 'unavailable' | 'owner-changed';
    observedAt: string | null;
    error: string | null;
  };
  recovery?: { status: 'pending' | 'ready' | 'unavailable'; at: string | null; reason: string | null };
  supervision?: { type: 'independent'; guardianPid: number; ownerUnit: string; backendUnit: string };
  blockers: { terminalSessions: number; fileTransfers: number; pipelineRuns: number; releaseBuilds: number; kernelRollouts?: number };
}

/** Binds admission to the resident observed by authenticated daemon status. */
export interface ApplicationOwnerObservation {
  owner: NonNullable<BackendRuntimeStatus['owner']>;
  epoch: number;
}

/** Readable even when application inventory cannot be observed. */
export interface IOmnitronBackendService {
  status(): Promise<BackendRuntimeStatus>;
}

