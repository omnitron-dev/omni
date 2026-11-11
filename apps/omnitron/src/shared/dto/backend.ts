import type { BuildStamp } from '../build-stamp.js';
import type { TargetRuntime } from '../../release/target-runtime.js';

/** Counters all resident backends must report before transferring control. */
export const BACKEND_ACTIVITY_COUNTERS = ['terminalSessions', 'fileTransfers', 'pipelineRuns', 'releaseBuilds'] as const;

export interface BackendRuntimeStatus {
  mode: 'coupled' | 'resident';
  handoffSupported: boolean;
  reason?: string;
  owner?: { id: string; pid: number; startedAt: string };
  /** The build loaded by the process running applications. Older owners omit it. */
  ownerBuild?: BuildStamp | null;
  /** Actual process supervising source applications; omitted when not observed. */
  ownerRuntime?: Pick<TargetRuntime, 'node' | 'abi' | 'platform' | 'arch'>;
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
  blockers: Record<typeof BACKEND_ACTIVITY_COUNTERS[number], number> & { kernelRollouts?: number; backupOperations?: number };
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

