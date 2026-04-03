/**
 * RemoteOpsService — Reusable remote operations layer on @xec-sh/core
 *
 * Provides ping, SSH, and remote command execution for all omnitron subsystems.
 * Built on ExecutionService which wraps @xec-sh/core ExecutionEngine.
 *
 * Used by: NodeManagerService, ProjectService, DeployService, DiscoveryService
 */

import type { ILogger } from '@omnitron-dev/titan/module/logger';
import { ExecutionService, type SSHTarget, type ExecResult } from '../execution/execution.service.js';

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
  os?: { platform: string; arch: string; hostname: string };
}

export interface RemoteOmnitronStatus {
  connected: boolean;
  version?: string;
  pid?: number;
  uptime?: number;
  role?: 'master' | 'slave';
  os?: { platform: string; arch: string; hostname: string; release: string };
}

export interface NodeCheckConfig {
  pingEnabled: boolean;
  pingTimeout: number;
  sshTimeout: number;
  omnitronCheckTimeout: number;
}

export const DEFAULT_CHECK_CONFIG: NodeCheckConfig = {
  pingEnabled: true,
  pingTimeout: 5_000,
  sshTimeout: 10_000,
  omnitronCheckTimeout: 15_000,
};

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
   * ICMP ping a host. Uses system `ping` command via @xec-sh/core.
   * Returns latency in ms or null if unreachable.
   */
  async ping(host: string, timeoutMs = DEFAULT_CHECK_CONFIG.pingTimeout): Promise<PingResult> {
    const start = Date.now();
    try {
      const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
      // macOS: /sbin/ping -c count -W timeout(ms), Linux: /bin/ping -c count -W timeout(s)
      // Use absolute paths — child processes may not have /sbin in PATH
      const isMac = process.platform === 'darwin';
      const pingBin = isMac ? '/sbin/ping' : '/bin/ping';
      const cmd = isMac
        ? `${pingBin} -c 1 -W ${timeoutMs} '${host}'`
        : `${pingBin} -c 1 -W ${timeoutSec} '${host}'`;

      const result = await this.exec.exec(cmd, { timeout: timeoutMs + 2000 });

      if (result.exitCode === 0) {
        const match = result.stdout.match(/time[=<](\d+\.?\d*)\s*ms/);
        const latency = match ? parseFloat(match[1]!) : Date.now() - start;
        return { reachable: true, latencyMs: Math.round(latency * 100) / 100 };
      }
      return { reachable: false, latencyMs: null, error: 'Host unreachable' };
    } catch (err) {
      return { reachable: false, latencyMs: null, error: (err as Error).message };
    }
  }

  // ===========================================================================
  // SSH
  // ===========================================================================

  /**
   * Check SSH connectivity to a remote host.
   * Executes `echo ok && uname -s -m -n` to verify connection and get OS info.
   */
  async checkSsh(target: SSHTarget, timeoutMs = DEFAULT_CHECK_CONFIG.sshTimeout): Promise<SshCheckResult> {
    const start = Date.now();
    try {
      const result = await this.exec.ssh(target, 'echo ok && uname -s -m -n', { timeout: timeoutMs });
      const latency = Date.now() - start;

      if (result.exitCode === 0 && result.stdout.includes('ok')) {
        const lines = result.stdout.trim().split('\n');
        const unameParts = (lines[1] ?? '').trim().split(/\s+/);
        const sshResult: SshCheckResult = { connected: true, latencyMs: latency };
        if (unameParts.length >= 3) {
          sshResult.os = { platform: unameParts[0]!.toLowerCase(), arch: unameParts[1]!, hostname: unameParts[2]! };
        }
        return sshResult;
      }
      return { connected: false, latencyMs: latency, error: result.stderr || 'SSH command failed' };
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
   */
  async checkRemoteOmnitron(
    target: SSHTarget,
    timeoutMs = DEFAULT_CHECK_CONFIG.omnitronCheckTimeout
  ): Promise<RemoteOmnitronStatus> {
    try {
      const result = await this.exec.ssh(
        target,
        'omnitron status --json 2>/dev/null || echo "{"',
        { timeout: timeoutMs }
      );

      if (result.exitCode !== 0) {
        return { connected: false };
      }

      try {
        const info = JSON.parse(result.stdout.trim() || '{}');
        return {
          connected: !!info.pid,
          version: info.version,
          pid: info.pid,
          uptime: info.uptime,
          role: info.role,
          os: info.os,
        };
      } catch {
        return { connected: false };
      }
    } catch {
      return { connected: false };
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

