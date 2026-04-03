/**
 * Typed Event Constants — Domain events emitted across daemon services
 *
 * Used with Titan EventsModule for decoupled pub/sub between:
 *   - Orchestrator (app lifecycle)
 *   - Infrastructure (container lifecycle)
 *   - Monitoring (metrics, health, alerts)
 *   - EventBroadcaster (WebSocket push to webapp)
 */

// =============================================================================
// App Lifecycle Events
// =============================================================================

export const APP_EVENTS = {
  STARTED: 'app.started',
  STOPPED: 'app.stopped',
  CRASHED: 'app.crashed',
  RESTARTING: 'app.restarting',
  SCALED: 'app.scaled',
  HEALTH_CHANGED: 'app.health_changed',
} as const;

export interface AppStartedEvent {
  name: string;
  pid: number | null;
  mode: 'classic' | 'bootstrap';
  instances: number;
}

export interface AppStoppedEvent {
  name: string;
  reason: 'manual' | 'shutdown' | 'dependency';
}

export interface AppCrashedEvent {
  name: string;
  error: string;
  restarts: number;
  critical: boolean;
}

export interface AppRestartingEvent {
  name: string;
  attempt: number;
}

export interface AppScaledEvent {
  name: string;
  from: number;
  to: number;
}

export interface AppHealthChangedEvent {
  name: string;
  previous: string;
  current: string;
}

// =============================================================================
// Infrastructure Events
// =============================================================================

export const INFRA_EVENTS = {
  READY: 'infra.ready',
  DEGRADED: 'infra.degraded',
  FAILED: 'infra.failed',
  SERVICE_UP: 'infra.service_up',
  SERVICE_DOWN: 'infra.service_down',
  SERVICE_RESTARTED: 'infra.service_restarted',
} as const;

export interface InfraReadyEvent {
  services: string[];
  provisionTimeMs: number;
}

export interface InfraDegradedEvent {
  unhealthyServices: string[];
  reason: string;
}

export interface InfraFailedEvent {
  error: string;
}

export interface InfraServiceEvent {
  service: string;
  image: string;
  status: string;
}

// =============================================================================
// Alert Events
// =============================================================================

export const ALERT_EVENTS = {
  FIRED: 'alert.fired',
  RESOLVED: 'alert.resolved',
  ACKNOWLEDGED: 'alert.acknowledged',
} as const;

export interface AlertFiredEvent {
  ruleId: string;
  ruleName: string;
  severity: string;
  value: string;
  message: string;
}

export interface AlertResolvedEvent {
  ruleId: string;
  ruleName: string;
  duration: number;
}

// =============================================================================
// Metrics Events
// =============================================================================

export const METRICS_EVENTS = {
  COLLECTED: 'metrics.collected',
} as const;

export interface MetricsCollectedEvent {
  timestamp: number;
  appCount: number;
  totalCpu: number;
  totalMemory: number;
}

// =============================================================================
// Project Events
// =============================================================================

export const PROJECT_EVENTS = {
  ADDED: 'project.added',
  REMOVED: 'project.removed',
  CONFIG_RELOADED: 'project.config_reloaded',
} as const;

export interface ProjectAddedEvent {
  name: string;
  path: string;
}

export interface ProjectRemovedEvent {
  name: string;
}

export interface ProjectConfigReloadedEvent {
  name: string;
}

// =============================================================================
// Stack Events
// =============================================================================

export const STACK_EVENTS = {
  STARTING: 'stack.starting',
  STARTED: 'stack.started',
  STOPPING: 'stack.stopping',
  STOPPED: 'stack.stopped',
  ERROR: 'stack.error',
  INFRA_READY: 'stack.infra_ready',
  SYNC_COMPLETED: 'stack.sync_completed',
  SYNC_FAILED: 'stack.sync_failed',
  DEPLOY_PROGRESS: 'stack.deploy_progress',
  NODE_CONNECTED: 'stack.node_connected',
  NODE_DISCONNECTED: 'stack.node_disconnected',
} as const;

export interface StackStartingEvent {
  project: string;
  stack: string;
  type: 'local' | 'remote' | 'cluster';
}

export interface StackStartedEvent {
  project: string;
  stack: string;
  type: 'local' | 'remote' | 'cluster';
  appCount: number;
  nodeCount: number;
}

export interface StackStoppedEvent {
  project: string;
  stack: string;
  reason: 'manual' | 'error' | 'shutdown';
}

export interface StackErrorEvent {
  project: string;
  stack: string;
  error: string;
}

export interface StackSyncCompletedEvent {
  project: string;
  stack: string;
  nodeHost: string;
  itemsSynced: number;
  durationMs: number;
}

export interface StackSyncFailedEvent {
  project: string;
  stack: string;
  nodeHost: string;
  error: string;
  pendingItems: number;
}

export interface StackDeployProgressEvent {
  project: string;
  stack: string;
  node: string;
  app: string;
  status: string;
  progress: number;
  message: string;
}

export interface StackNodeConnectedEvent {
  project: string;
  stack: string;
  host: string;
  port: number;
}

export interface StackNodeDisconnectedEvent {
  project: string;
  stack: string;
  host: string;
  port: number;
  reason: string;
}

// =============================================================================
// Node Events
// =============================================================================

export const NODE_EVENTS = {
  STATUS_UPDATED: 'node.status_updated',
  WENT_ONLINE: 'node.went_online',
  WENT_OFFLINE: 'node.went_offline',
  WENT_DEGRADED: 'node.went_degraded',
  CHECK_COMPLETED: 'node.check_completed',
} as const;

export interface NodeStatusUpdatedEvent {
  nodeId: string;
  status: 'online' | 'degraded' | 'offline' | 'unknown';
  previousStatus?: string;
}

export interface NodeCheckCompletedEvent {
  nodeCount: number;
  onlineCount: number;
  degradedCount: number;
  offlineCount: number;
}

// =============================================================================
// Daemon Events
// =============================================================================

export const DAEMON_EVENTS = {
  STARTED: 'daemon.started',
  STOPPING: 'daemon.stopping',
  CONFIG_RELOADED: 'daemon.config_reloaded',
} as const;

// =============================================================================
// All Event Types (for WebSocket broadcast channel filtering)
// =============================================================================

export const ALL_EVENT_CHANNELS = [
  ...Object.values(APP_EVENTS),
  ...Object.values(INFRA_EVENTS),
  ...Object.values(ALERT_EVENTS),
  ...Object.values(METRICS_EVENTS),
  ...Object.values(PROJECT_EVENTS),
  ...Object.values(STACK_EVENTS),
  ...Object.values(NODE_EVENTS),
  ...Object.values(DAEMON_EVENTS),
] as const;

export type EventChannel = (typeof ALL_EVENT_CHANNELS)[number];

/** Generic event envelope for WebSocket broadcast */
export interface DaemonEvent<T = unknown> {
  channel: EventChannel;
  timestamp: number;
  data: T;
}
