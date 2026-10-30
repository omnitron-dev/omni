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

import { Netron, NETRON_EVENT_PEER_DISCONNECT } from '@omnitron-dev/titan/netron';
import { TcpTransport } from '@omnitron-dev/titan/netron/transport/tcp';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
// Peer type from netron.connect() — RemotePeer for TCP connections
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
   * `invalid input syntax for type uuid: "sample-cpp-9700"` and every entry
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
  /** The last refusal seen for that read, so it is reported once, not every 15 s. */
  lastSyncStatusError: string | null;
  /** The same, for the pull — a failing pull is a backlog nobody is draining. */
  lastPullError: string | null;
  /**
   * The pull running on this connection, if one is — and the peer it runs
   * on. See `pullSyncData`. Optional so a connection built without it reads
   * as «no pull running», which is what it means.
   */
  pull?: { peer: unknown; startedAt: number; sweepsSkipped: number } | null;
  generation?: number;
  removed?: boolean;
  cleanup?: Promise<void> | null;
  reconnectAt?: number | null;
  syncStatusAt?: number | null;
  lastPullAt?: number | null;
  cleanupError?: string | null;
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

/** A failed resource must not prevent the next connection from being opened. */
async function bounded<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
      timer.unref();
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

/**
 * Whether an error means the connection is gone rather than the call failed.
 *
 * A remote method that threw is a result; a socket that closed is not. Only
 * the second is worth reconnecting for, and confusing them turns a genuine
 * remote failure into a retry loop against a node that will refuse it again.
 */
export function isConnectionGone(err: unknown): boolean {
  // Netron's own word for it, recognised by what it is. A dropped peer — by
  // the heartbeat below, or by the far side — rejects every call in flight
  // with a `TransportLostError` whose message is only its REASON: «manual
  // disconnect», «peer disconnected», a transport's name. None of those
  // matched the patterns underneath, so the one dead connection this could
  // not see was the one this connector closes itself. Test node, 2026-09-22
  // 21:17:51 UTC: the heartbeat dropped the peer while the deployment was
  // reading its credentials, a read that `retryOnDisconnect` exists for.
  // By name rather than `instanceof`: the class is the same one only while
  // there is one copy of titan loaded.
  if ((err as { name?: unknown } | null)?.name === 'TransportLostError') return true;
  const message = (err as Error)?.message ?? String(err);
  return /socket closed|not connected|ECONNRESET|EPIPE|connection closed|socket is not open|Peer .* disconnected/i.test(
    message,
  );
}

export class SlaveConnector {
  private readonly connections = new Map<string, SlaveConnection>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  /** Said once per master, not once per node: it is a property of this daemon. */
  private noSyncServiceReported = false;
  private disposed = false;
  private heartbeatRunning = false;
  private readonly cleanupTimeout: number;

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
    private readonly syncService: SyncService | null,
    options?: { heartbeatInterval?: number; maxBackoff?: number; dial?: MeshDialer; cleanupTimeout?: number },
  ) {
    this.heartbeatInterval = options?.heartbeatInterval ?? 15_000;
    this.maxBackoff = options?.maxBackoff ?? 120_000;
    this.dial = options?.dial ?? directLink;
    this.cleanupTimeout = options?.cleanupTimeout ?? 5_000;
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
      lastSyncStatusError: null,
      lastPullError: null,
      pull: null,
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
   *
   * And a reconnect waiting out its backoff is brought forward: the backoff
   * is for retries nobody is waiting on, and it grows to `maxBackoff`
   * (120 s) — past this wait's own minute. On sample/test (2026-09-25) a
   * deployment right after a `fleet upgrade` restarted the node's daemon
   * waited 60 s here for a connection whose next attempt was 66 s away, and
   * went on without the node's infrastructure.
   */
  async waitUntilConnected(host: string, port: number, timeoutMs = 60_000): Promise<boolean> {
    const key = `${host}:${port}`;
    const deadline = Date.now() + timeoutMs;

    const pending = this.connections.get(key);
    if (pending && !this.disposed && (pending.status === 'disconnected' || pending.status === 'error') && pending.reconnectTimer) {
      clearTimeout(pending.reconnectTimer);
      pending.reconnectTimer = null;
      pending.reconnectAttempt = 0;
      void this.connectSlave(key, pending);
    }

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

    conn.removed = true;
    this.connections.delete(key);
    await this.disconnectSlave(conn);
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
    syncStatusAt: number | null;
    lastSyncStatusError: string | null;
    lastPullError: string | null;
    lastPullAt: number | null;
    reconnectAt: number | null;
    reconnectAttempt: number;
    cleanupError: string | null;
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
      syncStatusAt: conn.syncStatusAt ?? null,
      lastSyncStatusError: conn.lastSyncStatusError,
      lastPullError: conn.lastPullError,
      lastPullAt: conn.lastPullAt ?? null,
      reconnectAt: conn.reconnectAt ?? null,
      reconnectAttempt: conn.reconnectAttempt,
      cleanupError: conn.cleanupError ?? null,
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
      const key = `${host}:${port}`;
      const conn = this.connections.get(key);
      if (conn) await this.connectionLost(key, conn, err);
      else await this.addSlave({ host, port });
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
    if (conn?.status !== 'connected' || !conn.peer) {
      throw new Error(`Slave ${key} not connected${conn?.lastError ? `: ${conn.lastError}` : ''}`);
    }
    const peer = conn.peer;
    try {
      const proxy = await peer.queryInterface(service);
      const fn = (proxy as any)[method];
      if (typeof fn !== 'function') throw new Error(`Method ${method} not found on service ${service}`);
      return await fn.call(proxy, ...args);
    } catch (error) {
      if (conn.peer === peer && isConnectionGone(error)) void this.connectionLost(key, conn, error);
      throw error;
    }
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
    if (this.disposed || conn.removed || conn.status === 'connected' || conn.status === 'connecting') return;
    conn.status = 'connecting';
    const generation = (conn.generation ?? 0) + 1;
    conn.generation = generation;
    conn.reconnectAt = null;
    const current = () => !this.disposed && !conn.removed && conn.generation === generation;
    let link: MeshLink | null = null;
    let netron: Netron | null = null;
    try {
      if (conn.cleanup) await conn.cleanup;
      if (!current()) return;
      link = await this.dial({ host: conn.config.host, port: conn.config.port });
      if (!current()) { await this.closeResources(null, link); return; }
      conn.link = link;
      netron = new Netron(createNullLogger(), { id: `master-to-${key}` });
      conn.netron = netron;
      netron.registerTransport('tcp', () => new TcpTransport());
      netron.setTransportOptions('tcp', { requestTimeout: SLAVE_REQUEST_TIMEOUT });
      const ownedNetron = netron;
      netron.on(NETRON_EVENT_PEER_DISCONNECT, () => {
        if (conn.netron !== ownedNetron || conn.status !== 'connected') return;
        void this.connectionLost(key, conn, new Error('RPC transport disconnected'));
      });
      const peer = await netron.connect(link.url, false);
      if (!current()) { await this.closeResources(netron, link); return; }
      const connectedLink = link;
      const pingResult = await bounded<{ version?: string }>((async () => {
        if (connectedLink.token) await authenticatePeer(peer as AuthenticatingPeer, connectedLink);
        const daemon = await peer.queryInterface<any>('OmnitronDaemon');
        return daemon.ping();
      })(), 10_000, 'RPC authentication or initial heartbeat timed out');
      if (!current()) { await this.closeResources(netron, link); return; }
      conn.peer = peer;
      conn.status = 'connected';
      conn.lastHeartbeat = Date.now();
      conn.lastError = null;
      conn.cleanupError = null;
      conn.reconnectAttempt = 0;
      this.logger.info({ host: conn.config.host, port: conn.config.port,
        slaveVersion: pingResult?.version, via: link.via, authenticated: Boolean(link.token) },
      'Node joined the mesh');
      void this.refreshSyncStatus(conn);
      void this.pullSyncData(key, conn);
    } catch (error) {
      if (current()) await this.connectionLost(key, conn, error);
      else await this.closeResources(netron, link);
    }
  }

  private async connectionLost(key: string, conn: SlaveConnection, error: unknown): Promise<void> {
    if (this.disposed || conn.removed) return;
    conn.lastError = error instanceof Error ? error.message : String(error);
    if (conn.cleanup) await conn.cleanup;
    else await this.disconnectSlave(conn);
    if (this.disposed || conn.removed || conn.status === 'connected' || conn.status === 'connecting') return;
    conn.status = 'error';
    this.scheduleReconnect(key, conn);
  }

  private async closeResources(netron: Netron | null, link: MeshLink | null): Promise<string | null> {
    try {
      // Release both independently: neither a stuck peer nor a half-open SSH
      // socket may prevent closing the other, or scheduling the next attempt.
      const results = await bounded(Promise.allSettled([
        Promise.resolve().then(() => netron?.stop()),
        Promise.resolve().then(() => link?.close?.()),
      ]), this.cleanupTimeout, 'Connection cleanup timed out; retry will use a new connection');
      return results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map(r => r.reason instanceof Error ? r.reason.message : String(r.reason)).join('; ') || null;
    } catch (error) { return error instanceof Error ? error.message : String(error); }
  }

  private async disconnectSlave(conn: SlaveConnection): Promise<void> {
    if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
    conn.reconnectTimer = null;
    conn.reconnectAt = null;
    if (conn.cleanup) return conn.cleanup;
    conn.generation = (conn.generation ?? 0) + 1;
    const netron = conn.netron;
    const link = conn.link;
    // Revoke ownership before closing. A late callback belongs to these old
    // resources and cannot disconnect or overwrite the replacement connection.
    conn.netron = null;
    conn.link = null;
    conn.peer = null;
    conn.status = 'disconnected';
    conn.syncStatus = null;
    conn.syncStatusAt = null;
    const cleanup = this.closeResources(netron, link).then(error => {
      conn.cleanupError = error;
      if (error) this.logger.warn({ host: conn.config.host, port: conn.config.port, error },
        'Mesh resource cleanup failed; reconnect remains enabled');
    });
    conn.cleanup = cleanup;
    try { await cleanup; } finally { if (conn.cleanup === cleanup) conn.cleanup = null; }
  }

  private scheduleReconnect(key: string, conn: SlaveConnection): void {
    if (this.disposed || conn.removed) return;
    if (conn.reconnectTimer) return;

    conn.reconnectAttempt++;
    const delay = Math.min(
      5000 * Math.pow(1.5, conn.reconnectAttempt - 1),
      this.maxBackoff,
    );

    conn.reconnectAt = Date.now() + delay;
    this.logger.warn({ host: conn.config.host, port: conn.config.port, attempt: conn.reconnectAttempt,
      retryInMs: delay, error: conn.lastError, cleanupError: conn.cleanupError ?? null }, 'Mesh disconnected; reconnect scheduled');
    conn.reconnectTimer = setTimeout(() => {
      conn.reconnectTimer = null;
      conn.reconnectAt = null;
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
    if (this.heartbeatRunning || this.disposed) return;
    this.heartbeatRunning = true;
    try {
      await Promise.all([...this.connections].map(async ([key, conn]) => {
        if (conn.status !== 'connected' || !conn.peer) return;
        const peer = conn.peer;
        try {
          await bounded((async () => {
            const daemon = await peer.queryInterface('OmnitronDaemon');
            await daemon.ping();
          })(), 10_000, 'Heartbeat timeout');
          if (conn.peer !== peer || conn.status !== 'connected') return;
          conn.lastHeartbeat = Date.now();
          void this.refreshSyncStatus(conn);
          void this.pullSyncData(key, conn);
        } catch (error) {
          if (conn.peer === peer) await this.connectionLost(key, conn, error);
        }
      }));
    } finally { this.heartbeatRunning = false; }
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

    const peer = conn.peer;
    try {
      const status = await bounded((async () => {
        const syncProxy = await peer.queryInterface('OmnitronSync');
        return await syncProxy.getSyncStatus() as ISyncStatus | undefined;
      })(), 10_000, 'Replication status read timed out');
      if (conn.peer !== peer || conn.status !== 'connected') return;
      conn.syncStatus = status ?? null;
      conn.syncStatusAt = Date.now();
      // Cleared on success, so a refusal that comes BACK is reported again
      // rather than being swallowed as «already said that once».
      conn.lastSyncStatusError = null;
    } catch (err) {
      if (conn.peer !== peer || conn.status !== 'connected') return;
      conn.syncStatusAt = null;
      if (isConnectionGone(err)) void this.connectionLost(`${conn.config.host}:${conn.config.port}`, conn, err);
      // A node that cannot answer is a node we do not know about, not a node
      // with an empty buffer. The heartbeat above is what decides whether it
      // is still connected; this only decides what we claim to know.
      conn.syncStatus = null;

      // Said ONCE at warn, then quietly. This was `debug` alone, and the
      // daemon logs at `info` — so when the node refused the read with
      // `Missing required role`, the whole effect was a blank «Sync» column
      // and not one line anywhere saying why. A control-plane read that a
      // node refuses is worth a sentence; the same sentence every 15 s for
      // a node that will never answer is not.
      const message = (err as Error).message;
      if (conn.lastSyncStatusError !== message) {
        conn.lastSyncStatusError = message;
        this.logger.warn(
          { host: conn.config.host, port: conn.config.port, error: message },
          'Sync status unavailable — the node did not answer getSyncStatus'
        );
      } else {
        this.logger.debug(
          { host: conn.config.host, error: message },
          'Sync status still unavailable'
        );
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
   *
   * ONE pull per connection at a time. Both callers fire and forget, and the
   * heartbeat calls this every 15 s whether or not the last sweep's pull has
   * finished. While a node's backlog is small a pull takes well under a
   * second and that never mattered. When one outlasted a heartbeat — the
   * master's machine busy, its database slow — the next sweep started a
   * second pull over the SAME entries, since the node releases nothing until
   * it is acknowledged; every entry was then ingested once per pull, the
   * pulls contended over each entry's claim and advanced in lockstep, and
   * each sweep added one more. Measured in this master's log, 2026-09-22:
   * nine pulls finishing within 122 ms of each other, eight of them the same
   * 7 918 entries, after `receiveBatch`'s limit of 60 batches a minute per
   * node — written against a flooding slave — had refused the master itself.
   * A backlog that the master drains at 800–1 100 entries a second when idle
   * grew instead.
   *
   * The turn belongs to the PEER, not to the connection. A call to a node
   * may wait out SLAVE_REQUEST_TIMEOUT — ten minutes — and a pull stuck on a
   * peer that has died would otherwise hold the reconnected one off for that
   * long: the guard would become the outage. A reconnect replaces the peer,
   * and a pull on the new one may start while the old one is still stuck.
   */
  private async pullSyncData(_key: string, conn: SlaveConnection): Promise<void> {
    // Said once, at warn. Without a sync service this master CANNOT replicate
    // anything from anywhere, and the old bare `return` made that
    // indistinguishable from a node with an empty buffer: the «Sync» column
    // reports a backlog climbing while nothing anywhere says the puller is
    // not wired. Measured on the stand — 33 614 → 34 189 pending over 40 s
    // with not one line about it.
    if (!this.syncService) {
      conn.lastPullError = 'Replication is unavailable: this master has no sync service';
      if (!this.noSyncServiceReported) {
        this.noSyncServiceReported = true;
        this.logger.warn(
          { host: conn.config.host, port: conn.config.port },
          'No sync service on this master — nothing will be pulled from any node',
        );
      }
      return;
    }
    if (conn.status !== 'connected' || !conn.peer) return;

    const running = conn.pull;
    if (running && running.peer === conn.peer) {
      // Debug per sweep; the pull reports how many it outlasted when it ends.
      running.sweepsSkipped++;
      this.logger.debug(
        { host: conn.config.host, runningMs: Date.now() - running.startedAt, sweepsSkipped: running.sweepsSkipped },
        'Sync pull still running — not starting another over the same entries',
      );
      return;
    }
    const peer = conn.peer;
    const pull = { peer, startedAt: Date.now(), sweepsSkipped: 0 };
    conn.pull = pull;

    try {
      const syncProxy = await peer.queryInterface('OmnitronSync');
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
      while (conn.peer === peer && conn.status === 'connected') {
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
        if (conn.peer !== peer || conn.status !== 'connected') return;
        if (delivered.length > 0) {
          await syncProxy.ackDrained({ ids: delivered });
          if (conn.peer === peer) conn.lastPullAt = Date.now();
        }
        totalPulled += delivered.length;

        // Entries the master rejected stay pending on the slave, so the next
        // fetch returns them again. Without this the sweep would re-fetch and
        // re-reject the same page until the safety limit.
        const ids: string[] = batch.entries.map((e: { id: string }) => e.id);
        if (!ids.some((id) => !seen.has(id))) {
          throw new Error(`Replication stalled: ${ids.length} oldest entries remain pending after ingestion; inspect master sync errors`);
        }
        for (const id of ids) seen.add(id);

        // Safety: don't pull more than 10k entries in one sweep
        if (totalPulled >= 10_000) break;
      }

      if (conn.peer !== peer || conn.status !== 'connected') return;
      conn.lastPullError = null;

      if (totalPulled > 0) {
        // How long it took, and how many heartbeats it outlasted: a pull that
        // skips sweeps is a master ingesting slower than it is asked to.
        this.logger.info(
          {
            host: conn.config.host,
            port: conn.config.port,
            entries: totalPulled,
            ms: Date.now() - pull.startedAt,
            sweepsSkipped: pull.sweepsSkipped,
          },
          'Sync data pulled from slave'
        );
      }
    } catch (err) {
      if (conn.peer !== peer || conn.status !== 'connected') return;
      if (isConnectionGone(err)) void this.connectionLost(`${conn.config.host}:${conn.config.port}`, conn, err);
      // Same rule as the status read beside it: once at warn, quietly after,
      // cleared on success. A pull that keeps failing is a backlog that keeps
      // growing, and the column showing the backlog cannot say why.
      const message = (err as Error).message;
      if (conn.lastPullError !== message) {
        conn.lastPullError = message;
        this.logger.warn(
          { host: conn.config.host, port: conn.config.port, error: message },
          'Sync pull failed — the node\'s buffer will keep growing until it succeeds',
        );
      } else {
        this.logger.debug(
          { host: conn.config.host, error: message },
          'Sync pull still failing'
        );
      }
    } finally {
      // Only our own turn: after a reconnect the field may already hold the
      // pull on the new peer.
      if (conn.pull === pull) conn.pull = null;
    }
  }
}
