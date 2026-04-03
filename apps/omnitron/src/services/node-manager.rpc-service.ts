/**
 * NodeManager RPC Service — Netron endpoints for node management
 *
 * Only available on master omnitron. Slave cannot manage nodes.
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
import type { INodeHealthSummary } from '../workers/types.js';
import type { NodeHealthRepository, HealthCheckRow, UptimeBucket } from './node-health.repository.js';

/** Interface for the health worker proxy methods we call */
interface IHealthWorkerProxy {
  triggerCheck(nodeId?: string): Promise<INodeHealthSummary[]>;
  getStatusSummaries(): Promise<INodeHealthSummary[]>;
}

@Service({ name: 'OmnitronNodes' })
export class NodeManagerRpcService {
  private healthWorkerProxy: IHealthWorkerProxy | null = null;
  private healthRepo: NodeHealthRepository | null = null;

  constructor(private readonly nodeManager: NodeManagerService) {}

  /** Set the health worker proxy after the worker is spawned */
  setHealthWorkerProxy(proxy: IHealthWorkerProxy | null): void {
    this.healthWorkerProxy = proxy;
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

  @Public({ auth: { roles: OPERATOR_ROLES } })
  removeNode(data: { id: string }): void {
    return this.nodeManager.removeNode(data.id);
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async checkNodeStatus(data: { id: string }): Promise<INodeStatus> {
    // Delegate to worker if available — returns fresh result directly
    if (this.healthWorkerProxy) {
      const summaries = await this.healthWorkerProxy.triggerCheck(data.id);
      const summary = summaries.find((s) => s.nodeId === data.id);
      if (summary?.lastCheck) {
        const status = summaryToNodeStatus(summary);
        this.nodeManager.updateStatusCacheFromWorker([summary]);
        return status;
      }
    }
    return this.nodeManager.checkNodeStatus(data.id);
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async checkAllNodes(): Promise<INodeStatus[]> {
    if (this.healthWorkerProxy) {
      const summaries = await this.healthWorkerProxy.triggerCheck();
      if (summaries.length > 0) {
        this.nodeManager.updateStatusCacheFromWorker(summaries);
        return summaries.filter((s) => s.lastCheck).map(summaryToNodeStatus);
      }
    }
    return this.nodeManager.checkAllNodes();
  }

  /** Read check history from PG directly (not via worker) */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getCheckHistory(data: { nodeId: string; limit?: number }): Promise<HealthCheckRow[]> {
    if (!this.healthRepo) return [];
    return this.healthRepo.getHistory(data.nodeId, data.limit ?? 50);
  }

  /**
   * Uptime bar data from PG — aggregated into fixed-interval buckets.
   * Each bucket has ping/omnitron uptime as 0.0–1.0 percentage.
   */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getUptimeBar(data: { nodeId: string; bucketCount?: number; intervalMs?: number }): Promise<UptimeBucket[]> {
    if (!this.healthRepo) return [];
    return this.healthRepo.getUptimeBar(data.nodeId, data.bucketCount ?? 60, data.intervalMs ?? 300_000);
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getNodeHealthSummaries(): Promise<INodeHealthSummary[]> {
    if (!this.healthWorkerProxy) return [];
    return this.healthWorkerProxy.getStatusSummaries();
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async triggerNodeCheck(data: { nodeId?: string }): Promise<INodeHealthSummary[]> {
    if (!this.healthWorkerProxy) return [];
    return this.healthWorkerProxy.triggerCheck(data.nodeId);
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  listSshKeys(): SshKeyInfo[] {
    return this.nodeManager.listSshKeys();
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  getCheckConfig(): ReturnType<NodeManagerService['getCheckConfig']> {
    return this.nodeManager.getCheckConfig();
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  setCheckConfig(data: { pingEnabled?: boolean; pingTimeout?: number; sshTimeout?: number; omnitronCheckTimeout?: number }): ReturnType<NodeManagerService['getCheckConfig']> {
    this.nodeManager.setCheckConfig(data);
    return this.nodeManager.getCheckConfig();
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
