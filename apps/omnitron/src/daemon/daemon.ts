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
  AUDIT_SERVICE_TOKEN,
  DAEMON_STATE_STORE_TOKEN,
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
import {
  AuthenticationManager,
  AuthorizationManager,
  type AuthContext,
} from '@omnitron-dev/titan/netron/auth';
import { createAuthContextWrapper } from '../services/auth-context.js';
import { ROLES } from '../shared/roles.js';
import { expandPath } from '../shared/paths.js';

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

/**
 * Where the daemon listens. The default is loopback; anything the operator
 * writes is passed through literally, `0.0.0.0` included.
 *
 * Exported so the two call sites below and the tests agree on one
 * definition. They previously each carried their own copy of
 * `host !== '0.0.0.0' ? host : '127.0.0.1'`, which is how the two of them
 * plus the config default managed to disagree about what the default was.
 */
export function resolveBindHost(configured: string | undefined): string {
  return configured ?? '127.0.0.1';
}

/**
 * Where a daemon binds its fleet TCP transport.
 *
 * A master follows `daemon.host`, whose default is loopback — the safe answer
 * for the machine an operator is sitting at.
 *
 * A slave cannot use that default, because being reachable is the whole of
 * what a slave is for: the master dials it to check its health and to pull
 * from it. Bound to loopback it is a daemon nobody can see, and the console
 * shows it as offline for ever with no way to tell it from a machine that is
 * genuinely down.
 *
 * It was exactly that, and by a longer route than a wrong default. The
 * generated slave config carried `daemon: { host: '0.0.0.0', … }` — and
 * `IEcosystemConfig`, the schema of the file it was written into, has no
 * `daemon` key; the daemon boots from `~/.omnitron/config.json`, which until
 * now could not carry one either. So the setting was written, ignored, and
 * every provisioned slave would have bound 127.0.0.1.
 *
 * An explicit `host` still wins, for an operator who wants one interface.
 */
export function fleetBindHostFor(dc: { role?: string; host?: string }): string {
  if (dc.role === 'slave') return dc.host ?? '0.0.0.0';
  return resolveBindHost(dc.host);
}

/**
 * The bind address a daemon should END UP with, from what was actually
 * configured.
 *
 * `fleetBindHostFor` above takes the daemon's RUNNING config, and by the time
 * anything holds one, `host` has been filled in from `DEFAULT_DAEMON_CONFIG`
 * — so `?? '0.0.0.0'` can never fire and every slave binds loopback. The
 * information it needs is whether an operator SET a host, and only the saved
 * file knows that: absent means "no opinion", `127.0.0.1` means "loopback,
 * deliberately".
 *
 * Measured 2026-09-14 on a provisioned slave, after the rule was written and
 * before this existed:
 *
 *     LISTEN 127.0.0.1:9700    ← the fleet port no master can dial
 *     LISTEN 127.0.0.1:9801
 *     LISTEN 127.0.0.1:9802
 *
 * The rule was right, the value it was given was already decided. This is the
 * same rule applied where the answer is still open.
 */
export function effectiveBindHost(saved: { role?: string; host?: string } | null): string {
  if (saved?.host) return saved.host;
  if (saved?.role === 'slave') return '0.0.0.0';
  return DEFAULT_DAEMON_CONFIG.host;
}

/**
 * Where a daemon binds the surfaces that exist to serve a console: the Netron
 * HTTP RPC and the WebSocket.
 *
 * A master follows `daemon.host`, like everything else. A slave does not,
 * because on a slave that knob is published for a different reason: a fleet
 * node has to bind its TCP transport somewhere the master can reach, and a
 * generated slave config therefore says `0.0.0.0`. The same value then
 * published two more surfaces — an authentication endpoint and a WebSocket
 * one that has no rate limit available to it — and a slave serves no console,
 * so nothing dials either. They were cost without benefit, on a machine whose
 * whole point is being somewhere else.
 */
export function consoleBindHostFor(dc: { role?: string; host?: string }): string {
  return dc.role === 'slave' ? '127.0.0.1' : resolveBindHost(dc.host);
}

/** Addresses that reach this host and nowhere else. */
export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return true; // absent means the loopback default above
  const h = host.trim().toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]' || h.startsWith('127.');
}

/**
 * Is the daemon still accepting the password its own migration seeded?
 *
 * Resolves the auth service lazily and answers `false` on any failure — a
 * daemon that cannot reach its database has a louder problem than this, and
 * a warning that fails the boot would be a worse trade than the risk it
 * describes.
 */
async function isSeededAdminPasswordInUse(
  app: Application,
  logger: { warn: (o: object, m: string) => void },
): Promise<boolean> {
  try {
    const auth = await app.container.resolveAsync<AuthService>(AUTH_SERVICE_TOKEN);
    return await auth.isUsingSeededAdminPassword();
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      'Could not check whether the seeded admin password is still in use',
    );
    return false;
  }
}

/**
 * The address other fleet nodes should dial to reach this one.
 *
 * `peer.address` is not decoration: `leader-election.ts` calls `requestVote`
 * and `leaderHeartbeat` against it. A node bound to `0.0.0.0` therefore may
 * not advertise `0.0.0.0` (not routable) — and must not advertise
 * `127.0.0.1` either, which is what it did: every other node in the fleet
 * resolves that to itself, so votes and heartbeats meant for the leader go
 * to the sender's own loopback. A wrong answer of the right shape.
 *
 * When the bind address says nothing about reachability, take the first
 * non-internal IPv4 the host has. Loopback remains the honest answer only
 * when there is genuinely nothing else — a single-host deployment, where
 * no other node can reach this one regardless.
 */
export function advertisedAddress(bindHost: string | undefined): string {
  if (bindHost && bindHost !== '0.0.0.0' && bindHost !== '::') return bindHost;

  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return '127.0.0.1';
}

export class OmnitronDaemon {
  private app: Application | null = null;
  private pidManager: PidManager | null = null;
  /** Port this daemon serves `/netron/invoke` on; advertised to fleet peers. */
  private rpcHttpPort: number | null = null;

  private fileWatcher: FileWatcher | null = null;
  private infraService: InfrastructureService | null = null;
  private eventBroadcaster: EventBroadcasterService | null = null;
  private syncService: SyncService | null = null;
  private nodeManagerService: import('../services/node-manager.service.js').NodeManagerService | null = null;
  private slaveConnector: import('../cluster/slave-connector.js').SlaveConnector | null = null;
  private meshHandle: import('../cluster/mesh.js').MeshHandle | null = null;
  private nodeManagerRpcService: import('../services/node-manager.rpc-service.js').NodeManagerRpcService | null = null;
  private systemWorkerManager: import('../workers/system-worker-manager.js').SystemWorkerManager | null = null;
  /** Everything the health-monitor worker needs to be spawned again. */
  private healthWorkerSpawn: (() => Promise<void>) | null = null;
  private healthWorkerRestartTimer: NodeJS.Timeout | null = null;
  private healthWorkerRestartAttempts = 0;
  /** The startup budget the worker is given, so a failure can name it. */
  private healthWorkerStartupTimeout = 0;
  /** In-daemon check timer, armed only while the worker is down. */
  private fallbackNodeCheckTimer: NodeJS.Timeout | null = null;
  /** Set by the shutdown task so nothing schedules work on the way out. */
  private isShuttingDown = false;
  private leaderElection: any = null;
  private configSyncService: any = null;
  private metricsServer: import('../observability/index.js').MetricsServer | null = null;
  private metricsBridge: import('../observability/index.js').MetricsBridge | null = null;
  private dc: IDaemonConfig = DEFAULT_DAEMON_CONFIG;

  /** Daemon config accessor for external use (e.g., DaemonRpcService) */
  get daemonConfig(): IDaemonConfig { return this.dc; }

  async start(config: IEcosystemConfig, options?: DaemonStartOptions, daemonConfig?: IDaemonConfig): Promise<void> {
    this.dc = daemonConfig ?? DEFAULT_DAEMON_CONFIG;

    const pidFile = expandPath(this.dc.pidFile);
    this.pidManager = new PidManager(pidFile);

    if (this.pidManager.isRunning()) {
      const existingPid = this.pidManager.getPid();
      throw new Error(`Omnitron daemon already running (PID: ${existingPid})`);
    }

    // Stale file from a previous crash is normal — clean it up so the
    // atomic `O_EXCL` write below succeeds. P1-L: doing this AFTER
    // isRunning() returned false means we only delete known-dead
    // markers; live daemons get the conflict error above.
    this.pidManager.remove();
    this.pidManager.write();

    // 1. Create Titan Application (the daemon itself)
    const DaemonModule = createDaemonModule(config, this.dc);

    this.app = await Application.create(DaemonModule, {
      name: 'omnitron',
      version: CLI_VERSION,
    });

    // P1-M — install our own SIGHUP handler BEFORE Application's
    // default shutdown handlers attach, so `kill -HUP <daemon>`
    // triggers a config reload (the Unix convention for long-running
    // daemons) instead of terminating the supervisor. We don't bind
    // this through the Application's signal manager because that
    // path is wired to `runShutdownTasks()`; we install at the
    // process level and the listener runs first.
    process.on('SIGHUP', () => {
      this.reloadConfigOnHup().catch((err) => {
        // The message already carries which steps applied — printing only
        // `.message` was fine for the load failure and misleading for the
        // apply failure, which is the one that leaves work half-done.
         
        console.warn(`[omnitron] SIGHUP config reload failed: ${(err as Error).message}`);
        const cause = (err as Error).cause;
        if (cause) {
           
          console.warn(`[omnitron]   caused by: ${(cause as Error).stack ?? String(cause)}`);
        }
      });
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
        const socketPath = expandPath(this.dc.socketPath);
        orchestrator.setDaemonNetron(this.app.netron, socketPath);
      }

      // 8.6. Wire metrics bridge + start /metrics HTTP endpoint.
      // Bridge subscribes to orchestrator events (restart/crash/escalation),
      // janitor sweeps, and esbuild reset/build hooks. The HTTP server
      // refreshes per-app gauges on each scrape via the bridge before
      // formatting Prometheus text.
      try {
        const { MetricsBridge, MetricsServer } = await import('../observability/index.js');
        const metricsService = await this.app.container.resolveAsync<IMetricsService>(TITAN_METRICS_TOKEN);
        const bridge = new MetricsBridge(metricsService, logger);
        orchestrator.setMetricsBridge(bridge);
        this.metricsBridge = bridge;
        const metricsPort = (this.dc.httpPort ?? 9800) + 3;
        const metricsServer = new MetricsServer({
          port: metricsPort,
          metrics: metricsService,
          bridge,
          logger,
        });
        await metricsServer.start();
        this.metricsServer = metricsServer;
      } catch (err) {
        logger.warn(
          { error: (err as Error).message },
          'metrics endpoint failed to start — /metrics will be unavailable',
        );
      }
    }

    // 8.8. Start webapp (nginx container serving Console UI) if enabled
    {
      const { readSavedDaemonConfig } = await import('../commands/up.js');
      const savedConfig = readSavedDaemonConfig();

      if (savedConfig?.webapp) {
        try {
          const { WebappService } = await import('../webapp/webapp.service.js');

          // Publishing the console while the seeded password is still in
          // place hands the whole control plane — start, stop, restart, logs,
          // config — to anyone who can reach the port and guess a word that
          // is written in the migration. Migration 001 says the password
          // "MUST be changed on first login"; nothing enforced it, and a
          // comment is not a control.
          //
          // So the console falls back to loopback rather than refusing to
          // start: the operator needs it to change the password, and a
          // control plane that will not come up is its own outage. The log
          // line says what to do and that this is not the configured bind.
          let consoleHost = this.dc.consoleBindHost ?? '127.0.0.1';
          if (!isLoopbackHost(consoleHost) && (await isSeededAdminPasswordInUse(this.app, logger))) {
            logger.error(
              { configured: consoleHost, bound: '127.0.0.1' },
              'REFUSING to publish the Console while the seeded admin password is unchanged — ' +
                'binding loopback instead. Sign in at http://127.0.0.1 and change it, then restart.',
            );
            consoleHost = '127.0.0.1';
          }

          const webapp = new WebappService(
            logger,
            process.cwd(),
            (this.dc.httpPort ?? 9800) + 1,
            this.dc.httpPort ?? 9800,
            consoleHost
          );
          await webapp.start();
        } catch (err) {
          logger.warn({ error: (err as Error).message }, 'Webapp failed to start — Console UI may not be available');
        }
      }
    }

    // 8.9. Fleet monitoring. Started BEFORE managed apps and not awaited.
    //
    // It used to be step 11.5, after `startApps`, `startScheduledTasks` and
    // `startBackgroundServices`. Fleet monitoring is about MACHINES; it has
    // nothing to do with whether this daemon's managed applications start, and
    // gating it behind them means one application that fails its startup
    // leaves the whole fleet unwatched for as long as the supervisor keeps
    // retrying it. Measured on this host: ten minutes after a daemon start,
    // with two applications still cycling through failed starts, not a single
    // node had been checked and nothing had said so.
    //
    // Not awaited, for the same reason in the other direction: spawning the
    // worker has a 30-second startup timeout, and the applications should not
    // wait behind it. The function handles and logs its own failures, and arms
    // the in-daemon fallback checks when the worker cannot run.
    void this.startHealthMonitorWorker(logger).catch((err: Error) => {
      // It handles its own failures; this is the last resort, because an
      // unhandled rejection is a crash of the daemon rather than a lost
      // subsystem.
      logger.error({ error: err.message }, 'Health monitor startup threw');
    });

    // 9. Start managed apps (waits for infra gate if apps have `requires`)
    await this.startApps(config, logger);

    // 10. Start background tasks via titan-scheduler (replaces bare setInterval)
    await this.startScheduledTasks(config, logger);

    // 11. Start remaining background services (telemetry, traces, leader election)
    await this.startBackgroundServices(config, logger);

    // (Fleet monitoring is started at 8.5, above — before managed apps.)

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
        path: expandPath(dc.socketPath),
        force: true,
        mode: 0o600, // Owner-only access for security
      },
    });

    // Local CLI trust. The Unix socket above is created mode 0600, so any
    // peer that can open it is provably the same OS user that owns this
    // daemon — the OS has already authenticated them. Grant those
    // connections an implicit admin context so the local CLI satisfies the
    // `@Public({ auth: { roles } })` guards on the daemon RPC services
    // without a redundant JWT handshake (the CLI talks over this socket
    // only). Remote transports — TCP (fleet), HTTP/WS (webapp) — are NOT
    // registered here and keep requiring a validated token, so this widens
    // nothing beyond same-user local access that the socket mode already
    // grants.
    this.app.netron.setTransportAuthContext('unix', {
      userId: 'omnitron-local',
      roles: [ROLES.ADMIN],
      permissions: [],
      metadata: { source: 'local-unix-socket' },
    });

    // TCP — remote fleet communication (cross-server). The default is
    // 127.0.0.1 so a single-host deployment never exposes daemon control
    // to the LAN; multi-host fleet operators opt in via `daemon.host`.
    //
    // The default belongs in DEFAULT_DAEMON_CONFIG, not here. It used to be
    // enforced here instead, as `dc.host !== '0.0.0.0' ? dc.host :
    // '127.0.0.1'` over a config default of `'0.0.0.0'` — absence encoded as
    // a value from the domain of valid answers. `0.0.0.0` is not a marker for
    // "unset", it is a bind address with a meaning, and it was the exact
    // value the comment above it told fleet operators to set. Following the
    // documentation produced loopback and no fleet, silently. It also
    // contradicted every neighbouring knob: `consoleBindHost: '0.0.0.0'`
    // publishes, and so does an app's transport host.
    //
    // (The original hazard — pre-fix this defaulted to all-interfaces while
    // the AuthorizationManager below was missing, giving any LAN host an
    // unauthenticated `stopAll({force:true})` — is answered by the default
    // being loopback and by that manager now being wired.)
    const tcpHost = fleetBindHostFor(dc);
    if (!isLoopbackHost(tcpHost)) {
      // Said, not enforced, and the difference is deliberate: silently
      // rebinding a fleet transport to loopback would take a cluster down,
      // and a node that cannot be reached is an outage rather than a
      // hardening. The console above IS rebound, because its whole purpose
      // is a password prompt and loopback still serves it.
      void (async () => {
        const loggerModule = await this.app!.container.resolveAsync<ILoggerModule>(LOGGER_SERVICE_TOKEN);
        const log = loggerModule.logger;
        if (await isSeededAdminPasswordInUse(this.app!, log)) {
          log.error(
            { host: tcpHost, port: dc.port },
            'The daemon fleet transport is published and the seeded admin password is unchanged — ' +
              'anyone who can reach this port can sign in and stop every app. Change it now.',
          );
        }
      })().catch(() => undefined);
    }
    this.app.netron.registerTransport('tcp', () => new TcpTransport());
    this.app.netron.registerTransportServer('tcp', {
      name: 'daemon-fleet',
      options: {
        port: dc.port,
        host: tcpHost,
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
    // Wire the AuthorizationManager so the `@Public({ auth: { roles } })`
    // decorators on DaemonRpcService are actually enforced on the wire.
    // Without an authzManager, `remote-peer.ts:enforceMethodAccess`
    // early-returns and every method is reachable by anyone who can
    // mint a valid JWT, regardless of `roles`. The WS origin policy
    // (`allowedOrigins: true` → same-host) closes the cross-origin
    // upgrade attack against cookie-mode auth.
    const authzManager = new AuthorizationManager(authLogger);
    this.app.netron.configureAuth(authManager, authzManager, {
      allowedOrigins: true,
    });

    // `trustProxy` is shared with the rate limiter deliberately: both answer
    // the same question — is there a proxy in front whose forwarded headers
    // we may believe? Two separate switches would eventually disagree.
    const authContextWrapper = createAuthContextWrapper({
      trustProxy: dc.httpRateLimit?.trustProxy === true,
    });

    // HTTP / WS bind also defaults to 127.0.0.1. The webapp talks to
    // these over the same loopback; nginx fronts the public surface.
    // Operators who proxy in from another host opt in via `daemon.host`
    // (same knob that controls TCP, with the same literal meaning).
    //
    // Except on a slave, where that knob has to be published for a different
    // reason and publishing these with it is pure cost. A fleet node must
    // bind its TCP transport somewhere the master can reach — that is what
    // `daemon.host: '0.0.0.0'` in a generated slave config is for — and the
    // same value then published the Netron HTTP RPC and the WebSocket
    // alongside it. A slave serves no console: the operator uses the
    // master's. So the two surfaces it gained are an authentication endpoint
    // it does not need and a WebSocket one that, as the note below records,
    // has no rate limit available to it.
    //
    // Rebound rather than warned about, which is the opposite of the choice
    // made for the TCP transport twenty lines up — and for the opposite
    // reason. Rebinding the fleet port would take a cluster down, because
    // being reachable is that port's whole job. Rebinding these costs a slave
    // nothing, because nothing dials them.
    const localHost = consoleBindHostFor(dc);

    // HTTP — Netron RPC API (internal port, nginx proxies from public port)
    // The public `httpPort` (9800) is nginx in front of the console; the
    // daemon's own Netron HTTP listener sits one above it. Remembered here
    // because the fleet registration below must advertise the port peers can
    // actually POST `/netron/invoke` to — not the TCP port, and not the
    // console's.
    const internalHttpPort = (dc.httpPort ?? 9800) + 1;
    this.rpcHttpPort = internalHttpPort;
    this.app.netron.registerTransport('http', () => new HttpTransport());
    const rl = dc.httpRateLimit ?? {};
    this.app.netron.registerTransportServer('http', {
      name: 'daemon-http',
      options: {
        port: internalHttpPort,
        host: localHost,
        cors: true,
        invocationWrapper: authContextWrapper,
        // Volume cap on the HTTP RPC surface, and only that one. Password
        // guessing is bounded by the per-account lockout in AuthService.
        //
        // The WebSocket surface below is NOT covered: netron's WebSocket
        // transport has no rate-limit option — `maxPayload` is the only
        // bound it accepts — and the console talks over WebSocket. This
        // comment used to say the limit bounded "everything else, including
        // attempts to flood the daemon into unresponsiveness", which
        // describes a protection that covers one of the two transports an
        // attacker can reach.
        rateLimit: {
          enabled: rl.enabled ?? true,
          windowMs: rl.windowMs ?? 60_000,
          maxRequests: rl.maxRequests ?? 3_000,
          globalMaxRequests: rl.globalMaxRequests ?? 6_000,
          trustProxy: rl.trustProxy ?? false,
          ...(rl.whitelist ? { whitelist: rl.whitelist } : {}),
        },
      },
    });

    // WebSocket — real-time event push to webapp clients
    const wsPort = (dc.httpPort ?? 9800) + 2;
    this.app.netron.registerTransport('websocket', () => new WebSocketTransport());
    this.app.netron.registerTransportServer('websocket', {
      name: 'daemon-ws',
      options: {
        port: wsPort,
        host: localHost,
        // Applied per invocation by `remote-peer.ts`, the dispatcher every
        // socket transport shares — so WS calls get the same request context
        // HTTP calls do. Until recently only the HTTP server read this
        // option and this line did nothing.
        invocationWrapper: authContextWrapper,
        // The only bound this transport accepts. Left unset it inherits
        // `ws`'s 100 MB default, which is a lot of memory to hand a single
        // frame on a control-plane socket that carries RPC arguments and
        // event pushes. 8 MB is well above anything the console sends and
        // well below anything worth allocating for a stranger.
        maxPayload: dc.wsMaxPayload ?? 8 * 1024 * 1024,
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

    // Table retention. `logging.maxSize` and `maxFiles` bound the rotated
    // files on disk and say nothing about the `logs` table, which had no
    // bound at all — 13 GB on the development host. Off unless configured,
    // and the number comes from the config rather than a default chosen
    // inside the collector, because a wrong default there deletes history.
    logCollector.setRetentionDays(
      config.logging?.databaseRetentionDays ?? 0,
      loggerModule.logger.child({ component: 'log-retention' })
    );

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

    // The audit trail. Master-only — its table lives in the omnitron
    // database — and every service that records into it takes it as an
    // optional dependency, so a slave serves the same methods and records
    // nothing rather than refusing them.
    let audit: import('../services/audit.service.js').AuditService | undefined;
    if (!isSlave) {
      try {
        audit = await container.resolveAsync<import('../services/audit.service.js').AuditService>(
          AUDIT_SERVICE_TOKEN,
        );
        const { AuditRpcService } = await import('../services/audit.rpc-service.js');
        await this.app.netron.peer.exposeService(new AuditRpcService(audit));
      } catch (err) {
        // A daemon whose database did not come up still runs; it simply
        // records nothing, and says so once rather than at every action.
        loggerModule.logger.warn(
          { error: (err as Error).message },
          'No audit trail on this daemon — actions will not be recorded',
        );
      }
    }

    // Secrets RPC service (file-based, no DB dependency)
    const { SecretsRpcService: SecretsRpc } = await import('../services/secrets.rpc-service.js');
    const secretsService = await container.resolveAsync(SECRETS_SERVICE_TOKEN);
    const secretsRpcService = new SecretsRpc(secretsService, audit);
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
    // Re-arm any persisted backup schedules so they survive daemon restarts.
    await backupService.restoreSchedules().catch((err: unknown) =>
      loggerModule.logger.warn({ err: (err as Error).message }, 'Failed to restore backup schedules'),
    );

    // Infrastructure RPC service (reports infra state — slave has no infra)
    const { InfrastructureRpcService: InfraRpc } = await import('../services/infrastructure.rpc-service.js');
    const infraRpcService = new InfraRpc(
      () => this.infraService,
      // Only a node hosts a stack's infrastructure on demand. A master
      // provisions its own from its own config at boot, and handing it a
      // second one over RPC would give one machine two reconcilers over one
      // set of containers.
      isSlave
        ? (infraConfig, declaredServices, presetRegistry, serviceOverrides) => {
            const service = new InfrastructureService(
              loggerModule.logger.child({ component: 'infra' }),
              infraConfig,
              declaredServices,
              presetRegistry,
              serviceOverrides,
              // A node keeps its own state in SQLite. Provisioning a
              // control-plane Postgres for it gives the host a database
              // nobody queries, on default credentials.
              false,
            );
            this.infraService = service;
            return service;
          }
        : undefined,
      // The node's own vault. Generated service credentials are written
      // here and read back on every later provision, which is what makes a
      // generated password usable: a data directory keeps the one it was
      // initialised with.
      // Resolved per call, not captured here: a resolution that fails during
      // startup would otherwise leave credential generation off for the life
      // of this daemon, and the absence reads as "this node needs none".
      isSlave
        ? () => {
            try {
              return container.resolve(SECRETS_SERVICE_TOKEN) as never;
            } catch {
              return undefined;
            }
          }
        : undefined,
      // The logger, because the one thing this service says on its own — that
      // a deployment is running on a default credential — is said at error
      // level and reaches nobody without it.
      loggerModule.logger.child({ component: 'infra' }),
    );
    await this.app.netron.peer.exposeService(infraRpcService);

    // Project + Stack management RPC service
    const projectService = await container.resolveAsync<ProjectService>(PROJECT_SERVICE_TOKEN);
    const projectRpcService = new ProjectRpcService(projectService, audit);
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

    // Remote metrics into the store the console actually reads.
    //
    // `ingestMetric` wrote them to `metrics_raw`, and nothing in this
    // repository reads that table — the metrics page queries titan-metrics'
    // own storage. So once the pipeline carried anything, it would have
    // carried it somewhere invisible. Recording through the same service the
    // master uses for its own readings makes a remote node a LABEL on the
    // existing series instead of a second store of the same concept.
    //
    // `node` is a distinct argument in the sink's signature rather than a
    // key a caller may forget to put in `labels`: a sample recorded without
    // it merges with the master's own, and the chart then shows two machines
    // summed under one name.
    if (!isSlave) {
      const syncMetrics = await container.resolveAsync<IMetricsService>(TITAN_METRICS_TOKEN);
      this.syncService.setMetricsSink((sample) => {
        try {
          syncMetrics.recordTyped('gauge', sample.name, { ...sample.labels, app: sample.app, node: sample.node }, sample.value);
        } catch (err) {
          loggerModule.logger.warn(
            { node: sample.node, name: sample.name, error: (err as Error).message },
            'Failed to record a replicated metric',
          );
        }
      });
    }

    // The producer the replication pipeline never had.
    //
    // `SyncService` buffers, batches, retries with backoff, evicts when over
    // budget, and the master keeps a dedup ledger for what it has taken —
    // all of it built, and `buffer`/`bufferBatch` had ZERO callers. A slave
    // collected its logs into its own SQLite and replicated none of them,
    // and nothing said so: an empty buffer drains successfully every cycle.
    //
    // Wired only for a slave. `bufferBatch` is a no-op for any other role,
    // so this is belt and braces rather than the guard itself — but a master
    // has no master to ship to, and doing the work would be pure cost.
    if (isSlave) {
      const syncService = this.syncService;
      logCollector.setSyncSink((entries) => {
        void syncService
          .bufferBatch(entries.map((e) => ({ category: 'logs' as const, payload: e as unknown as Record<string, unknown> })))
          .catch(() => {
            // `bufferBatch` logs its own failure. Swallowed here because the
            // lines are already in the local table: losing the replica copy
            // must not cost the flush that succeeded.
          });
      });
    }
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
      const { DaemonStateStore: DaemonStateStoreCls } = await import('./daemon-state-store.service.js');
      const daemonStateStore = await container.resolveAsync<InstanceType<typeof DaemonStateStoreCls>>(DAEMON_STATE_STORE_TOKEN);
      const nodeManager = new NodeManagerService(
        loggerModule.logger.child({ component: 'nodes' }),
        daemonStateStore,
        secretsService as any,
      );
      this.nodeManagerService = nodeManager;
      const nodeManagerRpcService = new NodeManagerRpcService(nodeManager, audit);
      // The deployer reaches nodes through the same SSH implementation as the
      // health checks — the only one that can present a stored password or a
      // key passphrase.
      {
        const { RemoteDeployer } = await import('../services/remote-deployer.service.js');
        const { ExecutionService } = await import('../execution/execution.service.js');
        const deployLogger = loggerModule.logger.child({ component: 'deploy' });
        nodeManagerRpcService.setRemoteDeployer(new RemoteDeployer(deployLogger, new ExecutionService(deployLogger)));
      }
      this.nodeManagerRpcService = nodeManagerRpcService;

      // The local node's own answers, for the three readers that ask every
      // node about itself. A daemon has no mesh connection to itself, so
      // `askNode` needs a local source for each.
      //
      // On the INSTANCE, after it is assigned, and not on `this.…?.` from
      // wherever each dependency happens to be constructed: `setSyncService`
      // was first written next to `new SyncService(...)`, ninety lines above
      // this assignment and inside the same function, where `?.` swallowed it
      // silently and the local node would have reported "not wired" forever.
      // An optional call is only safe where the object is known to exist.
      nodeManagerRpcService.setSyncService(this.syncService);

      await this.app.netron.peer.exposeService(nodeManagerRpcService);

      // The mesh: every registered node, connected and replicating.
      //
      // `SlaveConnector` maintains the connections and pulls each node's
      // write-ahead buffer on connect and on every heartbeat, and all of it
      // worked — but the only caller of `addSlave` was a remote or cluster
      // stack starting. So the master connected to the nodes something had
      // been deployed onto, and to no others. A node added through the
      // console, provisioned, and collecting its own metrics and logs was
      // never dialled, and buffered locally forever: measured at 47,407
      // undelivered entries over eleven hours on the first such node, which
      // reported healthy the whole time.
      //
      // Built here rather than inside ProjectService because reaching a node
      // needs what only this side has — the registry's SSH credentials, for
      // the token the node's daemon demands and for the tunnel a firewalled
      // daemon port needs. ProjectService adopts the same instance: one per
      // master, or two connectors pull the same buffer and race to ack it.
      try {
        const { SlaveConnector } = await import('../cluster/slave-connector.js');
        const { createMeshDialer } = await import('../cluster/mesh-link.js');
        const { startMesh } = await import('../cluster/mesh.js');
        const { ExecutionService: Exec } = await import('../execution/execution.service.js');

        const meshLogger = loggerModule.logger.child({ component: 'mesh' });
        const fleetService = await container
          .resolveAsync<FleetService>(FLEET_SERVICE_TOKEN)
          .catch(() => undefined);

        const connector = new SlaveConnector(meshLogger, fleetService, this.syncService ?? null, {
          dial: createMeshDialer({
            logger: meshLogger,
            execution: new Exec(meshLogger),
            subject: `mesh:${os.hostname()}`,
            sshTargetFor: async ({ host }) => {
              const node = nodeManager.listNodes().find((n) => n.host === host && !n.isLocal);
              return node ? nodeManager.nodeToSshTarget(node) : null;
            },
          }),
        });

        this.slaveConnector = connector;
        const projectService = await container.resolveAsync<ProjectService>(PROJECT_SERVICE_TOKEN);
        projectService.setSlaveConnector(connector);
        // So the console can answer "is this node replicating", which is a
        // different question from "can this master reach it".
        nodeManagerRpcService.setSlaveConnector(connector);

        // A stack names a host; the registry holds the credential for it.
        // Wired here because this is the side that has both — ProjectService
        // reads config files, the node registry keeps its secrets in the
        // daemon's vault.
        projectService.setNodeCredentialResolver(async (host) => {
          const node = nodeManager.listNodes().find((n) => n.host === host && !n.isLocal);
          return node ? nodeManager.nodeToSshTarget(node) : null;
        });
        this.meshHandle = startMesh({ registry: nodeManager, connector, logger: meshLogger });
      } catch (err) {
        // A master with no mesh still supervises its own apps, so this does
        // not stop the daemon — but nothing else reports it, and a silent
        // failure here looks exactly like a fleet that has nothing to say.
        loggerModule.logger.error(
          { error: (err as Error).message },
          'Mesh not started — registered nodes will buffer their data locally and replicate nothing',
        );
      }
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
      // The console asks every node for its relay, and a daemon has no mesh
      // connection to itself, so the local node's answer comes from here.
      this.nodeManagerRpcService?.setTelemetryRelay(telemetryRelay);
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
      // The local node's own election state, for the cross-node reader.
      this.nodeManagerRpcService?.setLeaderElection(this.leaderElection);
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
    // First-touch init reads from SQLite (and migrates the legacy
    // JSON snapshot in-place if one exists). Subsequent reads via
    // `load()` are synchronous from the in-memory cache.
    await stateStore.init();
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

    // Step 2: Provision app infrastructure (postgres, redis, minio) if declared.
    //
    // Two ownership models share this slot historically:
    //
    //   (a) Top-level apps declared directly in the daemon config — the
    //       daemon owns their infra here, marks the gate ready, and apps
    //       in the top-level `apps: []` proceed.
    //
    //   (b) Project/stack mode — infra is owned by `StackInfrastructureManager`
    //       per `(project, stack)` and provisioned later by
    //       `projectService.startStack`. Running both passes can collide
    //       on the SAME service name with different prefixes (D14): the
    //       daemon path uses prefix `omnitron-` while the stack path
    //       sets `${project}-${stack}-`. With a non-trivial top-level
    //       `infrastructure.services` map the daemon would create a
    //       parallel set of containers that nobody owns and the stack's
    //       provision later races them on ports.
    //
    // Resolution: if any project has enabled stacks, defer infra entirely
    // to stack provision and mark the gate ready immediately. Top-level
    // `infrastructure.services` is informational in this mode (used by
    // stack auto-detection upstream); the daemon does not provision it
    // again here.
    const { ProjectRegistry } = await import('../project/registry.js');
    const projects = ProjectRegistry.open().list();
    const projectModeActive = projects.some(
      (p) => Array.isArray(p.enabledStacks) && p.enabledStacks.length > 0,
    );

    if (projectModeActive) {
      logger.info(
        { projects: projects.length },
        'project mode active — daemon-level infrastructure deferred to stack provision',
      );
      gate.markReady({ services: {}, ready: true });
      return;
    }

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

        // Fail-fast unless explicitly opted out via `--no-infra` (handled
        // earlier by skipping this branch). Re-throw so daemon startup
        // surfaces the actual cause to the operator instead of leaving the
        // daemon "running" with a half-broken state.
        const allowDegraded = (config as { allowDegradedInfra?: boolean }).allowDegradedInfra === true;
        if (!allowDegraded) {
          const throwable = new Error(
            `Daemon infrastructure provisioning failed: ${reason}\n` +
            `Stack apps will not start until this is resolved.\n` +
            `Fix the underlying issue (Docker socket, image pull, port, …) and run 'omnitron up' again.\n` +
            `To deliberately run with no managed infra (external services), pass --no-infra to 'omnitron up'.`
          );
          (throwable as any).code = 'DAEMON_INFRA_PROVISIONING_FAILED';
          (throwable as any).cause = err;
          throw throwable;
        }
        logger.warn('allowDegradedInfra=true — apps with infrastructure requirements may fail to start');
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
    const { decideOrphans } = await import('../infrastructure/orphan-containers.js');

    const managed = await listManagedContainers();
    if (managed.length === 0) return;

    // Build set of expected container name prefixes from registered projects/stacks
    const expectedPrefixes = new Set<string>();
    const internalNames = new Set(['omnitron-pg', 'omnitron-nginx']);

    // Load each project's config FIRST. `listStacks` reads the loaded-config
    // cache and returns [] for a project whose config has not been read —
    // and this runs before the per-project load loop further down, whose own
    // comment says loading "populates internal cache used by listStacks".
    //
    // So on every boot where projects come from the registry rather than CWD
    // auto-detection — the normal case — `expectedPrefixes` was EMPTY and
    // every managed container looked like an orphan. Measured from this
    // daemon's own log, 2026-09-12 12:46, ten RUNNING containers removed in
    // fourteen seconds: postgres, redis, bitcoin, monero (daemon and wallet),
    // nominatim, tor, tiles, minio, gateway — each logged as "not part of any
    // registered stack" while being part of the registered stack.
    //
    // Named volumes survived (`docker rm -f`, no `-v`), so this cost a cold
    // restart of every service rather than the chain data. That is luck, not
    // design.
    let expectationsComplete = true;
    for (const project of projects) {
      try {
        await projectService.loadProjectConfig(project.name);
      } catch (err) {
        expectationsComplete = false;
        logger.warn(
          { project: project.name, error: (err as Error).message },
          'Could not read this project’s stacks — skipping orphan reconciliation rather than guessing',
        );
        continue;
      }
      const stacks = projectService.listStacks(project.name);
      if (stacks.length === 0) expectationsComplete = false;
      for (const stack of stacks) {
        expectedPrefixes.add(`${project.name}-${stack.name}-`);
      }
    }

    // Whether anything may be removed is one decision with several ways of
    // being wrong, and every way it has been wrong so far was a mistake about
    // what the inputs MEANT. It lives in `decideOrphans`, where it can be
    // pinned in a test rather than discovered on a host.
    const decision = decideOrphans({
      isSlave: this.dc?.role === 'slave',
      managed: managed.map((c) => ({
        name: c.name,
        status: c.status,
        project: c.project,
        stack: c.stack,
      })),
      projects: projects.map((p) => p.name),
      expectedPrefixes: [...expectedPrefixes],
      expectationsComplete,
      internalNames: [...internalNames],
    });

    if (decision.action === 'skip') {
      logger.warn(
        { managed: managed.length, expectedPrefixes: expectedPrefixes.size, because: decision.because },
        'Orphan reconciliation skipped',
      );
      return;
    }

    let orphanCount = 0;
    for (const name of decision.containers) {
      const container = managed.find((c) => c.name === name)!;
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

  /**
   * Apply the internal-database schema.
   *
   * Delegates to the shared runner (`database/migration-runner.ts`) so this
   * path, the infrastructure service and the `migrate` CLI all execute the
   * same registry through the same engine. A failure here is logged as an
   * ERROR — the daemon keeps running, but every feature backed by
   * omnitron-pg (alerts, sessions, logs, metrics, deployments) is degraded
   * and the operator has to see it.
   */
  private async runOmnitronMigrations(logger: ILogger): Promise<void> {
    const { runOmnitronMigrations } = await import('../database/migration-runner.js');

    try {
      await runOmnitronMigrations(logger);
    } catch (err) {
      logger.error(
        { error: (err as Error).message },
        'Omnitron database migrations FAILED — alerts, sessions, logs and metrics will not work until this is resolved'
      );
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

      // The console asks every node for its own indicators, and a daemon has
      // no mesh connection to itself — so the local node's answer comes from
      // here. Registered beside the indicators rather than in the wiring
      // above, because this is the object that has just been given them.
      this.nodeManagerRpcService?.setTitanHealth(titanHealth);
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

    // When there are enabled stacks to resume, wait for Docker first. Under
    // OS-service supervision the daemon boots at login, seconds before
    // OrbStack/dockerd finishes starting — on 2026-07-11 the one-shot resume
    // fired into "Docker is not available" and the platform stayed appless
    // for days. Bounded wait; on timeout we proceed and the enabled-stacks
    // reconciler keeps retrying with backoff.
    const hasEnabledStacks = allProjects.some((p) => (p.enabledStacks?.length ?? 0) > 0);
    if (hasEnabledStacks) {
      const { isDockerAvailable } = await import('../infrastructure/container-runtime.js');
      const deadline = Date.now() + 120_000;
      let waited = false;
      while (!(await isDockerAvailable())) {
        if (Date.now() > deadline) {
          logger.warn('Docker still unavailable after 120s — proceeding; reconciler will retry enabled stacks');
          break;
        }
        if (!waited) {
          logger.info('Docker not available yet (host still booting?) — waiting before stack resume');
          waited = true;
        }
        await new Promise((r) => setTimeout(r, 3_000));
      }
      if (waited) logger.info('Docker is available — continuing stack resume');
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

    // Keep converging after boot: retry failed resumes (with backoff) and
    // re-start enabled stacks that later fall over. One-shot boot resume is
    // not enough — see the 2026-07-11 Docker-race incident.
    projectService.startEnabledStacksReconciler();
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
        // Only a slave replicates. `bufferBatch` is itself a no-op for any
        // other role, but passing null keeps the job from registering at all
        // and makes the scheduler's own "skipped, because" line say so.
        syncService: isSlave ? this.syncService : null,
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
          address: advertisedAddress(this.dc.host),
          port: this.dc.port,
          role: 'leader',
          metadata: { pid: process.pid, version: CLI_VERSION, httpPort: this.dc.httpPort, rpcPort: this.rpcHttpPort },
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

  /**
   * Start the health-monitor system worker, and keep it started.
   *
   * Three things were wrong with the previous version, and they compounded
   * into one outage:
   *
   *  - It returned SILENTLY when a precondition failed, so a daemon that
   *    never checked a single node looked exactly like one that checked them
   *    all. Each branch now says which precondition it was.
   *  - Nothing watched the worker's process. When it died, the master kept
   *    the proxy, and every fleet check — the console's Refresh, the Check
   *    button, `omnitron node check` — answered
   *    `TitanError: Service with id HealthMonitor@1.0.0 not found`. Observed
   *    live: a fleet frozen at the worker's last report for two days, with
   *    the console rendering it as current.
   *  - The fallback timer existed only inside the catch for a FAILED SPAWN,
   *    so a worker that started and later crashed had no fallback at all.
   *
   * The worker is now respawned with backoff, the proxy is dropped the moment
   * its process ends, and the daemon runs the checks itself in the meantime.
   */
  private async startHealthMonitorWorker(
    logger: import('@omnitron-dev/titan/module/logger').ILogger,
  ): Promise<void> {
    if (this.dc.role === 'slave') return; // By design: slaves do not manage a fleet.
    if (!this.app) {
      logger.warn({}, 'Health monitor not started — application is not available');
      return;
    }
    if (!this.nodeManagerService) {
      logger.warn({}, 'Health monitor not started — node manager was not constructed');
      return;
    }

    const nodeManager = this.nodeManagerService;

    try {
      const titanPm = await import('@omnitron-dev/titan-pm');
      const { SystemWorkerManager } = await import('../workers/system-worker-manager.js');
      const { fileURLToPath } = await import('node:url');
      const nodePath = await import('node:path');
      const { omnitronPgConnectionString } = await import('../database/connection.js');

      // Resolve PM from DI
      const pm = await this.app.container.resolveAsync<any>(titanPm.PM_MANAGER_TOKEN);

      const loggerModule = await this.app.container.resolveAsync<ILoggerModule>(LOGGER_SERVICE_TOKEN);
      const workerManager = new SystemWorkerManager(pm, loggerModule.logger.child({ component: 'system-workers' }));
      this.systemWorkerManager = workerManager;

      // Get worker process path. The naive heuristic of "tsx in execArgv → .ts"
      // is wrong: the daemon binary itself is loaded with `--import tsx/esm`
      // (so transpilation works for any .ts in the tree), but the *daemon
      // entry* may still be the compiled .js. We must check what physically
      // exists alongside the running daemon, not what's in execArgv.
      const thisDir = nodePath.dirname(fileURLToPath(import.meta.url));
      const workersDir = nodePath.resolve(thisDir, '..', 'workers');
      const tsPath = nodePath.join(workersDir, 'health-monitor-process.ts');
      const jsPath = nodePath.join(workersDir, 'health-monitor-process.js');
      const fsMod = await import('node:fs');
      const workerPath = fsMod.existsSync(jsPath)
        ? jsPath
        : fsMod.existsSync(tsPath)
          ? tsPath
          : jsPath; // fall through to .js — error will be clear if missing

      const spawnOpts: { execArgv?: string[]; startupTimeout?: number } = {};
      if (process.execArgv.some((a) => a.includes('tsx'))) {
        spawnOpts.execArgv = ['--import', 'tsx/esm'];
      }
      // What the worker has to do before it can report ready is create a
      // Titan application — a DI container, a module graph and a PG pool.
      // Managed applications get two to five minutes for that; this was
      // thirty seconds, and on a loaded host it expired on every attempt.
      // A deadline shorter than the work turns a healthy subsystem into one
      // that is started and killed for ever, which is what was observed:
      // fifty minutes of restart attempts, none of which could have finished.
      spawnOpts.startupTimeout =
        this.dc.healthMonitor?.startupTimeoutMs
        ?? DEFAULT_DAEMON_CONFIG.healthMonitor?.startupTimeoutMs
        ?? 120_000;
      this.healthWorkerStartupTimeout = spawnOpts.startupTimeout;

      /**
       * The worker's configuration.
       *
       * Read at every spawn, not once: the operator's check settings live in
       * the node manager and change at runtime. The fallbacks come from
       * `DEFAULT_DAEMON_CONFIG` rather than being written out again here —
       * the inline copies said 30 s and 7 days while the declared defaults
       * said 60 s and 90 days, so which numbers a deployment got depended on
       * whether its config file happened to mention `healthMonitor` at all.
       */
      const buildConfig = () => {
        const declared = DEFAULT_DAEMON_CONFIG.healthMonitor ?? {};
        const configured = this.dc.healthMonitor ?? {};
        const operator = nodeManager.getCheckConfig();
        return {
          intervalMs: configured.intervalMs ?? declared.intervalMs ?? 60_000,
          concurrency: operator.concurrency,
          offlineTimeoutMs: configured.offlineTimeoutMs ?? declared.offlineTimeoutMs ?? 90_000,
          pingTimeout: operator.pingTimeout,
          sshTimeout: operator.sshTimeout,
          omnitronCheckTimeout: operator.omnitronCheckTimeout,
          pingEnabled: operator.pingEnabled,
          retentionDays: configured.retentionDays ?? declared.retentionDays ?? 90,
          // Was a hard-coded DSN, password included, in this file — the sixth
          // copy of literals `database/connection.ts` exists to be the only
          // copy of. A daemon pointed elsewhere by OMNITRON_DATABASE_URL wrote
          // its check history to a database nothing else used.
          dbUrl: omnitronPgConnectionString(),
        };
      };

      this.healthWorkerSpawn = async () => {
        const healthConfig = buildConfig();
        const nodesJson = JSON.stringify(await nodeManager.getNodeCheckTargets());
        const proxy = await workerManager.spawn(
          'health-monitor',
          workerPath,
          { configJson: JSON.stringify(healthConfig), nodesJson },
          spawnOpts,
        );

        // Wire IPC: worker → master status cache updates via PM's public API
        workerManager.onMessage('health-monitor', (msg: any) => {
          if (msg?.type === 'health:status_batch' && Array.isArray(msg.summaries)) {
            nodeManager.updateStatusCacheFromWorker(msg.summaries);
            this.broadcastNodeCheckCompleted(msg.summaries);
          }
        });

        if (this.nodeManagerRpcService) {
          this.nodeManagerRpcService.setHealthWorkerProxy(proxy as any);
        }
        this.healthWorkerRestartAttempts = 0;
        this.stopFallbackNodeChecks();
        logger.info({ intervalMs: healthConfig.intervalMs }, 'Health monitor system worker started');
      };

      // A worker that ends — crash or deliberate stop — must take its proxy
      // with it. `expected` is true only while the daemon is shutting down,
      // which is also when a respawn would be wrong.
      workerManager.onExit('health-monitor', (exit) => {
        this.nodeManagerRpcService?.setHealthWorkerProxy(null);
        if (exit.expected || this.isShuttingDown) return;
        this.startFallbackNodeChecks(logger);
        this.scheduleHealthMonitorRestart(logger);
      });

      // Operator changes to the check settings have to reach the process that
      // performs the checks. They reached a field on the node manager that
      // only the daemon's own fallback path read, so turning ping off in the
      // console turned nothing off.
      nodeManager.on('checkConfig:changed', () => {
        void callWorkerMethod(workerManager, 'updateConfig', JSON.stringify(buildConfig())).catch((err: Error) => {
          logger.warn({ error: err.message }, 'Failed to push check config to health monitor');
        });
      });

      // Wire node CRUD events → sync to worker
      const syncNodesToWorker = async () => {
        if (!workerManager.get('health-monitor')) return;
        const targets = await nodeManager.getNodeCheckTargets();
        await callWorkerMethod(workerManager, 'updateNodes', JSON.stringify(targets)).catch((err: Error) => {
          logger.warn({ error: err.message }, 'Failed to sync node list to health monitor');
        });
      };
      nodeManager.on('node:added', syncNodesToWorker);
      nodeManager.on('node:updated', syncNodesToWorker);
      nodeManager.on('node:removed', syncNodesToWorker);

      // A node changing state is the event the console subscribes to. Four of
      // the five NODE_EVENTS channels were declared and never emitted.
      nodeManager.on('node:health', (t: import('../services/node-manager.service.js').NodeHealthTransition) => {
        this.broadcastNodeTransition(t);
      });

      // Wire PG repository for direct history reads (bypasses worker)
      if (this.nodeManagerRpcService) {
        try {
          const db = await this.app!.container.resolveAsync(OMNITRON_DB_TOKEN);
          const { NodeHealthRepository } = await import('../services/node-health.repository.js');
          this.nodeManagerRpcService.setHealthRepository(new NodeHealthRepository(db));
        } catch {
          logger.warn({}, 'Could not wire health repository — PG may not be ready');
        }
      }

      // The console needs these to size its uptime bars against history that
      // actually exists.
      const bootConfig = buildConfig();
      nodeManager.setHistoryConfig({
        uptimeIntervalMs:
          this.dc.healthMonitor?.uptimeIntervalMs
          ?? DEFAULT_DAEMON_CONFIG.healthMonitor?.uptimeIntervalMs
          ?? 86_400_000,
        retentionDays: bootConfig.retentionDays,
      });

      await this.healthWorkerSpawn();
    } catch (err) {
      logger.warn(
        { error: (err as Error).message },
        'Health monitor worker failed to start — falling back to direct checks'
      );
      this.startFallbackNodeChecks(logger);
      if (this.healthWorkerSpawn) this.scheduleHealthMonitorRestart(logger);
    }
  }

  /**
   * Try the health-monitor worker again, backing off.
   *
   * Capped at a minute: the worker is cheap to start and the fleet view is
   * blind without it, but a worker that cannot start (a missing file, a bad
   * runtime) must not be respawned in a tight loop for the life of the daemon.
   */
  private scheduleHealthMonitorRestart(
    logger: import('@omnitron-dev/titan/module/logger').ILogger,
  ): void {
    if (this.healthWorkerRestartTimer || this.isShuttingDown || !this.healthWorkerSpawn) return;

    const attempt = ++this.healthWorkerRestartAttempts;
    const delay = Math.min(60_000, 2_000 * 2 ** Math.min(attempt - 1, 5));
    logger.warn({ attempt, delayMs: delay }, 'Health monitor worker is down — restarting');

    this.healthWorkerRestartTimer = setTimeout(() => {
      this.healthWorkerRestartTimer = null;
      if (this.isShuttingDown || !this.healthWorkerSpawn) return;
      this.healthWorkerSpawn().catch((err: Error) => {
        logger.warn(
          { attempt, startupTimeoutMs: this.healthWorkerStartupTimeout, error: err.message },
          'Health monitor worker restart failed',
        );
        this.scheduleHealthMonitorRestart(logger);
      });
    }, delay);
    this.healthWorkerRestartTimer.unref();
  }

  /**
   * Run node checks in the daemon while the worker is unavailable.
   *
   * Idempotent, and stopped as soon as the worker is back — two check loops
   * against the same fleet would double every remote host's load and write
   * two rows per interval.
   */
  private startFallbackNodeChecks(
    logger: import('@omnitron-dev/titan/module/logger').ILogger,
  ): void {
    if (this.fallbackNodeCheckTimer || !this.nodeManagerService) return;
    const declared = DEFAULT_DAEMON_CONFIG.healthMonitor ?? {};
    const intervalMs = this.dc.healthMonitor?.intervalMs ?? declared.intervalMs ?? 60_000;
    logger.warn({ intervalMs }, 'Checking nodes from the daemon until the health monitor returns');
    this.fallbackNodeCheckTimer = setInterval(() => {
      void this.nodeManagerService?.checkAllNodes();
    }, intervalMs);
    this.fallbackNodeCheckTimer.unref();
    void this.nodeManagerService.checkAllNodes();
  }

  private stopFallbackNodeChecks(): void {
    if (!this.fallbackNodeCheckTimer) return;
    clearInterval(this.fallbackNodeCheckTimer);
    this.fallbackNodeCheckTimer = null;
  }

  /** Aggregate counts from a worker batch → one console event. */
  private broadcastNodeCheckCompleted(summaries: Array<{ status?: string }>): void {
    if (!this.eventBroadcaster) return;
    const count = (s: string) => summaries.filter((x) => x.status === s).length;
    this.eventBroadcaster.broadcast(NODE_EVENTS.CHECK_COMPLETED, {
      nodeCount: summaries.length,
      onlineCount: count('online'),
      degradedCount: count('degraded'),
      offlineCount: count('offline'),
    });
  }

  /** One node's health changing → the channel named after the new state. */
  private broadcastNodeTransition(
    transition: import('../services/node-manager.service.js').NodeHealthTransition,
  ): void {
    if (!this.eventBroadcaster) return;
    const payload = {
      nodeId: transition.nodeId,
      status: transition.status,
      ...(transition.previousStatus ? { previousStatus: transition.previousStatus } : {}),
    };
    this.eventBroadcaster.broadcast(NODE_EVENTS.STATUS_UPDATED, payload);
    const channel =
      transition.status === 'online' ? NODE_EVENTS.WENT_ONLINE
        : transition.status === 'offline' ? NODE_EVENTS.WENT_OFFLINE
          : transition.status === 'degraded' ? NODE_EVENTS.WENT_DEGRADED
            : null;
    if (channel) this.eventBroadcaster.broadcast(channel, payload);
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

  /**
   * Point the file watcher at a reloaded config, if one is running.
   *
   * Public because `DaemonRpcService.reloadConfig` is the other half of the
   * same reload — the RPC and the SIGHUP handler must not diverge on what a
   * reload updates, which is exactly how the watcher came to be left out of
   * both.
   */
  applyWatchConfig(config: IEcosystemConfig): void {
    this.fileWatcher?.applyConfig(config);
  }

  disableWatch(): void {
    if (this.fileWatcher) {
      this.fileWatcher.stop();
      this.fileWatcher = null;
    }
  }

  /**
   * Whether file watching is running, and over what.
   *
   * `enabled` said only that a `FileWatcher` OBJECT existed. Observed on this
   * host: `{ enabled: true, apps: [] }` — a watcher running over nothing,
   * reported to an operator as "watching". Everyone downstream read the
   * boolean and concluded their edits were being picked up.
   *
   * The watch set is built from `config.apps` — the daemon's OWN ecosystem
   * config. Apps that arrive through the project registry are not in it, so a
   * daemon serving projects watches none of them however the flag reads.
   * `watching` is the fact an operator actually wants; `enabled` keeps its
   * old meaning so existing callers do not silently change behaviour, and
   * `reason` says why the two can disagree.
   */
  getWatchStatus(): {
    enabled: boolean;
    watching: boolean;
    reason?: string;
    apps: Array<{ name: string; directory: string }>;
  } {
    if (!this.fileWatcher) {
      return { enabled: false, watching: false, reason: 'the file watcher is not running', apps: [] };
    }
    const apps = this.fileWatcher.getWatchedApps();
    if (apps.length === 0) {
      return {
        enabled: true,
        watching: false,
        reason:
          'the watcher is running but no app matched: the watch set comes from this daemon\'s own ' +
          'ecosystem config, and apps registered through a project are not in it',
        apps,
      };
    }
    return { enabled: true, watching: true, apps };
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
   * Called by DaemonRpcService.shutdown() for the `omnitron down` CLI command.
   */
  async stop(): Promise<void> {
    if (!this.app) return;
    await this.app.shutdown(ShutdownReason.Manual);
    // Application doesn't process.exit() for Manual reason — do it explicitly
    process.exit(0);
  }

  /**
   * SIGHUP handler — reload the ecosystem config without taking the
   * daemon down. Follows the Unix convention (`man 7 signal`: "many
   * daemons interpret SIGHUP as a request to reread their configs").
   * Reloads via the same code path the `reloadConfig` RPC uses so
   * orchestrator + RPC service both pick up the new entries.
   */
  private async reloadConfigOnHup(): Promise<void> {
    if (!this.app) return;
    // Loading first, on its own: a malformed file must be rejected before
    // anything is touched, and that failure genuinely means "the daemon is as
    // it was".
    const { loadEcosystemConfig } = await import('../config/loader.js');
    const newConfig = await loadEcosystemConfig();

    // Applying is the other half, and it has no such guarantee — each
    // destination takes the config in turn, so a failure in the middle leaves
    // the daemon split. `applyReloadedConfig` names what applied and what did
    // not, because "reload failed" reads as "nothing changed" and that is the
    // wrong reading exactly when it matters.
    //
    // The handler used to end in `catch (err) { throw err; }`, which did
    // nothing whatever. Removing it is trivial; what it was standing in front
    // of is not.
    const { applyReloadedConfig } = await import('./config-reload.js');
    await applyReloadedConfig(newConfig, [
      {
        name: 'orchestrator',
        apply: async (cfg) => {
          const { ORCHESTRATOR_TOKEN } = await import('../shared/tokens.js');
          const orchestrator = await this.app!.container.resolveAsync<OrchestratorService>(ORCHESTRATOR_TOKEN);
          orchestrator.setConfig(cfg);
        },
      },
      {
        name: 'file watcher',
        // The watcher holds its own copy of the app list. Left out, a reload
        // updated who gets restarted but not who is watched: an app added to
        // the config was never watched, and one removed from it kept its
        // watchers and went on triggering restarts.
        apply: (cfg) => {
          this.applyWatchConfig(cfg);
        },
      },
      {
        name: 'RPC snapshot',
        // Exposed under DAEMON_SERVICE_ID; the reloadConfig RPC path mutates
        // `this.config` directly, so we mirror the same write. Unresolvable is
        // not a failure here — the service may not be exposed yet.
        apply: async (cfg) => {
          const { DAEMON_SERVICE_ID } = await import('../config/defaults.js');
          const daemonRpc = await this.app!.container
            .resolveAsync<DaemonRpcService>(DAEMON_SERVICE_ID)
            .catch(() => null);
          if (daemonRpc) {
            (daemonRpc as unknown as { config: typeof cfg }).config = cfg;
          }
        },
      },
    ]);

     
    console.info('[omnitron] SIGHUP — config reloaded');
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

    // D13: Application now drives shutdown via LifecycleController, which
    // emits per-phase events via ApplicationEvent.LifecyclePhaseEvent.
    // Forward `phase-finish` durations into the metrics bridge so the
    // `lifecycle_shutdown_phase_duration_seconds` histogram and the
    // `lifecycle_shutdown_phase_timeouts_total` counter populate.
    app.on(ApplicationEvent.LifecyclePhaseEvent, (event: any) => {
      const bridge = this.metricsBridge;
      if (!bridge) return;
      const phase = event?.phase;
      const kind = event?.kind;
      const durationMs = typeof event?.durationMs === 'number' ? event.durationMs : 0;
      if (!phase) return;
      try {
        if (kind === 'phase-finish') {
          bridge.recordLifecyclePhase(String(phase), durationMs, 'finish');
        } else if (kind === 'phase-timeout') {
          bridge.recordLifecyclePhase(String(phase), durationMs, 'timeout');
        }
      } catch {
        // Metrics are best-effort; never fail shutdown over telemetry.
      }
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
      if (this.metricsServer) {
        try {
          await this.metricsServer.stop();
        } catch { /* non-critical */ }
        this.metricsServer = null;
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
      // The mesh first: stop following the registry, then drop the
      // connections. Each one may hold an SSH tunnel, and a tunnel that
      // outlives its daemon holds a socket and a remote session open with
      // nothing left to notice.
      try {
        this.meshHandle?.stop();
      } catch { /* non-critical */ }
      this.meshHandle = null;

      if (this.slaveConnector) {
        try { await this.slaveConnector.dispose(); } catch { /* non-critical */ }
        this.slaveConnector = null;
      }

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

      // Before stopping the workers: a worker exiting on the way out must not
      // be read as a crash and rescheduled.
      this.isShuttingDown = true;
      this.healthWorkerSpawn = null;
      if (this.healthWorkerRestartTimer) {
        clearTimeout(this.healthWorkerRestartTimer);
        this.healthWorkerRestartTimer = null;
      }
      this.stopFallbackNodeChecks();

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
        // A node's infrastructure outlives its daemon.
        //
        // `teardown()` is `docker rm`, not `docker stop`, and this task runs
        // on every shutdown — so on a node, restarting the daemon would
        // remove the stack's Postgres, Redis and MinIO. `omnitron fleet
        // upgrade` restarts every node's daemon, which would have made a
        // routine upgrade take the test environment down with it.
        //
        // The daemon is the supervisor, not the owner of the data plane's
        // lifetime. Locally it still tears down — `omnitron down` there means
        // "I am done for the day" — and on either, `omnitron infra down` is
        // the command that removes containers on purpose.
        if (this.dc.role === 'slave') {
          // Said on the way out, because the absence of a teardown is
          // otherwise indistinguishable from a teardown that failed.
          console.info('[omnitron] leaving this node\'s infrastructure running — the daemon does not own its lifetime');
        } else {
          try { await this.infraService.teardown(); } catch { /* best-effort */ }
        }
        this.infraService = null;
      }
    }, ShutdownPriority.VeryLow);

    // --- Priority: Last (100) — PID file removal ---
    app.registerShutdownTask('remove-pid', () => {
      this.pidManager?.remove();
    }, ShutdownPriority.Last);
  }
}


/**
 * Call a method on a system worker's proxy.
 *
 * `ServiceProxy` is typed with an index signature whose values may be an
 * async iterable as well as a function, so a direct `worker.updateConfig(…)`
 * does not type-check. Resolving through one place keeps the cast in one
 * place, and returns without throwing when the worker is not running — the
 * only correct answer for "tell the health monitor" when there is none.
 */
async function callWorkerMethod(
  manager: import('../workers/system-worker-manager.js').SystemWorkerManager,
  method: string,
  ...args: unknown[]
): Promise<unknown> {
  const worker = manager.get<Record<string, unknown>>('health-monitor');
  if (!worker) return undefined;
  const fn = (worker as unknown as Record<string, unknown>)[method];
  if (typeof fn !== 'function') return undefined;
  return (fn as (...a: unknown[]) => unknown).apply(worker, args);
}
