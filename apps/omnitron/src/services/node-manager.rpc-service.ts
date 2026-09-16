/**
 * NodeManager RPC Service — Netron endpoints for node management
 *
 * Only available on master omnitron. Slave cannot manage nodes.
 *
 * The health-monitor worker is an OPTIMISATION, not a dependency. Every
 * endpoint that prefers it degrades to the daemon's own checks when the call
 * fails, and drops the proxy on the way so the next caller does not pay for
 * the same timeout. The guards used to test `this.healthWorkerProxy` for null
 * — which is only ever true before the worker is wired and after the daemon
 * begins shutting down — so a worker that CRASHED left a proxy that looked
 * present and answered every call with
 * `TitanError: Service with id HealthMonitor@1.0.0 not found`. The console's
 * Refresh and Check buttons returned that error verbatim, and the fleet view
 * went on rendering a status frozen at the worker's last report as though it
 * were current.
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { VIEWER_ROLES, OPERATOR_ROLES } from '../shared/roles.js';
import type {
  NodeManagerService,
  AddNodeInput,
  UpdateNodeInput,
  INodeWithStatus,
  INodeStatus,
  SshKeyInfo,
} from './node-manager.service.js';
import type { NodeCheckConfig } from './remote-ops.service.js';
import type { FleetHistoryConfig, IMeshNodeStatus, INodeIndicators, INodeSyncStatus, INodeRelayStats, INodeClusterState } from '../shared/dto/nodes.js';
import type { ISyncStatus } from '../shared/dto/project.js';
import type { INodeHealthSummary } from '../workers/types.js';
import type { NodeHealthRepository, HealthCheckRow, UptimeBucket } from './node-health.repository.js';

/** Interface for the health worker proxy methods we call */
interface IHealthWorkerProxy {
  triggerCheck(nodeId?: string): Promise<INodeHealthSummary[]>;
  getStatusSummaries(): Promise<INodeHealthSummary[]>;
}

import type { IOmnitronNodesService } from '../shared/dto/services.js';

/**
 * Caps on what one call may ask the database for.
 *
 * `limit` and `bucketCount` arrived from the caller and went straight into
 * the query. A page size is not a suggestion the client makes — it is the
 * cost of the request, and the server is the only side that knows what it can
 * afford. The console asks for 200 buckets; these numbers are above what any
 * caller in the tree needs and below what would hurt.
 */
const MAX_HISTORY_LIMIT = 500;
const MAX_UPTIME_BUCKETS = 400;

/** Clamp an untrusted count to `[1, max]`, falling back for NaN/absent. */
function boundedCount(value: number | undefined, fallback: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(value)));
}

@Service({ name: 'OmnitronNodes' })
export class NodeManagerRpcService implements IOmnitronNodesService {
  private healthWorkerProxy: IHealthWorkerProxy | null = null;
  private healthRepo: NodeHealthRepository | null = null;

  private remoteDeployer: import('./remote-deployer.service.js').RemoteDeployer | null = null;

  private slaveConnector: import('../cluster/slave-connector.js').SlaveConnector | null = null;

  private titanHealth: { check(): Promise<{ status: string; indicators: Record<string, unknown> }> } | null = null;

  private syncService: { getStatus(): Promise<ISyncStatus> } | null = null;

  private telemetryRelay: { stats(): unknown } | null = null;

  private leaderElection: { getClusterState(): unknown } | null = null;

  constructor(private readonly nodeManager: NodeManagerService) {}

  /** Set the health worker proxy after the worker is spawned */
  setHealthWorkerProxy(proxy: IHealthWorkerProxy | null): void {
    this.healthWorkerProxy = proxy;
  }

  /** Whether fleet checks are currently being served by the worker. */
  hasHealthWorker(): boolean {
    return this.healthWorkerProxy !== null;
  }

  /** Set the PG repository for direct history reads */
  setHealthRepository(repo: NodeHealthRepository | null): void {
    this.healthRepo = repo;
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  listNodes(): INodeWithStatus[] {
    return this.nodeManager.listNodes();
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  getNode(data: { id: string }): INodeWithStatus | null {
    return this.nodeManager.getNode(data.id);
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  addNode(data: AddNodeInput): ReturnType<NodeManagerService['addNode']> {
    return this.nodeManager.addNode(data);
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  updateNode(data: { id: string } & UpdateNodeInput): ReturnType<NodeManagerService['updateNode']> {
    const { id, ...input } = data;
    return this.nodeManager.updateNode(id, input);
  }

  /**
   * Remove a node, and everything keyed to it.
   *
   * The check history goes too. It is keyed by an id that will never be
   * issued again, nothing can read it back, and the retention sweep only
   * looks at age — so a fleet that churns nodes accumulates rows no query
   * will ever name. Deletion that stops at the registry row is deletion of
   * the part you can see.
   */
  @Public({ auth: { roles: OPERATOR_ROLES } })
  async removeNode(data: { id: string }): Promise<void> {
    await this.nodeManager.removeNode(data.id);
    if (!this.healthRepo) return;
    try {
      await this.healthRepo.deleteHistory(data.id);
    } catch (err) {
      // The node IS gone; failing the call now would invite a retry that
      // cannot succeed. Say so instead.
      this.nodeManager.reportProblem('deleteHistory', err as Error);
    }
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async checkNodeStatus(data: { id: string }): Promise<INodeStatus> {
    // Delegate to worker if available — returns fresh result directly
    const summaries = await this.callWorker((w) => w.triggerCheck(data.id), 'triggerCheck');
    const summary = summaries?.find((s) => s.nodeId === data.id);
    if (summary?.lastCheck) {
      const status = summaryToNodeStatus(summary);
      this.nodeManager.updateStatusCacheFromWorker([summary]);
      return status;
    }
    return this.nodeManager.checkNodeStatus(data.id);
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async checkAllNodes(): Promise<INodeStatus[]> {
    const summaries = await this.callWorker((w) => w.triggerCheck(), 'triggerCheck');
    if (summaries) {
      this.nodeManager.updateStatusCacheFromWorker(summaries);
      // The FILTERED list decides, not the raw one. A worker that answered
      // with summaries none of which carries a `lastCheck` — one that has
      // been spawned but not yet told which nodes exist, say — passed the
      // `length > 0` test and then returned an empty array, and an empty
      // array on the page whose subject is the fleet reads as "you have no
      // nodes". Whatever empties it, the daemon can still answer.
      const checked = summaries.filter((s) => s.lastCheck).map(summaryToNodeStatus);
      if (checked.length > 0) return checked;
    }
    return this.nodeManager.checkAllNodes();
  }

  /** Read check history from PG directly (not via worker) */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getCheckHistory(data: { nodeId: string; limit?: number }): Promise<HealthCheckRow[]> {
    if (!this.healthRepo) return [];
    return this.healthRepo.getHistory(data.nodeId, boundedCount(data.limit, 50, MAX_HISTORY_LIMIT));
  }

  /**
   * Uptime bar data from PG — aggregated into fixed-interval buckets.
   * Each bucket has ping/omnitron uptime as 0.0–1.0 percentage.
   */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getUptimeBar(data: { nodeId: string; bucketCount?: number; intervalMs?: number }): Promise<UptimeBucket[]> {
    if (!this.healthRepo) return [];
    return this.healthRepo.getUptimeBar(
      data.nodeId,
      boundedCount(data.bucketCount, 60, MAX_UPTIME_BUCKETS),
      data.intervalMs ?? 300_000,
    );
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getNodeHealthSummaries(): Promise<INodeHealthSummary[]> {
    return (await this.callWorker((w) => w.getStatusSummaries(), 'getStatusSummaries')) ?? [];
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async triggerNodeCheck(data: { nodeId?: string }): Promise<INodeHealthSummary[]> {
    const summaries = await this.callWorker((w) => w.triggerCheck(data.nodeId), 'triggerCheck');
    if (summaries && summaries.length > 0) {
      this.nodeManager.updateStatusCacheFromWorker(summaries);
      return summaries;
    }
    // No worker: run the checks here so the caller gets an answer rather than
    // an empty array that reads as "the fleet is empty".
    if (data.nodeId) {
      await this.nodeManager.checkNodeStatus(data.nodeId);
    } else {
      await this.nodeManager.checkAllNodes();
    }
    return this.nodeManager.getHealthSummaries(data.nodeId);
  }

  /**
   * Install a bundle on a node, beside what it is running.
   *
   * On the daemon rather than in the CLI because the node's credentials are
   * in the daemon's vault. `nodeToDeployTarget` resolves them here and they
   * go no further; the caller passes an id and gets back whether it worked.
   *
   * OPERATOR, not VIEWER: this writes several hundred megabytes to a remote
   * machine.
   */
  @Public({ auth: { roles: OPERATOR_ROLES } })
  async installBundleOnNode(data: { nodeId: string; archivePath: string; version: string }): Promise<boolean> {
    const target = await this.nodeManager.nodeToDeployTarget(data.nodeId);
    return this.deployer().installBundle(target, data.archivePath, data.version);
  }

  /**
   * Make an installed version current, and restart the node into it.
   *
   * Separate from the install for the reason the versioned layout exists:
   * this is the only step that changes what the node serves.
   */
  @Public({ auth: { roles: OPERATOR_ROLES } })
  async activateBundleOnNode(data: { nodeId: string; version: string; keepVersions?: number }): Promise<boolean> {
    const target = await this.nodeManager.nodeToDeployTarget(data.nodeId);
    return this.deployer().activateBundle(target, data.version, '/opt/omnitron', data.keepVersions ?? 3);
  }

  /**
   * The deployer, made once and kept.
   *
   * Lazily, because a daemon that never upgrades a node should not pay for an
   * execution engine at boot — and because `RemoteDeployer` is only reachable
   * from these two methods, so there is nothing else to construct it for.
   */
  private deployer(): import('./remote-deployer.service.js').RemoteDeployer {
    if (!this.remoteDeployer) {
      throw new Error('Remote deployment is not configured on this daemon.');
    }
    return this.remoteDeployer;
  }

  /** Wired by the daemon at startup, on a master. */
  setRemoteDeployer(deployer: import('./remote-deployer.service.js').RemoteDeployer | null): void {
    this.remoteDeployer = deployer;
  }

  /** The daemon's mesh connector, so the console can be told what it sees. */
  setSlaveConnector(connector: import('../cluster/slave-connector.js').SlaveConnector | null): void {
    this.slaveConnector = connector;
  }

  /**
   * This daemon's own titan-health, for the local node's indicators.
   *
   * A remote node is asked over the mesh; the local one cannot be, because a
   * daemon has no mesh connection to itself.
   */
  setTitanHealth(service: { check(): Promise<{ status: string; indicators: Record<string, unknown> }> } | null): void {
    this.titanHealth = service;
  }

  /** This daemon's own replication state, for the local node. */
  setSyncService(service: { getStatus(): Promise<ISyncStatus> } | null): void {
    this.syncService = service;
  }

  /** This daemon's own telemetry relay, for the local node. */
  setTelemetryRelay(relay: { stats(): unknown } | null): void {
    this.telemetryRelay = relay;
  }

  /** This daemon's own election state, for the local node. */
  setLeaderElection(election: { getClusterState(): unknown } | null): void {
    this.leaderElection = election;
  }

/**
   * Ask a service ON the node, wherever the node is.
   *
   * The console's own clients are bound to the daemon it is connected to, so
   * every question about a node used to be answerable only about the local
   * one. `SlaveConnector.invokeOnSlave` has always been able to reach any
   * service on any node over the mesh and had exactly one caller; this is the
   * seam the node readers share, so adding the next one is a method name
   * rather than another copy of the plumbing.
   *
   * `ok: false` carries the REASON and never a verdict. A node outside the
   * mesh has not answered; saying "unhealthy" or "not replicating" about
   * silence sends an operator to repair the wrong thing.
   */
  private async askNode<T>(
    nodeId: string,
    service: string,
    method: string,
    args: unknown[],
    local: (() => Promise<T>) | null,
  ): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    const node = this.nodeManager.getNode(nodeId);
    if (!node) return { ok: false, error: 'No such node' };

    if (node.isLocal) {
      if (!local) return { ok: false, error: `${service} is not wired on this daemon` };
      try {
        return { ok: true, value: await local() };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }

    if (!this.slaveConnector) return { ok: false, error: 'This daemon has no mesh connector' };
    try {
      const value = (await this.slaveConnector.invokeOnSlave(node.host, node.daemonPort, service, method, args)) as T;
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /**
   * What the node's OWN titan-health says about it.
   *
   * Every omnitron daemon runs `TitanHealthModule` and answers `Health@1.0.0`,
   * with titan's built-in indicators — memory, event loop, disk, database,
   * redis — plus the two this daemon registers: docker and the apps it
   * supervises. The remote nodes have had all of it since they were
   * provisioned, and nothing ever asked them: the console's `health` client is
   * bound to `daemonClient.daemon`, so it only ever spoke to the daemon it was
   * connected to.
   *
   * There is no new mechanism here. `SlaveConnector.invokeOnSlave` already
   * calls any service on any node over the mesh — it had exactly one caller,
   * `OmnitronInfra.provisionStack` — and `Health@1.0.0` is already answering
   * on the other side.
   *
   * `reachable: false` with a reason is NOT `unhealthy`. A node that cannot be
   * asked has not reported anything, and rendering silence as a verdict is the
   * same mistake as reading an unmeasured SSH layer as a refusal.
   */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getNodeIndicators(data: { nodeId: string }): Promise<INodeIndicators> {
    const r = await this.askNode<{ status: string; indicators: Record<string, unknown> }>(
      data.nodeId,
      'Health@1.0.0',
      'check',
      [],
      this.titanHealth ? () => this.titanHealth!.check() : null,
    );
    return r.ok
      ? { nodeId: data.nodeId, reachable: true, error: null, status: r.value?.status ?? null, indicators: r.value?.indicators ?? {} }
      : { nodeId: data.nodeId, reachable: false, error: r.error, status: null, indicators: {} };
  }

  /**
   * Whether the node's data is actually MOVING.
   *
   * Every other reading on the node page answers "can we reach it". A node can
   * be green on all of them and replicate nothing — and for every registered
   * node that no stack had been deployed onto, that is exactly what happened:
   * 47,407 entries buffered on one, none delivered, over eleven hours, while
   * the page showed it healthy.
   *
   * `OmnitronSync.getSyncStatus` has answered this since it was written; its
   * own docblock says "for webapp monitoring" and the console has never known
   * the service exists. `pendingItems` climbing with `lastSyncAt` standing
   * still is the whole diagnosis, and it was one call away the entire time.
   */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getNodeSyncStatus(data: { nodeId: string }): Promise<INodeSyncStatus> {
    const r = await this.askNode<ISyncStatus>(
      data.nodeId,
      'OmnitronSync',
      'getSyncStatus',
      [],
      this.syncService ? () => this.syncService!.getStatus() : null,
    );
    return r.ok
      ? { nodeId: data.nodeId, reachable: true, error: null, sync: r.value }
      : { nodeId: data.nodeId, reachable: false, error: r.error, sync: null };
  }

/**
   * The node's telemetry relay: what it buffered, sent, failed and DROPPED.
   *
   * `getNodeSyncStatus` answers whether the log/metric replication is moving.
   * This answers the other pipe — the telemetry relay — and it carries the one
   * counter in the fleet that reports LOSS. `totalDropped` is what the buffer
   * threw away because it was full, and a number that only ever goes up while
   * nobody looks is how a gap in the metrics is discovered months later from
   * the chart rather than from the daemon that made it.
   *
   * `OmnitronTelemetry.getRelayStats` has answered this since it was written —
   * the file's own header says "Webapp → Leader telemetry stats (relay
   * health)" — and the console has never called it.
   */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getNodeRelayStats(data: { nodeId: string }): Promise<INodeRelayStats> {
    const r = await this.askNode<Record<string, unknown>>(
      data.nodeId,
      'OmnitronTelemetry',
      'getRelayStats',
      [],
      this.telemetryRelay ? () => Promise.resolve(this.telemetryRelay!.stats() as Record<string, unknown>) : null,
    );
    return r.ok
      ? { nodeId: data.nodeId, reachable: true, error: null, relay: r.value ?? null }
      : { nodeId: data.nodeId, reachable: false, error: r.error, relay: null };
  }


/**
   * Which node each node thinks is the leader.
   *
   * The fourth reader through `askNode`, and the one that is only meaningful
   * ACROSS nodes: a single node's answer is unremarkable, and two nodes naming
   * different leaders, or sitting in different terms, is a split brain — the
   * state in which every node is individually healthy and the fleet is not.
   * Nothing in the console could see it, because `OmnitronCluster` is one of
   * the services its client does not know, and `getClusterState`'s own
   * docblock says it is "used by CLI and webapp dashboard".
   */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getNodeClusterState(data: { nodeId: string }): Promise<INodeClusterState> {
    const r = await this.askNode<Record<string, unknown>>(
      data.nodeId,
      'OmnitronCluster',
      'getClusterState',
      [],
      this.leaderElection ? () => Promise.resolve(this.leaderElection!.getClusterState() as Record<string, unknown>) : null,
    );
    return r.ok
      ? { nodeId: data.nodeId, reachable: true, error: null, cluster: r.value ?? null }
      : { nodeId: data.nodeId, reachable: false, error: r.error, cluster: null };
  }


  /**
   * Whether each node is replicating, and how it is being reached.
   *
   * The node page could say a node was up — SSH answers, the daemon answers
   * a ping — while nothing it collected ever arrived. Reachability and
   * membership are different questions, and only the second one is about
   * whether the data on the master is the whole of what the fleet knows.
   *
   * Three states are worth distinguishing, and the console renders all
   * three: not in the mesh at all; connected but UNAUTHENTICATED, which
   * answers pings and can replicate nothing; and connected over an SSH
   * tunnel, which works but says the node's daemon port is closed to this
   * master and is worth knowing before someone debugs the latency.
   */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getMeshStatus(): Promise<IMeshNodeStatus[]> {
    const connections = this.slaveConnector?.getConnections() ?? [];
    const byAddress = new Map(connections.map((c) => [`${c.host}:${c.port}`, c]));

    return this.nodeManager.listNodes().map((node) => {
      const conn = byAddress.get(`${node.host}:${node.daemonPort}`);
      return {
        nodeId: node.id,
        inMesh: Boolean(conn),
        status: conn?.status ?? 'disconnected',
        via: conn?.via ?? null,
        authenticated: conn?.authenticated ?? false,
        lastHeartbeat: conn?.lastHeartbeat ?? null,
        lastError: conn?.lastError ?? null,
      };
    });
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  listSshKeys(): SshKeyInfo[] {
    return this.nodeManager.listSshKeys();
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  getCheckConfig(): NodeCheckConfig {
    return this.nodeManager.getCheckConfig();
  }

  /** How much history exists, and how wide one uptime-bar segment is. */
  @Public({ auth: { roles: VIEWER_ROLES } })
  getHistoryConfig(): FleetHistoryConfig {
    return this.nodeManager.getHistoryConfig();
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  setCheckConfig(data: Partial<NodeCheckConfig>): NodeCheckConfig {
    this.nodeManager.setCheckConfig(data);
    return this.nodeManager.getCheckConfig();
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  /**
   * Call the health worker, or report that it could not be called.
   *
   * `null` means "no answer from the worker" — no proxy, or a proxy whose
   * process is gone. Both cases return the caller to the in-process path.
   * A failing proxy is dropped rather than retried: the process behind it
   * does not come back, and the daemon re-wires a fresh one when it respawns.
   */
  private async callWorker<T>(
    fn: (worker: IHealthWorkerProxy) => Promise<T>,
    method: string,
  ): Promise<T | null> {
    const worker = this.healthWorkerProxy;
    if (!worker) return null;
    try {
      return await fn(worker);
    } catch (err) {
      // Drop only the proxy we just used: the daemon may have wired a new one
      // while this call was in flight.
      if (this.healthWorkerProxy === worker) this.healthWorkerProxy = null;
      this.nodeManager.reportWorkerUnavailable(method, err as Error);
      return null;
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Convert a worker health summary to the frontend-facing INodeStatus */
function summaryToNodeStatus(summary: INodeHealthSummary): INodeStatus {
  const check = summary.lastCheck!;
  const status: INodeStatus = {
    nodeId: summary.nodeId,
    pingReachable: check.pingReachable,
    pingLatencyMs: check.pingLatencyMs,
    sshConnected: check.sshConnected,
    sshLatencyMs: check.sshLatencyMs,
    omnitronConnected: check.omnitronConnected,
    checkedAt: check.checkedAt,
  };
  if (check.omnitronVersion) status.omnitronVersion = check.omnitronVersion;
  if (check.omnitronPid) status.omnitronPid = check.omnitronPid;
  if (check.omnitronUptime) status.omnitronUptime = check.omnitronUptime;
  if (check.omnitronRole === 'master' || check.omnitronRole === 'slave') status.omnitronRole = check.omnitronRole;
  if (check.os) status.os = check.os;
  if (check.pingError) status.pingError = check.pingError;
  if (check.sshError) status.sshError = check.sshError;
  if (check.omnitronError) status.omnitronError = check.omnitronError;
  return status;
}
