/**
 * Health Monitor Worker Service
 *
 * DI-managed service that periodically checks all nodes (ping/SSH/omnitron),
 * writes results to PG, and sends IPC status batches to the master daemon
 * for cache updates.
 *
 * Replaces the old bare @Process HealthMonitorProcess with proper Titan module integration.
 * The IPC communication pattern is preserved — the service sends messages to parent
 * via parentPort.postMessage() or process.send().
 */

import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { Service } from '@omnitron-dev/titan/decorators';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule, type ILogger } from '@omnitron-dev/titan/module/logger';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

import type {
  IHealthCheckResult,
  INodeCheckTarget,
  IHealthMonitorConfig,
  INodeHealthSummary,
  NodeHealthStatus,
  HealthWorkerMessage,
} from './types.js';
import { RemoteOpsService } from '../services/remote-ops.service.js';

@Injectable()
@Service({ name: 'HealthMonitor' })
export class HealthMonitorService {
  private config!: IHealthMonitorConfig;
  private nodes: Map<string, INodeCheckTarget> = new Map();
  private statusCache: Map<string, INodeHealthSummary> = new Map();
  private db: Kysely<any> | null = null;
  private remoteOps!: RemoteOpsService;
  private checkTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastCleanup = 0;
  private readonly logger: ILogger;

  constructor(
    @Inject(LOGGER_SERVICE_TOKEN) loggerModule: ILoggerModule,
  ) {
    this.logger = loggerModule.logger;
  }

  /**
   * Initialize the worker. Called by master process via RPC with config/nodes.
   */
  async init(configJson: string, nodesJson: string): Promise<void> {
    this.config = JSON.parse(configJson);
    const nodesList: INodeCheckTarget[] = JSON.parse(nodesJson);
    for (const node of nodesList) {
      this.nodes.set(node.id, node);
    }

    this.remoteOps = new RemoteOpsService(this.logger as any);

    // Connect to PG
    try {
      const pool = new pg.Pool({ connectionString: this.config.dbUrl });
      this.db = new Kysely({ dialect: new PostgresDialect({ pool }) });
      this.logger.info({}, 'Connected to PG for health check persistence');
    } catch (err) {
      this.logger.warn({ error: (err as Error).message }, 'Failed to connect to PG — running without persistence');
    }

    // Start periodic checks
    this.startCheckLoop();

    // Notify master we're ready
    this.sendIpc({ type: 'health:ready' });

    this.logger.info(
      { nodeCount: this.nodes.size, intervalMs: this.config.intervalMs },
      'Health monitor worker initialized'
    );

    // Run initial check immediately
    void this.runAllChecks();
  }

  /** Master calls this when nodes are added/updated/removed */
  updateNodes(nodesJson: string): void {
    const nodesList: INodeCheckTarget[] = JSON.parse(nodesJson);
    this.nodes.clear();
    for (const node of nodesList) {
      this.nodes.set(node.id, node);
    }
    this.logger.info({ nodeCount: this.nodes.size }, 'Node list updated');
  }

  /** On-demand check for a specific node or all nodes */
  async triggerCheck(nodeId?: string): Promise<INodeHealthSummary[]> {
    if (nodeId) {
      const node = this.nodes.get(nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      const result = await this.checkNode(node);
      const summary = this.deriveSummary(node, result);
      this.statusCache.set(nodeId, summary);
      await this.persistResults([result]);
      this.broadcastSummaries();
      return [summary];
    }
    await this.runAllChecks();
    return this.getStatusSummaries();
  }

  /** Get current in-memory status summaries */
  getStatusSummaries(): INodeHealthSummary[] {
    return Array.from(this.statusCache.values());
  }

  /** Get check history from PG */
  async getCheckHistory(nodeId: string, limit = 50): Promise<IHealthCheckResult[]> {
    if (!this.db) return [];
    const rows = await this.db
      .selectFrom('node_health_checks')
      .selectAll()
      .where('nodeId', '=', nodeId)
      .orderBy('checkedAt', 'desc')
      .limit(limit)
      .execute();
    return rows as IHealthCheckResult[];
  }

  /** Update config at runtime */
  updateConfig(configJson: string): void {
    const newConfig: IHealthMonitorConfig = JSON.parse(configJson);
    this.config = newConfig;
    this.startCheckLoop(); // Restart timer with new interval
    this.logger.info({ intervalMs: newConfig.intervalMs }, 'Config updated');
  }

  /** Health check for PM */
  async checkHealth(): Promise<{ status: string; timestamp: number }> {
    return {
      status: this.isRunning ? 'degraded' : 'healthy',
      timestamp: Date.now(),
    };
  }

  async shutdown(): Promise<void> {
    this.stopCheckLoop();
    if (this.db) {
      await this.db.destroy();
      this.db = null;
    }
    await this.remoteOps.dispose();
    this.logger.info({}, 'Health monitor worker shut down');
  }

  // ===========================================================================
  // Check Loop
  // ===========================================================================

  private startCheckLoop(): void {
    this.stopCheckLoop();
    this.checkTimer = setInterval(() => void this.runAllChecks(), this.config.intervalMs);
    this.checkTimer.unref();
  }

  private stopCheckLoop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  private async runAllChecks(): Promise<void> {
    if (this.isRunning) return; // No overlap
    this.isRunning = true;

    try {
      const nodeList = Array.from(this.nodes.values());
      if (nodeList.length === 0) return;

      const results: IHealthCheckResult[] = [];

      // Process in batches of config.concurrency
      for (let i = 0; i < nodeList.length; i += this.config.concurrency) {
        const batch = nodeList.slice(i, i + this.config.concurrency);
        const batchResults = await Promise.allSettled(
          batch.map((node) => this.checkNode(node))
        );

        for (const r of batchResults) {
          if (r.status === 'fulfilled') {
            results.push(r.value);
          }
        }
      }

      // Update in-memory cache
      for (const result of results) {
        const node = this.nodes.get(result.nodeId);
        if (node) {
          this.statusCache.set(result.nodeId, this.deriveSummary(node, result));
        }
      }

      // Persist to PG
      await this.persistResults(results);

      // Broadcast to master via IPC
      this.broadcastSummaries();

      // Periodic cleanup — once per hour, not every cycle
      const now = Date.now();
      if (now - this.lastCleanup > 3_600_000) {
        this.lastCleanup = now;
        await this.cleanupOldRows();
      }
    } catch (err) {
      this.logger.error({ error: (err as Error).message }, 'Error during health check round');
    } finally {
      this.isRunning = false;
    }
  }

  // ===========================================================================
  // Individual Node Check
  // ===========================================================================

  private async checkNode(node: INodeCheckTarget): Promise<IHealthCheckResult> {
    const start = Date.now();

    const result: IHealthCheckResult = {
      nodeId: node.id,
      checkedAt: new Date().toISOString(),
      checkDurationMs: 0,
      pingReachable: false,
      pingLatencyMs: null,
      pingError: null,
      sshConnected: false,
      sshLatencyMs: null,
      sshError: null,
      omnitronConnected: false,
      omnitronVersion: null,
      omnitronPid: null,
      omnitronUptime: null,
      omnitronRole: null,
      omnitronError: null,
      os: null,
    };

    if (node.isLocal) {
      result.pingReachable = true;
      result.pingLatencyMs = 0;
      result.sshConnected = true;
      result.sshLatencyMs = 0;
      result.omnitronConnected = true;
      result.omnitronPid = process.ppid; // Parent is the daemon
      result.omnitronUptime = process.uptime() * 1000;
      result.omnitronRole = 'master';
      result.os = {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        release: os.release(),
      };
      result.checkDurationMs = Date.now() - start;
      return result;
    }

    // 1. Ping
    if (this.config.pingEnabled) {
      const ping = await this.remoteOps.ping(node.host, this.config.pingTimeout);
      result.pingReachable = ping.reachable;
      result.pingLatencyMs = ping.latencyMs;
      if (ping.error) result.pingError = ping.error;
    } else {
      result.pingReachable = true;
    }

    // 2. SSH — always attempt
    const sshTarget = {
      host: node.host,
      port: node.sshPort,
      username: node.sshUser,
      ...(node.sshPrivateKey && { privateKey: readKeyContent(node.sshPrivateKey) }),
      ...(node.sshPassphrase && { passphrase: node.sshPassphrase }),
    };
    const ssh = await this.remoteOps.checkSsh(sshTarget, this.config.sshTimeout);
    result.sshConnected = ssh.connected;
    result.sshLatencyMs = ssh.latencyMs;
    if (ssh.error) result.sshError = ssh.error;
    if (ssh.os) result.os = { ...ssh.os, release: '' };

    // 3. Omnitron (only if SSH connected)
    if (result.sshConnected) {
      const omn = await this.remoteOps.checkRemoteOmnitron(sshTarget, this.config.omnitronCheckTimeout);
      result.omnitronConnected = omn.connected;
      if (omn.version) result.omnitronVersion = omn.version;
      if (omn.pid) result.omnitronPid = omn.pid;
      if (omn.uptime) result.omnitronUptime = omn.uptime;
      if (omn.role) result.omnitronRole = omn.role;
      if (omn.os) result.os = omn.os;
    }

    result.checkDurationMs = Date.now() - start;
    return result;
  }

  // ===========================================================================
  // Status Derivation
  // ===========================================================================

  private deriveSummary(node: INodeCheckTarget, result: IHealthCheckResult): INodeHealthSummary {
    const previous = this.statusCache.get(node.id);
    const isReachable = result.sshConnected || result.pingReachable;

    let status: NodeHealthStatus;
    if (result.sshConnected || (node.isLocal && result.omnitronConnected)) {
      status = result.omnitronConnected ? 'online' : 'degraded';
    } else {
      // Not reachable — check offline timeout
      const offlineTimeout = node.offlineTimeout ?? this.config.offlineTimeoutMs;
      const lastSeen = previous?.lastSeenOnline;
      if (lastSeen && (Date.now() - new Date(lastSeen).getTime()) < offlineTimeout) {
        status = 'degraded';
      } else {
        status = 'offline';
      }
    }

    const consecutiveFailures = isReachable
      ? 0
      : (previous?.consecutiveFailures ?? 0) + 1;

    const lastSeenOnline = isReachable
      ? result.checkedAt
      : (previous?.lastSeenOnline ?? null);

    return {
      nodeId: node.id,
      status,
      lastCheck: result,
      lastSeenOnline,
      consecutiveFailures,
    };
  }

  // ===========================================================================
  // Persistence
  // ===========================================================================

  private async persistResults(results: IHealthCheckResult[]): Promise<void> {
    if (!this.db || results.length === 0) return;

    try {
      const rows = results.map((r) => ({
        nodeId: r.nodeId,
        checkedAt: r.checkedAt,
        checkDurationMs: r.checkDurationMs,
        pingReachable: r.pingReachable,
        pingLatencyMs: r.pingLatencyMs,
        pingError: r.pingError,
        sshConnected: r.sshConnected,
        sshLatencyMs: r.sshLatencyMs,
        sshError: r.sshError,
        omnitronConnected: r.omnitronConnected,
        omnitronVersion: r.omnitronVersion,
        omnitronPid: r.omnitronPid,
        omnitronUptime: r.omnitronUptime,
        omnitronRole: r.omnitronRole,
        omnitronError: r.omnitronError,
        os: r.os ? JSON.stringify(r.os) : null,
      }));

      await this.db.insertInto('node_health_checks').values(rows).execute();
    } catch (err) {
      this.logger.warn({ error: (err as Error).message }, 'Failed to persist health check results');
    }
  }

  private async cleanupOldRows(): Promise<void> {
    if (!this.db) return;

    try {
      const cutoff = new Date(Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000).toISOString();
      const { sql } = await import('kysely');
      await sql`
        DELETE FROM node_health_checks
        WHERE id IN (
          SELECT id FROM node_health_checks
          WHERE "checkedAt" < ${cutoff}
          LIMIT 10000
        )
      `.execute(this.db);
    } catch {
      // Non-critical — cleanup will retry next hour
    }
  }

  // ===========================================================================
  // IPC
  // ===========================================================================

  private sendIpc(message: HealthWorkerMessage): void {
    const parentPort = (globalThis as any).parentPort;
    if (parentPort?.postMessage) {
      parentPort.postMessage(message);
    } else if (typeof process.send === 'function') {
      process.send(message);
    }
  }

  private broadcastSummaries(): void {
    this.sendIpc({
      type: 'health:status_batch',
      summaries: Array.from(this.statusCache.values()),
    });
  }
}

/** Read SSH key: if path -> read file, if already content -> return as-is */
function readKeyContent(pathOrContent: string): string {
  if (pathOrContent.startsWith('-----')) return pathOrContent;
  try {
    return readFileSync(pathOrContent, 'utf-8');
  } catch {
    return pathOrContent;
  }
}
