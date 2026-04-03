/**
 * NodeManagerService — Manages infrastructure nodes (machines)
 *
 * File-based storage at ~/.omnitron/nodes.json (no PG dependency).
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
import type { INodeHealthSummary, INodeCheckTarget } from '../workers/types.js';
import type { SecretsService } from './secrets.service.js';

// =============================================================================
// Types
// =============================================================================

export interface INode {
  id: string;
  name: string;
  host: string;
  sshPort: number;
  sshUser: string;
  sshAuthMethod: 'password' | 'key';
  sshPrivateKey?: string;
  /** Whether an encrypted passphrase is stored in secrets.enc */
  hasPassphrase?: boolean;
  /** Whether an SSH password is stored in secrets.enc */
  hasPassword?: boolean;
  /** Runtime to install/use on remote nodes */
  runtime: 'node' | 'bun';
  /** Omnitron daemon port on this node */
  daemonPort: number;
  /** Tags for filtering/grouping */
  tags: string[];
  /** Whether this is the local machine (cannot be deleted) */
  isLocal: boolean;
  /** When the node was added */
  createdAt: string;
  /** Last modification */
  updatedAt: string;
  /** Per-node offline timeout in ms (null = use global default) */
  offlineTimeout?: number | null;
}

export interface INodeStatus {
  nodeId: string;
  pingReachable: boolean;
  pingLatencyMs: number | null;
  pingError?: string;
  sshConnected: boolean;
  sshLatencyMs: number | null;
  sshError?: string;
  omnitronConnected: boolean;
  omnitronVersion?: string;
  omnitronPid?: number;
  omnitronUptime?: number;
  omnitronRole?: 'master' | 'slave';
  omnitronError?: string;
  /** OS info from remote node */
  os?: { platform: string; arch: string; hostname: string; release: string };
  checkedAt: string;
}

export interface INodeWithStatus extends INode {
  status: INodeStatus | null;
}

export interface AddNodeInput {
  name: string;
  host: string;
  sshPort?: number;
  sshUser?: string;
  sshAuthMethod?: 'password' | 'key';
  sshPrivateKey?: string;
  /** Passphrase for encrypted SSH key (will be encrypted in secrets.enc) */
  sshPassphrase?: string;
  /** SSH password auth (will be encrypted in secrets.enc) */
  sshPassword?: string;
  runtime?: 'node' | 'bun';
  daemonPort?: number;
  tags?: string[];
  offlineTimeout?: number | null;
}

export interface UpdateNodeInput {
  name?: string;
  host?: string;
  sshPort?: number;
  sshUser?: string;
  sshAuthMethod?: 'password' | 'key';
  sshPrivateKey?: string;
  /** Passphrase for encrypted SSH key (will be encrypted in secrets.enc) */
  sshPassphrase?: string;
  /** SSH password auth (will be encrypted in secrets.enc) */
  sshPassword?: string;
  runtime?: 'node' | 'bun';
  daemonPort?: number;
  tags?: string[];
  offlineTimeout?: number | null;
}

export interface SshKeyInfo {
  name: string;
  path: string;
  type: string;
}

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
    private readonly secrets?: SecretsService,
  ) {
    super();
    this.remoteOps = new RemoteOpsService(logger);
    this.load();
    this.ensureLocalNode();
    this.initLocalStatus();
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
      status: this.statusCache.get(node.id) ?? null,
    }));
  }

  getNode(id: string): INodeWithStatus | null {
    const node = this.nodes.get(id);
    if (!node) return null;
    return { ...node, status: this.statusCache.get(id) ?? null };
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
    // Check connectivity in background — secrets are already persisted
    void this.checkNodeStatus(id).catch(() => {});
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
      void this.checkNodeStatus(id).catch(() => {});
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
        if (val) target.sshPassphrase = val; // password auth as passphrase for xec
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
   * Synchronously populate local node status at construction time.
   * We ARE the daemon — no RPC/socket needed, just read process info.
   */
  private initLocalStatus(): void {
    this.statusCache.set(LOCAL_NODE_ID, {
      nodeId: LOCAL_NODE_ID,
      pingReachable: true,
      pingLatencyMs: 0,
      sshConnected: true,
      sshLatencyMs: 0,
      omnitronConnected: true,
      omnitronVersion: '0.1.0',
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
    });
  }

  // ===========================================================================
  // Persistence
  // ===========================================================================

  private load(): void {
    try {
      if (fs.existsSync(NODES_FILE)) {
        const data = JSON.parse(fs.readFileSync(NODES_FILE, 'utf-8'));
        if (Array.isArray(data.nodes)) {
          for (const node of data.nodes) {
            this.nodes.set(node.id, node);
          }
        }
      }
    } catch (err) {
      this.logger.warn({ error: (err as Error).message }, 'Failed to load nodes file');
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(NODES_FILE), { recursive: true });
      const data = { nodes: Array.from(this.nodes.values()) };
      fs.writeFileSync(NODES_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.warn({ error: (err as Error).message }, 'Failed to save nodes file');
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
