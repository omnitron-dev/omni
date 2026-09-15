/**
 * SlaveConnector — Master↔slave Netron TCP connection manager
 *
 * Runs on the MASTER daemon. Manages persistent TCP connections to all
 * slave daemons in remote/cluster stacks. Handles:
 *
 * - Auto-connect on stack start
 * - Exponential backoff reconnection on disconnect
 * - Heartbeat monitoring (detect slave failures)
 * - Sync wiring (push sync invoke to SyncService)
 * - Fleet node status updates
 *
 * Each slave runs its own omnitron daemon on the remote machine.
 * The slave's Netron TCP transport is already registered and listening.
 * We connect to it using RemoteDaemonClient pattern.
 *
 * Connection lifecycle:
 *   connect() → ping() → subscribe events → heartbeat loop
 *   on disconnect → backoff → reconnect()
 *   on stack stop → disconnect() cleanup
 */

import { Netron } from '@omnitron-dev/titan/netron';
import { TcpTransport } from '@omnitron-dev/titan/netron/transport/tcp';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
// Peer type from netron.connect() — RemotePeer for TCP connections
import type { FleetService } from '../services/fleet.service.js';
import type { SyncService } from '../services/sync.service.js';
import { directLink, stableNodeUuid, type MeshDialer, type MeshLink } from './mesh-link.js';

// =============================================================================
// Types
// =============================================================================

export interface SlaveNodeConfig {
  host: string;
  port: number;
  /**
   * The MASTER's identifier for this node — the registry's `randomUUID()`.
   *
   * What a slave calls itself is `${hostname}-${port}`, and the columns the
   * master stores replicated rows in are `uuid`. So every ingest failed with
   * `invalid input syntax for type uuid: "daos-cpp-9700"` and every entry
   * was left unacknowledged. This is also the id the node list, the charts
   * and the log filters join on, so it is the right one regardless.
   *
   * Absent for a node that arrived through a stack rather than the registry;
   * see `stableNodeUuid`.
   */
  nodeId?: string | undefined;
  label?: string | undefined;
  /**
   * Stack and project this node belongs to, when it belongs to one.
   *
   * Optional because a node joins the mesh by being REGISTERED, not by
   * hosting a stack. Required here, the only nodes the master ever connected
   * to were the ones a remote stack had just started on — so a machine added
   * through the console, provisioned, and left to collect its own metrics
   * was never dialled, and buffered until told otherwise. Measured on the
   * first such node: 47,407 entries, none replicated, over eleven hours.
   */
  stack?: string | undefined;
  project?: string | undefined;
}

export type SlaveConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface SlaveConnection {
  config: SlaveNodeConfig;
  status: SlaveConnectionStatus;
  netron: Netron | null;
  peer: any;
  lastHeartbeat: number | null;
  lastError: string | null;
  reconnectAttempt: number;
  reconnectTimer: NodeJS.Timeout | null;
  /** How this connection was reached, and what has to be released. */
  link: MeshLink | null;
}

// =============================================================================
// SlaveConnector
// =============================================================================

export class SlaveConnector {
  private readonly connections = new Map<string, SlaveConnection>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  /** Heartbeat interval — how often we ping each slave (ms) */
  private readonly heartbeatInterval: number;
  /** Max reconnect backoff (ms) */
  private readonly maxBackoff: number;
  /**
   * How to reach a node, and what to present when there.
   *
   * Defaults to dialling the daemon port with no credential, which is what
   * this class always did — so a caller that arranges nothing behaves as
   * before, and the decision about firewalls and tokens lives outside a
   * connection manager.
   */
  private readonly dial: MeshDialer;

  constructor(
    private readonly logger: ILogger,
    private readonly fleetService: FleetService | undefined,
    private readonly syncService: SyncService | null,
    options?: { heartbeatInterval?: number; maxBackoff?: number; dial?: MeshDialer },
  ) {
    this.heartbeatInterval = options?.heartbeatInterval ?? 15_000;
    this.maxBackoff = options?.maxBackoff ?? 120_000;
    this.dial = options?.dial ?? directLink;
  }

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  /**
   * Add and connect to a slave node.
   */
  async addSlave(config: SlaveNodeConfig): Promise<void> {
    const key = `${config.host}:${config.port}`;

    if (this.connections.has(key)) {
      // Debug, not warn: the node registry re-asserts its members whenever a
      // health check sees one, so "already registered" is the normal case
      // and a warning per node per check is noise that hides the real ones.
      this.logger.debug({ host: config.host, port: config.port }, 'Node already in the mesh');
      return;
    }

    const conn: SlaveConnection = {
      config,
      status: 'disconnected',
      netron: null,
      peer: null,
      lastHeartbeat: null,
      lastError: null,
      reconnectAttempt: 0,
      reconnectTimer: null,
      link: null,
    };

    this.connections.set(key, conn);
    this.logger.info({ host: config.host, port: config.port, stack: config.stack }, 'Slave registered');

    // Start connection attempt
    this.connectSlave(key, conn);

    // Start heartbeat loop if not running
    if (!this.heartbeatTimer) {
      this.startHeartbeatLoop();
    }
  }

  /**
   * Remove and disconnect from a slave node.
   */
  async removeSlave(host: string, port: number): Promise<void> {
    const key = `${host}:${port}`;
    const conn = this.connections.get(key);
    if (!conn) return;

    await this.disconnectSlave(conn);
    this.connections.delete(key);
    this.logger.info({ host, port }, 'Slave removed');
  }

  /**
   * Disconnect all slaves and stop heartbeat loop.
   */
  async dispose(): Promise<void> {
    this.disposed = true;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    const entries = [...this.connections.entries()];
    for (const [, conn] of entries) {
      await this.disconnectSlave(conn);
    }
    this.connections.clear();
  }

  // ===========================================================================
  // Queries
  // ===========================================================================

  /**
   * Get status of all slave connections.
   */
  getConnections(): Array<{
    host: string;
    port: number;
    stack: string | undefined;
    status: SlaveConnectionStatus;
    lastHeartbeat: number | null;
    lastError: string | null;
    /** How the master reached it — a node on the slow path should say so. */
    via: MeshLink['via'] | null;
    /** False here means `ping` works and no data can be pulled. */
    authenticated: boolean;
  }> {
    return [...this.connections.values()].map((conn) => ({
      host: conn.config.host,
      port: conn.config.port,
      stack: conn.config.stack,
      status: conn.status,
      lastHeartbeat: conn.lastHeartbeat,
      lastError: conn.lastError,
      via: conn.link?.via ?? null,
      authenticated: Boolean(conn.link?.token),
    }));
  }

  /**
   * Invoke an RPC method on a specific slave.
   */
  async invokeOnSlave(host: string, port: number, service: string, method: string, args: unknown[]): Promise<unknown> {
    const key = `${host}:${port}`;
    const conn = this.connections.get(key);
    if (!conn?.peer) throw new Error(`Slave ${key} not connected`);

    const proxy = await conn.peer.queryInterface(service);
    const fn = (proxy as any)[method];
    if (typeof fn !== 'function') throw new Error(`Method ${method} not found on service ${service}`);
    return fn.call(proxy, ...args);
  }

  /**
   * Broadcast an RPC method to all connected slaves.
   */
  async broadcastToSlaves(service: string, method: string, args: unknown[]): Promise<Map<string, unknown>> {
    const results = new Map<string, unknown>();

    for (const [key, conn] of this.connections) {
      if (conn.status !== 'connected' || !conn.peer) continue;

      try {
        const result = await this.invokeOnSlave(conn.config.host, conn.config.port, service, method, args);
        results.set(key, result);
      } catch (err) {
        this.logger.warn(
          { host: conn.config.host, error: (err as Error).message },
          'Broadcast to slave failed'
        );
        results.set(key, { error: (err as Error).message });
      }
    }

    return results;
  }

  // ===========================================================================
  // Private — Connection Lifecycle
  // ===========================================================================

  private async connectSlave(key: string, conn: SlaveConnection): Promise<void> {
    if (this.disposed || conn.status === 'connected') return;

    conn.status = 'connecting';

    try {
      const link = await this.dial({ host: conn.config.host, port: conn.config.port });
      conn.link = link;

      const netron = new Netron(createNullLogger(), { id: `master-to-${key}` });
      netron.registerTransport('tcp', () => new TcpTransport());

      const peer = await netron.connect(link.url, false);

      // Present the credential before asking for anything that needs it.
      //
      // `ping` is reachable without one, which is why this connection looked
      // healthy while every data call behind it answered `Authentication
      // required` — the connector's only failure signal was a debug line in
      // the pull, and a slave with nothing to say looks the same as one that
      // is refusing.
      if (link.token) {
        const runTask = (peer as { runTask?: (task: string, payload: unknown) => Promise<{ success?: boolean; error?: string }> })
          .runTask;
        if (typeof runTask !== 'function') {
          throw new Error(`cannot present a credential over ${link.url} — this transport has no authenticate task`);
        }
        const auth = await runTask.call(peer, 'authenticate', { token: link.token });
        if (!auth?.success) {
          throw new Error(`node refused the master's credential: ${auth?.error ?? 'no reason given'}`);
        }
      }

      // Verify slave is alive
      const daemon = await peer.queryInterface<any>('OmnitronDaemon');
      const pingResult = await daemon.ping();

      conn.netron = netron;
      conn.peer = peer;
      conn.status = 'connected';
      conn.lastHeartbeat = Date.now();
      conn.lastError = null;
      conn.reconnectAttempt = 0;

      this.logger.info(
        {
          host: conn.config.host,
          port: conn.config.port,
          slaveVersion: pingResult?.version,
          via: link.via,
          authenticated: Boolean(link.token),
        },
        'Node joined the mesh'
      );

      // Pull buffered sync data from slave immediately
      void this.pullSyncData(key, conn);

      // Update fleet DB
      try {
        await this.fleetService?.heartbeat(key);
      } catch {
        // Non-critical — fleet DB may not have this node yet
      }

      // Monitor for disconnection
      netron.on('peer:disconnected', () => {
        if (this.disposed) return;
        this.logger.warn({ host: conn.config.host, port: conn.config.port }, 'Slave disconnected');
        conn.status = 'disconnected';
        conn.peer = null;
        this.scheduleReconnect(key, conn);
      });

    } catch (err) {
      conn.status = 'error';
      conn.lastError = (err as Error).message;
      conn.netron = null;
      conn.peer = null;
      // A tunnel outlives the netron that failed over it, and each one holds
      // an SSH connection. Released here or they accumulate one per retry.
      await this.releaseLink(conn);

      this.logger.debug(
        { host: conn.config.host, port: conn.config.port, error: conn.lastError, attempt: conn.reconnectAttempt },
        'Slave connection failed'
      );

      this.scheduleReconnect(key, conn);
    }
  }

  private async disconnectSlave(conn: SlaveConnection): Promise<void> {
    if (conn.reconnectTimer) {
      clearTimeout(conn.reconnectTimer);
      conn.reconnectTimer = null;
    }

    if (conn.netron) {
      try {
        await conn.netron.stop();
      } catch {
        // Already stopped
      }
      conn.netron = null;
    }

    await this.releaseLink(conn);

    conn.peer = null;
    conn.status = 'disconnected';
  }

  /** Give back whatever was opened to make this connection possible. */
  private async releaseLink(conn: SlaveConnection): Promise<void> {
    const close = conn.link?.close;
    conn.link = null;
    if (!close) return;
    try {
      await close();
    } catch (err) {
      this.logger.debug(
        { host: conn.config.host, error: (err as Error).message },
        'Releasing the mesh link failed',
      );
    }
  }

  private scheduleReconnect(key: string, conn: SlaveConnection): void {
    if (this.disposed) return;
    if (conn.reconnectTimer) return;

    conn.reconnectAttempt++;
    const delay = Math.min(
      5000 * Math.pow(1.5, conn.reconnectAttempt - 1),
      this.maxBackoff,
    );

    conn.reconnectTimer = setTimeout(() => {
      conn.reconnectTimer = null;
      if (!this.disposed) {
        this.connectSlave(key, conn);
      }
    }, delay);

    if (conn.reconnectTimer.unref) conn.reconnectTimer.unref();
  }

  // ===========================================================================
  // Private — Heartbeat
  // ===========================================================================

  private startHeartbeatLoop(): void {
    this.heartbeatTimer = setInterval(() => {
      this.heartbeatSweep().catch((err) => {
        this.logger.warn({ error: (err as Error).message }, 'Heartbeat sweep error');
      });
    }, this.heartbeatInterval);
    this.heartbeatTimer.unref();
  }

  private async heartbeatSweep(): Promise<void> {
    for (const [key, conn] of this.connections) {
      if (conn.status !== 'connected' || !conn.peer) continue;

      try {
        const daemon = await conn.peer.queryInterface('OmnitronDaemon');
        await Promise.race([
          daemon.ping(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Heartbeat timeout')), 10_000)),
        ]);

        conn.lastHeartbeat = Date.now();

        // Update fleet DB
        try {
          await this.fleetService?.heartbeat(key);
        } catch {
          // Non-critical
        }
      } catch (err) {
        this.logger.warn(
          { host: conn.config.host, port: conn.config.port, error: (err as Error).message },
          'Heartbeat failed — marking slave as disconnected'
        );

        conn.status = 'disconnected';
        conn.lastError = (err as Error).message;

        // Force reconnect
        await this.disconnectSlave(conn);
        this.scheduleReconnect(key, conn);
      }
    }

    // Pull sync data from all connected slaves during heartbeat
    for (const [key, conn] of this.connections) {
      if (conn.status === 'connected' && conn.peer) {
        void this.pullSyncData(key, conn);
      }
    }
  }

  // ===========================================================================
  // Private — Sync Data Pull (master pulls from slave)
  // ===========================================================================

  /**
   * Pull buffered sync data from a slave.
   * Called on initial connect and periodically during heartbeat.
   * Drains slave's WAL buffer and ingests into master's SyncService.
   */
  private async pullSyncData(_key: string, conn: SlaveConnection): Promise<void> {
    if (!this.syncService || conn.status !== 'connected' || !conn.peer) return;

    try {
      const syncProxy = await conn.peer.queryInterface('OmnitronSync');
      let totalPulled = 0;
      const seen = new Set<string>();

      // The master labels the data with the id IT knows this node by.
      //
      // `batch.nodeId` is the slave's own `${hostname}-${port}`, and the
      // columns it lands in are `uuid`. Trusting a remote machine's name for
      // itself is also how two nodes that pick the same hostname become one
      // series; the master dialled this connection and knows what it dialled.
      const nodeId = conn.config.nodeId ?? stableNodeUuid(conn.config.host, conn.config.port);

      // Pull in batches until slave buffer is empty
      while (true) {
        const drained = await syncProxy.drainBuffer({ limit: 1000 });
        if (!drained || !drained.entries || drained.entries.length === 0) break;
        const batch = { ...drained, nodeId };

        // Ingest into master, then release on the slave — in that order.
        // `drainBuffer` used to mark entries synced before returning them,
        // so anything that went wrong from here on lost the data on both
        // sides while this loop logged the failure at debug level.
        const result = await this.syncService.receiveBatch(batch);
        const delivered = [...(result.acceptedIds ?? []), ...(result.duplicateIds ?? [])];
        if (delivered.length > 0) await syncProxy.ackDrained({ ids: delivered });
        totalPulled += delivered.length;

        // Entries the master rejected stay pending on the slave, so the next
        // fetch returns them again. Without this the sweep would re-fetch and
        // re-reject the same page until the safety limit.
        const ids: string[] = batch.entries.map((e: { id: string }) => e.id);
        if (!ids.some((id) => !seen.has(id))) {
          this.logger.warn(
            { host: conn.config.host, pending: ids.length },
            'Sync pull stalled — the master is rejecting the slave\'s oldest entries'
          );
          break;
        }
        for (const id of ids) seen.add(id);

        // Safety: don't pull more than 10k entries in one sweep
        if (totalPulled >= 10_000) break;
      }

      if (totalPulled > 0) {
        this.logger.info(
          { host: conn.config.host, port: conn.config.port, entries: totalPulled },
          'Sync data pulled from slave'
        );
      }
    } catch (err) {
      this.logger.debug(
        { host: conn.config.host, error: (err as Error).message },
        'Sync pull failed — will retry on next heartbeat'
      );
    }
  }
}
