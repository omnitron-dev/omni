/** Operator-visible operations supported by the recipient protocol in this build. */
export const FENCED_OPERATIONS = Object.freeze(['stack.stop', 'stack.resume-installed'] as const);

export type ElectionState = 'follower' | 'candidate' | 'leader';
export interface ClusterStateInfo {
  nodeId: string;
  clusterId: string;
  state: ElectionState;
  /** Durable decimal epoch. Null until authority has been observed. */
  term: string | null;
  leaderId: string | null;
  peers: number;
  uptime: number;
  coordination: 'postgres-lease';
  authority: 'confirmed' | 'unavailable' | 'expired' | 'stopped' | 'contended';
  reason: string | null;
  leaseExpiresAt: string | null;
  leaseRemainingMs: number;
  /** A leadership observation does not fence an external side effect. */
  effectFencing: 'recipient-required';
  fencedOperations: typeof FENCED_OPERATIONS;
}

export type ClusterParticipation =
  | (ClusterStateInfo & { participant: 'controller'; enabled: true })
  | { participant: 'worker'; enabled: true; clusterId: string; nodeId: string; coordination: 'postgres-lease'; fencedOperations: typeof FENCED_OPERATIONS }
  | { participant: 'standalone'; enabled: false };

/** Older controllers reported only a subset of the election fields and sometimes a numeric term. */
export type NodeClusterObservation = Partial<Omit<ClusterStateInfo, 'state' | 'term' | 'fencedOperations'>> & {
  participant?: string;
  enabled?: boolean;
  state?: string;
  term?: string | number | null;
  fencedOperations?: readonly string[];
};
