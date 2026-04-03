/**
 * Fleet Service — Multi-node cluster management
 *
 * Manages a fleet of Omnitron daemons across multiple nodes.
 * Uses Titan Discovery (Redis) for node registration and heartbeat,
 * and Netron TCP for cross-node RPC communication.
 *
 * Architecture:
 *   Leader: aggregates telemetry, serves webapp, coordinates deploys
 *   Follower: runs apps, reports metrics/logs, accepts commands from leader
 *
 * Node discovery happens in two ways:
 *   1. Manual: `omnitron remote add <alias> <host:port>`
 *   2. Auto: Titan DiscoveryModule with Redis (same Redis cluster)
 *
 * Each node stores its registration in omnitron-pg (leader) for persistence.
 */

import type { Kysely } from 'kysely';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { OmnitronDatabase } from '../database/schema.js';

// =============================================================================
// Types
// =============================================================================

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

// =============================================================================
// Service
// =============================================================================

export class FleetService {
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Kysely<OmnitronDatabase>,
    private readonly logger: ILogger,
    readonly selfNodeId?: string
  ) {}

  // ===========================================================================
  // Node Registration
  // ===========================================================================

  /**
   * Register a new node in the fleet.
   */
  async registerNode(registration: NodeRegistration): Promise<FleetNode> {
    const existing = await this.db
      .selectFrom('nodes')
      .selectAll()
      .where('address', '=', registration.address)
      .where('port', '=', registration.port)
      .executeTakeFirst();

    if (existing) {
      // Update existing registration
      const updated = await this.db
        .updateTable('nodes')
        .set({
          hostname: registration.hostname,
          role: registration.role ?? existing.role,
          status: 'online',
          lastHeartbeat: new Date(),
          metadata: registration.metadata ? JSON.stringify(registration.metadata) as any : existing.metadata,
          updatedAt: new Date(),
        } as any)
        .where('id', '=', existing.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return mapNode(updated);
    }

    const node = await this.db
      .insertInto('nodes')
      .values({
        hostname: registration.hostname,
        address: registration.address,
        port: registration.port,
        role: registration.role ?? 'follower',
        status: 'online',
        lastHeartbeat: new Date(),
        metadata: registration.metadata ? JSON.stringify(registration.metadata) as any : null,
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow();

    this.logger.info({ hostname: registration.hostname, address: registration.address }, 'Node registered');
    return mapNode(node);
  }

  /**
   * Remove a node from the fleet.
   */
  async removeNode(nodeId: string): Promise<void> {
    await this.db.deleteFrom('nodes').where('id', '=', nodeId).execute();
    this.logger.info({ nodeId }, 'Node removed from fleet');
  }

  /**
   * Get a specific node.
   */
  async getNode(nodeId: string): Promise<FleetNode | null> {
    const node = await this.db
      .selectFrom('nodes')
      .selectAll()
      .where('id', '=', nodeId)
      .executeTakeFirst();
    return node ? mapNode(node) : null;
  }

  /**
   * Find node by address.
   */
  async findByAddress(address: string, port: number): Promise<FleetNode | null> {
    const node = await this.db
      .selectFrom('nodes')
      .selectAll()
      .where('address', '=', address)
      .where('port', '=', port)
      .executeTakeFirst();
    return node ? mapNode(node) : null;
  }

  // ===========================================================================
  // Fleet Queries
  // ===========================================================================

  /**
   * Get all nodes in the fleet.
   */
  async listNodes(): Promise<FleetNode[]> {
    const nodes = await this.db
      .selectFrom('nodes')
      .selectAll()
      .orderBy('createdAt', 'asc')
      .execute();
    return nodes.map(mapNode);
  }

  /**
   * Get fleet summary.
   */
  async getSummary(): Promise<FleetSummary> {
    const nodes = await this.listNodes();
    const online = nodes.filter((n) => n.status === 'online');
    const leader = nodes.find((n) => n.role === 'leader') ?? null;

    return {
      totalNodes: nodes.length,
      onlineNodes: online.length,
      offlineNodes: nodes.length - online.length,
      leader,
      nodes,
    };
  }

  /**
   * Get nodes by role.
   */
  async getNodesByRole(role: NodeRole): Promise<FleetNode[]> {
    const nodes = await this.db
      .selectFrom('nodes')
      .selectAll()
      .where('role', '=', role)
      .execute();
    return nodes.map(mapNode);
  }

  // ===========================================================================
  // Heartbeat
  // ===========================================================================

  /**
   * Record a heartbeat from a node.
   */
  async heartbeat(nodeId: string): Promise<void> {
    await this.db
      .updateTable('nodes')
      .set({ lastHeartbeat: new Date(), status: 'online', updatedAt: new Date() } as any)
      .where('id', '=', nodeId)
      .execute();
  }

  /**
   * Start heartbeat sweep — marks nodes offline if no heartbeat in 30s.
   */
  startHeartbeatSweep(intervalMs = 15_000, staleThresholdMs = 30_000): void {
    if (this.heartbeatTimer) return;

    this.heartbeatTimer = setInterval(async () => {
      try {
        const staleThreshold = new Date(Date.now() - staleThresholdMs);

        // Mark stale nodes as offline
        const result = await this.db
          .updateTable('nodes')
          .set({ status: 'offline', updatedAt: new Date() } as any)
          .where('status', '=', 'online')
          .where('lastHeartbeat', '<', staleThreshold)
          .execute();

        const affected = Number((result as any)[0]?.numUpdatedRows ?? (result as any).numUpdatedRows ?? 0);
        if (affected > 0) {
          this.logger.warn({ count: affected }, 'Marked stale nodes as offline');
        }
      } catch {
        // Non-critical
      }
    }, intervalMs);
    this.heartbeatTimer.unref();
  }

  /**
   * Stop heartbeat sweep.
   */
  stopHeartbeatSweep(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ===========================================================================
  // Node Role Management
  // ===========================================================================

  /**
   * Update node role.
   */
  async setRole(nodeId: string, role: NodeRole): Promise<FleetNode> {
    const updated = await this.db
      .updateTable('nodes')
      .set({ role, updatedAt: new Date() } as any)
      .where('id', '=', nodeId)
      .returningAll()
      .executeTakeFirstOrThrow();
    return mapNode(updated);
  }

  /**
   * Set node to draining mode (no new work, finish existing).
   */
  async drainNode(nodeId: string): Promise<void> {
    await this.db
      .updateTable('nodes')
      .set({ status: 'draining', updatedAt: new Date() } as any)
      .where('id', '=', nodeId)
      .execute();
    this.logger.info({ nodeId }, 'Node set to draining');
  }
}

// =============================================================================
// Mapper
// =============================================================================

function mapNode(row: any): FleetNode {
  return {
    id: row.id,
    hostname: row.hostname,
    address: row.address,
    port: row.port,
    role: row.role,
    status: row.status,
    lastHeartbeat: row.lastHeartbeat
      ? row.lastHeartbeat instanceof Date ? row.lastHeartbeat.toISOString() : String(row.lastHeartbeat)
      : null,
    metadata: row.metadata
      ? typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
      : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}
