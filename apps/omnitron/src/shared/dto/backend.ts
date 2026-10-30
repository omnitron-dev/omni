export interface BackendRuntimeStatus {
  mode: 'coupled' | 'resident';
  handoffSupported: boolean;
  reason?: string;
  owner?: { id: string; pid: number; startedAt: string };
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
  blockers: { terminalSessions: number; fileTransfers: number; pipelineRuns: number; releaseBuilds: number };
}

/** Readable even when application inventory cannot be observed. */
export interface IOmnitronBackendService {
  status(): Promise<BackendRuntimeStatus>;
}

