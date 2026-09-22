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
import type { ISyncStatus } from '../shared/dto/project.js';
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
  /**
   * What the node last said about its own replication, or null for a node we
   * have not heard from. Null is the honest answer: the console used to
   * report `syncedSlaves: 0, totalPending: 0` as a literal, and a confident
   * zero about a buffer nobody has asked about reads as «up to date».
   */
  syncStatus: ISyncStatus | null;
}

// =============================================================================
// SlaveConnector
// =============================================================================

/** The part of a peer this needs: netron's `authenticate` core-task. */
export interface AuthenticatingPeer {
  runTask?: (task: string, payload: unknown) => Promise<{ success?: boolean; error?: string } | undefined>;
}

/**
 * Present the master's credential, and tell a refusal from a broken line.
 *
 * netron's `authenticate` core-task catches everything a credential can do
 * wrong — an invalid signature, an expired token, a role the node will not
 * grant — and RESOLVES with `{ success: false, error }`. It throws only when
 * the call itself did not complete.
 *
 * This called `link.onRejected` for both, and the difference is not
 * cosmetic: `onRejected` drops the cached signing secret and logs "Node
 * refused the master credential". Measured on a master while it was starting
 * six applications: two of those lines, and the same credential
 * authenticated first try when asked again a minute later —
 * `success: true, roles: [service_role]`. The node had refused nothing; the
 * tunnel had not survived a busy moment. An operator reading that line goes
 * looking at authentication, which is the one thing that was working.
 */
export async function authenticatePeer(peer: AuthenticatingPeer, link: MeshLink): Promise<void> {
  const runTask = peer.runTask;
  if (typeof runTask !== 'function') {
    throw new Error(`cannot present a credential over ${link.url} — this transport has no authenticate task`);
  }

  const auth = await runTask.call(peer, 'authenticate', { token: link.token });
  if (!auth?.success) {
    link.onRejected?.(auth?.error);
    throw new Error(`node refused the master's credential: ${auth?.error ?? 'no reason given'}`);
  }
}

/**
 * How long a call to a node may take.
 *
 * Ten minutes, because the operations a master asks of a node are
 * provisioning ones: pulling images, waiting on health checks, installing a
 * bundle. A caller that needs a shorter bound imposes it itself — the
 * heartbeat does.
 */
const SLAVE_REQUEST_TIMEOUT = 10 * 60_000;

/**
 * Whether an error means the connection is gone rather than the call failed.
 *
 * A remote method that threw is a result; a socket that closed is not. Only
 * the second is worth reconnecting for, and confusing them turns a genuine
 * remote failure into a retry loop against a node that will refuse it again.
 */
export function isConnectionGone(err: unknown): boolean {
  const message = (err as Error)?.message ?? String(err);
  return /socket closed|not connected|ECONNRESET|EPIPE|connection closed|socket is not open|Peer .* disconnected/i.test(
    message,
  );
}

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
      syncStatus: null,
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
   * Wait until a node is connected, or until the budget runs out.
   *
   * `addSlave` starts the connection and returns — deliberately, because the
   * mesh adds every registered node at startup and must not block on the
   * slowest one. A caller that immediately invokes something on that node
   * therefore raced its own connection:
   *
   *     Could not bring up this node's infrastructure:
   *       Slave 37.27.130.185:9700 not connected
   *
   * measured while deploying a stack to a node the master connected to
   * successfully two seconds later.
   *
   * Polling rather than an event, because the connection may already be
   * established when this is called — a subscriber would then wait for a
   * transition that has already happened, which is the same race wearing a
   * different hat.
   */
  async waitUntilConnected(host: string, port: number, timeoutMs = 60_000): Promise<boolean> {
    const key = `${host}:${port}`;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (this.disposed) return false;
      const conn = this.connections.get(key);
      if (conn?.status === 'connected') return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return this.connections.get(key)?.status === 'connected';
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
    /** The node's own replication state, or null if it has not been heard. */
    syncStatus: ISyncStatus | null;
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
      syncStatus: conn.syncStatus,
    }));
  }

  /**
   * Invoke an RPC method on a specific slave.
   */
  async invokeOnSlave(
    host: string,
    port: number,
    service: string,
    method: string,
    args: unknown[],
    options?: {
      /**
       * Reconnect and try once more when the call dies with a closed socket.
       *
       * `status: 'connected'` is a cached belief, refreshed by the heartbeat.
       * Between a node's daemon exiting and the next heartbeat noticing, the
       * connection object still says connected and the socket is dead — and
       * the only way to find out is to use it.
       *
       * That window is not rare, it is the NORMAL case for the one caller
       * that matters: the deployer restarts a node's daemon, waits for it to
       * answer, and the very next step provisions its infrastructure over a
       * mesh connection established to the process that just exited.
       * Measured three times in a row on the test node — `Slave node
       * provisioned` at 14:01:29, `Socket closed during RPC` in the same
       * second, and a stack that never got its containers.
       *
       * Opt-in per call rather than blanket, because a retry is only safe
       * for an operation that can be applied twice. `provisionStack` is a
       * reconciler and can; a call that transfers or increments cannot, and
       * must keep failing loudly instead.
       */
      retryOnDisconnect?: boolean;
    },
  ): Promise<unknown> {
    try {
      return await this.callOnSlave(host, port, service, method, args);
    } catch (err) {
      if (!options?.retryOnDisconnect || !isConnectionGone(err)) throw err;

      this.logger.info(
        { host, port, service, method, error: (err as Error).message },
        'The mesh connection was already gone — reconnecting and trying once more',
      );
      await this.removeSlave(host, port);
      await this.addSlave({ host, port });
      if (!(await this.waitUntilConnected(host, port, 60_000))) {
        // The symptom is «did not come back»; the diagnosis is in what
        // dropped it, and without the cause the second failure hides the
        // first.
        throw new Error(`Slave ${host}:${port} did not come back after its connection dropped`, {
          cause: err,
        });
      }
      return await this.callOnSlave(host, port, service, method, args);
    }
  }

  private async callOnSlave(host: string, port: number, service: string, method: string, args: unknown[]): Promise<unknown> {
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

    // Anything left from a previous attempt goes back before a new one is
    // made. The disconnect path releases it too; this is the guarantee that
    // does not depend on which path got here.
    await this.releaseLink(conn);

    try {
      const link = await this.dial({ host: conn.config.host, port: conn.config.port });
      conn.link = link;

      const netron = new Netron(createNullLogger(), { id: `master-to-${key}` });
      netron.registerTransport('tcp', () => new TcpTransport());
      // The calls this connection carries ARE the work: a container set
      // coming up, an image being pulled, a bundle being installed. netron's
      // default is five seconds, and the failure it produces names a
      // timeout while the node goes on doing exactly what it was asked:
      //
      //     Could not bring up this node's infrastructure:
      //       RPC request timed out after 5000ms
      //
      // measured against a node that provisioned it successfully.
      //
      // The one call that must fail fast is the heartbeat, and it is bounded
      // by its own race rather than by this — which is why raising this does
      // not make a dead node look alive.
      netron.setTransportOptions('tcp', { requestTimeout: SLAVE_REQUEST_TIMEOUT });

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
await authenticatePeer(peer as AuthenticatingPeer, link);
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

      // Pull buffered sync data from slave immediately, then ask what is
      // left. Both call sites of the drain do this: without it here, a node
      // that just joined shows an empty «Sync» column until the first sweep
      // fifteen seconds later, which is exactly when somebody is looking.
      void this.pullSyncData(key, conn).then(() => this.refreshSyncStatus(conn));

      await this.recordFleetHeartbeat(conn);

      // Monitor for disconnection
      netron.on('peer:disconnected', () => {
        if (this.disposed) return;
        this.logger.warn({ host: conn.config.host, port: conn.config.port }, 'Slave disconnected');
        // Give back the netron and the link BEFORE reconnecting.
        //
        // This dropped the peer and kept both, and `connectSlave` overwrites
        // them with the new ones — so every reconnect leaked a Netron and,
        // for a node reached over SSH, a tunnel holding an open SSH session.
        // The nodes that reconnect are the ones on a poor link, so the leak
        // is fastest exactly where it is worst, and it ends at sshd's
        // session limit: the master locked out of the node entirely,
        // including the path it deploys over.
        void this.disconnectSlave(conn).finally(() => this.scheduleReconnect(key, conn));
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
    // What it last told us about its buffer is no longer something we know.
    // Keeping the last figure would report a stale «0 pending» about a node
    // that has been silent for hours, which is the exact reading this whole
    // path exists to prevent.
    conn.syncStatus = null;
  }

  /**
   * Tell the fleet table this node answered, if it is a node the fleet knows.
   *
   * `heartbeat(nodeId)` is `UPDATE nodes SET lastHeartbeat=… WHERE id=$1`
   * and `nodes.id` is a `uuid`. Both call sites passed `${host}:${port}` —
   * the connector's own map key — so every heartbeat since this class was
   * written raised `invalid input syntax for type uuid` into a bare `catch`
   * that discarded it. A write that cannot succeed, in a silence that cannot
   * report it.
   *
   * Called only with the master's registry id, and only when there is one: a
   * node that reached this connector through a stack has no fleet row, and
   * an UPDATE matching nothing is not an error, so it would go on being
   * silent for a second reason. The debug line is what distinguishes the two
   * states for whoever next asks why `lastHeartbeat` is stale.
   */
  private async recordFleetHeartbeat(conn: SlaveConnection): Promise<void> {
    const nodeId = conn.config.nodeId;
    if (!this.fleetService || !nodeId) return;
    try {
      await this.fleetService.heartbeat(nodeId);
    } catch (err) {
      this.logger.debug(
        { host: conn.config.host, nodeId, error: (err as Error).message },
        'Fleet heartbeat not recorded — this node has no row in the fleet table',
      );
    }
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

        await this.recordFleetHeartbeat(conn);
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
        // The status is read AFTER the drain, and regardless of whether the
        // drain worked: `pendingItems` then means what is still waiting
        // rather than what was waiting before this sweep touched it. A
        // failed drain is precisely when the figure matters.
        void this.pullSyncData(key, conn).then(() => this.refreshSyncStatus(conn));
      }
    }
  }

  /**
   * Ask the node what its own replication is doing, and remember the answer.
   *
   * `OmnitronSync.getSyncStatus` has answered this since it was written, and
   * the only caller was the node's own page. The stack view reported
   * `syncedSlaves: 0, totalPending: 0` as literals and `syncStatus: null` per
   * node — a «Sync» column that could never show anything — while the figure
   * it could not show was 47,407 entries buffered on one node, none
   * delivered, over eleven hours.
   *
   * It rides the heartbeat because the heartbeat already reaches every node
   * every 15 s, so the view costs one extra call per node per sweep and
   * nothing at all at read time.
   */
  private async refreshSyncStatus(conn: SlaveConnection): Promise<void> {
    if (conn.status !== 'connected' || !conn.peer) return;

    try {
      const syncProxy = await conn.peer.queryInterface('OmnitronSync');
      const status = (await syncProxy.getSyncStatus()) as ISyncStatus | undefined;
      conn.syncStatus = status ?? null;
    } catch (err) {
      // A node that cannot answer is a node we do not know about, not a node
      // with an empty buffer. The heartbeat above is what decides whether it
      // is still connected; this only decides what we claim to know.
      conn.syncStatus = null;
      this.logger.debug(
        { host: conn.config.host, error: (err as Error).message },
        'Sync status unavailable — the node reports nothing until the next heartbeat'
      );
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
        // Discards are released too: the master has said it can never store
        // them, so holding them parks the buffer behind an entry that will
        // be refused identically forever. Each one was logged at ERROR.
        const delivered = [
          ...(result.acceptedIds ?? []),
          ...(result.duplicateIds ?? []),
          ...(result.discardedIds ?? []),
        ];
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
