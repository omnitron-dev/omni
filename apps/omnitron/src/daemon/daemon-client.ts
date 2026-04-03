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

// =============================================================================
// DaemonClient — Unix socket (local CLI ↔ daemon)
// =============================================================================

export class DaemonClient implements IDaemonService {
  private netron: Netron;
  private peer: RemotePeer | null = null;
  private proxy: IDaemonService | null = null;
  private connected = false;
  private readonly serviceCache = new Map<string, unknown>();

  constructor(private readonly socketPath: string = DEFAULT_SOCKET_PATH) {
    this.netron = new Netron(createNullLogger(), { id: `omnitron-${process.pid}` });
    this.netron.registerTransport('unix', () => new UnixSocketTransport());
    this.netron.setTransportOptions('unix', { requestTimeout: CLI_REQUEST_TIMEOUT });
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    this.peer = await this.netron.connect(`unix://${this.socketPath}`, false) as RemotePeer;
    this.proxy = await this.peer.queryInterface<IDaemonService>(DAEMON_SERVICE_ID);
    this.connected = true;
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
  private readonly serviceCache = new Map<string, unknown>();

  constructor(
    private readonly host: string,
    private readonly port: number
  ) {
    this.netron = new Netron(createNullLogger(), { id: `omnitron-remote-${process.pid}` });
    this.netron.registerTransport('tcp', () => new TcpTransport());
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    this.peer = await this.netron.connect(`tcp://${this.host}:${this.port}`, false) as RemotePeer;
    this.connected = true;
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

export function createDaemonClient(socketPath?: string): DaemonClient {
  return new DaemonClient(socketPath ?? process.env['OMNITRON_SOCKET'] ?? DEFAULT_SOCKET_PATH);
}

export function createRemoteDaemonClient(host: string, port: number): RemoteDaemonClient {
  return new RemoteDaemonClient(host, port);
}
