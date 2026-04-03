/**
 * Default configuration values
 */

import os from 'node:os';
import path from 'node:path';
import type { IEcosystemConfig, IDaemonConfig } from './types.js';

export const OMNITRON_HOME = path.join(os.homedir(), '.omnitron');
export const CLI_VERSION = '0.1.0';
export const DAEMON_SERVICE_ID = 'OmnitronDaemon';

/** Default Unix socket path for local daemon RPC */
export const DEFAULT_SOCKET_PATH = path.join(OMNITRON_HOME, 'daemon.sock');

/** Default secrets file path */
export const DEFAULT_SECRETS_PATH = path.join(OMNITRON_HOME, 'secrets.enc');

export const DEFAULT_PORTS: Record<string, number> = {
  main: 3001,
  storage: 3002,
  priceverse: 3003,
  paysys: 3004,
  messaging: 3005,
};

/**
 * Internal daemon config — NOT from project config.
 * Omnitron daemon manages its own paths, ports, and operational settings.
 */
export const DEFAULT_DAEMON_CONFIG: IDaemonConfig = {
  socketPath: DEFAULT_SOCKET_PATH,
  port: 9700,
  host: '0.0.0.0',
  httpPort: 9800,
  pidFile: path.join(OMNITRON_HOME, 'daemon.pid'),
  stateFile: path.join(OMNITRON_HOME, 'state.json'),
  logDir: path.join(OMNITRON_HOME, 'logs'),
  role: 'master',
  cluster: {
    enabled: false,
    discovery: 'redis',
    electionTimeout: { min: 5_000, max: 15_000 },
    heartbeatInterval: 2_000,
  },
  secrets: {
    provider: 'file',
    path: DEFAULT_SECRETS_PATH,
  },
  healthMonitor: {
    intervalMs: 60_000, // 1 check per minute
    concurrency: 20,
    offlineTimeoutMs: 90_000,
    pingEnabled: true,
    pingTimeout: 5_000,
    sshTimeout: 10_000,
    omnitronCheckTimeout: 15_000,
    retentionDays: 90, // 90 days — need history for uptime bars
    uptimeIntervalMs: 86_400_000, // 24 hours per bar segment
  },
};

/**
 * Default project config — applied when omnitron.config.ts doesn't specify values.
 */
export const DEFAULT_ECOSYSTEM: Omit<IEcosystemConfig, 'apps'> = {
  supervision: {
    strategy: 'one_for_one',
    maxRestarts: 5,
    window: 60_000,
    backoff: { type: 'exponential', initial: 1_000, max: 30_000, factor: 2 },
  },
  monitoring: {
    healthCheck: { interval: 15_000, timeout: 5_000 },
    metrics: { interval: 5_000, retention: 3600 },
  },
  logging: {
    level: 'info',
    maxSize: '50mb',
    maxFiles: 10,
    compress: true,
  },
};
