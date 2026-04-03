/**
 * DaemonModule — Nexus DI module for the Omnitron daemon
 *
 * The daemon is a Titan Application that uses PM module for supervision.
 */

import fs from 'node:fs';
import { Module } from '@omnitron-dev/titan/decorators';
import { Scope } from '@omnitron-dev/titan/nexus';
import { ConfigModule } from '@omnitron-dev/titan/module/config';
import { LoggerModule, LOGGER_SERVICE_TOKEN, type ILoggerModule } from '@omnitron-dev/titan/module/logger';
import { ProcessManagerModule, PM_MANAGER_TOKEN, type ProcessManager } from '@omnitron-dev/titan-pm';
import { TitanAuthModule } from '@omnitron-dev/titan-auth';
import { SchedulerModule } from '@omnitron-dev/titan-scheduler';
import { TitanHealthModule } from '@omnitron-dev/titan-health';
import { TitanMetricsModule } from '@omnitron-dev/titan-metrics';

import { OrchestratorService } from '../orchestrator/orchestrator.service.js';
import { LogManager } from '../monitoring/log-manager.js';
import { StateStore } from './state-store.js';
import { InfrastructureGate } from '../infrastructure/infrastructure-gate.js';
import {
  ORCHESTRATOR_TOKEN,
  LOG_MANAGER_TOKEN,
  STATE_STORE_TOKEN,
  ECOSYSTEM_CONFIG_TOKEN,
  OMNITRON_DB_TOKEN,
  AUTH_SERVICE_TOKEN,
  LOG_COLLECTOR_TOKEN,
  FLEET_SERVICE_TOKEN,
  ALERT_SERVICE_TOKEN,
  DEPLOY_SERVICE_TOKEN,
  HEALTH_CHECK_SERVICE_TOKEN,
  DISCOVERY_SERVICE_TOKEN,
  KUBERNETES_SERVICE_TOKEN,
  PIPELINE_SERVICE_TOKEN,
  TRACE_COLLECTOR_TOKEN,
  BACKUP_SERVICE_TOKEN,
  SECRETS_SERVICE_TOKEN,
  TELEMETRY_RELAY_TOKEN,
  INFRASTRUCTURE_GATE_TOKEN,
  PROJECT_SERVICE_TOKEN,
  SLAVE_STORAGE_TOKEN,
} from '../shared/tokens.js';
import { AuthService } from '../services/auth.service.js';
import { LogCollectorService } from '../services/log-collector.service.js';
import { FleetService } from '../services/fleet.service.js';
import { AlertService } from '../services/alert.service.js';
import { DeployService } from '../services/deploy.service.js';
import { HealthCheckService } from '../services/health-check.service.js';
import { DiscoveryService } from '../services/discovery.service.js';
import { KubernetesService } from '../services/kubernetes.service.js';
import { PipelineService } from '../services/pipeline.service.js';
import { TraceCollectorService } from '../services/trace-collector.service.js';
import { BackupService } from '../services/backup.service.js';
import { SecretsService } from '../services/secrets.service.js';
import { createTelemetryRelay } from '../services/telemetry.service.js';
import { ProjectService } from '../services/project.service.js';
import { SlaveStorageService } from '../services/slave-storage.service.js';
import { Writable } from 'node:stream';
import type { Kysely } from 'kysely';
import type { OmnitronDatabase } from '../database/schema.js';
import type { IEcosystemConfig, IDaemonConfig } from '../config/types.js';

/**
 * Writable stream that can reopen its underlying file descriptor.
 *
 * After log rotation renames the current file, `reopen()` closes the old fd
 * and opens a new one at the same path. This ensures pino writes to the new
 * file rather than the old (renamed) inode.
 */
class ReopenableFileStream extends Writable {
  private fd: number;

  constructor(private readonly filePath: string) {
    super();
    this.fd = fs.openSync(filePath, 'a');
  }

  override _write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void): void {
    fs.write(this.fd, chunk, callback);
  }

  /** Close the current fd and open a fresh one at the same path. */
  reopen(): void {
    try {
      fs.closeSync(this.fd);
    } catch {
      // fd may already be closed
    }
    this.fd = fs.openSync(this.filePath, 'a');
  }

  override _destroy(_error: Error | null, callback: (error?: Error | null) => void): void {
    try {
      fs.closeSync(this.fd);
    } catch {
      // already closed
    }
    callback();
  }
}

/** Module-scoped reference to the daemon's log file stream — used for rotation reopen */
let daemonLogStream: ReopenableFileStream | null = null;
/** Daemon's error-only log stream (error + fatal) */
let daemonErrorStream: ReopenableFileStream | null = null;

/** Get the daemon's log stream for rotation-triggered reopening */
export function getDaemonLogStream(): ReopenableFileStream | null {
  return daemonLogStream;
}

/** Get the daemon's error log stream for rotation-triggered reopening */
export function getDaemonErrorStream(): ReopenableFileStream | null {
  return daemonErrorStream;
}

/**
 * Writable stream that forwards pino JSON lines to LogCollectorService.
 * Buffers lines until setCollector() is called (LogCollector initializes after Logger).
 */
class LogCollectorStream extends Writable {
  private collector: import('../services/log-collector.service.js').LogCollectorService | null = null;
  private pendingLines: string[] = [];

  override _write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void): void {
    const line = chunk.toString().trimEnd();
    if (!line) { callback(); return; }

    if (this.collector) {
      this.collector.ingestPinoLine('omnitron', line);
    } else {
      // Buffer until collector is available (cap at 500 to prevent unbounded growth)
      if (this.pendingLines.length < 500) this.pendingLines.push(line);
    }
    callback();
  }

  /** Wire the LogCollector once DI has resolved it */
  setCollector(collector: import('../services/log-collector.service.js').LogCollectorService): void {
    this.collector = collector;
    // Flush buffered lines
    for (const line of this.pendingLines) {
      collector.ingestPinoLine('omnitron', line);
    }
    this.pendingLines = [];
  }
}

/** Module-scoped reference for wiring in daemon.ts */
let daemonLogCollectorStream: LogCollectorStream | null = null;

/** Get the LogCollector stream for wiring */
export function getDaemonLogCollectorStream(): LogCollectorStream | null {
  return daemonLogCollectorStream;
}

/**
 * Creates the DaemonModule with injected ecosystem config.
 * The daemon itself runs ProcessManagerModule in 'child' isolation
 * with IPC transport — matching how PM manages child processes.
 */
export function createDaemonModule(ecosystemConfig: IEcosystemConfig, dc: IDaemonConfig) {
  const isSlave = dc.role === 'slave';

  @Module({
    imports: [
      ConfigModule.forRoot({
        sources: [{ type: 'env', prefix: 'OMNITRON_' }],
      }),

      LoggerModule.forRoot({
        level: (ecosystemConfig.logging as any)?.level || 'info',
        base: { app: 'omnitron', role: 'daemon' },
        redact: ['password', 'secret', 'token', 'authorization', 'cookie'],
        destinations: (() => {
          // Write daemon's own logs to ~/.omnitron/logs/omnitron.log (alongside stdout).
          // Uses ReopenableFileStream so LogManager can reopen after rotation.
          const logDir = dc.logDir.replace('~', process.env['HOME'] ?? '');
          fs.mkdirSync(logDir, { recursive: true });
          daemonLogStream = new ReopenableFileStream(`${logDir}/omnitron.log`);

          // Error-only stream — captures error+fatal to separate file for quick triage
          daemonErrorStream = new ReopenableFileStream(`${logDir}/omnitron.error.log`);

          // Feed daemon logs into LogCollector for webapp /logs page
          daemonLogCollectorStream = new LogCollectorStream();

          return [
            { stream: daemonLogStream },
            { stream: daemonErrorStream, level: 'error' as any },
            { stream: daemonLogCollectorStream },
          ];
        })(),
      }),

      // PM Module — child process isolation with Unix socket transport for Netron RPC.
      // IPC channel (process.send) remains for PM control plane (ready/error/shutdown).
      // Unix sockets provide the Netron data plane (service calls, health, metrics).
      ProcessManagerModule.forRoot({
        isolation: 'child',
        transport: 'unix',
        restartPolicy: {
          enabled: true,
          maxRestarts: ecosystemConfig.supervision.maxRestarts,
          window: ecosystemConfig.supervision.window,
          backoff: ecosystemConfig.supervision.backoff,
        },
        resources: {
          timeout: 60_000, // Allow up to 60s for tsx/bootstrap startup
        },
        monitoring: {
          healthCheck: {
            interval: ecosystemConfig.monitoring.healthCheck.interval,
            timeout: ecosystemConfig.monitoring.healthCheck.timeout,
          },
          metrics: true,
        },
      }),

      // Auth — JWT verification + caching via titan-auth (same as main/storage/messaging/paysys)
      TitanAuthModule.forRoot({
        algorithm: 'HS256',
        jwtSecret: (() => {
          const jwtSecret = dc.auth?.jwtSecret;
          if (!jwtSecret && process.env['NODE_ENV'] === 'production') {
            throw new Error('auth.jwtSecret must be configured in production mode');
          }
          return jwtSecret ?? 'omnitron-dev-jwt-secret';
        })(),
        issuer: 'omnitron',
        cacheEnabled: true,
        cacheTTL: 10_000,
        cacheMaxSize: 10_000,
        isGlobal: true,
      }),

      // Scheduler — replaces bare setInterval calls in daemon.ts
      SchedulerModule.forRoot({
        enabled: true,
        timezone: 'UTC',
        maxConcurrent: 10,
      }),

      // Metrics — unified collection, storage, query (replaces OmnitronMetricsService + MetricsCollectorService)
      TitanMetricsModule.forRoot({
        appName: 'omnitron',
        collection: {
          enabled: true,
          interval: ecosystemConfig.monitoring.metrics.interval,
          process: true,
          system: true,
          rpc: true,
        },
        storage: {
          type: 'memory',
          flushInterval: 5_000,
        },
        retention: {
          maxAge: '7d',
        },
        isGlobal: true,
      }),

      // Health — built-in memory + event loop indicators + custom indicators
      TitanHealthModule.forRoot({
        enableMemoryIndicator: true,
        enableEventLoopIndicator: true,
        enableCaching: true,
        cacheTtl: 5_000,
        isGlobal: true,
      }),
    ],
    providers: [
      // Ecosystem config
      [ECOSYSTEM_CONFIG_TOKEN, { useValue: ecosystemConfig }],

      // =====================================================================
      // Core providers (both master and slave)
      // =====================================================================

      // Slave SQLite storage (only active on slave daemons — no Docker/PG needed)
      ...(isSlave ? [[
        SLAVE_STORAGE_TOKEN,
        {
          useFactory: (loggerModule: ILoggerModule) =>
            new SlaveStorageService(loggerModule.logger),
          inject: [LOGGER_SERVICE_TOKEN],
          scope: Scope.Singleton,
        },
      ] as any] : []),

      // Infrastructure readiness gate (Scope.Singleton — shared by daemon + orchestrator)
      [
        INFRASTRUCTURE_GATE_TOKEN,
        {
          useFactory: () => new InfrastructureGate(),
          scope: Scope.Singleton,
        },
      ],

      // State persistence
      [
        STATE_STORE_TOKEN,
        {
          useFactory: () => new StateStore(dc.stateFile.replace('~', process.env['HOME'] ?? '')),
          scope: Scope.Singleton,
        },
      ],

      // Orchestrator (core logic, uses PM ProcessManager)
      [
        ORCHESTRATOR_TOKEN,
        {
          useFactory: (loggerModule: ILoggerModule, pm: ProcessManager, stateStore: StateStore) =>
            new OrchestratorService(loggerModule.logger, pm, stateStore),
          inject: [LOGGER_SERVICE_TOKEN, PM_MANAGER_TOKEN, STATE_STORE_TOKEN],
          scope: Scope.Singleton,
        },
      ],

      // Log manager — project-scoped directories, error.log separation, per-app rotation
      [
        LOG_MANAGER_TOKEN,
        {
          useFactory: (orchestrator: OrchestratorService) => {
            // Build per-app rotation overrides from ecosystem config
            const perApp = new Map<string, { maxSize?: string; maxFiles?: number; compress?: boolean }>();
            for (const app of ecosystemConfig.apps) {
              const logging = (app as any).observability?.logging;
              if (logging?.maxSize || logging?.maxFiles != null || logging?.compress != null) {
                perApp.set(app.name, {
                  maxSize: logging.maxSize,
                  maxFiles: logging.maxFiles,
                  compress: logging.compress,
                });
              }
            }
            const baseDir = dc.logDir.replace('~', process.env['HOME'] ?? '').replace(/\/logs\/?$/, '');
            return new LogManager(
              {
                baseDir,
                defaults: {
                  maxSize: ecosystemConfig.logging.maxSize,
                  maxFiles: ecosystemConfig.logging.maxFiles,
                  compress: ecosystemConfig.logging.compress,
                },
                perApp,
              },
              orchestrator,
            );
          },
          inject: [ORCHESTRATOR_TOKEN],
          scope: Scope.Singleton,
        },
      ],

      // Health check service (composable checks for apps + infra)
      [
        HEALTH_CHECK_SERVICE_TOKEN,
        {
          useFactory: (orchestrator: OrchestratorService) =>
            new HealthCheckService(orchestrator, () => null),
          inject: [ORCHESTRATOR_TOKEN],
          scope: Scope.Singleton,
        },
      ],

      // Kubernetes management (no DB dependency)
      [
        KUBERNETES_SERVICE_TOKEN,
        {
          useFactory: (loggerModule: ILoggerModule) => new KubernetesService(loggerModule.logger),
          inject: [LOGGER_SERVICE_TOKEN],
          scope: Scope.Singleton,
        },
      ],

      // Backup/restore automation (no DB dependency)
      [
        BACKUP_SERVICE_TOKEN,
        {
          useFactory: (loggerModule: ILoggerModule) => new BackupService(loggerModule.logger),
          inject: [LOGGER_SERVICE_TOKEN],
          scope: Scope.Singleton,
        },
      ],

      // Secrets management (encrypted at rest, file-based)
      [
        SECRETS_SERVICE_TOKEN,
        {
          useFactory: () => {
            const secretsPath = (dc.secrets?.path ?? '~/.omnitron/secrets.enc')
              .replace('~', process.env['HOME'] ?? '');
            const secretsPassphrase = dc.secrets?.passphrase;
            if (!secretsPassphrase && process.env['NODE_ENV'] === 'production') {
              throw new Error('secrets.passphrase must be configured in production mode');
            }
            return new SecretsService(secretsPath, secretsPassphrase ?? 'omnitron-dev-passphrase');
          },
          scope: Scope.Singleton,
        },
      ],

      // =====================================================================
      // Master-only providers (require PostgreSQL via OMNITRON_DB_TOKEN)
      // =====================================================================

      // Omnitron-PG Kysely connection (master only — slave uses SQLite)
      ...(!isSlave ? [[
        OMNITRON_DB_TOKEN,
        {
          useFactory: async () => {
            const { Kysely, PostgresDialect } = await import('kysely');
            const pg = await import('pg');
            const pool = new pg.default.Pool({
              host: 'localhost',
              port: 5480,
              database: 'omnitron',
              user: 'omnitron',
              password: 'omnitron',
              max: 10,
            });
            return new Kysely<OmnitronDatabase>({
              dialect: new PostgresDialect({ pool }),
            });
          },
          scope: Scope.Singleton,
        },
      ] as any] : []),

      // Auth service (master only — requires PG for sessions/users)
      ...(!isSlave ? [[
        AUTH_SERVICE_TOKEN,
        {
          useFactory: (db: Kysely<OmnitronDatabase>, loggerModule: ILoggerModule) => {
            const jwtSecret = dc.auth?.jwtSecret;
            if (!jwtSecret && process.env['NODE_ENV'] === 'production') {
              throw new Error('auth.jwtSecret must be configured in production mode');
            }
            if (!jwtSecret) {
              loggerModule.logger.warn(
                'No auth.jwtSecret configured — using insecure default. ' +
                'Set auth.jwtSecret in omnitron.config.ts for production.'
              );
            }
            return new AuthService(db, jwtSecret);
          },
          inject: [OMNITRON_DB_TOKEN, LOGGER_SERVICE_TOKEN],
          scope: Scope.Singleton,
        },
      ] as any] : []),

      // Log collector — master: PG, slave: SQLite (same column schema)
      ...(!isSlave ? [[
        LOG_COLLECTOR_TOKEN,
        {
          useFactory: (db: Kysely<OmnitronDatabase>) => new LogCollectorService(db),
          inject: [OMNITRON_DB_TOKEN],
          scope: Scope.Singleton,
        },
      ] as any] : [[
        LOG_COLLECTOR_TOKEN,
        {
          useFactory: async (_loggerModule: ILoggerModule, slaveStorage: SlaveStorageService) => {
            // On slave, reuse the singleton SlaveStorageService's SQLite — logs table has same columns
            const db = await slaveStorage.getDb();
            return new LogCollectorService(db as any);
          },
          inject: [LOGGER_SERVICE_TOKEN, SLAVE_STORAGE_TOKEN],
          scope: Scope.Singleton,
        },
      ] as any]),

      // Fleet management (master only — requires PG for node registry)
      ...(!isSlave ? [[
        FLEET_SERVICE_TOKEN,
        {
          useFactory: (db: Kysely<OmnitronDatabase>, loggerModule: ILoggerModule) =>
            new FleetService(db, loggerModule.logger),
          inject: [OMNITRON_DB_TOKEN, LOGGER_SERVICE_TOKEN],
          scope: Scope.Singleton,
        },
      ] as any] : []),

      // Project + Stack management
      // On master: receives FleetService for remote/cluster stacks
      // On slave: FleetService is null — only local stack management
      ...(!isSlave ? [[
        PROJECT_SERVICE_TOKEN,
        {
          useFactory: (loggerModule: ILoggerModule, orchestrator: OrchestratorService, fleet: any) =>
            new ProjectService(loggerModule.logger, orchestrator, fleet),
          inject: [LOGGER_SERVICE_TOKEN, ORCHESTRATOR_TOKEN, FLEET_SERVICE_TOKEN],
          scope: Scope.Singleton,
        },
      ] as any] : [[
        PROJECT_SERVICE_TOKEN,
        {
          useFactory: (loggerModule: ILoggerModule, orchestrator: OrchestratorService) =>
            new ProjectService(loggerModule.logger, orchestrator),
          inject: [LOGGER_SERVICE_TOKEN, ORCHESTRATOR_TOKEN],
          scope: Scope.Singleton,
        },
      ] as any]),

      // Alert evaluation engine (master only)
      ...(!isSlave ? [[
        ALERT_SERVICE_TOKEN,
        {
          useFactory: (db: Kysely<OmnitronDatabase>, orchestrator: OrchestratorService) =>
            new AlertService(db, orchestrator, () => ({})),
          inject: [OMNITRON_DB_TOKEN, ORCHESTRATOR_TOKEN],
          scope: Scope.Singleton,
        },
      ] as any] : []),

      // Deploy service (master only)
      ...(!isSlave ? [[
        DEPLOY_SERVICE_TOKEN,
        {
          useFactory: (db: Kysely<OmnitronDatabase>, orchestrator: OrchestratorService, loggerModule: ILoggerModule, healthCheck: HealthCheckService) =>
            new DeployService(db, orchestrator, loggerModule.logger, healthCheck),
          inject: [OMNITRON_DB_TOKEN, ORCHESTRATOR_TOKEN, LOGGER_SERVICE_TOKEN, HEALTH_CHECK_SERVICE_TOKEN],
          scope: Scope.Singleton,
        },
      ] as any] : []),

      // Discovery service (master only — depends on Fleet)
      ...(!isSlave ? [[
        DISCOVERY_SERVICE_TOKEN,
        {
          useFactory: (fleet: FleetService) => new DiscoveryService(fleet),
          inject: [FLEET_SERVICE_TOKEN],
          scope: Scope.Singleton,
        },
      ] as any] : []),

      // CI/CD Pipeline execution (master only)
      ...(!isSlave ? [[
        PIPELINE_SERVICE_TOKEN,
        {
          useFactory: (db: Kysely<OmnitronDatabase>, loggerModule: ILoggerModule) =>
            new PipelineService(db, loggerModule.logger),
          inject: [OMNITRON_DB_TOKEN, LOGGER_SERVICE_TOKEN],
          scope: Scope.Singleton,
        },
      ] as any] : []),

      // Distributed trace collector (master only)
      ...(!isSlave ? [[
        TRACE_COLLECTOR_TOKEN,
        {
          useFactory: (db: Kysely<OmnitronDatabase>, loggerModule: ILoggerModule) =>
            new TraceCollectorService(db, loggerModule.logger),
          inject: [OMNITRON_DB_TOKEN, LOGGER_SERVICE_TOKEN],
          scope: Scope.Singleton,
        },
      ] as any] : []),

      // Telemetry relay (master only — store-and-forward pipeline)
      ...(!isSlave ? [[
        TELEMETRY_RELAY_TOKEN,
        {
          useFactory: (
            db: Kysely<OmnitronDatabase>,
            logCollector: LogCollectorService,
            loggerModule: ILoggerModule,
          ) =>
            createTelemetryRelay({ db, logCollector, logger: loggerModule.logger }),
          inject: [OMNITRON_DB_TOKEN, LOG_COLLECTOR_TOKEN, LOGGER_SERVICE_TOKEN],
          scope: Scope.Singleton,
        },
      ] as any] : []),
    ],
  })
  class DaemonModule {}

  return DaemonModule;
}
