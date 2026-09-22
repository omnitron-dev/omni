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
import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule, type ILogger } from '@omnitron-dev/titan/module/logger';
import { OMNITRON_DB_TOKEN, FLEET_SELF_NODE_ID_TOKEN } from '../shared/tokens.js';
import type { OmnitronDatabase } from '../database/schema.js';
import type { NodeRole, FleetNode, FleetSummary, NodeRegistration } from '../shared/dto/fleet.js';

// =============================================================================
// Types
// =============================================================================

export type { NodeRole, NodeStatus, FleetNode, FleetSummary, NodeRegistration } from '../shared/dto/fleet.js';

// =============================================================================
// Service
// =============================================================================

@Injectable()
export class FleetService {
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly logger: ILogger;
  /** This daemon's own row in `nodes`, once it has registered itself. See `registerSelf`. */
  private ownNodeId: string | undefined;

  // T-2 part 2 — @Inject + useClass; an explicit id arrives via the
  // FLEET_SELF_NODE_ID_TOKEN useValue provider (string | undefined).
  constructor(
    @Inject(OMNITRON_DB_TOKEN) private readonly db: Kysely<OmnitronDatabase>,
    @Inject(LOGGER_SERVICE_TOKEN) loggerModule: ILoggerModule,
    @Inject(FLEET_SELF_NODE_ID_TOKEN) private readonly configuredSelfNodeId?: string,
  ) {
    this.logger = loggerModule.logger;
  }

  /**
   * Which row of `nodes` is this daemon: the id it was configured with, or
   * the one its own registration created.
   *
   * It was the configured value alone, which the daemon provides as
   * `undefined` — so the scheduler's heartbeat sent the literal `'self'`,
   * and `UPDATE nodes … WHERE id = 'self'` failed on the uuid column every
   * interval (119 times in 30 minutes on the master, 2026-09-22), under a
   * `catch` that called it non-critical. The master's row kept the
   * `lastHeartbeat` of the moment it registered.
   */
  get selfNodeId(): string | undefined {
    return this.configuredSelfNodeId ?? this.ownNodeId;
  }

  // ===========================================================================
  // Node Registration
  // ===========================================================================

  /**
   * Register THIS daemon, and remember which row it is — the id the
   * heartbeat keeps current. `registerNode` returned it, and its caller
   * dropped it.
   */
  async registerSelf(registration: NodeRegistration): Promise<FleetNode> {
    const node = await this.registerNode(registration);
    this.ownNodeId = node.id;
    return node;
  }

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
   * Record a heartbeat from a node; returns how many rows it reached.
   *
   * The count, because an UPDATE that matches nothing is not an error: a
   * heartbeat for a row that is not there reads as success unless somebody
   * asks how many rows it touched.
   */
  async heartbeat(nodeId: string): Promise<number> {
    const result = await this.db
      .updateTable('nodes')
      .set({ lastHeartbeat: new Date(), status: 'online', updatedAt: new Date() } as any)
      .where('id', '=', nodeId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
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
