/**
 * RemoteOpsService — Reusable remote operations layer on @xec-sh/core
 *
 * Provides ping, SSH, and remote command execution for all omnitron subsystems.
 * Built on ExecutionService which wraps @xec-sh/core ExecutionEngine.
 *
 * Used by: NodeManagerService, ProjectService, DeployService, DiscoveryService
 */

import { execFile } from 'node:child_process';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import { ExecutionService, type SSHTarget, type ExecResult } from '../execution/execution.service.js';
import type { NodeCheckConfig } from '../shared/dto/nodes.js';
import { readNodeStatus } from '../project/node-app-health.js';

export type { NodeCheckConfig } from '../shared/dto/nodes.js';

// =============================================================================
// Types
// =============================================================================

export interface PingResult {
  reachable: boolean;
  latencyMs: number | null;
  error?: string;
}

export interface SshCheckResult {
  connected: boolean;
  latencyMs: number;
  error?: string;
  /** Remote OS info (if connected) */
  os?: { platform: string; arch: string; hostname: string; release: string };
}

export interface RemoteOmnitronStatus {
  connected: boolean;
  version?: string;
  pid?: number;
  uptime?: number;
  role?: 'master' | 'slave';
  os?: { platform: string; arch: string; hostname: string; release: string };
}


export const DEFAULT_CHECK_CONFIG: NodeCheckConfig = {
  pingEnabled: true,
  pingTimeout: 5_000,
  sshTimeout: 10_000,
  omnitronCheckTimeout: 15_000,
  concurrency: 20,
};

/** Bounds for each numeric knob: [min, max]. */
const CHECK_CONFIG_BOUNDS = {
  pingTimeout: [250, 60_000],
  sshTimeout: [1_000, 120_000],
  omnitronCheckTimeout: [1_000, 120_000],
  concurrency: [1, 100],
} as const;

/**
 * A check configuration the checker can actually run.
 *
 * `setCheckConfig` took whatever arrived over RPC and assigned it. A timeout
 * of `0` means "give up before trying" and `NaN` compares false against every
 * bound, so both produced a fleet where nothing is ever reachable and nothing
 * says why. Clamping is not politeness here: these numbers become process
 * timeouts and a concurrency width.
 */
export function normalizeCheckConfig(input: Partial<NodeCheckConfig>): NodeCheckConfig {
  const out: NodeCheckConfig = { ...DEFAULT_CHECK_CONFIG };
  out.pingEnabled = input.pingEnabled ?? DEFAULT_CHECK_CONFIG.pingEnabled;
  for (const key of Object.keys(CHECK_CONFIG_BOUNDS) as Array<keyof typeof CHECK_CONFIG_BOUNDS>) {
    const [min, max] = CHECK_CONFIG_BOUNDS[key];
    const raw = input[key];
    out[key] = Number.isFinite(raw) ? Math.min(max, Math.max(min, Math.round(raw as number))) : DEFAULT_CHECK_CONFIG[key];
  }
  return out;
}

// =============================================================================
// Host validation
// =============================================================================

/** A DNS label: letters, digits and hyphens, not starting or ending with one. */
const DNS_LABEL = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/;

/** Dotted-quad IPv4. */
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isIpv4(value: string): boolean {
  const m = IPV4.exec(value);
  if (!m) return false;
  return m.slice(1).every((part) => {
    const n = Number(part);
    return n <= 255 && String(n) === String(Number(part));
  });
}

function isIpv6(value: string): boolean {
  // Node's URL parser is the authority we already ship; `[::1]` is the form
  // it accepts, and it rejects everything an IPv6 literal must not be.
  try {
    return new URL(`http://[${value}]/`).hostname === `[${value.toLowerCase()}]`;
  } catch {
    return false;
  }
}

/**
 * A host that may be stored on a node.
 *
 * The value ends up in an SSH target, in a `ping` argument list, and in a
 * `tcp://…` URL. It was never checked: `addNode` stored the string it was
 * given, and `ping` interpolated it into a shell command inside single
 * quotes, where a host containing an apostrophe ends the quoting and the rest
 * runs as a command on the daemon's machine. The argument list is now passed
 * to `execFile` with no shell at all, and this is the second lock: a host is
 * a hostname, an IPv4 address, or an IPv6 address, and nothing else is a host.
 *
 * A trailing dot is stripped rather than rejected — `example.com.` is one
 * name to a resolver and a different string to every comparison we make.
 *
 * @throws Error naming the value and what is allowed.
 */
export function assertNodeHost(value: string): string {
  const host = typeof value === 'string' ? value.trim() : '';
  if (!host) throw new Error('Host is required');
  if (host.length > 255) throw new Error('Host is too long (max 255 characters)');

  // Bracketed IPv6, as it is written in a URL.
  const unbracketed = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (unbracketed.includes(':')) {
    if (isIpv6(unbracketed)) return unbracketed.toLowerCase();
    throw new Error(`Invalid host ${JSON.stringify(value)}: not a valid IPv6 address`);
  }

  if (isIpv4(host)) return host;

  const normalized = host.endsWith('.') ? host.slice(0, -1) : host;
  const labels = normalized.split('.');
  if (normalized && labels.every((l) => DNS_LABEL.test(l))) {
    // A final label of digits is not a hostname — no top-level domain is
    // numeric — and what it almost always is instead is a mistyped address.
    // `999.1.1.1` passes every label rule, so without this it would be
    // stored as a name, resolve to nothing, and report the node unreachable
    // for a reason the operator cannot see from the value they typed.
    if (/^\d+$/.test(labels[labels.length - 1]!)) {
      throw new Error(
        `Invalid host ${JSON.stringify(value)}: looks like an IP address but is not a valid one.`,
      );
    }
    return normalized.toLowerCase();
  }

  throw new Error(
    `Invalid host ${JSON.stringify(value)}. Expected a hostname, an IPv4 address, or an IPv6 address.`,
  );
}

// =============================================================================
// Service
// =============================================================================

export class RemoteOpsService {
  private readonly exec: ExecutionService;

  constructor(logger: ILogger) {
    this.exec = new ExecutionService(logger);
  }

  // ===========================================================================
  // Ping (ICMP)
  // ===========================================================================

  /**
   * ICMP ping a host. Runs the system `ping` with an ARGUMENT LIST.
   * Returns latency in ms or null if unreachable.
   *
   * There is no shell in this path. The command used to be assembled as a
   * string with the host quoted into it, which made every stored host a
   * potential command on the daemon's own machine.
   */
  async ping(host: string, timeoutMs = DEFAULT_CHECK_CONFIG.pingTimeout): Promise<PingResult> {
    const start = Date.now();
    let target: string;
    try {
      target = assertNodeHost(host);
    } catch (err) {
      return { reachable: false, latencyMs: null, error: (err as Error).message };
    }

    const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
    // macOS: /sbin/ping -c count -W timeout(ms), Linux: /bin/ping -c count -W timeout(s)
    // Use absolute paths — child processes may not have /sbin in PATH
    const isMac = process.platform === 'darwin';
    const pingBin = isMac ? '/sbin/ping' : '/bin/ping';
    const args = isMac
      ? ['-c', '1', '-W', String(timeoutMs), target]
      : ['-c', '1', '-W', String(timeoutSec), '-w', String(timeoutSec), target];

    const result = await runFile(pingBin, args, timeoutMs + 2_000);

    if (result.exitCode === 0) {
      const match = result.stdout.match(/time[=<](\d+\.?\d*)\s*ms/);
      const latency = match ? parseFloat(match[1]!) : Date.now() - start;
      return { reachable: true, latencyMs: Math.round(latency * 100) / 100 };
    }
    return {
      reachable: false,
      latencyMs: null,
      error: firstLine(result.stderr) || 'Host unreachable',
    };
  }

  // ===========================================================================
  // SSH
  // ===========================================================================

  /**
   * Check SSH connectivity to a remote host.
   *
   * The OS facts are read one per line. They used to come from
   * `uname -s -m -n`, which does NOT print in the order of the flags —
   * `uname` prints its fields in a fixed canonical order, so the reply was
   * `Linux <hostname> <machine>` while the parser read
   * `[platform, arch, hostname]`. Every remote node in the console reported
   * its HOSTNAME as its CPU architecture: a live node showed
   * `linux acme-cpp` with `x86_64` filed as the hostname.
   */
  async checkSsh(target: SSHTarget, timeoutMs = DEFAULT_CHECK_CONFIG.sshTimeout): Promise<SshCheckResult> {
    const start = Date.now();
    try {
      // `;` rather than `&&`, and a `true` at the end: this is a
      // CONNECTIVITY check, and what it must not do is report a reachable
      // host as unreachable because one of the four `uname` calls is missing
      // on a minimal image. If the command ran at all, SSH worked.
      const result = await this.exec.ssh(
        target,
        'echo ok; uname -s; uname -n; uname -m; uname -r; true',
        { timeout: timeoutMs },
      );
      const latency = Date.now() - start;

      if (result.exitCode === 0 && result.stdout.includes('ok')) {
        const lines = result.stdout.trim().split('\n').map((l) => l.trim());
        const sshResult: SshCheckResult = { connected: true, latencyMs: latency };
        // [ok, sysname, nodename, machine, release]
        const [, platform, hostname, arch, release] = lines;
        if (platform && hostname && arch) {
          sshResult.os = {
            platform: platform.toLowerCase(),
            arch,
            hostname,
            release: release ?? '',
          };
        }
        return sshResult;
      }
      return { connected: false, latencyMs: latency, error: firstLine(result.stderr) || 'SSH command failed' };
    } catch (err) {
      return { connected: false, latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }

  /**
   * Execute a command on a remote host via SSH.
   */
  async sshExec(target: SSHTarget, command: string, timeoutMs?: number): Promise<ExecResult> {
    return this.exec.ssh(target, command, timeoutMs ? { timeout: timeoutMs } : undefined);
  }

  // ===========================================================================
  // Remote Omnitron Status
  // ===========================================================================

  /**
   * Check if omnitron daemon is running on a remote node.
   * Executes `omnitron status --json` via SSH.
   *
   * A host with no omnitron installed and a host that could not be asked are
   * different answers, and both used to come back as a bare
   * `{ connected: false }`. The console has a "Not installed" state it can
   * only reach when the reason survives the call, so the reason is returned.
   */
  async checkRemoteOmnitron(
    target: SSHTarget,
    timeoutMs = DEFAULT_CHECK_CONFIG.omnitronCheckTimeout
  ): Promise<RemoteOmnitronStatus & { error?: string }> {
    try {
      const result = await this.exec.ssh(
        target,
        'command -v omnitron >/dev/null 2>&1 || { echo "omnitron: command not found" >&2; exit 127; }; omnitron status --json',
        { timeout: timeoutMs }
      );

      if (result.exitCode !== 0) {
        return { connected: false, error: firstLine(result.stderr) || `omnitron status exited ${result.exitCode}` };
      }

      // Through the envelope. `omnitron status --json` answers
      // `{ok, data:{version, pid, uptime, …}}`, and this read `info.pid` —
      // undefined for every real answer — so a node whose daemon had been up
      // for days, answering this very command, was listed `○ offline` in the
      // console and in `omnitron node list`. Measured on the test node while
      // it reported `appsOnline: 6`.
      const info = readNodeStatus(result.stdout.trim() || '{}');
      if (!info) {
        return { connected: false, error: 'omnitron status did not return JSON' };
      }
      const status: RemoteOmnitronStatus & { error?: string } = { connected: !!info.pid };
      if (info.version) status.version = info.version;
      if (info.pid) status.pid = info.pid;
      if (info.uptime) status.uptime = info.uptime;
      if (info.role) status.role = info.role;
      // No `os` here: this answer has never carried one — `data` holds
      // version, pid, uptime, memoryBytes, appsTotal, appsOnline, errors and
      // apps. The node's OS comes from the SSH check, which measures it.
      if (!status.connected) status.error = 'omnitron status reported no running daemon';
      return status;
    } catch (err) {
      return { connected: false, error: (err as Error).message };
    }
  }

  // ===========================================================================
  // Local Execution (convenience)
  // ===========================================================================

  async localExec(command: string, timeoutMs?: number): Promise<ExecResult> {
    return this.exec.exec(command, timeoutMs ? { timeout: timeoutMs } : undefined);
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async dispose(): Promise<void> {
    await this.exec.dispose?.();
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Run a binary with an argument list — no shell, no interpolation.
 *
 * `execFile`'s error carries the exit status in `code` only when the process
 * ran and exited; a spawn failure puts an errno string there (`'ENOENT'`) and
 * a timeout leaves it null with `killed` set. All three are failures, and
 * each one has a different thing worth reporting.
 */
function runFile(bin: string, args: string[], timeout: number): Promise<ExecResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      let exitCode = 0;
      let message = '';
      if (err) {
        const e = err as NodeJS.ErrnoException & { code?: number | string; killed?: boolean };
        exitCode = typeof e.code === 'number' ? e.code : 1;
        if (e.killed) message = `Timed out after ${timeout}ms`;
        else if (typeof e.code === 'string') message = `${bin}: ${e.code}`;
      }
      resolve({
        stdout: (stdout ?? '').trim(),
        stderr: (stderr ?? '').trim() || message,
        exitCode,
        duration: Date.now() - start,
      });
    });
  });
}

/** The first line of a message, for a field the console renders on one row. */
function firstLine(text: string | undefined): string {
  if (!text) return '';
  const line = text.split('\n').find((l) => l.trim());
  return (line ?? '').trim().slice(0, 300);
}
