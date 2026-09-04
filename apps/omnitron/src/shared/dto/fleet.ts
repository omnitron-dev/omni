/**
 * Fleet DTOs — the wire shapes of the OmnitronFleet service.
 *
 * Declared away from `services/fleet.service.ts` for the reason set out in
 * `./auth.ts`.
 */

export type NodeRole = 'leader' | 'follower' | 'candidate' | 'database' | 'cache' | 'gateway' | 'worker';
export type NodeStatus = 'online' | 'offline' | 'draining' | 'joining';

export interface FleetNode {
  id: string;
  hostname: string;
  address: string;
  port: number;
  role: NodeRole;
  status: NodeStatus;
  lastHeartbeat: string | null;
  metadata: Record<string, unknown> | null;
  apps?: string[];
  createdAt: string;
}

export interface FleetSummary {
  totalNodes: number;
  onlineNodes: number;
  offlineNodes: number;
  leader: FleetNode | null;
  nodes: FleetNode[];
}

export interface NodeRegistration {
  hostname: string;
  address: string;
  port: number;
  role?: NodeRole;
  metadata?: Record<string, unknown>;
}
