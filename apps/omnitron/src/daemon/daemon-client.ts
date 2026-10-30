/**
 * DaemonClient — Netron RPC client for CLI and internal use
 *
 * Implements IDaemonService interface directly — all methods are
 * callable on the client itself, no intermediate `.invoke()` or `.daemon()`.
 *
 * For other services (OmnitronProject, OmnitronSystemInfo, etc.),
 * use `client.service<T>(name)` which returns a typed Netron proxy.
 *
 * Usage:
 *   const client = createDaemonClient();
 *
 *   // IDaemonService methods — directly on client
 *   const apps = await client.list();
 *   const status = await client.status();
 *   await client.stopApp({ name: 'main' });
 *
 *   // Other services — via typed proxy
 *   const project = await client.service<IProjectRpcService>('OmnitronProject');
 *   const stacks = await project.listStacks({ project: 'omni' });
 */

import { UnixSocketTransport } from '@omnitron-dev/titan/netron/transport/unix';
import { TcpTransport } from '@omnitron-dev/titan/netron/transport/tcp';
import { RpcConnection } from './rpc-connection.js';
import { getEnv } from '../shared/env-config.js';
import type {
  IDaemonService,
  ProcessInfoDto,
  DaemonStatusDto,
  AggregatedMetricsDto,
  AggregatedHealthDto,
  LogEntryDto,
  AppDiagnosticsDto,
} from '../shared/dto/services.js';
import { DAEMON_SERVICE_ID, DEFAULT_SOCKET_PATH, DEFAULT_DAEMON_CONFIG } from '../config/defaults.js';
import { PidManager } from './pid-manager.js';
import { expandPath } from '../shared/paths.js';

const CLI_REQUEST_TIMEOUT = 60_000;

/**
 * Ceiling for `isReachable()`, independent of the request timeout.
 *
 * A daemon that is going to answer answers a `ping` in milliseconds over a
 * unix socket. Five seconds is generous; what it must never be is "however
 * long this command is willing to wait for its actual work".
 */
const REACHABILITY_TIMEOUT = 5_000;

/**
 * Why a daemon did not answer.
 *
 * Three different situations, three different things for an operator to do,
 * and the CLI reported all of them as "Daemon is not running" — advice that
 * is right for one of them and actively misleading for the other two.
 */
export type DaemonAbsence =
  /** No pid file: nothing has been started. `omnitron up`. */
  | { kind: 'stopped' }
  /** A pid file pointing at a process that no longer exists: it crashed. */
  | { kind: 'stale'; pid: number }
  /** Alive, and did not answer in time. Usually busy; wait or investigate. */
  | { kind: 'silent'; pid: number; waitedMs: number }
  /** The pid file could not be read, so the question stays open. */
  | { kind: 'unknown'; reason: string };

/**
 * Timeout for calls that legitimately take minutes — starting or stopping a
 * whole stack, where each app is a Titan application connecting to a
 * database, Redis and its siblings before it reports ready.
 *
 * Six apps take well over a minute on a cold start, so the default ceiling
 * expired mid-operation and the CLI announced a failure for something that
 * went on to succeed.
 */
export const LONG_REQUEST_TIMEOUT = 10 * 60_000;

/**
 * Whether an error is the client giving up rather than the operation failing.
 *
 * The distinction matters more than it looks: the daemon does not cancel
 * anything when the caller stops waiting, so a timeout leaves the operation
 * running with its outcome unknown. Reporting that as a failure is worse
 * than reporting nothing, because an operator acts on it — rolling back
 * something that is in the middle of working.
 */
export function isRequestTimeout(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown };

  // The code is the answer whenever there is one.
  if (e.code === 408 || e.code === 'REQUEST_TIMEOUT') return true;
  if (e.code !== undefined && e.code !== null) return false;

  // Only an error that arrived WITHOUT a code — serialised across a boundary
  // that dropped it — falls back to its wording. Reading the text of a coded
  // error would let a 500 whose message happens to mention a timeout be
  // reported as "we stopped waiting", which is the opposite conclusion: one
  // says the operation may still be running, the other that it failed.
  return typeof e.message === 'string' && e.message.includes('timed out after');
}

// =============================================================================
// DaemonClient — Unix socket (local CLI ↔ daemon)
// =============================================================================

export class DaemonClient implements IDaemonService {
  private readonly connection: RpcConnection;
  private proxy: IDaemonService | null = null;

  constructor(socketPath: string = DEFAULT_SOCKET_PATH, requestTimeout: number = CLI_REQUEST_TIMEOUT) {
    this.connection = new RpcConnection(`unix://${socketPath}`, netron => {
      netron.registerTransport('unix', () => new UnixSocketTransport());
      netron.setTransportOptions('unix', { requestTimeout });
    });
  }

  private async ensureConnected(): Promise<void> {
    this.proxy = await this.service<IDaemonService>(DAEMON_SERVICE_ID);
  }

  /** Retain this handle across backend replacements; failed calls are never replayed. */
  async service<T>(serviceName: string): Promise<T> {
    return this.connection.service<T>(serviceName);
  }

  // ---------------------------------------------------------------------------
  // IDaemonService — delegated to Netron proxy
  // ---------------------------------------------------------------------------

  async startApp(data: { name: string }): Promise<ProcessInfoDto> {
    await this.ensureConnected();
    return this.proxy!.startApp(data);
  }

  async startAll(): Promise<ProcessInfoDto[]> {
    await this.ensureConnected();
    return this.proxy!.startAll();
  }

  async stopApp(data: { name: string; force?: boolean; timeout?: number }): Promise<{ success: boolean }> {
    await this.ensureConnected();
    return this.proxy!.stopApp(data);
  }

  async stopAll(data: { force?: boolean }): Promise<{ count: number }> {
    await this.ensureConnected();
    return this.proxy!.stopAll(data);
  }

  async restartApp(data: { name: string }): Promise<ProcessInfoDto> {
    await this.ensureConnected();
    return this.proxy!.restartApp(data);
  }

  async restartAll(): Promise<ProcessInfoDto[]> {
    await this.ensureConnected();
    return this.proxy!.restartAll();
  }

  async reloadApp(data: { name: string }): Promise<ProcessInfoDto> {
    await this.ensureConnected();
    return this.proxy!.reloadApp(data);
  }

  async list(): Promise<ProcessInfoDto[]> {
    await this.ensureConnected();
    return this.proxy!.list();
  }

  async getApp(data: { name: string }): Promise<ProcessInfoDto> {
    await this.ensureConnected();
    return this.proxy!.getApp(data);
  }

  async status(): Promise<DaemonStatusDto> {
    await this.ensureConnected();
    return this.proxy!.status();
  }

  async getMetrics(data: { name?: string }): Promise<AggregatedMetricsDto> {
    await this.ensureConnected();
    return this.proxy!.getMetrics(data);
  }

  async getHealth(data: { name?: string }): Promise<AggregatedHealthDto> {
    await this.ensureConnected();
    return this.proxy!.getHealth(data);
  }

  async getLogs(data: { name?: string; lines?: number }): Promise<LogEntryDto[]> {
    await this.ensureConnected();
    return this.proxy!.getLogs(data);
  }

  async scale(data: { name: string; instances: number }): Promise<ProcessInfoDto> {
    await this.ensureConnected();
    return this.proxy!.scale(data);
  }

  async ping(): Promise<{ uptime: number; version: string; pid: number }> {
    await this.ensureConnected();
    return this.proxy!.ping();
  }

  async shutdown(data: { force?: boolean }): Promise<{ success: boolean }> {
    await this.ensureConnected();
    return this.proxy!.shutdown(data);
  }

  async reloadConfig(): Promise<{ success: boolean }> {
    await this.ensureConnected();
    return this.proxy!.reloadConfig();
  }

  async setMetricsEnabled(data: { name?: string; enabled: boolean }): Promise<{ success: boolean }> {
    await this.ensureConnected();
    return this.proxy!.setMetricsEnabled(data);
  }

  async inspect(data: { name: string }): Promise<AppDiagnosticsDto> {
    await this.ensureConnected();
    return this.proxy!.inspect(data);
  }

  async getDependencyGraph(data: { name: string }): Promise<{
    nodes: Array<{ id: string; label?: string; type?: string }>;
    edges: Array<{ from: string; to: string; type?: 'dependency' | 'parent' }>;
  } | null> {
    await this.ensureConnected();
    return this.proxy!.getDependencyGraph(data);
  }

  async exec(data: { name: string; service: string; method: string; args: unknown[] }): Promise<unknown> {
    await this.ensureConnected();
    return this.proxy!.exec(data);
  }

  async getEnv(data: { name: string }): Promise<Record<string, string>> {
    await this.ensureConnected();
    return this.proxy!.getEnv(data);
  }

  async revealEnv(data: { name: string }): Promise<Record<string, string>> {
    await this.ensureConnected();
    return this.proxy!.revealEnv(data);
  }

  async enableWatch(data: { apps?: string[] }): Promise<{ watching: Array<{ name: string; directory: string }> }> {
    await this.ensureConnected();
    return this.proxy!.enableWatch(data);
  }

  async disableWatch(): Promise<{ success: boolean }> {
    await this.ensureConnected();
    return this.proxy!.disableWatch();
  }

  async getWatchStatus(): Promise<{ enabled: boolean; watching: boolean; reason?: string; apps: Array<{ name: string; directory: string }> }> {
    await this.ensureConnected();
    return this.proxy!.getWatchStatus();
  }

  // ---------------------------------------------------------------------------
  // Connection management
  // ---------------------------------------------------------------------------

  /**
   * Whether the daemon answers, decided quickly.
   *
   * This is a LIVENESS PROBE, and it must not inherit the request timeout.
   * Commands that start or restart an application legitimately wait minutes
   * for the operation — and every one of them calls this first, to decide
   * whether to auto-start the daemon or fall back to signalling its pid. With
   * a shared ceiling, `omnitron stop` against a WEDGED daemon would sit on
   * the probe for ten minutes before reaching the fallback written for
   * exactly that case. Measured 2026-09-14: a daemon that accepted
   * connections and answered nothing, for thirteen minutes.
   *
   * "Is it alive" and "do the work" are different questions and take
   * different amounts of time to answer.
   */
  async isReachable(): Promise<boolean> {
    return (await this.whyUnreachable()) === null;
  }

  /**
   * Why the daemon did not answer — or `null` when it did.
   *
   * `isReachable()` answers a three-state question with a boolean and throws
   * the interesting state away. Twenty-five commands then printed "Daemon is
   * not running", which is one of three things this can mean and the only one
   * that tells the operator to start it. The other two are a daemon that IS
   * running and has not answered in five seconds — during a stack boot, say,
   * where the right advice is to wait — and a pid file left behind by a
   * daemon that crashed, where the right advice is to clean it up.
   *
   * `status.ts` has drawn this distinction all along, in its own copy, for
   * itself. This puts it where the question is asked so every caller gets it.
   */
  async whyUnreachable(): Promise<DaemonAbsence | null> {
    try {
      await Promise.race([
        this.ping(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('daemon did not answer')), REACHABILITY_TIMEOUT).unref?.(),
        ),
      ]);
      return null;
    } catch (err) {
      return this.diagnoseAbsence(err as Error);
    }
  }

  /**
   * Read the pid file to tell a stopped daemon from a silent one.
   *
   * Deliberately not a second reachability probe: the socket has already had
   * its five seconds. This asks the operating system a different question —
   * does the process exist — whose answer the socket cannot give.
   */
  private diagnoseAbsence(err: Error): DaemonAbsence {
    try {
      const pid = new PidManager(this.resolvePidFile()).readPid();
      if (pid === null) return { kind: 'stopped' };
      if (!PidManager.isProcessAlive(pid)) return { kind: 'stale', pid };
      return { kind: 'silent', pid, waitedMs: REACHABILITY_TIMEOUT };
    } catch {
      // The pid file is unreadable. That is not evidence either way, and
      // saying "not running" here would be the same guess in new clothes.
      return { kind: 'unknown', reason: err.message };
    }
  }

  /**
   * Where this daemon's pid file lives.
   *
   * Its own method so the diagnosis above can be exercised against a pid file
   * a test controls. Inlined, the only way to reach `diagnoseAbsence` was to
   * have a real daemon in a real state — which is to say, not at all.
   */
  protected resolvePidFile(): string {
    return expandPath(DEFAULT_DAEMON_CONFIG.pidFile);
  }

  async disconnect(): Promise<void> {
    await this.connection.disconnect();
  }
}

// =============================================================================
// RemoteDaemonClient — TCP (cross-server fleet communication)
// =============================================================================

export class RemoteDaemonClient {
  private readonly connection: RpcConnection;

  constructor(host: string, port: number) {
    this.connection = new RpcConnection(`tcp://${host}:${port}`, netron => {
      netron.registerTransport('tcp', () => new TcpTransport());
    });
  }

  async service<T>(serviceName: string): Promise<T> {
    return this.connection.service<T>(serviceName);
  }

  async ping(): Promise<{ uptime: number; version: string; pid: number }> {
    const daemon = await this.service<IDaemonService>(DAEMON_SERVICE_ID);
    return daemon.ping();
  }

  /**
   * Whether the daemon answers, decided quickly.
   *
   * This is a LIVENESS PROBE, and it must not inherit the request timeout.
   * Commands that start or restart an application legitimately wait minutes
   * for the operation — and every one of them calls this first, to decide
   * whether to auto-start the daemon or fall back to signalling its pid. With
   * a shared ceiling, `omnitron stop` against a WEDGED daemon would sit on
   * the probe for ten minutes before reaching the fallback written for
   * exactly that case. Measured 2026-09-14: a daemon that accepted
   * connections and answered nothing, for thirteen minutes.
   *
   * "Is it alive" and "do the work" are different questions and take
   * different amounts of time to answer.
   */
  async isReachable(): Promise<boolean> {
    try {
      await Promise.race([
        this.ping(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('daemon did not answer')), REACHABILITY_TIMEOUT).unref?.(),
        ),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    await this.connection.disconnect();
  }
}

// =============================================================================
// Factory functions
// =============================================================================

export function createDaemonClient(socketPath?: string, requestTimeout?: number): DaemonClient {
  return new DaemonClient(socketPath ?? getEnv().OMNITRON_SOCKET ?? DEFAULT_SOCKET_PATH, requestTimeout);
}

export function createRemoteDaemonClient(host: string, port: number): RemoteDaemonClient {
  return new RemoteDaemonClient(host, port);
}
