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
import type { FleetHistoryConfig } from '../shared/dto/nodes.js';
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
