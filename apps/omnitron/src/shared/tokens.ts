/**
 * Omnitron DI Tokens
 */

import { createToken } from '@omnitron-dev/titan/nexus';
import type { Kysely } from 'kysely';
import type { OrchestratorService } from '../orchestrator/orchestrator.service.js';
import type { LogManager } from '../monitoring/log-manager.js';
import type { StateStore } from '../daemon/state-store.js';
import type { IEcosystemConfig } from '../config/types.js';
import type { OmnitronDatabase } from '../database/schema.js';
import type { AuthService } from '../services/auth.service.js';
import type { LogCollectorService } from '../services/log-collector.service.js';
import type { FleetService } from '../services/fleet.service.js';
import type { AlertService } from '../services/alert.service.js';
import type { DeployService } from '../services/deploy.service.js';
import type { HealthCheckService } from '../services/health-check.service.js';
import type { DiscoveryService } from '../services/discovery.service.js';
import type { KubernetesService } from '../services/kubernetes.service.js';
import type { PipelineService } from '../services/pipeline.service.js';
import type { TraceCollectorService } from '../services/trace-collector.service.js';
import type { BackupService } from '../services/backup.service.js';
import type { SecretsService } from '../services/secrets.service.js';
import type { TelemetryRelayService } from '@omnitron-dev/titan-telemetry-relay';
import type { InfrastructureGate } from '../infrastructure/infrastructure-gate.js';
import type { InfrastructureService } from '../infrastructure/infrastructure.service.js';
import type { ProjectService } from '../services/project.service.js';

type Token<T> = ReturnType<typeof createToken<T>>;

export const ORCHESTRATOR_TOKEN: Token<OrchestratorService> = createToken<OrchestratorService>('Orchestrator');
export const LOG_MANAGER_TOKEN: Token<LogManager> = createToken<LogManager>('LogManager');
export const STATE_STORE_TOKEN: Token<StateStore> = createToken<StateStore>('StateStore');
export const ECOSYSTEM_CONFIG_TOKEN: Token<IEcosystemConfig> = createToken<IEcosystemConfig>('EcosystemConfig');

/** Kysely connection to omnitron-pg (port 5480) */
export const OMNITRON_DB_TOKEN: Token<Kysely<OmnitronDatabase>> = createToken<Kysely<OmnitronDatabase>>('OmnitronDb');
/** Portal authentication service */
export const AUTH_SERVICE_TOKEN: Token<AuthService> = createToken<AuthService>('AuthService');
/** Structured log collector (writes to omnitron-pg) */
export const LOG_COLLECTOR_TOKEN: Token<LogCollectorService> = createToken<LogCollectorService>('LogCollector');

/** Fleet management (multi-node cluster) */
export const FLEET_SERVICE_TOKEN: Token<FleetService> = createToken<FleetService>('FleetService');
/** Alert rule-based evaluation engine */
export const ALERT_SERVICE_TOKEN: Token<AlertService> = createToken<AlertService>('AlertServiceInternal');
/** Application deployment with strategies */
export const DEPLOY_SERVICE_TOKEN: Token<DeployService> = createToken<DeployService>('DeployService');
/** Composable health checks (apps + infra) */
export const HEALTH_CHECK_SERVICE_TOKEN: Token<HealthCheckService> = createToken<HealthCheckService>('HealthCheckService');
/** Auto-discovery (Docker + SSH) */
export const DISCOVERY_SERVICE_TOKEN: Token<DiscoveryService> = createToken<DiscoveryService>('DiscoveryService');
/** Kubernetes cluster management */
export const KUBERNETES_SERVICE_TOKEN: Token<KubernetesService> = createToken<KubernetesService>('KubernetesService');
/** CI/CD Pipeline execution */
export const PIPELINE_SERVICE_TOKEN: Token<PipelineService> = createToken<PipelineService>('PipelineService');
/** Distributed trace collector */
export const TRACE_COLLECTOR_TOKEN: Token<TraceCollectorService> = createToken<TraceCollectorService>('TraceCollectorService');
/** Database backup/restore automation */
export const BACKUP_SERVICE_TOKEN: Token<BackupService> = createToken<BackupService>('BackupService');
/** Encrypted secrets storage */
export const SECRETS_SERVICE_TOKEN: Token<SecretsService> = createToken<SecretsService>('SecretsService');
/** Telemetry relay (store-and-forward pipeline) */
export const TELEMETRY_RELAY_TOKEN: Token<TelemetryRelayService> = createToken<TelemetryRelayService>('TelemetryRelayService');

/** Infrastructure readiness gate */
export const INFRASTRUCTURE_GATE_TOKEN: Token<InfrastructureGate> = createToken<InfrastructureGate>('InfrastructureGate');
/** Infrastructure service — manages Docker containers */
export const INFRASTRUCTURE_SERVICE_TOKEN: Token<InfrastructureService> = createToken<InfrastructureService>('InfrastructureService');

/** Project + Stack management service */
export const PROJECT_SERVICE_TOKEN: Token<ProjectService> = createToken<ProjectService>('ProjectService');

/** SQLite storage for slave daemons (replaces OMNITRON_DB_TOKEN on slaves) */
export { SlaveStorageService } from '../services/slave-storage.service.js';
import type { SlaveStorageService } from '../services/slave-storage.service.js';
export const SLAVE_STORAGE_TOKEN: Token<SlaveStorageService> = createToken<SlaveStorageService>('SlaveStorage');
