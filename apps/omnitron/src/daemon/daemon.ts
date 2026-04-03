/**
 * OmnitronDaemon — The daemon IS a Titan Application
 *
 * Bootstraps via Application.create(), uses Nexus DI, and registers four
 * Netron transport servers:
 *
 * 1. Unix socket (local) — CLI <-> daemon RPC. High-performance, secure.
 * 2. TCP (remote) — omnitron <-> omnitron fleet communication.
 * 3. HTTP (webapp) — serves Omnitron Console SPA + Netron RPC on port 9800.
 * 4. WebSocket — real-time event push to webapp clients.
 *
 * Architecture completion:
 *   - InfrastructureGate: apps wait for infra before starting
 *   - titan-scheduler: replaces bare setInterval calls
 *   - titan-health: custom health indicators (Docker, apps, memory, event loop)
 *   - Typed events: domain events broadcast via WebSocket
 *   - RBAC: role-based access on all RPC endpoints (admin/operator/viewer)
 *   - Config resolution: secrets + env-aware injection into apps
 */

import { Application, ShutdownReason, ShutdownPriority, ApplicationEvent } from '@omnitron-dev/titan';
import { UnixSocketTransport } from '@omnitron-dev/titan/netron/transport/unix';
import { TcpTransport } from '@omnitron-dev/titan/netron/transport/tcp';
import { HttpTransport } from '@omnitron-dev/titan/netron/transport/http';
import { WebSocketTransport } from '@omnitron-dev/titan/netron/transport/websocket';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule, type ILogger } from '@omnitron-dev/titan/module/logger';
import { SCHEDULER_SERVICE_TOKEN, type SchedulerService } from '@omnitron-dev/titan-scheduler';
import { HEALTH_SERVICE_TOKEN as TITAN_HEALTH_TOKEN, type IHealthService } from '@omnitron-dev/titan-health';
import type { TelemetryRelayService } from '@omnitron-dev/titan-telemetry-relay';

import os from 'node:os';
import type { IEcosystemConfig, IDaemonConfig } from '../config/types.js';
import { CLI_VERSION, DEFAULT_DAEMON_CONFIG } from '../config/defaults.js';
import { createDaemonModule, getDaemonLogStream, getDaemonErrorStream, getDaemonLogCollectorStream } from './daemon.module.js';
import { DaemonRpcService } from './daemon.rpc-service.js';
import { AuthRpcService } from '../services/auth.rpc-service.js';
import { LogsRpcService } from '../services/log-collector.rpc-service.js';
import { EventBroadcasterService } from '../services/event-broadcaster.service.js';
import { EventBroadcasterRpcService } from '../services/event-broadcaster.rpc-service.js';
import { ProjectRpcService } from '../services/project.rpc-service.js';
import type { ProjectService } from '../services/project.service.js';
import { SyncService } from '../services/sync.service.js';
import { SyncRpcService } from '../services/sync.rpc-service.js';
import { SystemInfoService } from '../services/system-info.service.js';
import { SystemInfoRpcService } from '../services/system-info.rpc-service.js';
import { PidManager } from './pid-manager.js';
import type { OrchestratorService } from '../orchestrator/orchestrator.service.js';
import { FileWatcher } from '../orchestrator/file-watcher.js';
import { InfrastructureService } from '../infrastructure/infrastructure.service.js';
import type { InfrastructureGate } from '../infrastructure/infrastructure-gate.js';
import { DockerHealthIndicator } from '../monitoring/docker-health.indicator.js';
import { AppHealthIndicator } from '../monitoring/app-health.indicator.js';
import { registerDaemonJobs } from './daemon-scheduler.js';
import { METRICS_SERVICE_TOKEN as TITAN_METRICS_TOKEN, type IMetricsService } from '@omnitron-dev/titan-metrics';
import type { LogManager } from '../monitoring/log-manager.js';
import type { StateStore } from './state-store.js';
import type { AuthService } from '../services/auth.service.js';
import type { LogCollectorService } from '../services/log-collector.service.js';
import type { FleetService } from '../services/fleet.service.js';
import type { AlertService } from '../services/alert.service.js';
import type { HealthCheckService } from '../services/health-check.service.js';
import type { TraceCollectorService } from '../services/trace-collector.service.js';
import type { BackupService } from '../services/backup.service.js';
import {
  ORCHESTRATOR_TOKEN,
  LOG_MANAGER_TOKEN,
  STATE_STORE_TOKEN,
  OMNITRON_DB_TOKEN,
  AUTH_SERVICE_TOKEN,
  LOG_COLLECTOR_TOKEN,
  FLEET_SERVICE_TOKEN,
  ALERT_SERVICE_TOKEN,
  HEALTH_CHECK_SERVICE_TOKEN,
  DISCOVERY_SERVICE_TOKEN,
  KUBERNETES_SERVICE_TOKEN,
  PIPELINE_SERVICE_TOKEN,
  TRACE_COLLECTOR_TOKEN,
  BACKUP_SERVICE_TOKEN,
  SECRETS_SERVICE_TOKEN,
  TELEMETRY_RELAY_TOKEN,
  DEPLOY_SERVICE_TOKEN,
  INFRASTRUCTURE_GATE_TOKEN,
  PROJECT_SERVICE_TOKEN,
  SLAVE_STORAGE_TOKEN,
} from '../shared/tokens.js';
import {
  APP_EVENTS,
  INFRA_EVENTS,
  DAEMON_EVENTS,
  PROJECT_EVENTS,
  STACK_EVENTS,
  NODE_EVENTS,
  type AppStartedEvent,
  type AppCrashedEvent,
  type AppRestartingEvent,
  type InfraReadyEvent,
  type InfraFailedEvent,
  type ProjectAddedEvent,
  type ProjectRemovedEvent,
  type StackStartedEvent,
  type StackStoppedEvent,
  type StackErrorEvent,
} from '../shared/events.js';
import { JWT_SERVICE_TOKEN, type IJWTService } from '@omnitron-dev/titan-auth';
import { AuthenticationManager, type AuthContext } from '@omnitron-dev/titan/netron/auth';
import { createAuthContextWrapper } from '../services/auth-context.js';

export interface DaemonStartOptions {
  /** Enable file watching — restarts apps on source file changes */
  watch?: boolean;
  /** Only watch these apps (default: all enabled apps) */
  watchApps?: string[];
  /** Skip infrastructure provisioning (Docker containers) */
  noInfra?: boolean;
  /** Disable file watching even if explicitly requested */
  noWatch?: boolean;
}

export class OmnitronDaemon {
  private app: Application | null = null;
  private pidManager: PidManager | null = null;
  private fileWatcher: FileWatcher | null = null;
  private infraService: InfrastructureService | null = null;
  private eventBroadcaster: EventBroadcasterService | null = null;
  private syncService: SyncService | null = null;
  private nodeManagerService: import('../services/node-manager.service.js').NodeManagerService | null = null;
  private nodeManagerRpcService: import('../services/node-manager.rpc-service.js').NodeManagerRpcService | null = null;
  private systemWorkerManager: import('../workers/system-worker-manager.js').SystemWorkerManager | null = null;
  private leaderElection: any = null;
  private configSyncService: any = null;
  private dc: IDaemonConfig = DEFAULT_DAEMON_CONFIG;

  /** Daemon config accessor for external use (e.g., DaemonRpcService) */
  get daemonConfig(): IDaemonConfig { return this.dc; }

  async start(config: IEcosystemConfig, options?: DaemonStartOptions, daemonConfig?: IDaemonConfig): Promise<void> {
    this.dc = daemonConfig ?? DEFAULT_DAEMON_CONFIG;

    const pidFile = this.dc.pidFile.replace('~', process.env['HOME'] ?? '');
    this.pidManager = new PidManager(pidFile);

    if (this.pidManager.isRunning()) {
      const existingPid = this.pidManager.getPid();
      throw new Error(`Omnitron daemon already running (PID: ${existingPid})`);
    }

    this.pidManager.write();

    // 1. Create Titan Application (the daemon itself)
    const DaemonModule = createDaemonModule(config, this.dc);

    this.app = await Application.create(DaemonModule, {
      name: 'omnitron',
      version: CLI_VERSION,
    });

    // 2. Register transports (Unix, TCP, HTTP, WebSocket)
    await this.registerTransports(this.dc);

    // 3. Resolve and expose RPC services via Netron
    await this.exposeRpcServices(config, this.dc);

    // 4. Start the Titan Application (boots DI, starts Netron, opens transports)
    await this.app.start();

    const loggerModule = await this.app.container.resolveAsync<ILoggerModule>(LOGGER_SERVICE_TOKEN);
    const logger = loggerModule.logger;

    logger.info(
      {
        socketPath: this.dc.socketPath,
        port: this.dc.port,
        httpPort: this.dc.httpPort,
        wsPort: (this.dc.httpPort ?? 9800) + 2,
        host: this.dc.host,
        pid: process.pid,
        version: CLI_VERSION,
      },
      'Omnitron daemon started'
    );

    // 5. Wire log persistence
    await this.wireLogPersistence();

    // 5.5. Check for crash recovery
    await this.checkCrashRecovery(logger);

    // 6. Provision infrastructure (omnitron-pg + app infra from config.infrastructure)
    await this.startInfrastructure(config, options, logger);

    // 7. Register custom health indicators (Docker + apps)
    await this.registerHealthIndicators();

    // 8. File watching (dev mode)
    this.startFileWatcher(config, options, logger);

    // 8.5. Wire daemon Netron to orchestrator for native topology routing
    {
      const orchestrator = await this.app.container.resolveAsync<OrchestratorService>(ORCHESTRATOR_TOKEN);
      if (this.app.netron) {
        const socketPath = this.dc.socketPath.replace('~', process.env['HOME'] ?? '');
        orchestrator.setDaemonNetron(this.app.netron, socketPath);
      }
    }

    // 8.8. Start webapp (nginx container serving Console UI) if enabled
    {
      const { readSavedDaemonConfig } = await import('../commands/up.js');
      const savedConfig = readSavedDaemonConfig();

      if (savedConfig?.webapp) {
        try {
          const { WebappService } = await import('../webapp/webapp.service.js');
          const webapp = new WebappService(logger, process.cwd(), (this.dc.httpPort ?? 9800) + 1, this.dc.httpPort ?? 9800);
          await webapp.start();
        } catch (err) {
          logger.warn({ error: (err as Error).message }, 'Webapp failed to start — Console UI may not be available');
        }
      }
    }

    // 9. Start managed apps (waits for infra gate if apps have `requires`)
    await this.startApps(config, logger);

    // 10. Start background tasks via titan-scheduler (replaces bare setInterval)
    await this.startScheduledTasks(config, logger);

    // 11. Start remaining background services (telemetry, traces, leader election)
    await this.startBackgroundServices(config, logger);

    // 11.5. Start health monitor system worker (master only)
    await this.startHealthMonitorWorker(logger);

    // 12. Wire event broadcasting (orchestrator events → WebSocket push)
    await this.wireEventBroadcasting(logger);

    // 13. Register shutdown tasks — Application handles SIGTERM/SIGINT
    // and calls shutdown tasks in priority order before process.exit()
    this.registerShutdownTasks(this.app);

    // 15. Broadcast daemon.started event
    this.eventBroadcaster?.broadcast(DAEMON_EVENTS.STARTED, {
      version: CLI_VERSION,
      pid: process.pid,
    });
  }

  // ============================================================================
  // Transport Registration
  // ============================================================================

  private async registerTransports(dc: IDaemonConfig): Promise<void> {
    if (!this.app?.netron) return;

    // Unix socket — local CLI <-> daemon (primary, high-performance)
    this.app.netron.registerTransport('unix', () => new UnixSocketTransport());
    this.app.netron.registerTransportServer('unix', {
      name: 'daemon-local',
      options: {
        path: dc.socketPath.replace('~', process.env['HOME'] ?? ''),
        force: true,
        mode: 0o600, // Owner-only access for security
      },
    });

    // TCP — remote fleet communication (cross-server)
    this.app.netron.registerTransport('tcp', () => new TcpTransport());
    this.app.netron.registerTransportServer('tcp', {
      name: 'daemon-fleet',
      options: {
        port: dc.port,
        host: dc.host,
      },
    });

    // Auth — JWT validation + session check + role extraction
    const isSlave = dc.role === 'slave';
    const jwtService = await this.app.container.resolveAsync<IJWTService>(JWT_SERVICE_TOKEN);
    const logModule = await this.app.container.resolveAsync<ILoggerModule>(LOGGER_SERVICE_TOKEN);
    const authLogger = logModule.logger.child({ component: 'auth' });

    // On master: full JWT + session validation via AuthService (PG-backed)
    // On slave: JWT-only validation (no session DB — no PG)
    const authService = !isSlave
      ? await this.app.container.resolveAsync<AuthService>(AUTH_SERVICE_TOKEN)
      : null;

    const authManager = new AuthenticationManager(authLogger, {
      authenticate: async () => {
        throw new Error('Credential authentication not supported. Use JWT Bearer token.');
      },
      validateToken: async (token: string): Promise<AuthContext> => {
        // JWT verification with caching via titan-auth JWTService
        const payload = await jwtService.verify(token);

        // Session validation — master only (requires PG for omnitron_sessions)
        if (authService) {
          const sessionId = payload['sid'] as string | undefined;
          if (sessionId) {
            const session = await authService.validateToken(token);
            if (!session) {
              const err = new Error('Session has been revoked or expired');
              (err as any).code = 'SESSION_REVOKED';
              (err as any).statusCode = 401;
              throw err;
            }
          }
        }

        // Role is now in JWT claims (set by AuthService.issueToken)
        const role = (payload['role'] as string) ?? 'viewer';
        const sessionId = payload['sid'] as string | undefined;

        return {
          userId: payload.sub,
          roles: [role],
          permissions: [],
          token: { type: 'bearer' },
          metadata: {
            sessionId,
            isServiceRole: role === 'service_role',
          },
        };
      },
      tokenCache: { enabled: true, ttl: 10_000 },
    });
    this.app.netron.configureAuth(authManager);

    const authContextWrapper = createAuthContextWrapper();

    // HTTP — Netron RPC API (internal port, nginx proxies from public port)
    const internalHttpPort = (dc.httpPort ?? 9800) + 1;
    this.app.netron.registerTransport('http', () => new HttpTransport());
    this.app.netron.registerTransportServer('http', {
      name: 'daemon-http',
      options: {
        port: internalHttpPort,
        host: '0.0.0.0',
        cors: true,
        invocationWrapper: authContextWrapper,
      },
    });

    // WebSocket — real-time event push to webapp clients
    const wsPort = (dc.httpPort ?? 9800) + 2;
    this.app.netron.registerTransport('websocket', () => new WebSocketTransport());
    this.app.netron.registerTransportServer('websocket', {
      name: 'daemon-ws',
      options: {
        port: wsPort,
        host: '0.0.0.0',
        invocationWrapper: authContextWrapper,
      },
    });
  }

  // ============================================================================
  // RPC Service Exposure
  // ============================================================================

  private async exposeRpcServices(config: IEcosystemConfig, dc: IDaemonConfig): Promise<void> {
    if (!this.app?.netron) return;

    const container = this.app.container;

    const isSlave = dc.role === 'slave';

    // Core services (available on both master and slave)
    const orchestrator = await container.resolveAsync<OrchestratorService>(ORCHESTRATOR_TOKEN);
    const titanHealth = await container.resolveAsync<IHealthService>(TITAN_HEALTH_TOKEN);
    const logManager = await container.resolveAsync<LogManager>(LOG_MANAGER_TOKEN);
    const logCollector = await container.resolveAsync<LogCollectorService>(LOG_COLLECTOR_TOKEN);
    const loggerModule = await container.resolveAsync<ILoggerModule>(LOGGER_SERVICE_TOKEN);

    const rpcService = new DaemonRpcService(orchestrator, titanHealth, logManager, config, this);
    await this.app.netron.peer.exposeService(rpcService);

    // Logs RPC service (works on both master and slave — uses PG or SQLite)
    const logsRpcService = new LogsRpcService(logCollector);
    await this.app.netron.peer.exposeService(logsRpcService);

    // Metrics RPC service — provided by TitanMetricsModule
    const metricsService = await container.resolveAsync<IMetricsService>(TITAN_METRICS_TOKEN);
    const { MetricsRpcService: MetricsRpc } = await import('@omnitron-dev/titan-metrics');
    const metricsRpcService = new MetricsRpc(metricsService);
    await this.app.netron.peer.exposeService(metricsRpcService);

    // HealthCheck RPC service (no DB dependency)
    const { HealthCheckRpcService: HealthCheckRpc } = await import('../services/health-check.rpc-service.js');
    const healthCheckService = await container.resolveAsync<HealthCheckService>(HEALTH_CHECK_SERVICE_TOKEN);
    const healthCheckRpcService = new HealthCheckRpc(healthCheckService);
    await this.app.netron.peer.exposeService(healthCheckRpcService);

    // Secrets RPC service (file-based, no DB dependency)
    const { SecretsRpcService: SecretsRpc } = await import('../services/secrets.rpc-service.js');
    const secretsService = await container.resolveAsync(SECRETS_SERVICE_TOKEN);
    const secretsRpcService = new SecretsRpc(secretsService);
    await this.app.netron.peer.exposeService(secretsRpcService);

    // Kubernetes RPC service (no DB dependency)
    const { KubernetesRpcService: K8sRpc } = await import('../services/kubernetes.rpc-service.js');
    const kubernetesService = await container.resolveAsync(KUBERNETES_SERVICE_TOKEN);
    const kubernetesRpcService = new K8sRpc(kubernetesService);
    await this.app.netron.peer.exposeService(kubernetesRpcService);

    // Backup RPC service (no DB dependency)
    const { BackupRpcService: BackupRpc } = await import('../services/backup.rpc-service.js');
    const backupService = await container.resolveAsync<BackupService>(BACKUP_SERVICE_TOKEN);
    const backupRpcService = new BackupRpc(backupService);
    await this.app.netron.peer.exposeService(backupRpcService);

    // Infrastructure RPC service (reports infra state — slave has no infra)
    const { InfrastructureRpcService: InfraRpc } = await import('../services/infrastructure.rpc-service.js');
    const infraRpcService = new InfraRpc(() => this.infraService);
    await this.app.netron.peer.exposeService(infraRpcService);

    // Project + Stack management RPC service
    const projectService = await container.resolveAsync<ProjectService>(PROJECT_SERVICE_TOKEN);
    const projectRpcService = new ProjectRpcService(projectService);
    await this.app.netron.peer.exposeService(projectRpcService);

    // Sync service (slave→master data replication)
    const syncNodeId = `${os.hostname()}-${dc.port}`;

    let syncDb: any;
    if (isSlave) {
      const slaveStorage = await container.resolveAsync(SLAVE_STORAGE_TOKEN);
      syncDb = await (slaveStorage as any).getDb();
    } else {
      syncDb = await container.resolveAsync(OMNITRON_DB_TOKEN);
    }
    this.syncService = new SyncService(syncDb, loggerModule.logger.child({ component: 'sync' }), syncNodeId, dc.role, dc.sync);
    const syncRpcService = new SyncRpcService(this.syncService);
    await this.app.netron.peer.exposeService(syncRpcService);

    // System info service (real-time OS/hardware metrics)
    const systemInfoService = new SystemInfoService(loggerModule.logger.child({ component: 'sysinfo' }), dc.role);
    const systemInfoRpcService = new SystemInfoRpcService(systemInfoService);
    await this.app.netron.peer.exposeService(systemInfoRpcService);

    // Event Broadcaster RPC service (WebSocket subscriptions)
    this.eventBroadcaster = new EventBroadcasterService(loggerModule.logger);
    const eventBroadcasterRpcService = new EventBroadcasterRpcService(this.eventBroadcaster);
    await this.app.netron.peer.exposeService(eventBroadcasterRpcService);

    // Node manager — file-based, no PG (master only — manages infrastructure nodes)
    // Health checks delegated to dedicated system worker (started later after infra is ready)
    if (!isSlave) {
      const { NodeManagerService } = await import('../services/node-manager.service.js');
      const { NodeManagerRpcService } = await import('../services/node-manager.rpc-service.js');
      const secretsService = await container.resolveAsync(SECRETS_SERVICE_TOKEN);
      const nodeManager = new NodeManagerService(loggerModule.logger.child({ component: 'nodes' }), secretsService as any);
      this.nodeManagerService = nodeManager;
      const nodeManagerRpcService = new NodeManagerRpcService(nodeManager);
      this.nodeManagerRpcService = nodeManagerRpcService;
      await this.app.netron.peer.exposeService(nodeManagerRpcService);
    }

    // =====================================================================
    // Master-only RPC services (require PostgreSQL)
    // =====================================================================

    if (!isSlave) {
      // Auth RPC service
      const authService = await container.resolveAsync<AuthService>(AUTH_SERVICE_TOKEN);
      const authRpcService = new AuthRpcService(authService);
      await this.app.netron.peer.exposeService(authRpcService);

      // Alert RPC service
      const { AlertRpcService: AlertRpc } = await import('../services/alert.rpc-service.js');
      const alertService = await container.resolveAsync<AlertService>(ALERT_SERVICE_TOKEN);
      const alertRpcService = new AlertRpc(alertService);
      await this.app.netron.peer.exposeService(alertRpcService);

      // Telemetry relay RPC service
      const { TelemetryRpcService: TelemetryRpc } = await import('../services/telemetry.rpc-service.js');
      const telemetryRelay = await container.resolveAsync<TelemetryRelayService>(TELEMETRY_RELAY_TOKEN);
      const telemetryRpcService = new TelemetryRpc(telemetryRelay);
      await this.app.netron.peer.exposeService(telemetryRpcService);

      // Fleet management RPC service
      const { FleetRpcService: FleetRpc } = await import('../services/fleet.rpc-service.js');
      const fleetService = await container.resolveAsync<FleetService>(FLEET_SERVICE_TOKEN);
      const fleetRpcService = new FleetRpc(fleetService);
      await this.app.netron.peer.exposeService(fleetRpcService);

      // Discovery RPC service
      const { DiscoveryRpcService: DiscoveryRpc } = await import('../services/discovery.rpc-service.js');
      const discoveryService = await container.resolveAsync(DISCOVERY_SERVICE_TOKEN);
      const discoveryRpcService = new DiscoveryRpc(discoveryService);
      await this.app.netron.peer.exposeService(discoveryRpcService);

      // Pipeline RPC service
      const { PipelineRpcService: PipelineRpc } = await import('../services/pipeline.rpc-service.js');
      const pipelineService = await container.resolveAsync(PIPELINE_SERVICE_TOKEN);
      const pipelineRpcService = new PipelineRpc(pipelineService);
      await this.app.netron.peer.exposeService(pipelineRpcService);

      // Trace collector RPC service
      const { TraceRpcService: TraceRpc } = await import('../services/trace-collector.rpc-service.js');
      const traceCollector = await container.resolveAsync<TraceCollectorService>(TRACE_COLLECTOR_TOKEN);
      const traceRpcService = new TraceRpc(traceCollector);
      await this.app.netron.peer.exposeService(traceRpcService);

      // Deploy RPC service
      const { DeployRpcService: DeployRpc } = await import('../services/deploy.rpc-service.js');
      const deployService = await container.resolveAsync(DEPLOY_SERVICE_TOKEN);
      const deployRpcService = new DeployRpc(deployService);
      await this.app.netron.peer.exposeService(deployRpcService);
    }

    // Cluster — leader election + config sync (optional, enabled via config, master only)
    // LeaderElection is created here once and stored; startBackgroundServices() starts it.
    if (dc.cluster?.enabled && !isSlave) {
      const { LeaderElection } = await import('../cluster/leader-election.js');
      const { ClusterRpcService: ClusterRpc } = await import('../cluster/cluster.rpc-service.js');

      const nodeId = `${os.hostname()}-${dc.port}`;
      const clusterFleetService = await container.resolveAsync<FleetService>(FLEET_SERVICE_TOKEN);

      this.leaderElection = new LeaderElection(
        nodeId,
        clusterFleetService,
        loggerModule.logger,
        {
          ...(dc.cluster!.electionTimeout && { electionTimeout: dc.cluster!.electionTimeout }),
          ...(dc.cluster!.heartbeatInterval != null && { heartbeatInterval: dc.cluster!.heartbeatInterval }),
        }
      );

      const clusterRpcService = new ClusterRpc(this.leaderElection);
      await this.app.netron.peer.exposeService(clusterRpcService);
    }
  }

  // ============================================================================
  // Log Persistence Wiring
  // ============================================================================

  private async wireLogPersistence(): Promise<void> {
    if (!this.app) return;

    const orchestrator = await this.app.container.resolveAsync<OrchestratorService>(ORCHESTRATOR_TOKEN);
    const logManager = await this.app.container.resolveAsync<LogManager>(LOG_MANAGER_TOKEN);
    const logCollector = await this.app.container.resolveAsync<LogCollectorService>(LOG_COLLECTOR_TOKEN);

    orchestrator.onAppLog((appName, line) => {
      logManager.appendToFile(appName, line);
      logCollector.ingestPinoLine(appName, line);
    });

    // Wire daemon's own logs into LogCollector (buffered since pino starts before DI)
    const collectorStream = getDaemonLogCollectorStream();
    if (collectorStream) {
      collectorStream.setCollector(logCollector);
    }

    logManager.onRotate((appName) => {
      if (appName === 'omnitron') {
        getDaemonLogStream()?.reopen();
        getDaemonErrorStream()?.reopen();
      }
    });
  }

  // ============================================================================
  // Crash Recovery Check
  // ============================================================================

  private async checkCrashRecovery(logger: import('@omnitron-dev/titan/module/logger').ILogger): Promise<void> {
    if (!this.app) return;

    const stateStore = await this.app.container.resolveAsync<StateStore>(STATE_STORE_TOKEN);
    const previousState = stateStore.load();
    if (previousState) {
      const runningApps = previousState.apps.filter((a) => a.status === 'online' || a.status === 'starting');
      if (runningApps.length > 0) {
        logger.warn(
          {
            previousApps: runningApps.map((a) => ({ name: a.name, pid: a.pid, status: a.status })),
            crashedAt: new Date(previousState.updatedAt).toISOString(),
          },
          'Detected unclean shutdown — previous daemon had running apps'
        );
      }
      stateStore.clear();
    }
  }

  // ============================================================================
  // Infrastructure Provisioning (Phase 1: full pipeline with gate)
  // ============================================================================

  private async startInfrastructure(
    config: IEcosystemConfig,
    options: DaemonStartOptions | undefined,
    logger: import('@omnitron-dev/titan/module/logger').ILogger,
  ): Promise<void> {
    if (!this.app) return;

    const gate = await this.app.container.resolveAsync<InfrastructureGate>(INFRASTRUCTURE_GATE_TOKEN);

    if (options?.noInfra) {
      gate.markFailed('Infrastructure provisioning skipped (--no-infra)');
      return;
    }

    const isSlave = this.dc.role === 'slave';
    const startTime = Date.now();

    // Step 1: Provision omnitron's own database (omnitron-pg)
    // Slave daemons use SQLite — no Docker, no PostgreSQL
    if (isSlave) {
      logger.info({ role: 'slave' }, 'Slave mode — skipping omnitron-pg provisioning (using SQLite)');
    } else {
      try {
        const { resolveOmnitronPg } = await import('../infrastructure/service-resolver.js');
        const { createContainer, getContainerState, waitForHealthy, ensureImage, removeContainer, createVolume } =
          await import('../infrastructure/container-runtime.js');

        const pgSpec = resolveOmnitronPg();
        const existing = await getContainerState(pgSpec.name);

        if (!existing || existing.status !== 'running') {
          logger.info('Provisioning omnitron-pg...');
          if (existing) await removeContainer(pgSpec.name);
          await ensureImage(pgSpec.image);
          for (const vol of pgSpec.volumes) {
            if (!vol.source.startsWith('/')) await createVolume(vol.source);
          }
          await createContainer(pgSpec);
          await waitForHealthy(pgSpec.name, 60_000);
          logger.info('omnitron-pg ready');
        } else {
          logger.debug('omnitron-pg already running');
        }

        await this.runOmnitronMigrations(logger);
      } catch (err) {
        logger.error({ error: (err as Error).message }, 'Failed to provision omnitron-pg');
        logger.warn('Continuing without internal database — some features will be unavailable');
      }
    }

    // Step 2: Provision app infrastructure (postgres, redis, minio) if declared
    // Slave daemons never provision Docker infrastructure
    if (config.infrastructure && !isSlave) {
      try {
        this.infraService = new InfrastructureService(logger, config.infrastructure);
        const infraState = await this.infraService.provision();

        const provisionTimeMs = Date.now() - startTime;
        gate.markReady(infraState);

        this.eventBroadcaster?.broadcast(INFRA_EVENTS.READY, {
          services: Object.keys(infraState.services),
          provisionTimeMs,
        } satisfies InfraReadyEvent);

        logger.info(
          { services: Object.keys(infraState.services), provisionTimeMs },
          'App infrastructure provisioned and healthy'
        );
      } catch (err) {
        const reason = (err as Error).message;
        gate.markFailed(reason);

        this.eventBroadcaster?.broadcast(INFRA_EVENTS.FAILED, {
          error: reason,
        } satisfies InfraFailedEvent);

        logger.error({ error: reason }, 'Failed to provision app infrastructure');
        logger.warn('Apps with infrastructure requirements may fail to start');
      }
    } else {
      // No infrastructure declared — mark gate as ready with empty state
      gate.markReady({ services: {}, ready: true });
    }
  }

  /**
   * Remove orphan containers that Docker auto-restarted after a system reboot
   * but don't belong to any currently registered project/stack.
   *
   * Containers are identified via the `omnitron.managed=true` label.
   * Internal containers (omnitron-pg, omnitron-nginx) are always kept.
   * Stack containers without `omnitron.stack` label (legacy) that conflict
   * with current stack containers are stopped.
   */
  private async reconcileOrphanContainers(
    logger: ILogger,
    projects: { name: string; enabledStacks?: string[] }[],
    projectService: ProjectService,
  ): Promise<void> {
    const { listManagedContainers, stopContainer, removeContainer } =
      await import('../infrastructure/container-runtime.js');

    const managed = await listManagedContainers();
    if (managed.length === 0) return;

    // Build set of expected container name prefixes from registered projects/stacks
    const expectedPrefixes = new Set<string>();
    const internalNames = new Set(['omnitron-pg', 'omnitron-nginx']);

    for (const project of projects) {
      const stacks = projectService.listStacks(project.name);
      for (const stack of stacks) {
        expectedPrefixes.add(`${project.name}-${stack.name}-`);
      }
    }

    let orphanCount = 0;
    for (const container of managed) {
      // Always keep internal omnitron containers
      if (internalNames.has(container.name)) continue;
      // Keep containers that match a known project/stack prefix
      if ([...expectedPrefixes].some((prefix) => container.name.startsWith(prefix))) continue;

      // This container is an orphan — stop and remove it
      logger.info(
        { container: container.name, status: container.status },
        'Removing orphan container (not part of any registered stack)',
      );
      try {
        if (container.status === 'running') await stopContainer(container.name);
        await removeContainer(container.name);
        orphanCount++;
      } catch (err) {
        logger.warn(
          { container: container.name, error: (err as Error).message },
          'Failed to remove orphan container',
        );
      }
    }

    if (orphanCount > 0) {
      logger.info({ removed: orphanCount }, 'Orphan container cleanup complete');
    }
  }

  private async runOmnitronMigrations(logger: ILogger): Promise<void> {
    try {
      const { Kysely, PostgresDialect, Migrator } = await import('kysely');
      const pg = await import('pg');
      const m001 = await import('../database/migrations/001_initial_schema.js');
      const m002 = await import('../database/migrations/002_metrics_raw.js');
      const m003 = await import('../database/migrations/003_pipelines_traces.js');
      const m004 = await import('../database/migrations/004_sync_buffer.js');
      const m005 = await import('../database/migrations/005_node_health_checks.js');

      const pool = new pg.default.Pool({
        host: 'localhost', port: 5480,
        database: 'omnitron', user: 'omnitron', password: 'omnitron',
      });

      const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });

      try {
        const migrator = new Migrator({
          db,
          provider: {
            async getMigrations() {
              return {
                '001_initial_schema': { up: m001.up, down: m001.down },
                '002_metrics_raw': { up: m002.up, down: m002.down },
                '003_pipelines_traces': { up: m003.up, down: m003.down },
                '004_sync_buffer': { up: m004.up, down: m004.down },
                '005_node_health_checks': { up: m005.up, down: m005.down },
              };
            },
          },
        });

        const { results, error } = await migrator.migrateToLatest();
        const applied = results?.filter((r) => r.status === 'Success') ?? [];
        if (applied.length > 0) {
          logger.info({ migrations: applied.map((r: any) => r.migrationName) }, `Applied ${applied.length} migration(s)`);
        }
        if (error) logger.warn({ error: String(error) }, 'Migration warning');
      } finally {
        await db.destroy();
      }
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'Could not run migrations — will retry on next start');
    }
  }

  // ============================================================================
  // Health Indicators (Phase 2: titan-health custom indicators)
  // ============================================================================

  private async registerHealthIndicators(): Promise<void> {
    if (!this.app) return;

    try {
      const titanHealth = await this.app.container.resolveAsync<IHealthService>(TITAN_HEALTH_TOKEN);
      const orchestrator = await this.app.container.resolveAsync<OrchestratorService>(ORCHESTRATOR_TOKEN);

      // Docker containers health indicator
      titanHealth.registerIndicator(new DockerHealthIndicator(() => this.infraService));

      // Managed apps health indicator
      titanHealth.registerIndicator(new AppHealthIndicator(orchestrator));
    } catch {
      // Health module may not be available — non-critical
    }
  }

  // ============================================================================
  // File Watching (dev mode)
  // ============================================================================

  private startFileWatcher(
    config: IEcosystemConfig,
    options: DaemonStartOptions | undefined,
    logger: import('@omnitron-dev/titan/module/logger').ILogger,
  ): void {
    if (!options?.watch || options?.noWatch || !this.app) return;

    this.app.container.resolveAsync<OrchestratorService>(ORCHESTRATOR_TOKEN).then((orchestrator) => {
      orchestrator.devMode = true;
      this.fileWatcher = new FileWatcher(logger, orchestrator, config, process.cwd());
      this.fileWatcher.start(options.watchApps);

      const watched = this.fileWatcher.getWatchedApps();
      for (const w of watched) {
        logger.info({ app: w.name, directory: w.directory }, 'Watching for changes');
      }
    });
  }

  // ============================================================================
  // Start Managed Apps
  // ============================================================================

  /**
   * Start all projects and their enabled stacks.
   *
   * The daemon is a UNIFIED CONTROL PLANE — it manages ALL registered projects
   * and ALL their stacks simultaneously. A single host can run:
   *   - Project A: dev (local), test (remote), prod (cluster)
   *   - Project B: dev (local)
   *   - Project C: dev (local), staging (remote)
   * All at the same time.
   */
  private async startApps(
    _config: IEcosystemConfig,
    logger: import('@omnitron-dev/titan/module/logger').ILogger,
  ): Promise<void> {
    if (!this.app) return;

    const projectService = await this.app.container.resolveAsync<ProjectService>(PROJECT_SERVICE_TOKEN);
    let allProjects = projectService.listProjects();

    // Auto-register project from CWD if no projects registered
    if (allProjects.length === 0) {
      try {
        // Use ProjectService's own registry to auto-detect — keeps in-memory state consistent
        projectService.autoDetectProject();
        allProjects = projectService.listProjects();
        if (allProjects.length > 0) {
          const p = allProjects[0]!;
          await projectService.loadProjectConfig(p.name);
          logger.info({ project: p.name, path: p.path }, 'Auto-registered project from CWD');
        }
      } catch (err) {
        logger.debug({ error: (err as Error).message }, 'No project auto-detected from CWD');
      }
    }

    if (allProjects.length === 0) {
      logger.info('No projects registered. Use `omnitron project add <name> <path>` or run from a directory with omnitron.config.ts');
      return;
    }

    // Reconcile orphan containers: stop/remove any omnitron.managed containers
    // that don't belong to current registered projects/stacks (e.g. leftovers from
    // a previous session or auto-restarted by Docker after a system reboot).
    try {
      await this.reconcileOrphanContainers(logger, allProjects, projectService);
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'Orphan container reconciliation failed — continuing');
    }

    // Iterate ALL registered projects and start their enabled stacks
    let totalStacks = 0;

    for (const project of allProjects) {
      // Load project config (populates internal cache used by listStacks)
      try {
        await projectService.loadProjectConfig(project.name);
      } catch (err) {
        logger.warn(
          { project: project.name, error: (err as Error).message },
          'Failed to load project config — skipping'
        );
        continue;
      }

      // Only start stacks that were explicitly enabled (persisted in registry).
      // Stacks are never auto-started — user must explicitly start via CLI or webapp.
      // Use listStacks() to include user stacks from omnitron.stacks.json (not just config stacks).
      const availableStacks = projectService.listStacks(project.name).map((s) => s.name);
      const enabledStacks = (project.enabledStacks ?? [])
        .filter((s) => availableStacks.includes(s));

      if (enabledStacks.length === 0) {
        logger.debug({ project: project.name }, 'No enabled stacks — skipping');
        continue;
      }

      logger.info(
        { project: project.name, stacks: enabledStacks },
        'Starting project stacks'
      );

      // Start each enabled stack
      for (const stackName of enabledStacks) {
        try {
          await projectService.startStack(project.name, stackName);
          totalStacks++;
          logger.info({ project: project.name, stack: stackName }, 'Stack started');
        } catch (err) {
          logger.error(
            { project: project.name, stack: stackName, error: (err as Error).message },
            'Failed to start stack — continuing with remaining'
          );
        }
      }
    }

    logger.info(
      { projects: allProjects.length, stacks: totalStacks },
      'All projects and stacks initialized'
    );
  }

  // ============================================================================
  // Scheduled Tasks (Phase 2: titan-scheduler replaces bare setInterval)
  // ============================================================================

  private async startScheduledTasks(
    config: IEcosystemConfig,
    logger: import('@omnitron-dev/titan/module/logger').ILogger,
  ): Promise<void> {
    if (!this.app) return;

    const container = this.app.container;

    const isSlave = this.dc.role === 'slave';

    try {
      const scheduler = await container.resolveAsync<SchedulerService>(SCHEDULER_SERVICE_TOKEN);
      const orchestrator = await container.resolveAsync<OrchestratorService>(ORCHESTRATOR_TOKEN);
      const titanMetrics = await container.resolveAsync<IMetricsService>(TITAN_METRICS_TOKEN);
      const logManager = await container.resolveAsync<LogManager>(LOG_MANAGER_TOKEN);

      // Master-only services (require PG)
      const authService = !isSlave ? await container.resolveAsync<AuthService>(AUTH_SERVICE_TOKEN) : null;
      const alertService = !isSlave ? await container.resolveAsync<AlertService>(ALERT_SERVICE_TOKEN) : null;
      const fleetService = !isSlave ? await container.resolveAsync<FleetService>(FLEET_SERVICE_TOKEN) : null;

      registerDaemonJobs(scheduler, {
        logger,
        orchestrator,
        authService,
        metricsService: titanMetrics,
        alertService,
        fleetService,
        logManager,
        infraService: this.infraService,
        metricsInterval: config.monitoring.metrics.interval,
        healthCheckInterval: config.monitoring.healthCheck.interval,
      });

      // Start titan-metrics collection + flush
      titanMetrics.start();
      logger.info('Daemon scheduler started with all periodic jobs');
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'Failed to start scheduler — falling back to manual timers');
    }
  }

  // ============================================================================
  // Background Services (telemetry, traces, fleet, leader election)
  // ============================================================================

  private async startBackgroundServices(
    config: IEcosystemConfig,
    logger: import('@omnitron-dev/titan/module/logger').ILogger,
  ): Promise<void> {
    if (!this.app) return;

    const container = this.app.container;
    const isSlave = this.dc.role === 'slave';

    // Start telemetry relay (master only — requires PG)
    if (!isSlave) {
      try {
        const telemetryRelay = await container.resolveAsync<TelemetryRelayService>(TELEMETRY_RELAY_TOKEN);
        await telemetryRelay.start();
        logger.info({ nodeId: telemetryRelay.nodeId, role: telemetryRelay.role }, 'Telemetry relay started');
      } catch (err) {
        logger.warn({ error: (err as Error).message }, 'Telemetry relay failed to start');
      }
    }

    // Register self in fleet (master only — requires PG)
    if (!isSlave) {
      try {
        const fleetService = await container.resolveAsync<FleetService>(FLEET_SERVICE_TOKEN);
        await fleetService.registerNode({
          hostname: os.hostname(),
          address: this.dc.host === '0.0.0.0' ? '127.0.0.1' : this.dc.host,
          port: this.dc.port,
          role: 'leader',
          metadata: { pid: process.pid, version: CLI_VERSION, httpPort: this.dc.httpPort },
        });
      } catch {
        // Non-critical — DB may not be ready
      }
    }

    // Start sync service (slave→master data replication)
    // Slaves buffer data locally and wait for master to connect and pull.
    // Master initiates connections to slaves (slaves are always reachable).
    if (this.syncService) {
      this.syncService.start();
      if (this.dc.role === 'slave') {
        logger.info({ role: 'slave' }, 'Sync service started — buffering locally, waiting for master to connect');
      }
    }

    // Start trace collector (master only — requires PG)
    if (!isSlave) {
      try {
        const traceCollector = await container.resolveAsync<TraceCollectorService>(TRACE_COLLECTOR_TOKEN);
        traceCollector.start();
        logger.info('Trace collector started');
      } catch (err) {
        logger.warn({ error: (err as Error).message }, 'Trace collector failed to start');
      }
    }

    // Start leader election (cluster mode, master only)
    // LeaderElection instance is already created in exposeRpcServices(); just start it here.
    if (this.leaderElection && !isSlave) {
      try {
        await this.leaderElection.start();
        logger.info({ cluster: true }, 'Leader election started');

        const loggerModule = await container.resolveAsync<ILoggerModule>(LOGGER_SERVICE_TOKEN);
        const { ConfigSyncService } = await import('../cluster/config-sync.js');
        this.configSyncService = new ConfigSyncService(config, loggerModule.logger);
      } catch (err) {
        logger.warn({ error: (err as Error).message }, 'Leader election failed to start');
      }
    }
  }

  // ============================================================================
  // Health Monitor System Worker
  // ============================================================================

  private async startHealthMonitorWorker(
    logger: import('@omnitron-dev/titan/module/logger').ILogger,
  ): Promise<void> {
    if (!this.app || !this.nodeManagerService || this.dc.role === 'slave') return;

    try {
      const titanPm = await import('@omnitron-dev/titan-pm');
      const { SystemWorkerManager } = await import('../workers/system-worker-manager.js');
      const { fileURLToPath } = await import('node:url');
      const nodePath = await import('node:path');

      // Resolve PM from DI
      const pm = await this.app.container.resolveAsync<any>(titanPm.PM_MANAGER_TOKEN);

      const loggerModule = await this.app.container.resolveAsync<ILoggerModule>(LOGGER_SERVICE_TOKEN);
      this.systemWorkerManager = new SystemWorkerManager(pm, loggerModule.logger.child({ component: 'system-workers' }));

      // Build health monitor config
      const hmDefaults = this.dc.healthMonitor ?? {};
      const healthConfig = {
        intervalMs: hmDefaults.intervalMs ?? 30_000,
        concurrency: hmDefaults.concurrency ?? 20,
        offlineTimeoutMs: hmDefaults.offlineTimeoutMs ?? 90_000,
        pingTimeout: hmDefaults.pingTimeout ?? 5_000,
        sshTimeout: hmDefaults.sshTimeout ?? 10_000,
        omnitronCheckTimeout: hmDefaults.omnitronCheckTimeout ?? 15_000,
        pingEnabled: hmDefaults.pingEnabled ?? true,
        retentionDays: hmDefaults.retentionDays ?? 7,
        dbUrl: 'postgresql://omnitron:omnitron@localhost:5480/omnitron',
      };

      // Get worker process path — .ts when running via tsx, .js when compiled
      const thisDir = nodePath.dirname(fileURLToPath(import.meta.url));
      const isTsx = process.execArgv.some((a) => a.includes('tsx'));
      const ext = isTsx ? '.ts' : '.js';
      const workerPath = nodePath.resolve(thisDir, '..', 'workers', `health-monitor-process${ext}`);

      // Convert nodes to check targets
      const nodesJson = JSON.stringify(await this.nodeManagerService.getNodeCheckTargets());
      const configJson = JSON.stringify(healthConfig);

      const spawnOpts: { execArgv?: string[]; startupTimeout?: number } = {};
      if (process.execArgv.some((a) => a.includes('tsx'))) {
        spawnOpts.execArgv = ['--import', 'tsx/esm'];
      }
      spawnOpts.startupTimeout = 30_000;

      const proxy = await this.systemWorkerManager.spawn(
        'health-monitor',
        workerPath,
        { configJson, nodesJson },
        spawnOpts,
      );

      // Wire IPC: worker → master status cache updates via PM's public API
      const nodeManager = this.nodeManagerService;
      const eventBroadcaster = this.eventBroadcaster;

      this.systemWorkerManager.onMessage('health-monitor', (msg: any) => {
        if (msg?.type === 'health:status_batch' && Array.isArray(msg.summaries)) {
          nodeManager.updateStatusCacheFromWorker(msg.summaries);
          // Broadcast node status updates via WebSocket
          if (eventBroadcaster) {
            const online = msg.summaries.filter((s: any) => s.status === 'online').length;
            const degraded = msg.summaries.filter((s: any) => s.status === 'degraded').length;
            const offline = msg.summaries.filter((s: any) => s.status === 'offline').length;
            eventBroadcaster.broadcast(NODE_EVENTS.CHECK_COMPLETED, {
              nodeCount: msg.summaries.length,
              onlineCount: online,
              degradedCount: degraded,
              offlineCount: offline,
            });
          }
        }
      });

      // Wire node CRUD events → sync to worker
      const syncNodesToWorker = async () => {
        const targets = await nodeManager.getNodeCheckTargets();
        (proxy as any).updateNodes(JSON.stringify(targets)).catch(() => {});
      };
      nodeManager.on('node:added', syncNodesToWorker);
      nodeManager.on('node:updated', syncNodesToWorker);
      nodeManager.on('node:removed', syncNodesToWorker);

      // Wire RPC service to use worker proxy + PG repository for direct reads
      if (this.nodeManagerRpcService) {
        this.nodeManagerRpcService.setHealthWorkerProxy(proxy as any);
        // Wire PG repository for direct history reads (bypasses worker)
        try {
          const db = await this.app!.container.resolveAsync(OMNITRON_DB_TOKEN);
          const { NodeHealthRepository } = await import('../services/node-health.repository.js');
          this.nodeManagerRpcService.setHealthRepository(new NodeHealthRepository(db));
        } catch {
          logger.warn({}, 'Could not wire health repository — PG may not be ready');
        }
      }

      logger.info({ intervalMs: healthConfig.intervalMs }, 'Health monitor system worker started');
    } catch (err) {
      logger.warn(
        { error: (err as Error).message },
        'Health monitor worker failed to start — falling back to direct checks'
      );
      // Fallback: start legacy periodic checks if worker fails
      // This ensures node status still works even without the worker
      if (this.nodeManagerService) {
        const intervalMs = this.dc.healthMonitor?.intervalMs ?? 30_000;
        const timer = setInterval(() => void this.nodeManagerService?.checkAllNodes(), intervalMs);
        timer.unref();
        void this.nodeManagerService.checkAllNodes();
      }
    }
  }

  // ============================================================================
  // Event Broadcasting (Phase 3: orchestrator events → WebSocket push)
  // ============================================================================

  private async wireEventBroadcasting(
    logger: import('@omnitron-dev/titan/module/logger').ILogger,
  ): Promise<void> {
    if (!this.app || !this.eventBroadcaster) return;

    const orchestrator = await this.app.container.resolveAsync<OrchestratorService>(ORCHESTRATOR_TOKEN);
    const broadcaster = this.eventBroadcaster;

    // Wire orchestrator events to broadcaster
    orchestrator.on('app:online', (appName: string) => {
      const handle = orchestrator.getHandle(appName);
      broadcaster.broadcast(APP_EVENTS.STARTED, {
        name: appName,
        pid: handle?.pid ?? null,
        mode: handle?.mode ?? 'bootstrap',
        instances: handle?.instanceCount ?? 1,
      } satisfies AppStartedEvent);
    });

    orchestrator.on('app:crash', (appName: string, error: Error) => {
      const handle = orchestrator.getHandle(appName);
      broadcaster.broadcast(APP_EVENTS.CRASHED, {
        name: appName,
        error: error.message,
        restarts: handle?.restarts ?? 0,
        critical: handle?.entry.critical ?? false,
      } satisfies AppCrashedEvent);
    });

    orchestrator.on('app:restart', (appName: string, attempt: number) => {
      broadcaster.broadcast(APP_EVENTS.RESTARTING, {
        name: appName,
        attempt,
      } satisfies AppRestartingEvent);
    });

    // Wire project/stack events
    const projectService = await this.app.container.resolveAsync<ProjectService>(PROJECT_SERVICE_TOKEN);

    projectService.on('project:added', (name: string, projectPath: string) => {
      broadcaster.broadcast(PROJECT_EVENTS.ADDED, {
        name,
        path: projectPath,
      } satisfies ProjectAddedEvent);
    });

    projectService.on('project:removed', (name: string) => {
      broadcaster.broadcast(PROJECT_EVENTS.REMOVED, { name } satisfies ProjectRemovedEvent);
    });

    projectService.on('project:config_reloaded', (name: string) => {
      broadcaster.broadcast(PROJECT_EVENTS.CONFIG_RELOADED, { name });
    });

    projectService.on('stack:started', (project: string, stack: string, type: string) => {
      broadcaster.broadcast(STACK_EVENTS.STARTED, {
        project,
        stack,
        type: type as 'local' | 'remote' | 'cluster',
        appCount: 0,
        nodeCount: 0,
      } satisfies StackStartedEvent);
    });

    projectService.on('stack:stopped', (project: string, stack: string, reason: string) => {
      broadcaster.broadcast(STACK_EVENTS.STOPPED, {
        project,
        stack,
        reason: reason as 'manual' | 'error' | 'shutdown',
      } satisfies StackStoppedEvent);
    });

    projectService.on('stack:error', (project: string, stack: string, error: string) => {
      broadcaster.broadcast(STACK_EVENTS.ERROR, {
        project,
        stack,
        error,
      } satisfies StackErrorEvent);
    });

    projectService.on('stack:deploy_progress', (project: string, stack: string, progress: any) => {
      broadcaster.broadcast(STACK_EVENTS.DEPLOY_PROGRESS, {
        project,
        stack,
        ...progress,
      });
    });

    logger.debug('Event broadcasting wired to orchestrator and project service');
  }

  // ============================================================================
  // Watch Mode Control (used by DaemonRpcService)
  // ============================================================================

  async enableWatch(apps?: string[]): Promise<Array<{ name: string; directory: string }>> {
    if (!this.app) throw new Error('Daemon not started');

    const orchestrator = await this.app.container.resolveAsync<OrchestratorService>(ORCHESTRATOR_TOKEN);
    const loggerModule = await this.app.container.resolveAsync<ILoggerModule>(LOGGER_SERVICE_TOKEN);

    if (this.fileWatcher) {
      this.fileWatcher.stop();
    }

    const config = await this.getConfig();
    this.fileWatcher = new FileWatcher(loggerModule.logger, orchestrator, config, process.cwd());
    this.fileWatcher.start(apps);
    return this.fileWatcher.getWatchedApps();
  }

  disableWatch(): void {
    if (this.fileWatcher) {
      this.fileWatcher.stop();
      this.fileWatcher = null;
    }
  }

  getWatchStatus(): { enabled: boolean; apps: Array<{ name: string; directory: string }> } {
    if (!this.fileWatcher) return { enabled: false, apps: [] };
    return { enabled: true, apps: this.fileWatcher.getWatchedApps() };
  }

  private async getConfig(): Promise<IEcosystemConfig> {
    const { loadEcosystemConfig } = await import('../config/loader.js');
    return loadEcosystemConfig();
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Trigger graceful shutdown via Application's lifecycle system.
   * Called by DaemonRpcService.shutdown() for the `omnitron shutdown` CLI command.
   */
  async stop(): Promise<void> {
    if (!this.app) return;
    await this.app.shutdown(ShutdownReason.Manual);
    // Application doesn't process.exit() for Manual reason — do it explicitly
    process.exit(0);
  }

  /**
   * Register all daemon shutdown tasks with Application's lifecycle system.
   *
   * Application handles SIGTERM/SIGINT/SIGHUP automatically and runs
   * shutdown tasks in priority order before calling app.stop() and process.exit().
   *
   * Priority order (lower = first):
   *   First (0)     — Broadcast stopping event, stop file watcher
   *   VeryHigh (10) — Stop managed apps (orchestrator.stopAll)
   *   High (20)     — Stop background services (scheduler, telemetry, alerts, fleet)
   *   Normal (50)   — Stop system workers, node manager, sync, cluster
   *   Low (80)      — Flush logs to DB, clear state
   *   VeryLow (90)  — Dispose project service, teardown infrastructure
   *   Last (100)    — Remove PID file
   */
  private registerShutdownTasks(app: Application): void {
    const container = app.container;

    // Broadcast DAEMON_EVENTS.STOPPING on shutdown start
    app.on(ApplicationEvent.ShutdownStart, ({ reason, details }: any) => {
      this.eventBroadcaster?.broadcast(DAEMON_EVENTS.STOPPING, {
        reason,
        signal: details?.signal,
      });
    });

    // --- Priority: First (0) — Immediate cleanup ---
    app.registerShutdownTask('stop-file-watcher-and-webapp', async () => {
      if (this.fileWatcher) {
        this.fileWatcher.stop();
        this.fileWatcher = null;
      }
      if (this.eventBroadcaster) {
        this.eventBroadcaster.clear();
        this.eventBroadcaster = null;
      }
      // Stop webapp nginx container (non-blocking — don't wait if slow)
      try {
        const { removeContainer } = await import('../infrastructure/container-runtime.js');
        void removeContainer('omnitron-nginx');
      } catch { /* non-critical */ }
    }, ShutdownPriority.First);

    // --- Priority: VeryHigh (10) — Stop managed apps (fast — 5s per app max) ---
    app.registerShutdownTask('stop-managed-apps', async () => {
      const orchestrator = await container.resolveAsync<OrchestratorService>(ORCHESTRATOR_TOKEN);
      await orchestrator.stopAll(true); // force=true for fast shutdown (SIGTERM + 5s → SIGKILL)
    }, ShutdownPriority.VeryHigh);

    // --- Priority: High (20) — Stop background services ---
    app.registerShutdownTask('stop-background-services', async () => {
      try {
        const relay = await container.resolveAsync<TelemetryRelayService>(TELEMETRY_RELAY_TOKEN);
        await relay.stop();
      } catch { /* non-critical */ }

      try {
        const mc = await container.resolveAsync<IMetricsService>(TITAN_METRICS_TOKEN);
        await mc.stop();
      } catch { /* non-critical */ }

      try {
        const alert = await container.resolveAsync<AlertService>(ALERT_SERVICE_TOKEN);
        alert.stop();
      } catch { /* non-critical */ }

      try {
        const fleet = await container.resolveAsync<FleetService>(FLEET_SERVICE_TOKEN);
        fleet.stopHeartbeatSweep();
      } catch { /* non-critical */ }

      try {
        const tc = await container.resolveAsync<TraceCollectorService>(TRACE_COLLECTOR_TOKEN);
        await tc.stop();
      } catch { /* non-critical */ }
    }, ShutdownPriority.High);

    // --- Priority: Normal (50) — System workers, node manager, sync, cluster ---
    app.registerShutdownTask('stop-system-services', async () => {
      if (this.syncService) {
        try { await this.syncService.stop(); } catch { /* non-critical */ }
        this.syncService = null;
      }

      try {
        if (this.leaderElection?.stop) this.leaderElection.stop();
      } catch { /* non-critical */ }

      try {
        if (this.configSyncService?.stopPeriodicSync) this.configSyncService.stopPeriodicSync();
      } catch { /* non-critical */ }

      if (this.systemWorkerManager) {
        try { await this.systemWorkerManager.stopAll(); } catch { /* non-critical */ }
        this.systemWorkerManager = null;
      }

      if (this.nodeManagerRpcService) {
        this.nodeManagerRpcService.setHealthWorkerProxy(null);
        this.nodeManagerRpcService.setHealthRepository(null);
        this.nodeManagerRpcService = null;
      }
      if (this.nodeManagerService) {
        try { await this.nodeManagerService.dispose(); } catch { /* non-critical */ }
        this.nodeManagerService = null;
      }

      try {
        const bs = await container.resolveAsync<BackupService>(BACKUP_SERVICE_TOKEN);
        bs.dispose();
      } catch { /* non-critical */ }
    }, ShutdownPriority.Normal);

    // --- Priority: Low (80) — Flush logs, clear state ---
    app.registerShutdownTask('flush-and-clear', async () => {
      try {
        const logCollector = await container.resolveAsync<LogCollectorService>(LOG_COLLECTOR_TOKEN);
        await logCollector.dispose();
      } catch { /* non-critical */ }

      try {
        const stateStore = await container.resolveAsync<StateStore>(STATE_STORE_TOKEN);
        stateStore.clear();
      } catch { /* non-critical */ }
    }, ShutdownPriority.Low);

    // --- Priority: VeryLow (90) — Project service, infrastructure teardown ---
    app.registerShutdownTask('teardown-infrastructure', async () => {
      try {
        const projectSvc = await container.resolveAsync<ProjectService>(PROJECT_SERVICE_TOKEN);
        await projectSvc.dispose();
      } catch { /* non-critical */ }

      if (this.infraService) {
        try { await this.infraService.teardown(); } catch { /* best-effort */ }
        this.infraService = null;
      }
    }, ShutdownPriority.VeryLow);

    // --- Priority: Last (100) — PID file removal ---
    app.registerShutdownTask('remove-pid', () => {
      this.pidManager?.remove();
    }, ShutdownPriority.Last);
  }
}
