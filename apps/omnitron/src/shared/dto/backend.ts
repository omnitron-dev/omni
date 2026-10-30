export interface BackendRuntimeStatus {
  mode: 'coupled' | 'resident';
  handoffSupported: boolean;
  reason?: string;
  owner?: { id: string; pid: number; startedAt: string };
  epoch?: number;
  phase?: string;
  observedAgeMs?: number;
  blockers: { terminalSessions: number; fileTransfers: number; pipelineRuns: number; releaseBuilds: number };
}

