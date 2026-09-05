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

import { Netron, type RemotePeer } from '@omnitron-dev/titan/netron';
import { UnixSocketTransport } from '@omnitron-dev/titan/netron/transport/unix';
import { TcpTransport } from '@omnitron-dev/titan/netron/transport/tcp';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
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
import { DAEMON_SERVICE_ID, DEFAULT_SOCKET_PATH } from '../config/defaults.js';

const CLI_REQUEST_TIMEOUT = 60_000;

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
  private netron: Netron;
  private peer: RemotePeer | null = null;
  private proxy: IDaemonService | null = null;
  private connected = false;
  /** The in-flight connect, shared by everyone who arrives during it. */
  private connecting: Promise<void> | null = null;
  private readonly serviceCache = new Map<string, unknown>();

  constructor(
    private readonly socketPath: string = DEFAULT_SOCKET_PATH,
    requestTimeout: number = CLI_REQUEST_TIMEOUT
  ) {
    this.netron = new Netron(createNullLogger(), { id: `omnitron-${process.pid}` });
    this.netron.registerTransport('unix', () => new UnixSocketTransport());
    this.netron.setTransportOptions('unix', { requestTimeout });
  }

  /**
   * Connect once, however many callers arrive at once.
   *
   * `connected` is set after the awaits, so on its own it guards the second
   * CALL and not the second CALLER: every method here opens with
   * `await this.ensureConnected()`, so `Promise.all([a(), b()])` had both see
   * `false`, both open a socket, and both `queryInterface`. The last
   * assignment wins and the earlier peer is leaked — `disconnect()` can only
   * tear down the one the fields point at.
   *
   * Sharing the in-flight promise covers exactly the window the flag was
   * written for. It is released in a `finally` however the attempt ends:
   * holding a rejected promise would replay the first failure forever, so a
   * daemon that was merely still starting could never be reached again.
   */
  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      this.peer = (await this.netron.connect(`unix://${this.socketPath}`, false)) as RemotePeer;
      this.proxy = await this.peer.queryInterface<IDaemonService>(DAEMON_SERVICE_ID);
      this.connected = true;
    })().finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  // ---------------------------------------------------------------------------
  // Typed service proxy for any Netron service
  // ---------------------------------------------------------------------------

  async service<T>(serviceName: string): Promise<T> {
    await this.ensureConnected();
    const cached = this.serviceCache.get(serviceName);
    if (cached) return cached as T;
    const proxy = await this.peer!.queryInterface<T>(serviceName);
    this.serviceCache.set(serviceName, proxy);
    return proxy;
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

  async enableWatch(data: { apps?: string[] }): Promise<{ watching: Array<{ name: string; directory: string }> }> {
    await this.ensureConnected();
    return this.proxy!.enableWatch(data);
  }

  async disableWatch(): Promise<{ success: boolean }> {
    await this.ensureConnected();
    return this.proxy!.disableWatch();
  }

  async getWatchStatus(): Promise<{ enabled: boolean; apps: Array<{ name: string; directory: string }> }> {
    await this.ensureConnected();
    return this.proxy!.getWatchStatus();
  }

  // ---------------------------------------------------------------------------
  // Connection management
  // ---------------------------------------------------------------------------

  async isReachable(): Promise<boolean> {
    try {
      await this.ping();
      return true;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      // Settle an in-flight connect before tearing anything down. Otherwise
      // the connect completes AFTER the disconnect and sets `connected` back
      // to true around a peer nothing points at — a socket that survives a
      // clean shutdown and surfaces a lifetime later.
      //
      // Awaiting it is also what makes clearing `connecting` below
      // unnecessary: its own `finally` has already run by this point. A line
      // doing it anyway would read as defensive and be unreachable, which is
      // worse than absent — nothing can tell you it stopped being needed.
      if (this.connecting) await this.connecting.catch(() => undefined);

      if (this.connected) {
        await this.netron.stop();
        this.connected = false;
        this.peer = null;
        this.proxy = null;
        this.serviceCache.clear();
      }
    } catch {
      // Already disconnected
    }
  }
}

// =============================================================================
// RemoteDaemonClient — TCP (cross-server fleet communication)
// =============================================================================

export class RemoteDaemonClient {
  private netron: Netron;
  private peer: RemotePeer | null = null;
  private connected = false;
  /** The in-flight connect, shared by everyone who arrives during it. */
  private connecting: Promise<void> | null = null;
  private readonly serviceCache = new Map<string, unknown>();

  constructor(
    private readonly host: string,
    private readonly port: number
  ) {
    this.netron = new Netron(createNullLogger(), { id: `omnitron-remote-${process.pid}` });
    this.netron.registerTransport('tcp', () => new TcpTransport());
  }

  /** As `DaemonClient.ensureConnected` — the same shape over TCP. */
  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      this.peer = (await this.netron.connect(`tcp://${this.host}:${this.port}`, false)) as RemotePeer;
      this.connected = true;
    })().finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  async service<T>(serviceName: string): Promise<T> {
    await this.ensureConnected();
    const cached = this.serviceCache.get(serviceName);
    if (cached) return cached as T;
    const proxy = await this.peer!.queryInterface<T>(serviceName);
    this.serviceCache.set(serviceName, proxy);
    return proxy;
  }

  async ping(): Promise<{ uptime: number; version: string; pid: number }> {
    const daemon = await this.service<IDaemonService>(DAEMON_SERVICE_ID);
    return daemon.ping();
  }

  async isReachable(): Promise<boolean> {
    try {
      await this.ping();
      return true;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      // Settle an in-flight connect before tearing anything down. Otherwise
      // the connect completes AFTER the disconnect and sets `connected` back
      // to true around a peer nothing points at — a socket that survives a
      // clean shutdown and surfaces a lifetime later.
      //
      // Awaiting it is also what makes clearing `connecting` below
      // unnecessary: its own `finally` has already run by this point. A line
      // doing it anyway would read as defensive and be unreachable, which is
      // worse than absent — nothing can tell you it stopped being needed.
      if (this.connecting) await this.connecting.catch(() => undefined);

      if (this.connected) {
        await this.netron.stop();
        this.connected = false;
        this.peer = null;
        this.serviceCache.clear();
      }
    } catch {
      // Already disconnected
    }
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
