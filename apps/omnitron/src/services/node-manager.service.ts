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
import {
  RemoteOpsService,
  type NodeCheckConfig,
  DEFAULT_CHECK_CONFIG,
  normalizeCheckConfig,
  assertNodeHost,
} from './remote-ops.service.js';
import { CLI_VERSION } from '../config/defaults.js';
import type { INodeHealthSummary, INodeCheckTarget, NodeHealthStatus } from '../workers/types.js';
import type { SecretsService } from './secrets.service.js';
import type {
  INode,
  INodeStatus,
  INodeWithStatus,
  AddNodeInput,
  UpdateNodeInput,
  SshKeyInfo,
  FleetHistoryConfig,
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
  FleetHistoryConfig,
} from '../shared/dto/nodes.js';

/** A node's health status changing from one value to another. */
export interface NodeHealthTransition {
  nodeId: string;
  status: NodeHealthStatus;
  previousStatus: NodeHealthStatus | null;
}

// =============================================================================
// Constants
// =============================================================================

const OMNITRON_HOME = path.join(os.homedir(), '.omnitron');
const NODES_FILE = path.join(OMNITRON_HOME, 'nodes.json');
const LOCAL_NODE_ID = 'local';

/** DaemonStateStore key holding the operator-set check configuration. */
const CHECK_CONFIG_KEY = 'nodes:check-config';

// =============================================================================
// Service
// =============================================================================

export class NodeManagerService extends EventEmitter {
  private nodes: Map<string, INode> = new Map();
  private statusCache: Map<string, INodeStatus> = new Map();
  /**
   * Aggregated health per node — the shape the worker reports and the console
   * reads. Kept here so a daemon whose worker is down can still answer
   * `triggerNodeCheck`, and so status TRANSITIONS have something to compare
   * against: `node.went_offline` and its siblings are declared event channels
   * that nothing ever emitted, because no one held the previous value.
   */
  private summaryCache: Map<string, INodeHealthSummary> = new Map();
  private readonly remoteOps: RemoteOpsService;
  private checkConfig: NodeCheckConfig = DEFAULT_CHECK_CONFIG;
  /** Set by the daemon from its own config; see `setHistoryConfig`. */
  private historyConfig: FleetHistoryConfig = { uptimeIntervalMs: 86_400_000, retentionDays: 90 };
  /**
   * Secrets read out of a node row and not yet written to the vault.
   *
   * The migration in `healLeakedSecrets` is async and starts at construction;
   * without this, a check running in that window would find no passphrase and
   * report a perfectly reachable node as unreachable.
   */
  private pendingSecrets = new Map<string, string>();

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

  /**
   * Update check configuration (ping/SSH timeouts, ping enabled/disabled).
   *
   * Persisted and announced. Both were missing: the setting lived in this
   * field alone, so it was lost on restart, and the health-monitor worker —
   * which performs every check the console displays — kept running with the
   * values it was handed at boot. An operator turning ping off in the console
   * changed a value that only the daemon's own fallback path ever read.
   */
  setCheckConfig(config: Partial<NodeCheckConfig>): void {
    const next = normalizeCheckConfig({ ...this.checkConfig, ...config });
    const changed = (Object.keys(next) as Array<keyof NodeCheckConfig>)
      .some((k) => next[k] !== this.checkConfig[k]);
    this.checkConfig = next;
    if (!changed) return;

    try {
      this.store.kvSetSync(CHECK_CONFIG_KEY, next);
    } catch (err) {
      this.logger.warn({ error: (err as Error).message }, 'Failed to persist node check config');
    }
    this.logger.info({ config: next }, 'Node check config updated');
    this.emit('checkConfig:changed', next);
  }

  getCheckConfig(): NodeCheckConfig {
    return { ...this.checkConfig };
  }

  /**
   * Tell the service how history is kept, so the console can be told too.
   *
   * `uptimeIntervalMs` was declared in the daemon config, documented, given a
   * default — and read by nothing. The console used a constant of its own,
   * and no caller anywhere could have discovered the retention window that
   * bounds what the bars can show.
   */
  setHistoryConfig(config: Partial<FleetHistoryConfig>): void {
    if (Number.isFinite(config.uptimeIntervalMs)) {
      this.historyConfig.uptimeIntervalMs = config.uptimeIntervalMs as number;
    }
    if (Number.isFinite(config.retentionDays)) {
      this.historyConfig.retentionDays = config.retentionDays as number;
    }
  }

  getHistoryConfig(): FleetHistoryConfig {
    return { ...this.historyConfig };
  }

  // ===========================================================================
  // CRUD
  // ===========================================================================

  listNodes(): INodeWithStatus[] {
    return Array.from(this.nodes.values()).map((node) => ({
      ...toWireNode(node),
      status: this.statusFor(node.id),
    }));
  }

  getNode(id: string): INodeWithStatus | null {
    const node = this.nodes.get(id);
    if (!node) return null;
    return { ...toWireNode(node), status: this.statusFor(id) };
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

  /**
   * One row per daemon.
   *
   * `host` plus `daemonPort` names a DAEMON, and two registry rows naming
   * the same one are always a mistake — there is no second thing there to
   * manage. Two daemons on one machine are two ports, and those are still
   * allowed.
   *
   * It was worth every cost it caused, all measured on one machine that had
   * been registered twice:
   *
   *   - the health monitor checked it on both rows, 120 connections an hour
   *     to one socket;
   *   - `fleet upgrade` transferred and installed the bundle to it twice;
   *   - the mesh holds one connection per ADDRESS, so exactly one of the two
   *     rows receives the node's data and the other reads "not joined"
   *     forever — and which one is arbitrary.
   *
   * Refused rather than merged: the existing row may carry credentials,
   * tags and history, and picking which of two to keep is the operator's
   * call, not this function's.
   */
  private assertAddressIsFree(host: string, daemonPort: number, exceptId?: string): void {
    for (const existing of this.nodes.values()) {
      if (existing.id === exceptId) continue;
      if (existing.host !== host || existing.daemonPort !== daemonPort) continue;
      throw new Error(
        `${host}:${daemonPort} is already registered as "${existing.name}". ` +
          'One row per daemon — edit that node, or give this one a different daemon port.',
      );
    }
  }

  async addNode(input: AddNodeInput): Promise<INode> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const node: INode = {
      id,
      name: input.name,
      // A host is not free text: it is spelled into an SSH target and into
      // the argument list of `ping`. Rejected at the WRITE so a stored value
      // cannot surprise a reader downstream.
      host: assertNodeHost(input.host),
      sshPort: assertPort('SSH port', input.sshPort ?? 22),
      sshUser: input.sshUser ?? 'root',
      sshAuthMethod: input.sshAuthMethod ?? 'key',
      ...(input.sshPrivateKey && { sshPrivateKey: input.sshPrivateKey }),
      runtime: input.runtime ?? 'node',
      daemonPort: assertPort('daemon port', input.daemonPort ?? 9700),
      tags: input.tags ?? [],
      isLocal: false,
      createdAt: now,
      updatedAt: now,
      ...(input.offlineTimeout != null && { offlineTimeout: input.offlineTimeout }),
    };
    if (!node.name.trim()) throw new Error('Node name is required');
    this.assertAddressIsFree(node.host, node.daemonPort);

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
    if (safeInput.host !== undefined) safeInput.host = assertNodeHost(safeInput.host);
    if (safeInput.sshPort !== undefined) safeInput.sshPort = assertPort('SSH port', safeInput.sshPort);
    if (safeInput.daemonPort !== undefined) safeInput.daemonPort = assertPort('daemon port', safeInput.daemonPort);

    const updated: INode = {
      ...node,
      ...safeInput,
      id: node.id,
      isLocal: node.isLocal,
      createdAt: node.createdAt,
      updatedAt: new Date().toISOString(),
    };

    // An edit can collide as readily as an add — correcting one node's host
    // to the address another already holds is exactly how a duplicate gets
    // made. Checked before any secret is written, so a refused edit leaves
    // nothing behind.
    //
    // Only when the edit MOVES the row. A registry that already holds two
    // rows for one daemon — made before this rule existed — refused every
    // edit to either of them, including the one that would have repaired it:
    //
    //     omnitron node update <id> --ssh-auth password
    //     37.27.130.185:9700 is already registered as "acme-deploy-test"
    //
    // The guard exists to stop a duplicate being CREATED. Refusing an edit
    // that changes neither the host nor the port cannot prevent one, and it
    // leaves an operator with a registry they can neither use nor mend.
    const addressChanged = updated.host !== node.host || updated.daemonPort !== node.daemonPort;
    if (addressChanged) {
      this.assertAddressIsFree(updated.host, updated.daemonPort, id);
    }

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

    // A credential that belongs to the other auth method is dead weight that
    // still authenticates: leaving a stored password on a node switched to
    // key auth means the console shows "SSH Key" while the daemon may log in
    // with a password the operator believes they stopped using.
    if (updated.sshAuthMethod !== node.sshAuthMethod) {
      if (updated.sshAuthMethod === 'key' && updated.hasPassword) {
        updated.hasPassword = false;
        await this.deleteSecret(id, 'password');
      }
      if (updated.sshAuthMethod === 'password') {
        delete updated.sshPrivateKey;
        if (updated.hasPassphrase) {
          updated.hasPassphrase = false;
          await this.deleteSecret(id, 'passphrase');
        }
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

  /**
   * Remove a node from the registry.
   *
   * Deletes the ROW, not just the map entry. `save()` rewrites every node
   * still held in memory, which is how the file-backed registry used to
   * express a deletion — but an UPSERT-per-row store expresses it by
   * deleting, and the row for a removed node stayed behind. The console
   * reported the node gone, and the next daemon start read it back in.
   *
   * Secret deletion is awaited for the same reason: fired and forgotten, a
   * failure left an SSH password in the vault under the id of a node nobody
   * can see any more.
   */
  async removeNode(id: string): Promise<void> {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Node not found: ${id}`);
    if (node.isLocal) throw new Error('Cannot remove local node');

    // Clean up encrypted secrets
    await this.deleteSecret(id, 'passphrase');
    await this.deleteSecret(id, 'password');

    this.nodes.delete(id);
    this.statusCache.delete(id);
    this.summaryCache.delete(id);
    try {
      this.store.deleteNodeSync(id);
    } catch (err) {
      this.logger.warn({ nodeId: id, error: (err as Error).message }, 'Failed to delete node row');
      throw err;
    }
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

      // Check if it looks like a private key (starts with -----BEGIN).
      // Read the HEADER, not the file: this walks a directory of private
      // keys, and `readFileSync(...).slice(0, 100)` pulled every byte of
      // every one of them into the daemon's heap to look at the first line.
      let head: string;
      try {
        head = readFileHead(fullPath, 100);
      } catch {
        continue; // Can't read — skip
      }
      if (head.includes('-----BEGIN') && head.includes('KEY')) {
        // Detect key type from header
        let type = 'unknown';
        if (head.includes('RSA')) type = 'rsa';
        else if (head.includes('EC')) type = 'ecdsa';
        else if (head.includes('OPENSSH')) type = 'ed25519';
        else if (head.includes('DSA')) type = 'dsa';

        keys.push({ name: entry, path: fullPath, type });
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
      // Not `false`: this check does not open an SSH session at all, and
      // `false` reads as "SSH was refused" everywhere it is consumed.
      sshConnected: null,
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
      status.omnitronVersion = CLI_VERSION;
      status.os = {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        release: os.release(),
      };
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
      let probeNetron: { stop(): Promise<void> } | null = null;
      try {
        const { Netron } = await import('@omnitron-dev/titan/netron');
        const { TcpTransport } = await import('@omnitron-dev/titan/netron/transport/tcp');
        const { createNullLogger } = await import('@omnitron-dev/titan/module/logger');

        const probe = new Netron(createNullLogger(), { id: `probe-${node.host}` });
        probeNetron = probe;
        probe.registerTransport('tcp', () => new TcpTransport());

        const connectStart = Date.now();
        const peer = await withTimeout(
          probe.connect(`tcp://${node.host}:${port}`, false),
          this.checkConfig.omnitronCheckTimeout,
        );

        // Ping via OmnitronDaemon service
        const daemon = await (peer as any).queryInterface('OmnitronDaemon');
        const info = await daemon.ping();
        const latency = Date.now() - connectStart;

        status.omnitronConnected = true;
        status.sshLatencyMs = null;
        if (info?.version) status.omnitronVersion = info.version;
        if (info?.pid) status.omnitronPid = info.pid;
        if (info?.uptime) status.omnitronUptime = info.uptime;

        this.logger.debug(
          { node: node.name, host: node.host, latencyMs: latency, version: info?.version },
          'Node check: Netron TCP ping OK'
        );
      } catch (err) {
        status.omnitronConnected = false;
        status.omnitronError = (err as Error).message;
        this.logger.debug(
          { node: node.name, host: node.host, port, error: (err as Error).message },
          'Node check: Netron TCP ping failed'
        );
      } finally {
        // Stop the probe on EVERY path. It only ran on success, so each
        // failed check — the common case for an offline node, once a minute,
        // for ever — left a Netron instance with a registered TCP transport
        // behind in the daemon.
        if (probeNetron) {
          try {
            await probeNetron.stop();
          } catch { /* the probe is being discarded either way */ }
        }
      }
    }

    this.recordStatus(node, status);
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

  /**
   * Convert a registered node into something the deployer can reach.
   *
   * The bridge between the two registries. An operator registers machines
   * here, in the console; deployment reads `stacks.nodes` out of a project
   * config. Nothing joined them, which is half of why a machine added in the
   * console could not be deployed to — the other half being that the deployer
   * could not have used this node's credentials even if it had been handed
   * one: it shelled out to `ssh -o BatchMode=yes`, and what this method
   * returns is a password.
   *
   * The credentials come from `nodeToSshTarget`, which the manual SSH check
   * already uses, so there is one place that knows how to unlock a node and
   * both callers use it.
   */
  async nodeToDeployTarget(
    id: string,
  ): Promise<import('./remote-deployer.service.js').DeployTarget> {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Node not found: ${id}`);
    if (node.isLocal) {
      // Not a refusal on principle — a local daemon is deployed to by running
      // omnitron, not by SSHing to yourself — but a refusal that says so,
      // rather than a loopback SSH that fails for a reason the operator then
      // has to work out.
      throw new Error('The local node is this daemon; it is not deployed to over SSH.');
    }

    const ssh = await this.nodeToSshTarget(node);
    const target: import('./remote-deployer.service.js').DeployTarget = {
      host: ssh.host,
      label: node.name,
      daemonPort: node.daemonPort ?? 9700,
    };
    if (ssh.port != null) target.sshPort = ssh.port;
    if (ssh.username) target.username = ssh.username;
    if (ssh.privateKey) target.privateKey = ssh.privateKey;
    if (ssh.passphrase) target.passphrase = ssh.passphrase;
    if (ssh.password) target.password = ssh.password;
    return target;
  }

  /**
   * Check every node.
   *
   * Concurrent, bounded by the same `concurrency` the worker uses. It was a
   * `for` loop with an `await` in it, so a fleet of twenty nodes with one
   * unreachable host took the ping timeout plus the TCP timeout SERIALLY —
   * twenty seconds of a thirty-second check interval spent on one node.
   */
  async checkAllNodes(): Promise<INodeStatus[]> {
    const ids = Array.from(this.nodes.keys());
    const results: INodeStatus[] = [];
    const width = Math.max(1, this.checkConfig.concurrency);

    for (let i = 0; i < ids.length; i += width) {
      const batch = ids.slice(i, i + width);
      const settled = await Promise.allSettled(batch.map((id) => this.checkNodeStatus(id)));
      settled.forEach((r, idx) => {
        if (r.status === 'fulfilled') {
          results.push(r.value);
        } else {
          this.logger.warn(
            { nodeId: batch[idx], error: (r.reason as Error)?.message },
            'Failed to check node',
          );
        }
      });
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
      this.setSummary(summary);
    }
  }

  /**
   * Aggregated health, for a daemon serving checks without the worker.
   *
   * `triggerNodeCheck` used to return `[]` when the worker was absent, and an
   * empty array on a page whose subject is the fleet reads as "no nodes".
   */
  getHealthSummaries(nodeId?: string): INodeHealthSummary[] {
    if (nodeId) {
      const one = this.summaryCache.get(nodeId);
      return one ? [one] : [];
    }
    return Array.from(this.summaryCache.values());
  }

  /**
   * Note that the health worker could not be reached.
   *
   * Called by the RPC layer when a worker call throws. The daemon re-spawns
   * the worker; this exists so the reason appears once, in the daemon's log,
   * rather than only in the error text of whichever console button was pressed.
   */
  reportWorkerUnavailable(method: string, err: Error): void {
    this.logger.warn(
      { method, error: err.message },
      'Health monitor worker unavailable — serving this check from the daemon',
    );
    this.emit('worker:unavailable', method, err);
  }

  /** Report a non-fatal failure in node bookkeeping, with the reason. */
  reportProblem(operation: string, err: Error): void {
    this.logger.warn({ operation, error: err.message }, 'Node maintenance step failed');
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

  /** The vault's own answer, with no in-memory fallback. */
  private async readVault(nodeId: string, field: string): Promise<string | null> {
    if (!this.secrets) return null;
    try {
      return await this.secrets.get(this.secretKey(nodeId, field));
    } catch {
      return null;
    }
  }

  private async getSecret(nodeId: string, field: string): Promise<string | null> {
    const key = this.secretKey(nodeId, field);
    if (this.secrets) {
      try {
        const stored = await this.secrets.get(key);
        if (stored) return stored;
      } catch { /* fall through to the pending value, if any */ }
    }
    return this.pendingSecrets.get(key) ?? null;
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
  // Status bookkeeping
  // ===========================================================================

  /** Record a check this service performed, and derive its health summary. */
  private recordStatus(node: INode, status: INodeStatus): void {
    this.statusCache.set(node.id, status);
    this.emit('node:status', node.id, status);

    const previous = this.summaryCache.get(node.id);
    const reachable = status.sshConnected || status.pingReachable || status.omnitronConnected;
    const offlineTimeout = node.offlineTimeout ?? DEFAULT_OFFLINE_TIMEOUT_MS;

    let health: NodeHealthStatus;
    if (status.omnitronConnected) {
      health = 'online';
    } else if (reachable) {
      health = 'degraded';
    } else {
      const lastSeen = previous?.lastSeenOnline;
      health = lastSeen && Date.now() - Date.parse(lastSeen) < offlineTimeout ? 'degraded' : 'offline';
    }

    this.setSummary({
      nodeId: node.id,
      status: health,
      lastCheck: {
        nodeId: node.id,
        checkedAt: status.checkedAt,
        checkDurationMs: 0,
        pingReachable: status.pingReachable,
        pingLatencyMs: status.pingLatencyMs,
        pingError: status.pingError ?? null,
        sshConnected: status.sshConnected,
        sshLatencyMs: status.sshLatencyMs,
        sshError: status.sshError ?? null,
        omnitronConnected: status.omnitronConnected,
        omnitronVersion: status.omnitronVersion ?? null,
        omnitronPid: status.omnitronPid ?? null,
        omnitronUptime: status.omnitronUptime ?? null,
        omnitronRole: status.omnitronRole ?? null,
        omnitronError: status.omnitronError ?? null,
        os: status.os ?? null,
      },
      lastSeenOnline: reachable ? status.checkedAt : (previous?.lastSeenOnline ?? null),
      consecutiveFailures: reachable ? 0 : (previous?.consecutiveFailures ?? 0) + 1,
    });
  }

  /**
   * Store a summary, write it to the row, and announce a change of state.
   *
   * `nodes.status` and `nodes.last_heartbeat` are columns the schema declares,
   * `selectNodesSync` reads back, and nothing ever wrote: every row on a live
   * daemon said `status = 'unknown'` with a null heartbeat, because the only
   * writer — `touchNodeHeartbeatSync` — had no callers. The upsert filled
   * them with its own `'unknown'` default on every save.
   *
   * What this buys beyond tidiness: `lastSeenOnline` survives a daemon
   * restart, so the offline grace period is measured from when the node was
   * actually last seen rather than from boot.
   */
  private setSummary(summary: INodeHealthSummary): void {
    const previous = this.summaryCache.get(summary.nodeId) ?? null;
    this.summaryCache.set(summary.nodeId, summary);

    try {
      this.store.touchNodeHeartbeatSync(
        summary.nodeId,
        summary.status,
        summary.lastCheck?.checkedAt ?? new Date().toISOString(),
      );
    } catch { /* the in-memory answer is still correct */ }

    if (previous?.status === summary.status) return;
    const transition: NodeHealthTransition = {
      nodeId: summary.nodeId,
      status: summary.status,
      previousStatus: previous?.status ?? null,
    };
    this.emit('node:health', transition);
  }

  // ===========================================================================
  // Persistence
  // ===========================================================================

  private load(): void {
    /** Rows found carrying a plaintext secret; healed after the loop. */
    const leaked: Array<{ node: INode; strays: Array<{ field: 'passphrase' | 'password'; value: string }> }> = [];

    try {
      // First-pass: read from SQLite. Each row's `metadata` column
      // holds the full INode JSON; the denormalised columns are for
      // future queries (status filters, by-host lookups, etc.).
      const rows = this.store.selectNodesSync();
      for (const row of rows) {
        if (!row.metadata) continue;
        try {
          const raw = JSON.parse(row.metadata) as INode & { sshPassphrase?: string; sshPassword?: string };
          const { node, strays } = splitStoredSecrets(raw);
          this.nodes.set(node.id, node);
          if (strays.length > 0) {
            for (const stray of strays) this.pendingSecrets.set(this.secretKey(node.id, stray.field), stray.value);
            leaked.push({ node, strays });
          }
          // Restore the last known health, but NOT a status reading: a
          // reachability answer from a previous daemon is not a current one,
          // and the console has no way to tell them apart on the dots. What
          // is worth keeping is when the node was last up, which is what the
          // offline grace period is measured against.
          if (row.status && row.status !== 'unknown') {
            this.summaryCache.set(node.id, {
              nodeId: node.id,
              status: row.status as NodeHealthStatus,
              lastCheck: null,
              lastSeenOnline: row.status === 'offline' ? null : row.last_heartbeat ?? null,
              consecutiveFailures: 0,
            });
          }
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

    if (leaked.length > 0) void this.healLeakedSecrets(leaked);

    this.loadCheckConfig();
  }

  /**
   * Move a plaintext secret out of a node row and into the vault.
   *
   * Observed on a live daemon: a node row whose `metadata` JSON contained
   * `"sshPassphrase": "<the operator's actual passphrase>"` next to
   * `"hasPassphrase": true`. An older `updateNode` spread its whole input
   * into the node — the destructure that stops that was added afterwards, and
   * it fixed new writes without touching rows already written. `listNodes`
   * then spread the parsed row onto the wire, so the passphrase went to every
   * caller with the VIEWER role, and to `omnitron node list`.
   *
   * Two things are needed and they are not the same: the wire shape is now
   * built field by field (`toWireNode`), which stops the leak for any
   * residue, present or future; and this moves the value to where it should
   * have been, so the row itself stops holding it.
   */
  private async healLeakedSecrets(
    leaked: Array<{ node: INode; strays: Array<{ field: 'passphrase' | 'password'; value: string }> }>,
  ): Promise<void> {
    for (const { node, strays } of leaked) {
      for (const { field, value } of strays) {
        this.logger.warn(
          { nodeId: node.id, field },
          'Node row held a plaintext SSH secret — moving it to the secret store',
        );
        // Read the VAULT, not `getSecret`: that one falls back to
        // `pendingSecrets`, which is where this value already is — so asking
        // it whether the secret is stored answers "yes" about the copy we are
        // trying to store, and the write never happens.
        const existing = await this.readVault(node.id, field);
        if (!existing) {
          if (!this.secrets) {
            // Nothing to migrate into. The row keeps the value for now — the
            // node would otherwise stop authenticating — but it no longer
            // reaches the wire, which is the part that matters.
            this.logger.error(
              { nodeId: node.id, field },
              'No secret store available — plaintext secret left in the node row',
            );
            continue;
          }
          await this.setSecret(node.id, field, value);
        }
      }
      // Rewrite the row from the sanitised node.
      this.persistNode(node);
      for (const { field } of strays) this.pendingSecrets.delete(this.secretKey(node.id, field));
    }
  }

  /** Restore the operator's check configuration, if one was ever set. */
  private loadCheckConfig(): void {
    try {
      const stored = this.store.kvGetSync<Partial<NodeCheckConfig>>(CHECK_CONFIG_KEY);
      if (!stored) return;
      this.checkConfig = normalizeCheckConfig({ ...DEFAULT_CHECK_CONFIG, ...stored });
    } catch (err) {
      this.logger.warn({ error: (err as Error).message }, 'Failed to load node check config — using defaults');
    }
  }

  /**
   * Persist a single node to SQLite. Called on add / update /
   * status-touch. Pre-T-7 every mutation rewrote the entire
   * registry JSON file; now it's a single atomic UPSERT.
   */
  private persistNode(node: INode): void {
    try {
      // Carry the status forward. `upsertNodeSync` defaults it to `'unknown'`,
      // so a `save()` triggered by an unrelated edit used to erase what the
      // last check had established.
      const known = this.summaryCache.get(node.id);
      this.store.upsertNodeSync({
        id: node.id,
        name: node.name,
        host: node.host,
        port: node.daemonPort,
        role: node.isLocal ? 'master' : 'slave',
        status: known?.status ?? 'unknown',
        last_heartbeat: known?.lastCheck?.checkedAt ?? null,
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
 * The node as it may be sent to a caller.
 *
 * Built field by field on purpose. `listNodes` used to spread the object
 * parsed out of the `metadata` column, which means the payload was whatever
 * happened to have been written there — and on a live daemon that included
 * an SSH passphrase in plaintext. A DTO is a promise about what is returned;
 * spreading a JSON blob delegates that promise to whoever last wrote the row.
 */
function toWireNode(node: INode): INode {
  const wire: INode = {
    id: node.id,
    name: node.name,
    host: node.host,
    sshPort: node.sshPort,
    sshUser: node.sshUser,
    sshAuthMethod: node.sshAuthMethod,
    runtime: node.runtime,
    daemonPort: node.daemonPort,
    tags: node.tags ?? [],
    isLocal: node.isLocal,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
  // The key is a PATH or key content chosen by the operator; the booleans say
  // only whether a secret exists. Neither is a secret itself.
  if (node.sshPrivateKey !== undefined) wire.sshPrivateKey = node.sshPrivateKey;
  if (node.hasPassphrase !== undefined) wire.hasPassphrase = node.hasPassphrase;
  if (node.hasPassword !== undefined) wire.hasPassword = node.hasPassword;
  if (node.offlineTimeout !== undefined) wire.offlineTimeout = node.offlineTimeout;
  return wire;
}

/** Separate a stored node from any plaintext secret its row still carries. */
function splitStoredSecrets(
  raw: INode & { sshPassphrase?: string; sshPassword?: string },
): { node: INode; strays: Array<{ field: 'passphrase' | 'password'; value: string }> } {
  const { sshPassphrase, sshPassword, ...rest } = raw;
  const node = rest as INode;
  const strays: Array<{ field: 'passphrase' | 'password'; value: string }> = [];
  if (typeof sshPassphrase === 'string' && sshPassphrase) {
    node.hasPassphrase = true;
    strays.push({ field: 'passphrase', value: sshPassphrase });
  }
  if (typeof sshPassword === 'string' && sshPassword) {
    node.hasPassword = true;
    strays.push({ field: 'password', value: sshPassword });
  }
  return { node, strays };
}

/** Fallback offline timeout, matching the health monitor's own default. */
const DEFAULT_OFFLINE_TIMEOUT_MS = 90_000;

/** A TCP port the daemon will actually try to connect to. */
function assertPort(kind: string, value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`Invalid ${kind}: ${JSON.stringify(value)}. Expected an integer between 1 and 65535.`);
  }
  return value;
}

/** Reject a promise that has not settled within `ms`. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Read the first `bytes` of a file without loading the whole thing. */
function readFileHead(filePath: string, bytes: number): string {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, read).toString('utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

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
