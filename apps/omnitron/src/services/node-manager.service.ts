/**
 * NodeManagerService — Manages infrastructure nodes (machines)
 *
 * Registry lives in the SQLite-backed `nodes` table of DaemonStateStore.
 * `~/.omnitron/nodes.json` is read once, on a boot that finds the table
 * empty, and then unlinked — the header claimed the JSON file was still the
 * storage long after T-7 moved it, which is the kind of thing a reader
 * believes because there is nothing to contradict it.
 * Always includes a "local" node for the local machine.
 * Remote nodes are accessed via SSH for provisioning and management.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import { RemoteOpsService, type NodeCheckConfig, DEFAULT_CHECK_CONFIG } from './remote-ops.service.js';
import { CLI_VERSION } from '../config/defaults.js';
import type { INodeHealthSummary, INodeCheckTarget } from '../workers/types.js';
import type { SecretsService } from './secrets.service.js';
import type {
  INode,
  INodeStatus,
  INodeWithStatus,
  AddNodeInput,
  UpdateNodeInput,
  SshKeyInfo,
} from '../shared/dto/nodes.js';

// =============================================================================
// Types
// =============================================================================

export type {
  INode,
  INodeStatus,
  INodeWithStatus,
  AddNodeInput,
  UpdateNodeInput,
  SshKeyInfo,
} from '../shared/dto/nodes.js';


// =============================================================================
// Constants
// =============================================================================

const OMNITRON_HOME = path.join(os.homedir(), '.omnitron');
const NODES_FILE = path.join(OMNITRON_HOME, 'nodes.json');
const LOCAL_NODE_ID = 'local';

// =============================================================================
// Service
// =============================================================================

export class NodeManagerService extends EventEmitter {
  private nodes: Map<string, INode> = new Map();
  private statusCache: Map<string, INodeStatus> = new Map();
  private readonly remoteOps: RemoteOpsService;
  private checkConfig: NodeCheckConfig = DEFAULT_CHECK_CONFIG;

  constructor(
    private readonly logger: ILogger,
    /**
     * T-7 — fleet node registry persistence moved off
     * ~/.omnitron/nodes.json onto the SQLite-backed `nodes` table
     * in DaemonStateStore.
     * Canonical name/host/port are denormalised into typed columns
     * for queries; the full INode payload (SSH config, tags, etc.)
     * lives in the `metadata` column as JSON.
     */
    private readonly store: import('../daemon/daemon-state-store.service.js').DaemonStateStore,
    private readonly secrets?: SecretsService,
  ) {
    super();
    this.remoteOps = new RemoteOpsService(logger);
    this.load();
    this.ensureLocalNode();

  }

  /** Update check configuration (ping/SSH timeouts, ping enabled/disabled) */
  setCheckConfig(config: Partial<NodeCheckConfig>): void {
    this.checkConfig = { ...this.checkConfig, ...config };
  }

  getCheckConfig(): NodeCheckConfig {
    return { ...this.checkConfig };
  }

  // ===========================================================================
  // CRUD
  // ===========================================================================

  listNodes(): INodeWithStatus[] {
    return Array.from(this.nodes.values()).map((node) => ({
      ...node,
      status: this.statusFor(node.id),
    }));
  }

  getNode(id: string): INodeWithStatus | null {
    const node = this.nodes.get(id);
    if (!node) return null;
    return { ...node, status: this.statusFor(id) };
  }

  /**
   * Status for one node.
   *
   * For the local node the facts about this daemon — version, pid, uptime,
   * role — are read from `process` on every call. They used to be written
   * once into the cache in the constructor, so `omnitronUptime` was whatever
   * `process.uptime()` returned a few milliseconds into boot, and the
   * console renders that as "Uptime": a handful of seconds, however long the
   * daemon had been up.
   *
   * The health-monitor worker also checks the local node, and what it
   * reports is not worthless — whether sshd answers on loopback is a real
   * check, and it is the only source for `checkedAt`, which dates the
   * reachability reading rather than this call. So the worker's status is
   * kept and only the fields the daemon knows first-hand are overwritten.
   * Neither source is discarded, because neither one is redundant.
   */
  private statusFor(id: string): INodeStatus | null {
    if (id !== LOCAL_NODE_ID) return this.statusCache.get(id) ?? null;

    const live = this.localStatus();
    const checked = this.statusCache.get(LOCAL_NODE_ID);
    if (!checked) return live;

    const merged: INodeStatus = { ...checked, omnitronConnected: true };
    // Assigned rather than spread: the fields are optional under
    // `exactOptionalPropertyTypes`, so writing `undefined` into them is a
    // different thing from leaving them out.
    if (live.omnitronVersion !== undefined) merged.omnitronVersion = live.omnitronVersion;
    if (live.omnitronPid !== undefined) merged.omnitronPid = live.omnitronPid;
    if (live.omnitronUptime !== undefined) merged.omnitronUptime = live.omnitronUptime;
    if (live.omnitronRole !== undefined) merged.omnitronRole = live.omnitronRole;
    return merged;
  }

  async addNode(input: AddNodeInput): Promise<INode> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const node: INode = {
      id,
      name: input.name,
      host: input.host,
      sshPort: input.sshPort ?? 22,
      sshUser: input.sshUser ?? 'root',
      sshAuthMethod: input.sshAuthMethod ?? 'key',
      ...(input.sshPrivateKey && { sshPrivateKey: input.sshPrivateKey }),
      runtime: input.runtime ?? 'node',
      daemonPort: input.daemonPort ?? 9700,
      tags: input.tags ?? [],
      isLocal: false,
      createdAt: now,
      updatedAt: now,
      ...(input.offlineTimeout != null && { offlineTimeout: input.offlineTimeout }),
    };

    // Store secrets encrypted (passphrase, password) — only boolean markers in nodes.json.
    // Must await before connectivity check, otherwise getSecret() reads stale file.
    if (input.sshPassphrase) {
      node.hasPassphrase = true;
      await this.setSecret(id, 'passphrase', input.sshPassphrase);
    }
    if (input.sshPassword) {
      node.hasPassword = true;
      await this.setSecret(id, 'password', input.sshPassword);
    }

    this.nodes.set(id, node);
    this.save();
    this.emit('node:added', node);
    this.logger.info({ nodeId: id, name: node.name, host: node.host }, 'Node added');
    // Check connectivity in background — secrets are already persisted.
    // `checkNodeStatus` records an unreachable host in the status it returns
    // rather than throwing, so anything arriving here is a fault in the probe
    // itself, and swallowing it leaves the node "unchecked" for ever with
    // nothing to explain why.
    void this.checkNodeStatus(id).catch((err) => {
      this.logger.warn({ nodeId: id, err }, 'Connectivity check failed to run');
    });
    return node;
  }

  async updateNode(id: string, input: UpdateNodeInput): Promise<INode> {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Node not found: ${id}`);
    if (node.isLocal && input.host) throw new Error('Cannot change host of local node');

    // Extract secrets before spreading into node (they must not be saved to nodes.json)
    const { sshPassphrase, sshPassword, ...safeInput } = input;

    const updated: INode = {
      ...node,
      ...safeInput,
      id: node.id,
      isLocal: node.isLocal,
      createdAt: node.createdAt,
      updatedAt: new Date().toISOString(),
    };

    // Update encrypted secrets — await to ensure they're persisted before connectivity check
    if (sshPassphrase !== undefined) {
      if (sshPassphrase) {
        updated.hasPassphrase = true;
        await this.setSecret(id, 'passphrase', sshPassphrase);
      } else {
        updated.hasPassphrase = false;
        await this.deleteSecret(id, 'passphrase');
      }
    }
    if (sshPassword !== undefined) {
      if (sshPassword) {
        updated.hasPassword = true;
        await this.setSecret(id, 'password', sshPassword);
      } else {
        updated.hasPassword = false;
        await this.deleteSecret(id, 'password');
      }
    }

    this.nodes.set(id, updated);
    this.save();
    this.emit('node:updated', updated);
    // Re-check connectivity after update
    if (!updated.isLocal) {
      void this.checkNodeStatus(id).catch((err) => {
        this.logger.warn({ nodeId: id, err }, 'Connectivity check failed to run');
      });
    }
    return updated;
  }

  removeNode(id: string): void {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Node not found: ${id}`);
    if (node.isLocal) throw new Error('Cannot remove local node');

    // Clean up encrypted secrets
    void this.deleteSecret(id, 'passphrase');
    void this.deleteSecret(id, 'password');

    this.nodes.delete(id);
    this.statusCache.delete(id);
    this.save();
    this.emit('node:removed', id);
    this.logger.info({ nodeId: id, name: node.name }, 'Node removed');
  }

  // ===========================================================================
  // SSH Key Discovery
  // ===========================================================================

  /** List available SSH private keys from ~/.ssh/ */
  listSshKeys(): SshKeyInfo[] {
    const sshDir = path.join(os.homedir(), '.ssh');
    if (!fs.existsSync(sshDir)) return [];

    const entries = fs.readdirSync(sshDir);
    const keys: SshKeyInfo[] = [];

    for (const entry of entries) {
      const fullPath = path.join(sshDir, entry);

      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;

      // Skip public keys, known_hosts, config, etc.
      if (
        entry.endsWith('.pub') ||
        entry === 'known_hosts' ||
        entry === 'known_hosts.old' ||
        entry === 'config' ||
        entry === 'authorized_keys'
      ) {
        continue;
      }

      // Check if it looks like a private key (starts with -----BEGIN)
      try {
        const head = fs.readFileSync(fullPath, 'utf-8').slice(0, 100);
        if (head.includes('-----BEGIN') && head.includes('KEY')) {
          // Detect key type from header
          let type = 'unknown';
          if (head.includes('RSA')) type = 'rsa';
          else if (head.includes('EC')) type = 'ecdsa';
          else if (head.includes('OPENSSH')) type = 'ed25519';
          else if (head.includes('DSA')) type = 'dsa';

          keys.push({ name: entry, path: fullPath, type });
        }
      } catch {
        // Can't read — skip
      }
    }

    return keys;
  }

  // ===========================================================================
  // Status Checks
  // ===========================================================================

  async checkNodeStatus(id: string): Promise<INodeStatus> {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Node not found: ${id}`);

    const status: INodeStatus = {
      nodeId: id,
      pingReachable: false,
      pingLatencyMs: null,
      sshConnected: false,
      sshLatencyMs: null,
      omnitronConnected: false,
      checkedAt: new Date().toISOString(),
    };

    if (node.isLocal) {
      // Local node — we ARE the daemon, zero-cost
      status.pingReachable = true;
      status.pingLatencyMs = 0;
      status.sshConnected = true;
      status.sshLatencyMs = 0;
      status.omnitronConnected = true;
      status.omnitronPid = process.pid;
      status.omnitronUptime = process.uptime() * 1000;
      status.omnitronRole = 'master';
      status.os = {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        release: os.release(),
      };
      try {
        const { CLI_VERSION } = await import('../config/defaults.js');
        status.omnitronVersion = CLI_VERSION;
      } catch {
        status.omnitronVersion = '0.1.0';
      }
    } else {
      // Remote node — ping + Netron TCP (no SSH — SSH is manual-only via UI)

      // 1. Ping (ICMP) — lightweight reachability check
      if (this.checkConfig.pingEnabled) {
        const ping = await this.remoteOps.ping(node.host, this.checkConfig.pingTimeout);
        status.pingReachable = ping.reachable;
        status.pingLatencyMs = ping.latencyMs;
        if (ping.error) status.pingError = ping.error;
      } else {
        status.pingReachable = true;
        status.pingLatencyMs = null;
      }

      // 2. Netron TCP ping — check if omnitron daemon is running and responsive
      //    Master connects to slave via SlaveConnector; if already connected,
      //    the heartbeat confirms status. Otherwise try a quick TCP connect + ping.
      const port = node.daemonPort ?? 9700;
      try {
        const { Netron } = await import('@omnitron-dev/titan/netron');
        const { TcpTransport } = await import('@omnitron-dev/titan/netron/transport/tcp');
        const { createNullLogger } = await import('@omnitron-dev/titan/module/logger');

        const probeNetron = new Netron(createNullLogger(), { id: `probe-${node.host}` });
        probeNetron.registerTransport('tcp', () => new TcpTransport());

        const connectStart = Date.now();
        const peer = await Promise.race([
          probeNetron.connect(`tcp://${node.host}:${port}`, false),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), this.checkConfig.omnitronCheckTimeout)),
        ]);

        // Ping via OmnitronDaemon service
        const daemon = await (peer as any).queryInterface('OmnitronDaemon');
        const info = await daemon.ping();
        const latency = Date.now() - connectStart;

        status.omnitronConnected = true;
        status.sshConnected = false; // SSH not checked
        status.sshLatencyMs = null;
        if (info?.version) status.omnitronVersion = info.version;
        if (info?.pid) status.omnitronPid = info.pid;
        if (info?.uptime) status.omnitronUptime = info.uptime;

        this.logger.debug(
          { node: node.name, host: node.host, latencyMs: latency, version: info?.version },
          'Node check: Netron TCP ping OK'
        );

        // Disconnect probe — SlaveConnector manages persistent connections
        await probeNetron.stop();
      } catch (err) {
        status.omnitronConnected = false;
        this.logger.debug(
          { node: node.name, host: node.host, port, error: (err as Error).message },
          'Node check: Netron TCP ping failed'
        );
      }
    }

    this.statusCache.set(id, status);
    this.emit('node:status', id, status);
    return status;
  }

  /** Convert node to SSH target — used for manual SSH checks from UI */
  async nodeToSshTarget(node: INode): Promise<import('../execution/execution.service.js').SSHTarget> {
    const target: import('../execution/execution.service.js').SSHTarget = {
      host: node.host,
      port: node.sshPort,
      username: node.sshUser,
    };
    if (node.sshPrivateKey) {
      target.privateKey = readKeyFile(node.sshPrivateKey);
    }
    if (node.hasPassphrase) {
      const passphrase = await this.getSecret(node.id, 'passphrase');
      if (passphrase) target.passphrase = passphrase;
    }
    if (node.hasPassword) {
      const password = await this.getSecret(node.id, 'password');
      if (password) target.password = password;
    }
    return target;
  }

  async checkAllNodes(): Promise<INodeStatus[]> {
    const results: INodeStatus[] = [];
    for (const node of this.nodes.values()) {
      try {
        const status = await this.checkNodeStatus(node.id);
        results.push(status);
      } catch (err) {
        this.logger.warn({ nodeId: node.id, error: (err as Error).message }, 'Failed to check node');
      }
    }
    return results;
  }

  // ===========================================================================
  // Worker Integration
  // ===========================================================================

  /**
   * Update the in-memory status cache from health-monitor worker summaries.
   * Called by daemon when worker sends IPC status batch.
   */
  updateStatusCacheFromWorker(summaries: INodeHealthSummary[]): void {
    for (const summary of summaries) {
      if (!summary.lastCheck) continue;
      const check = summary.lastCheck;
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
      this.statusCache.set(summary.nodeId, status);
      this.emit('node:status', summary.nodeId, status);
    }
  }

  /**
   * Convert current node list to serializable check targets for the worker.
   * Resolves secrets so the worker can use them directly.
   */
  async getNodeCheckTargets(): Promise<INodeCheckTarget[]> {
    const targets: INodeCheckTarget[] = [];
    for (const node of this.nodes.values()) {
      const target: INodeCheckTarget = {
        id: node.id,
        name: node.name,
        host: node.host,
        sshPort: node.sshPort,
        sshUser: node.sshUser,
        sshAuthMethod: node.sshAuthMethod,
        runtime: node.runtime,
        daemonPort: node.daemonPort,
        isLocal: node.isLocal,
        offlineTimeout: node.offlineTimeout ?? null,
      };
      // Resolve key content from file path
      if (node.sshPrivateKey) {
        target.sshPrivateKey = readKeyFile(node.sshPrivateKey);
      }
      // Resolve secrets — worker needs plaintext values for SSH
      if (node.hasPassphrase) {
        const val = await this.getSecret(node.id, 'passphrase');
        if (val) target.sshPassphrase = val;
      }
      if (node.hasPassword) {
        const val = await this.getSecret(node.id, 'password');
        if (val) target.sshPassword = val;
      }
      targets.push(target);
    }
    return targets;
  }

  // ===========================================================================
  // Secrets Helpers
  // ===========================================================================

  private secretKey(nodeId: string, field: string): string {
    return `node:${nodeId}:${field}`;
  }

  private async getSecret(nodeId: string, field: string): Promise<string | null> {
    if (!this.secrets) return null;
    try {
      return await this.secrets.get(this.secretKey(nodeId, field));
    } catch {
      return null;
    }
  }

  private async setSecret(nodeId: string, field: string, value: string): Promise<void> {
    if (!this.secrets) {
      this.logger.warn({ nodeId, field }, 'SecretsService not available — secret not stored');
      return;
    }
    await this.secrets.set(this.secretKey(nodeId, field), value);
  }

  private async deleteSecret(nodeId: string, field: string): Promise<void> {
    if (!this.secrets) return;
    try {
      await this.secrets.delete(this.secretKey(nodeId, field));
    } catch { /* non-critical */ }
  }

  /**
   * Status of the machine this daemon runs on.
   *
   * We ARE the daemon — no RPC or socket needed, just read process info, and
   * read it now rather than at construction. The version came from a string
   * literal `'0.1.0'` while the package was at 0.2.0, so the fleet view
   * reported a version the daemon has never been; it is `CLI_VERSION` now,
   * the same source `omnitron status` uses.
   *
   * The role is `master` unconditionally, and that is correct rather than
   * lazy: this service is only constructed on a non-slave daemon.
   */
  private localStatus(): INodeStatus {
    return {
      nodeId: LOCAL_NODE_ID,
      pingReachable: true,
      pingLatencyMs: 0,
      sshConnected: true,
      sshLatencyMs: 0,
      omnitronConnected: true,
      omnitronVersion: CLI_VERSION,
      omnitronPid: process.pid,
      omnitronUptime: process.uptime() * 1000,
      omnitronRole: 'master',
      os: {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        release: os.release(),
      },
      checkedAt: new Date().toISOString(),
    };
  }

  // ===========================================================================
  // Persistence
  // ===========================================================================

  private load(): void {
    try {
      // First-pass: read from SQLite. Each row's `metadata` column
      // holds the full INode JSON; the denormalised columns are for
      // future queries (status filters, by-host lookups, etc.).
      const rows = this.store.selectNodesSync();
      for (const row of rows) {
        if (!row.metadata) continue;
        try {
          const node = JSON.parse(row.metadata) as INode;
          this.nodes.set(node.id, node);
        } catch {
          // Corrupt row — skip and let the next mutation overwrite.
        }
      }

      // One-shot legacy import. If the SQLite table is empty but the
      // pre-T-7 nodes.json file exists, migrate it in-place. The
      // existing file is then unlinked so subsequent boots skip the
      // branch.
      if (this.nodes.size === 0 && fs.existsSync(NODES_FILE)) {
        try {
          const data = JSON.parse(fs.readFileSync(NODES_FILE, 'utf-8'));
          if (Array.isArray(data.nodes)) {
            for (const node of data.nodes) {
              this.nodes.set(node.id, node);
              this.persistNode(node);
            }
          }
          try { fs.unlinkSync(NODES_FILE); } catch { /* best-effort */ }
        } catch (err) {
          this.logger.warn({ error: (err as Error).message }, 'Legacy nodes.json migration failed — leaving file in place');
        }
      }
    } catch (err) {
      this.logger.warn({ error: (err as Error).message }, 'Failed to load nodes from store');
    }
  }

  /**
   * Persist a single node to SQLite. Called on add / update /
   * status-touch. Pre-T-7 every mutation rewrote the entire
   * registry JSON file; now it's a single atomic UPSERT.
   */
  private persistNode(node: INode): void {
    try {
      this.store.upsertNodeSync({
        id: node.id,
        name: node.name,
        host: node.host,
        port: node.daemonPort,
        role: node.isLocal ? 'master' : 'slave',
        metadata: node as unknown as Record<string, unknown>,
      });
    } catch (err) {
      this.logger.warn({ id: node.id, error: (err as Error).message }, 'Failed to persist node');
    }
  }

  /**
   * Persist every node currently held in memory. Used after a
   * batch mutation that affected multiple rows (the previous
   * fs.writeFileSync semantics).
   */
  private save(): void {
    for (const node of this.nodes.values()) {
      this.persistNode(node);
    }
  }

  private ensureLocalNode(): void {
    if (this.nodes.has(LOCAL_NODE_ID)) return;
    const now = new Date().toISOString();
    this.nodes.set(LOCAL_NODE_ID, {
      id: LOCAL_NODE_ID,
      name: 'Local Machine',
      host: '127.0.0.1',
      sshPort: 22,
      sshUser: os.userInfo().username,
      sshAuthMethod: 'key',
      runtime: 'node',
      daemonPort: 9700,
      tags: ['local'],
      isLocal: true,
      createdAt: now,
      updatedAt: now,
    });
    this.save();
  }

  async dispose(): Promise<void> {
    await this.remoteOps.dispose();
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Read SSH private key file contents.
 * If the value is already key content (starts with -----BEGIN), return as-is.
 * Otherwise treat as file path and read.
 */
function readKeyFile(pathOrContent: string): string {
  if (pathOrContent.startsWith('-----BEGIN') || pathOrContent.startsWith('-----')) {
    return pathOrContent;
  }
  try {
    return fs.readFileSync(pathOrContent, 'utf-8');
  } catch {
    return pathOrContent;
  }
}
